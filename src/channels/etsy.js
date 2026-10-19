const {channelFetch}=require('./request');
const { config } = require('../config');
const { getToken, setToken } = require('../services/tokenStore');
const { fromUnixSeconds, maxDate } = require('../utils/dates');

function apiKeyHeader() {
  if (!config.etsy.clientId) return '';
  return config.etsy.clientSecret
    ? `${config.etsy.clientId}:${config.etsy.clientSecret}`
    : config.etsy.clientId;
}

function assertConfigured() {
  if (!config.etsy.clientId || !config.etsy.shopId) {
    throw new Error('ETSY_CLIENT_ID and ETSY_SHOP_ID are required.');
  }
}

async function refreshAccessToken(token) {
  if (!token || !token.refresh_token) {
    throw new Error('Etsy is not authorized yet. Open /auth/etsy/start.');
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.etsy.clientId,
    refresh_token: token.refresh_token
  });

  if (config.etsy.clientSecret) {
    body.set('client_secret', config.etsy.clientSecret);
  }

  const response = await channelFetch(config.etsy.tokenUrl, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-api-key': apiKeyHeader()
    },
    body
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok || !data.access_token) {
    throw new Error(`Etsy token refresh failed: ${response.status} ${text}`);
  }

  const next = {
    ...token,
    ...data,
    expires_at: new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString()
  };
  await setToken('etsy', next);
  return next;
}

async function getAccessToken() {
  assertConfigured();
  const token = await getToken('etsy');
  const expiresAt = token && token.expires_at ? new Date(token.expires_at).getTime() : 0;

  if (token && token.access_token && Date.now() < expiresAt - 60000) {
    return token.access_token;
  }

  const refreshed = await refreshAccessToken(token);
  return refreshed.access_token;
}

async function etsyJson(path, options = {}) {
  const accessToken = await getAccessToken();
  const response = await channelFetch(`${config.etsy.apiBaseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'x-api-key': apiKeyHeader(),
      ...(options.headers || {})
    },
    body: options.body
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error=new Error(`Etsy API failed: ${response.status} ${text}`);error.httpStatus=response.status;throw error;
  }

  return data;
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function buildAddress(receipt) {
  if (receipt.formatted_address) return decodeHtmlEntities(receipt.formatted_address);

  return [
    receipt.name || receipt.first_line_name,
    receipt.first_line,
    receipt.second_line,
    receipt.city,
    receipt.state,
    receipt.zip,
    receipt.country_iso || receipt.country_name
  ].filter(Boolean).map(decodeHtmlEntities).join('\n');
}

async function hydrateReceipt(receipt) {
  if (Array.isArray(receipt.transactions) && receipt.transactions.length) {
    return receipt;
  }

  const id = receipt.receipt_id || receipt.id;
  if (!id) return receipt;
  return etsyJson(`/shops/${encodeURIComponent(config.etsy.shopId)}/receipts/${encodeURIComponent(id)}?legacy=true`);
}

function normalizeReceipt(receipt) {
  const id = receipt.receipt_id || receipt.id;
  const createdAt = fromUnixSeconds(receipt.created_timestamp || receipt.created_at);
  const updatedAt = fromUnixSeconds(receipt.updated_timestamp || receipt.updated_at) || createdAt;
  const transactions = Array.isArray(receipt.transactions) ? receipt.transactions : [];
  const transactionShipByDate = maxDate(transactions.map((transaction) => fromUnixSeconds(transaction.expected_ship_date)));
  const shipByDate = transactionShipByDate || fromUnixSeconds(receipt.expected_ship_timestamp);
  const shipments = Array.isArray(receipt.shipments) ? receipt.shipments : [];
  const firstShipment = shipments.find((shipment) => shipment && (shipment.tracking_code || shipment.tracking_url)) || shipments[0] || {};
  const trackingCode = firstShipment.tracking_code || '';
  const rawSkus = transactions.map((transaction) => ({
    source_id: transaction.transaction_id == null ? '' : String(transaction.transaction_id),
    sku: transaction.sku || transaction.title || 'No SKU',
    title: decodeHtmlEntities(transaction.title || ''),
    quantity: Number(transaction.quantity || 1),
    variations: (transaction.selected_variations || [])
      .map((v) => String(v.formatted_value || '').trim())
      .filter(Boolean)
  }));

  const grandtotal = receipt.grandtotal || {};
  const revenueAmount = grandtotal.amount != null
    ? (grandtotal.divisor ? Number(grandtotal.amount) / Number(grandtotal.divisor) : Number(grandtotal.amount))
    : null;
  const revenueCurrency = grandtotal.currency_code || null;

  return {
    channel: 'etsy',
    vendor: 'Etsy.com',
    externalOrderId: String(id),
    orderName: String(id),
    status: receipt.status || (receipt.was_shipped ? 'shipped' : 'open'),
    shipped: Boolean(receipt.was_shipped || shipments.some(shipment=>Number(shipment?.shipment_notification_timestamp)>0)),
    rawSkus,
    createdAt,
    updatedAtSource: updatedAt,
    shipByDate,
    address: buildAddress(receipt),
    note: decodeHtmlEntities(receipt.message_from_buyer || ''),
    isGift: Boolean(receipt.is_gift),
    giftMessage: decodeHtmlEntities(receipt.gift_message || ''),
    trackingCode,
    trackingUrl: trackingCode ? `https://tandt.posta.sk/en/items/${encodeURIComponent(trackingCode)}` : 'https://tandt.posta.sk/en/items/',
    orderUrl: `https://www.etsy.com/your/orders/${id}`,
    sourcePayload: receipt,
    revenueAmount,
    revenueCurrency
  };
}

async function poll({ since }) {
  assertConfigured();

  const limit = 100;
  const minLastModified = Math.floor(new Date(since).getTime() / 1000);
  const fetchReceiptPages = async (filters) => {
    const receipts = new Map();
    let offset = 0;
    while (true) {
      const params = new URLSearchParams({
        ...filters,
        legacy: 'true',
        limit: String(limit),
        offset: String(offset)
      });
      const payload = await etsyJson(`/shops/${encodeURIComponent(config.etsy.shopId)}/receipts?${params}`);
      const pageItems = payload.results || payload.receipts || [];
      if (!pageItems.length) break;
      const previousSize = receipts.size;
      for (const item of pageItems) {
        const receipt = await hydrateReceipt(item);
        const id = receipt.receipt_id || receipt.id;
        if (!id) throw new Error('Etsy returned an order without an ID.');
        receipts.set(String(id), receipt);
      }
      if (receipts.size === previousSize) throw new Error('Etsy pagination repeated a page. Synchronization was not completed.');
      offset += pageItems.length;
      if ((payload.count && offset >= Number(payload.count)) || pageItems.length < limit) break;
    }
    return receipts;
  };

  const changedReceipts = await fetchReceiptPages({ min_last_modified: String(minLastModified) });
  const receipts = new Map(changedReceipts);
  // Etsy does not consistently advance a receipt's modified timestamp when an
  // item's expected ship date changes. Refresh all unshipped receipts so these
  // changes reach the app even when they fall outside the modified-date cursor.
  const openReceipts = await fetchReceiptPages({ was_shipped: 'false' });
  for (const [id, receipt] of openReceipts) receipts.set(id, receipt);

  const orders = [...receipts.values()].map(normalizeReceipt);
  const nextCursor = maxDate([...changedReceipts.values()].map((receipt) =>
    fromUnixSeconds(receipt.updated_timestamp || receipt.updated_at || receipt.created_timestamp || receipt.created_at)
  )) || since;

  return { orders, nextCursor };
}

module.exports = {
  poll,
  getAccessToken,
  refreshAccessToken,
  apiKeyHeader
};

async function getReceiptShipment(receiptId){
 if(!/^[1-9][0-9]*$/.test(String(receiptId))||!/^[1-9][0-9]*$/.test(String(config.etsy.shopId)))throw new Error('Invalid Etsy receipt or shop ID.');
 return etsyJson(`/shops/${config.etsy.shopId}/receipts/${receiptId}?legacy=true`);
}
async function sendReceiptShipment(receiptId,trackingCode,carrier='other'){
 const token=await getToken('etsy');
 if(token?.scope&&!String(token.scope).split(/\s+/).includes('transactions_w')){
  const error=new Error('Reconnect Etsy and approve shipping updates before confirming dispatch.');error.httpStatus=403;error.dispatchMessage=error.message;throw error;
 }
 return etsyJson(`/shops/${config.etsy.shopId}/receipts/${receiptId}/tracking`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tracking_code:trackingCode,carrier_name:carrier,send_bcc:false})});
}
module.exports.getReceiptShipment=getReceiptShipment;
module.exports.sendReceiptShipment=sendReceiptShipment;
