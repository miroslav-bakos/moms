const {channelFetch}=require('./request');
'use strict';

const crypto = require('crypto');
const { config } = require('../config');
const { maxDate } = require('../utils/dates');

const CARRIER_LABELS = {
  1: 'Slovenská pošta',
  2: 'Kuriér',
  3: 'Packeta',
  4: 'Osobný odber',
  5: 'Na poštu / Balíkobox'
};

function assertConfigured() {
  if (!config.sashe.userId || !config.sashe.apiKey) {
    throw new Error('Sashe requires SASHE_USER_ID and SASHE_API_KEY.');
  }
}

function fmtDateTimeParam(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function buildHash(userId, dateTimeFrom, dateTimeTo, apiKey) {
  const message = String(userId) + dateTimeFrom + dateTimeTo;
  return crypto.createHmac('sha256', apiKey).update(message).digest('hex').toUpperCase();
}

function buildAddress(pkg) {
  // Packeta: fullAddress contains the pickup point
  if (Number(pkg.carrier) === 3) return pkg.fullAddress || '';
  const name = [pkg.firstname, pkg.lastname].filter(Boolean).join(' ');
  const zipCity = [pkg.postcode, pkg.city].filter(Boolean).join(' ');
  return [name, pkg.address, zipCity, pkg.country, pkg.phone].filter(Boolean).join('\n');
}

function parseTracking(raw) {
  if (!raw) return { trackingCode: '', trackingUrl: '' };
  if (raw.startsWith('http')) {
    try {
      const u = new URL(raw);
      const code = u.searchParams.get('match') || u.searchParams.get('id') || u.searchParams.get('number') || '';
      return { trackingCode: code, trackingUrl: raw };
    } catch (_) {
      return { trackingCode: '', trackingUrl: raw };
    }
  }
  return { trackingCode: raw, trackingUrl: '' };
}

function normalizeOrder(pkg) {
  const rawSkus = (pkg.products || []).map((p) => ({
    sku: String(p.idRemote || p.idSashe || ''),
    title: p.name || '',
    quantity: Number(p.quantity || 1),
    variantTitle: ''
  }));

  const carrier = CARRIER_LABELS[Number(pkg.carrier)] || String(pkg.carrier || '');
  const { trackingCode, trackingUrl } = parseTracking(pkg.tracking_code || '');

  const rawAmount = pkg.total_paid ?? pkg.total_price ?? pkg.price ?? pkg.total ?? null;
  const revenueAmount = rawAmount != null ? Number(rawAmount) : null;
  const revenueCurrency = pkg.currency || 'EUR';

  return {
    channel: 'sashe',
    vendor: 'Sashe',
    externalOrderId: String(pkg.vs),
    orderName: String(pkg.vs),
    status: String(pkg.status || 'open'),
    shipped: Boolean(pkg.tracking_code),
    rawSkus,
    createdAt: pkg.creation_date ? new Date(pkg.creation_date) : null,
    updatedAtSource: pkg.creation_date ? new Date(pkg.creation_date) : null,
    shipByDate: null,
    address: buildAddress(pkg),
    note: [pkg.note, carrier ? `Carrier: ${carrier}` : ''].filter(Boolean).join('\n'),
    isGift: false,
    giftMessage: '',
    trackingCode,
    trackingUrl,
    orderUrl: `https://www.sashe.sk/chcem/moje-zakazky?hfpid=${encodeURIComponent(pkg.vs)}&hflogin=&hfaddress=&hfprice=&hfpackage_submit=H%C4%BEadaj`,
    sourcePayload: pkg,
    revenueAmount,
    revenueCurrency
  };
}

async function poll({ since }) {
  assertConfigured();

  const { userId, apiKey } = config.sashe;
  const dateTimeFrom = fmtDateTimeParam(since);
  const dateTimeTo = fmtDateTimeParam(new Date());
  const hash = buildHash(userId, dateTimeFrom, dateTimeTo, apiKey);

  // Build URL manually to avoid %3A encoding of colons in datetime params
  const url = `https://www.sashe.sk/direct/api/packages.php?userId=${userId}&dateTimeFrom=${dateTimeFrom}&dateTimeTo=${dateTimeTo}&hash=${hash}`;

  const res = await channelFetch(url,{retry:false});
  const text = await res.text();
  if (!res.ok) throw new Error(`Sashe API HTTP ${res.status}: ${text}`);

  const data = JSON.parse(text);
  if (data.error_no) throw new Error(`Sashe API error ${data.error_no}: ${data.error_message}`);

  const rawPackages = data.packages;
  if (!Array.isArray(rawPackages)) throw new Error('Sashe returned an invalid packages list. Synchronization was not completed.');
  const uniquePackages = new Map();
  for (const pkg of rawPackages) {
    if (!pkg || !String(pkg.vs ?? '').trim()) throw new Error('Sashe returned an order without an ID.');
    uniquePackages.set(String(pkg.vs), pkg);
  }
  const orders = [...uniquePackages.values()].map(normalizeOrder);
  const nextCursor = maxDate(orders.map((o) => o.updatedAtSource)) || since;
  return { orders, nextCursor };
}

module.exports = { poll };
