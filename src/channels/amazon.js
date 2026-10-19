const {channelFetch}=require('./request');
const { config } = require('../config');
const { getToken, setToken } = require('../services/tokenStore');
const { maxDate } = require('../utils/dates');

const ENDPOINT_GROUPS = {
  na: { host: 'sellingpartnerapi-na.amazon.com', awsRegion: 'us-east-1' },
  eu: { host: 'sellingpartnerapi-eu.amazon.com', awsRegion: 'eu-west-1' },
  fe: { host: 'sellingpartnerapi-fe.amazon.com', awsRegion: 'us-west-2' }
};

const SELLER_CENTRAL_URLS = {
  ca: 'https://sellercentral.amazon.ca',
  us: 'https://sellercentral.amazon.com',
  mx: 'https://sellercentral.amazon.com.mx',
  br: 'https://sellercentral.amazon.com.br',
  ie: 'https://sellercentral.amazon.ie',
  es: 'https://sellercentral-europe.amazon.com',
  uk: 'https://sellercentral-europe.amazon.com',
  fr: 'https://sellercentral-europe.amazon.com',
  be: 'https://sellercentral.amazon.com.be',
  nl: 'https://sellercentral.amazon.nl',
  de: 'https://sellercentral-europe.amazon.com',
  it: 'https://sellercentral-europe.amazon.com',
  se: 'https://sellercentral.amazon.se',
  pl: 'https://sellercentral.amazon.pl',
  tr: 'https://sellercentral.amazon.com.tr'
};

function assertConfigured() {
  if (!config.amazon.lwaClientId || !config.amazon.lwaClientSecret) {
    throw new Error('Amazon LWA client id/secret are required.');
  }
  if (!config.amazon.refreshToken) {
    throw new Error('AMAZON_REFRESH_TOKEN is required. For private apps, generate it with self-authorization in Seller Central or the Solution Provider Portal.');
  }
  if (!Object.keys(config.amazon.marketplaceIds).length) {
    throw new Error('AMAZON_MARKETPLACE_IDS is required.');
  }
}

function regionConfig() {
  return ENDPOINT_GROUPS[config.amazon.regionGroup] || ENDPOINT_GROUPS.eu;
}

function amzDateParts(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8)
  };
}

function encode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

function flattenQuery(query = {}) {
  const pairs = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) pairs.push([key, item]);
    } else {
      pairs.push([key, value]);
    }
  }
  return pairs.sort((a, b) => {
    const keyCompare = String(a[0]).localeCompare(String(b[0]));
    return keyCompare || String(a[1]).localeCompare(String(b[1]));
  });
}

function canonicalQuery(query) {
  return flattenQuery(query).map(([key, value]) => `${encode(key)}=${encode(value)}`).join('&');
}

function queryString(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue;
    params.append(key, Array.isArray(value) ? value.join(',') : value);
  }
  return params.toString();
}

async function getLwaAccessToken() {
  assertConfigured();
  const stored = await getToken('amazon_lwa');
  const expiresAt = stored && stored.expires_at ? new Date(stored.expires_at).getTime() : 0;

  if (stored && stored.access_token && Date.now() < expiresAt - 60000) {
    return stored.access_token;
  }

  const refreshToken = (stored && stored.refresh_token) || config.amazon.refreshToken;
  if (!refreshToken) {
    throw new Error('AMAZON_REFRESH_TOKEN is missing. Authorize Amazon or set the refresh token.');
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.amazon.lwaClientId,
    client_secret: config.amazon.lwaClientSecret
  });

  const response = await channelFetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok || !data.access_token) {
    const error = new Error(`Amazon LWA refresh failed: ${response.status} ${text}`);
    error.status = response.status;
    throw error;
  }

  const token = {
    ...data,
    refresh_token: refreshToken,
    expires_at: new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString()
  };
  await setToken('amazon_lwa', token);
  return token.access_token;
}

async function amazonRequest({ method = 'GET', path, query = {}, body = null, accessToken = null, signal }) {
  assertConfigured();
  const group = regionConfig();
  const bodyText = body ? JSON.stringify(body) : '';
  const { amzDate } = amzDateParts();
  const token = accessToken || await getLwaAccessToken();
  const qs = queryString(query);
  const url = `https://${group.host}${path}${qs ? `?${qs}` : ''}`;
  const response = await channelFetch(url, {
    method,
    headers: {
      'x-amz-date': amzDate,
      'x-amz-access-token': token,
      'Accept': 'application/json',
      'user-agent': 'local-orders-app/0.1.0 (Language=JavaScript; Platform=Node.js)',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: bodyText || undefined,
    signal
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = new Error(`Amazon SP-API failed: ${response.status} ${text}`);
    error.status = response.status;
    throw error;
  }

  return data.payload || data;
}

function marketplaceIds() {
  return Object.values(config.amazon.marketplaceIds);
}

function firstMarketplaceRegion() {
  return Object.keys(config.amazon.marketplaceIds)[0] || 'de';
}

function marketplaceRegionById(marketplaceId) {
  const wanted = String(marketplaceId || '');
  for (const [region, id] of Object.entries(config.amazon.marketplaceIds)) {
    if (id === wanted) return region;
  }
  return firstMarketplaceRegion();
}

function sellerCentralOrderUrl(orderId, marketplaceId = '') {
  const region = marketplaceRegionById(marketplaceId);
  const base = SELLER_CENTRAL_URLS[region] || SELLER_CENTRAL_URLS.de;
  return `${base}/orders-v3/order/${orderId}`;
}

function normalizeAddress(address) {
  if (!address) return '';
  return [
    address.Name || address.name,
    address.AddressLine1 || address.addressLine1,
    address.AddressLine2 || address.addressLine2,
    address.AddressLine3 || address.addressLine3,
    address.City || address.city,
    address.StateOrRegion || address.stateOrRegion,
    address.PostalCode || address.postalCode,
    address.CountryCode || address.countryCode
  ].filter(Boolean).join('\n');
}

async function createRestrictedDataToken(orderId) {
  const path = `/orders/v0/orders/${encodeURIComponent(orderId)}/address`;
  const payload = await amazonRequest({
    method: 'POST',
    path: '/tokens/2021-03-01/restrictedDataToken',
    body: {
      restrictedResources: [{ method: 'GET', path }]
    }
  });

  if (!payload.restrictedDataToken) {
    throw new Error('Amazon did not return a restricted data token.');
  }

  return payload.restrictedDataToken;
}

async function fetchLegacyAddress(orderId) {
  if (!config.amazon.fetchAddress) return '';
  const rdt = await createRestrictedDataToken(orderId);
  const payload = await amazonRequest({
    method: 'GET',
    path: `/orders/v0/orders/${encodeURIComponent(orderId)}/address`,
    accessToken: rdt
  });
  return normalizeAddress(payload.ShippingAddress || payload.shippingAddress);
}

async function fetchLegacyItems(orderId) {
  const items = [];
  let nextToken = '';
  const visitedTokens = new Set();

  do {
    if (visitedTokens.has(nextToken)) throw new Error('Amazon pagination repeated a token. Synchronization was not completed.');
    visitedTokens.add(nextToken);
    const query = nextToken ? { NextToken: nextToken } : {};
    const payload = await amazonRequest({
      method: 'GET',
      path: `/orders/v0/orders/${encodeURIComponent(orderId)}/orderItems`,
      query
    });
    items.push(...(payload.OrderItems || payload.orderItems || []));
    nextToken = payload.NextToken || payload.nextToken || '';
  } while (nextToken);

  return items;
}

function normalizeLegacyOrder(order, items, address) {
  const orderId = order.AmazonOrderId || order.amazonOrderId;
  const marketplaceId = order.MarketplaceId || order.marketplaceId || '';
  const rawSkus = (items || []).map((item) => ({
    source_id: String(item.OrderItemId || item.orderItemId || ''),
    sku: item.SellerSKU || item.sellerSKU || item.SellerSku || item.sellerSku || item.Title || 'No SKU',
    title: item.Title || item.title || '',
    quantity: Number(item.QuantityOrdered || item.quantityOrdered || 1)
  }));

  const orderTotal = order.OrderTotal || order.orderTotal || {};
  const revenueAmount = orderTotal.Amount != null ? Number(orderTotal.Amount) : null;
  const revenueCurrency = orderTotal.CurrencyCode || null;

  return {
    channel: 'amazon',
    vendor: `Amazon.${marketplaceRegionById(marketplaceId)}`,
    externalOrderId: String(orderId),
    orderName: String(orderId),
    status: order.OrderStatus || order.orderStatus || '',
    rawSkus,
    createdAt: order.PurchaseDate || order.purchaseDate,
    updatedAtSource: order.LastUpdateDate || order.lastUpdateDate || order.PurchaseDate || order.purchaseDate,
    shipByDate: order.LatestShipDate || order.latestShipDate || order.PurchaseDate || order.purchaseDate,
    address,
    note: '',
    isGift: false,
    giftMessage: '',
    orderUrl: sellerCentralOrderUrl(orderId, marketplaceId),
    sourcePayload: { order, items },
    revenueAmount,
    revenueCurrency
  };
}

function normalizeCurrentOrder(order) {
  const orderId = order.amazonOrderId || order.AmazonOrderId || order.orderId || order.id;
  const marketplaceId = order.marketplaceId || order.MarketplaceId || '';
  const buyer = order.buyer || {};
  const recipient = order.recipient || {};
  const deliveryAddress = recipient.deliveryAddress || order.shippingAddress || {};
  const rawItems = order.orderItems || order.items || order.lineItems || [];
  const rawSkus = rawItems.map((item) => ({
    source_id: String(item.orderItemId || item.OrderItemId || item.id || ''),
    sku: item.sellerSku ||
      item.sellerSKU ||
      item.sku ||
      (item.product && (item.product.sellerSku || item.product.sellerSKU || item.product.sku || item.product.asin)) ||
      item.title ||
      (item.product && item.product.title) ||
      'No SKU',
    title: item.title || item.productTitle || (item.product && item.product.title) || '',
    quantity: Number(item.quantityOrdered || item.quantity || item.itemQuantity || 1)
  }));

  const orderTotal = order.orderTotal || order.OrderTotal || {};
  const revenueAmount = orderTotal.amount != null ? Number(orderTotal.amount)
    : orderTotal.Amount != null ? Number(orderTotal.Amount) : null;
  const revenueCurrency = orderTotal.currencyCode || orderTotal.CurrencyCode || null;

  return {
    channel: 'amazon',
    vendor: `Amazon.${marketplaceRegionById(marketplaceId)}`,
    externalOrderId: String(orderId),
    orderName: String(orderId),
    status: order.orderStatus || order.OrderStatus || '',
    rawSkus,
    createdAt: order.purchaseDate || order.PurchaseDate || order.createdAt || order.createdTime,
    updatedAtSource: order.lastUpdatedDate || order.LastUpdateDate || order.updatedAt || order.lastUpdatedTime || order.purchaseDate || order.createdTime,
    shipByDate: order.latestShipDate || order.LatestShipDate || order.purchaseDate || order.createdTime,
    address: normalizeAddress(deliveryAddress),
    note: '',
    isGift: Boolean(order.isGift || (buyer && buyer.giftMessage)),
    giftMessage: buyer.giftMessage || '',
    orderUrl: sellerCentralOrderUrl(orderId, marketplaceId),
    sourcePayload: order,
    revenueAmount,
    revenueCurrency
  };
}

async function pollLegacy({ since }) {
  const orders = [];
  let nextToken = '';
  const visitedTokens = new Set();

  do {
    if (visitedTokens.has(nextToken)) throw new Error('Amazon pagination repeated a token. Synchronization was not completed.');
    visitedTokens.add(nextToken);
    const query = nextToken
      ? { NextToken: nextToken }
      : {
          LastUpdatedAfter: new Date(since).toISOString(),
          MarketplaceIds: marketplaceIds(),
          MaxResultsPerPage: 100
        };
    const payload = await amazonRequest({
      method: 'GET',
      path: '/orders/v0/orders',
      query
    });
    const pageOrders = payload.Orders || payload.orders || [];

    for (const order of pageOrders) {
      const orderId = order.AmazonOrderId || order.amazonOrderId;
      if (!orderId) throw new Error('Amazon returned an order without an ID.');
      const items = await fetchLegacyItems(orderId);
      let address = '';
      try {
        address = await fetchLegacyAddress(orderId);
      } catch (error) {
        address = '';
      }
      orders.push(normalizeLegacyOrder(order, items, address));
    }

    nextToken = payload.NextToken || payload.nextToken || '';
  } while (nextToken);

  const uniqueOrders = [...new Map(orders.map(order => [order.externalOrderId, order])).values()];
  return {
    orders: uniqueOrders,
    nextCursor: maxDate(orders.map((order) => order.updatedAtSource || order.createdAt)) || since
  };
}

async function pollCurrent({ since }) {
  const orders = [];
  let nextToken = '';
  const visitedTokens = new Set();

  do {
    if (visitedTokens.has(nextToken)) throw new Error('Amazon pagination repeated a token. Synchronization was not completed.');
    visitedTokens.add(nextToken);
    const query = nextToken
      ? { nextToken }
      : {
          lastUpdatedAfter: new Date(since).toISOString(),
          marketplaceIds: marketplaceIds()
        };
    const payload = await amazonRequest({
      method: 'GET',
      path: `/orders/${config.amazon.ordersApiVersion}/orders`,
      query
    });
    const pageOrders = payload.orders || payload.Orders || [];
    for (const order of pageOrders) {
      if (!(order.amazonOrderId || order.AmazonOrderId || order.orderId || order.id)) throw new Error('Amazon returned an order without an ID.');
      orders.push(normalizeCurrentOrder(order));
    }
    nextToken = payload.nextToken || payload.NextToken || '';
  } while (nextToken);

  const uniqueOrders = [...new Map(orders.map(order => [order.externalOrderId, order])).values()];
  return {
    orders: uniqueOrders,
    nextCursor: maxDate(orders.map((order) => order.updatedAtSource || order.createdAt)) || since
  };
}

async function poll(args) {
  assertConfigured();
  if (String(config.amazon.ordersApiVersion).toLowerCase() === 'v0') {
    return pollLegacy(args);
  }
  return pollCurrent(args);
}

async function getSolicitationEligibility(order) {
  const orderId = order.external_order_id;
  if (!orderId) return false;
  const payload = order.source_payload || {};
  const marketplaceId = payload.MarketplaceId || Object.values(config.amazon.marketplaceIds)[0];
  if (!marketplaceId) return false;
  try {
    const result = await amazonRequest({
      method: 'GET',
      path: `/solicitations/v1/orders/${encodeURIComponent(orderId)}/solicitations`,
      query: { marketplaceIds: marketplaceId }
    });
    const actions = result?._links?.actions || [];
    return actions.some((a) => a.name === 'productReviewAndSellerFeedback');
  } catch (err) {
    console.error('getSolicitationEligibility failed for order', orderId, err.message);
    return false;
  }
}

async function requestFeedback(order) {
  const orderId = order.external_order_id;
  if (!orderId) throw new Error('Order has no external_order_id');
  const payload = order.source_payload || {};
  const marketplaceId = payload.MarketplaceId || Object.values(config.amazon.marketplaceIds)[0];
  if (!marketplaceId) throw new Error('Cannot determine marketplace ID for this order');
  await amazonRequest({
    method: 'POST',
    path: `/solicitations/v1/orders/${encodeURIComponent(orderId)}/solicitations/productReviewAndSellerFeedback`,
    query: { marketplaceIds: marketplaceId }
  });
}

module.exports = {
  poll,
  getLwaAccessToken,
  amazonRequest,
  requestFeedback,
  getSolicitationEligibility
};

// confirmShipment remains an Orders v0 operation; the current API supplies packages
// for reconciliation. A fixed numeric package reference is retained in PostgreSQL.
async function getDispatchOrder(orderId){
 const result=await amazonRequest({path:`/orders/2026-01-01/orders/${encode(orderId)}`,query:{includedData:['FULFILLMENT','PACKAGES']}});
 if(!result.order)throw new Error('Amazon did not return dispatch details.');
 return result.order;
}
function dispatchCarrier(attempt){
 return attempt.carrier_name==='gls'?{carrierCode:'GLS',shippingMethod:'Business Parcel'}:{carrierCode:'Other',carrierName:'Slovak Post',shippingMethod:'Parcel'};
}
function packageCarrierMatches(attempt,p){
 // Reconcile uncertain writes against their persisted payload, including legacy names.
 const expected=attempt.request_payload.remote?.packageDetail||dispatchCarrier(attempt);
 return String(p.carrier||'').toLowerCase()===String(expected.carrierName||expected.carrierCode).toLowerCase()&&p.shippingService===expected.shippingMethod;
}
function prepareDispatch(attempt,remote){
 const {sameItems,rejected}=require('./dispatchUtils');
 const local=attempt.request_payload.items;
 if(remote.fulfillment?.fulfilledBy!=='MERCHANT'||remote.fulfillment?.fulfillmentStatus!=='UNSHIPPED'||!sameItems(local,(remote.orderItems||[]).map(i=>({id:i.orderItemId,quantity:i.quantityOrdered}))))throw rejected('Review Amazon order quantities and fulfillment before dispatch.');
 const marketplace=remote.salesChannel?.marketplaceId;
 if(!marketplace||!marketplaceIds().includes(marketplace))throw rejected('Amazon marketplace is not configured for this order.');
 if((remote.packages||[]).some(p=>p.packageStatus?.status!=='CANCELLED'))throw rejected('Amazon already has a package. Review tracking before dispatch.');
 return {marketplaceId:marketplace,packageDetail:{packageReferenceId:String(attempt.package_reference_id),...dispatchCarrier(attempt),trackingNumber:attempt.tracking_code,shipDate:new Date(attempt.request_payload.ship_date).toISOString(),orderItems:local.map(i=>({orderItemId:i.id,quantity:i.quantity}))}};
}
function existingDispatchPackage(attempt,remote){
 const {sameItems}=require('./dispatchUtils');const active=(remote.packages||[]).filter(p=>p.packageStatus?.status!=='CANCELLED');
 if(active.length!==1)return null;const p=active[0];
 return /^\d+$/.test(String(p.packageReferenceId))&&BigInt(p.packageReferenceId)>0n&&BigInt(p.packageReferenceId)<=9223372036854775807n&&p.trackingNumber===attempt.tracking_code&&packageCarrierMatches(attempt,p)&&['SHIPPED','IN_TRANSIT','DELIVERED'].includes(p.packageStatus?.status)&&sameItems(attempt.request_payload.items,(p.packageItems||[]).map(i=>({id:i.orderItemId,quantity:i.quantity})))?p:null;
}
module.exports.existingDispatchPackage=existingDispatchPackage;
function dispatchFound(attempt,remote){
 const {sameItems}=require('./dispatchUtils');
 return (remote.packages||[]).some(p=>String(p.packageReferenceId)===String(attempt.package_reference_id)&&p.trackingNumber===attempt.tracking_code&&packageCarrierMatches(attempt,p)&&['SHIPPED','IN_TRANSIT','DELIVERED'].includes(p.packageStatus?.status)&&sameItems(attempt.request_payload.items,(p.packageItems||[]).map(i=>({id:i.orderItemId,quantity:i.quantity}))));
}
async function sendDispatch(attempt){
 try{await amazonRequest({method:'POST',path:`/orders/v0/orders/${encode(attempt.receipt_id)}/shipmentConfirmation`,body:attempt.request_payload.remote});}
 catch(error){error.httpStatus=error.status;throw error;}
}
module.exports.getDispatchOrder=getDispatchOrder;
module.exports.prepareDispatch=prepareDispatch;
module.exports.dispatchFound=dispatchFound;
module.exports.sendDispatch=sendDispatch;
