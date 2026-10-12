const {channelFetch}=require('./request');
const { config } = require('../config');
const { maxDate } = require('../utils/dates');
const { getToken, setToken } = require('../services/tokenStore');

function assertConfigured() {
  if (!config.shopify.shopDomain) {
    throw new Error('Shopify requires SHOPIFY_SHOP_DOMAIN.');
  }
}

function resolveShopDomain() {
  const raw = config.shopify.shopDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return raw.includes('.') ? raw : `${raw}.myshopify.com`;
}

let clientTokenRequest;
async function getClientToken() {
  const host=resolveShopDomain();
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(host)||!config.shopify.clientId||!config.shopify.clientSecret)throw new Error('Configure the Shopify shop domain, client ID and client secret.');
  const identity=require('node:crypto').createHash('sha256').update(JSON.stringify([host,config.shopify.clientId,config.shopify.clientSecret])).digest('hex');
  const stored=await getToken('shopify');
  if(stored?.client_identity===identity && stored.access_token && Date.parse(stored.expires_at)>Date.now()+60000)return stored.access_token;
  const response=await channelFetch(`https://${host}/admin/oauth/access_token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:config.shopify.clientId,client_secret:config.shopify.clientSecret}).toString()});
  if(!response.ok)throw new Error('Shopify could not authorize this app. Check that the app is installed on a store in the same organization and that its credentials are correct.');
  const token=await response.json();
  if(typeof token.access_token!=='string'||!token.access_token||!Number.isFinite(Number(token.expires_in))||Number(token.expires_in)<=60)throw new Error('Shopify returned an invalid access token.');
  await setToken('shopify',{...token,client_identity:identity});return token.access_token;
}
async function getAccessToken() {
  if(config.shopify.authMode==='client_credentials') {
    if(!clientTokenRequest)clientTokenRequest=getClientToken().finally(()=>{clientTokenRequest=null;});
    return clientTokenRequest;
  }
  if (config.shopify.accessToken) return config.shopify.accessToken;
  const stored = await getToken('shopify');
  if (stored && stored.access_token) return stored.access_token;
  throw new Error('Shopify is not authorized. Visit /auth/shopify/start to authorize.');
}

function parseLinkHeader(header) {
  if (!header) return null;
  const parts = header.split(',');
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

async function shopifyJson(url) {
  const token = await getAccessToken();
const response = await channelFetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-Shopify-Access-Token': token
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(`Shopify API failed: ${response.status} ${text}`);
  }

  return {
    data,
    nextUrl: parseLinkHeader(response.headers.get('link'))
  };
}

function shopifyAdminOrderUrl(order) {
  if (config.shopify.adminOrderUrlTemplate) {
    return config.shopify.adminOrderUrlTemplate
      .replace('{id}', encodeURIComponent(order.id))
      .replace('{name}', encodeURIComponent(order.name || order.order_number || order.id));
  }

  const handle = resolveShopDomain().replace(/\.myshopify\.com$/, '');
  return `https://admin.shopify.com/store/${handle}/orders/${order.id}`;
}

function buildAddress(address) {
  if (!address) return '';
  return [
    address.name,
    address.company,
    address.address1,
    address.address2,
    address.city,
    address.province,
    address.zip,
    address.country_code || address.country,
    address.phone
  ].filter(Boolean).join('\n');
}

function firstTracking(order) {
  const fulfillments = Array.isArray(order.fulfillments) ? order.fulfillments : [];
  for (const fulfillment of fulfillments) {
    if (fulfillment.tracking_number || fulfillment.tracking_url) {
      return {
        trackingCode: fulfillment.tracking_number || '',
        trackingUrl: fulfillment.tracking_url || ''
      };
    }
  }
  return { trackingCode: '', trackingUrl: '' };
}

function normalizeOrder(order) {
  const tracking = firstTracking(order);
  const rawSkus = (order.line_items || []).map((item) => ({
    source_id: item.id == null ? '' : String(item.id),
    sku: item.sku || item.title || 'No SKU',
    title: item.title || item.name || '',
    quantity: Number(item.quantity || 1),
    variantTitle: item.variant_title || ''
  }));

  const revenueAmount = order.current_total_price != null ? Number(order.current_total_price) : null;
  const revenueCurrency = order.currency || null;

  return {
    channel: 'shopify',
    vendor: 'Shopify',
    externalOrderId: String(order.id),
    orderName: order.name || String(order.order_number || order.id),
    status: order.cancelled_at ? 'cancelled' : (order.fulfillment_status || order.financial_status || 'open'),
    rawSkus,
    createdAt: order.created_at,
    updatedAtSource: order.updated_at,
    shipByDate: null,
    address: buildAddress(order.shipping_address),
    note: order.note || '',
    isGift: false,
    giftMessage: '',
    trackingCode: tracking.trackingCode,
    trackingUrl: tracking.trackingUrl,
    orderUrl: shopifyAdminOrderUrl(order),
    sourcePayload: order,
    revenueAmount,
    revenueCurrency
  };
}

async function poll({ since }) {
  assertConfigured();
  if(config.shopify.authMode==='client_credentials')return require('./shopifyOrdersGraphql').poll({since,graphql:dispatchGraphql,normalize:normalizeOrder});

  const fields = [
    'id',
    'name',
    'order_number',
    'created_at',
    'updated_at',
    'cancelled_at',
    'financial_status',
    'fulfillment_status',
    'note',
    'email',
    'line_items',
    'shipping_address',
    'fulfillments',
    'order_status_url',
    'current_total_price',
    'currency'
  ].join(',');
  const params = new URLSearchParams({
    status: 'any',
    updated_at_min: new Date(since).toISOString(),
    limit: '250',
    fields
  });

  let nextUrl = `https://${resolveShopDomain()}/admin/api/${config.shopify.apiVersion}/orders.json?${params}`;
  const imported = new Map();
  const visited = new Set();

  while (nextUrl) {
    if (visited.has(nextUrl)) throw new Error('Shopify pagination repeated a page. Synchronization was not completed.');
    visited.add(nextUrl);
    const page = await shopifyJson(nextUrl);
    for (const order of page.data.orders || []) {
      if (!order.id) throw new Error('Shopify returned an order without an ID.');
      imported.set(String(order.id), normalizeOrder(order));
    }
    nextUrl = page.nextUrl;
  }

  const orders = [...imported.values()];
  const nextCursor = maxDate(orders.map((order) => order.updatedAtSource || order.createdAt)) || since;
  return { orders, nextCursor };
}

// Read-only financial query; no bank or payout actions are requested.
async function fetchPaymentBalances(signal) {
  assertConfigured();
  const token = await getAccessToken();
  const response = await channelFetch(`https://${resolveShopDomain()}/admin/api/${config.shopify.apiVersion}/graphql.json`, {
    method: 'POST', signal,
    headers: {'Content-Type': 'application/json', 'X-Shopify-Access-Token': token},
    body: JSON.stringify({query: '{ shopifyPaymentsAccount { balance { amount currencyCode } } }'})
  });
  if (!response.ok) {
    const error = new Error('Shopify balance request failed');
    error.status = response.status;
    throw error;
  }
  const payload = await response.json();
  if (payload.errors?.length) {
    const error = new Error('Shopify balance query failed');
    error.status = payload.errors.some(item => item.extensions?.code === 'ACCESS_DENIED') ? 403 : 502;
    throw error;
  }
  const account = payload.data?.shopifyPaymentsAccount;
  if (account === null) return null;
  if (!account || !Array.isArray(account.balance)) throw new Error('Invalid Shopify balance response');
  return account.balance;
}

module.exports = { poll, fetchPaymentBalances };

async function dispatchGraphql(query,variables){
 assertConfigured();const response=await channelFetch(`https://${resolveShopDomain()}/admin/api/${config.shopify.apiVersion}/graphql.json`,{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':await getAccessToken()},body:JSON.stringify({query,variables})});
 const result=await response.json();
 if(!response.ok){const error=new Error('Shopify dispatch request failed.');error.httpStatus=response.status;throw error;}
 if(result.errors?.length){const error=new Error('Shopify dispatch permissions or request failed.');if(!result.data)error.httpStatus=400;throw error;}
 if(!result.data)throw new Error('Shopify dispatch returned no data.');return result.data;
}
async function getDispatchOrder(orderId){
 // Fetch line connections separately: nesting 250-item connections exceeds
 // Shopify's query cost limit even for a small order.
 const data=await dispatchGraphql(`query MomsDispatch($id:ID!){order(id:$id){id cancelledAt lineItems(first:250){nodes{id quantity sku} pageInfo{hasNextPage}} fulfillments(first:50){id status trackingInfo{company number url}} fulfillmentOrders(first:50){nodes{id status supportedActions{action} assignedLocation{location{id}}} pageInfo{hasNextPage}}}}`,{id:`gid://shopify/Order/${orderId}`});
 if(!data.order)throw new Error('Shopify order was not found.');
 const order=data.order;
 if(order.lineItems?.pageInfo?.hasNextPage||order.fulfillmentOrders?.pageInfo?.hasNextPage||order.fulfillments?.length===50)throw new Error('Shopify order has too many fulfillment lines. Review it on Shopify.');
 for(const o of order.fulfillmentOrders?.nodes||[]){
  const result=await dispatchGraphql(`query MomsDispatchLines($id:ID!){fulfillmentOrder(id:$id){lineItems(first:250){nodes{id remainingQuantity lineItem{id}} pageInfo{hasNextPage}}}}`,{id:o.id});
  if(!result.fulfillmentOrder?.lineItems||result.fulfillmentOrder.lineItems.pageInfo?.hasNextPage)throw new Error('Shopify fulfillment lines are incomplete.');
  o.lineItems=result.fulfillmentOrder.lineItems;
 }
 for(const f of order.fulfillments||[]){
  const result=await dispatchGraphql(`query MomsDispatchShipment($id:ID!){fulfillment(id:$id){fulfillmentLineItems(first:250){nodes{quantity lineItem{id}} pageInfo{hasNextPage}}}}`,{id:f.id});
  if(!result.fulfillment?.fulfillmentLineItems||result.fulfillment.fulfillmentLineItems.pageInfo?.hasNextPage)throw new Error('Shopify shipment lines are incomplete.');
  f.fulfillmentLineItems=result.fulfillment.fulfillmentLineItems;
 }
 return order;
}
function prepareDispatch(attempt,remote){
 const {sameItems,rejected}=require('./dispatchUtils');const local=attempt.request_payload.items;
 const key=id=>String(id).split('/').pop();
 if(remote.cancelledAt||!sameItems(local,(remote.lineItems?.nodes||[]).map(i=>({id:key(i.id),quantity:i.quantity})))||(remote.fulfillments||[]).some(f=>f.status!=='CANCELLED'&&f.status!=='ERROR'&&f.status!=='FAILURE'))throw rejected('Review Shopify order quantities and fulfillment before dispatch.');
 const orders=(remote.fulfillmentOrders?.nodes||[]).filter(o=>(o.lineItems?.nodes||[]).some(l=>l.remainingQuantity>0));
 const locations=new Set(orders.map(o=>o.assignedLocation?.location?.id));
 if(!orders.length||locations.size!==1||locations.has(undefined)||orders.some(o=>!o.supportedActions?.some(a=>a.action==='CREATE_FULFILLMENT')))throw rejected('Shopify fulfillment is not available at one location. Review it on Shopify.');
 const quantities=new Map();for(const o of orders)for(const l of o.lineItems.nodes)if(l.remainingQuantity>0){const id=key(l.lineItem.id);quantities.set(id,(quantities.get(id)||0)+l.remainingQuantity);}
 if(!sameItems(local,[...quantities].map(([id,quantity])=>({id,quantity}))))throw rejected('Review Shopify remaining quantities before dispatch.');
 const tracking={company:attempt.carrier_name==='gls'?'GLS':'Other',number:attempt.tracking_code};
 const url=attempt.request_payload.tracking_url||(attempt.carrier_name!=='gls'?`http://tandt.posta.sk/en/items/${encodeURIComponent(attempt.tracking_code)}`:'');if(url)tracking.url=url;
 return {lineItemsByFulfillmentOrder:orders.map(o=>({fulfillmentOrderId:o.id,fulfillmentOrderLineItems:o.lineItems.nodes.filter(l=>l.remainingQuantity>0).map(l=>({id:l.id,quantity:l.remainingQuantity}))})),notifyCustomer:true,trackingInfo:tracking};
}
function dispatchFound(attempt,remote){
 const {sameItems}=require('./dispatchUtils');const company=attempt.carrier_name==='gls'?'GLS':'Other',url=attempt.request_payload.remote?.trackingInfo?.url||attempt.request_payload.tracking_url||(attempt.carrier_name!=='gls'?`http://tandt.posta.sk/en/items/${encodeURIComponent(attempt.tracking_code)}`:'');
 return (remote.fulfillments||[]).some(f=>{
  const quantities=new Map();for(const l of f.fulfillmentLineItems?.nodes||[]){const id=String(l.lineItem.id).split('/').pop();quantities.set(id,(quantities.get(id)||0)+l.quantity);}
  return f.status==='SUCCESS'&&f.trackingInfo?.some(t=>t.number===attempt.tracking_code&&t.company===company&&(!url||t.url===url))&&sameItems(attempt.request_payload.items,[...quantities].map(([id,quantity])=>({id,quantity})));
 });
}
async function sendDispatch(attempt){
 const data=await dispatchGraphql(`mutation MomsDispatch($fulfillment:FulfillmentInput!){fulfillmentCreate(fulfillment:$fulfillment){fulfillment{id status} userErrors{field message}}}`,{fulfillment:attempt.request_payload.remote});
 const result=data.fulfillmentCreate;
 if(result?.userErrors?.length&&!result.fulfillment)throw require('./dispatchUtils').rejected('Shopify rejected the shipment.');
 if(!result?.fulfillment?.id||result.fulfillment.status!=='SUCCESS')throw new Error('Shopify shipment outcome is unclear.');
}
module.exports.dispatchIdentity=()=>resolveShopDomain().toLowerCase();
module.exports.getDispatchOrder=getDispatchOrder;
module.exports.prepareDispatch=prepareDispatch;
module.exports.dispatchFound=dispatchFound;
module.exports.sendDispatch=sendDispatch;
