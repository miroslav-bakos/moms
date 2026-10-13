'use strict';
// Only provider-reported funds. Orders, sales and scheduled payouts are not balances.
// Sources: developer-docs.amazon/sp-api/reference/listbalances;
// shopify.dev/docs/api/admin-graphql/2026-04/objects/ShopifyPaymentsAccount;
// developers.etsy.com/documentation/tutorials/payments/ (running ledger only).
const { config } = require('../config');
const { amazonRequest } = require('../channels/amazon');
const { fetchPaymentBalances } = require('../channels/shopify');

function money(value, currency) {
  if (!/^[A-Z]{3}$/.test(currency || '') || !['string', 'number'].includes(typeof value) ||
      String(value).length > 64 || !/^-?\d+(\.\d{1,12})?$/.test(String(value)) || !Number.isFinite(Number(value)) ||
      Math.abs(Number(value)) > Number.MAX_SAFE_INTEGER) throw new Error('Invalid balance amount');
  return { amount: String(value), currency };
}
function sourceTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid balance timestamp');
  return date.toISOString();
}
function amazonRows(balances, markets = {}) {
  if (!Array.isArray(balances)) throw new Error('Invalid Amazon balance response');
  const seen = new Set();
  return balances.map(balance => {
    if (balance.balanceType !== 'TOTAL' || balance.asOfDate) throw new Error('Expected current total balance');
    const meta = balance.partnerMetadata;
    if (!meta?.marketplaceId || !meta.accountType) throw new Error('Missing balance account');
    const total = money(balance.amount?.currencyAmount, balance.amount?.currencyCode);
    const key = JSON.stringify([meta.marketplaceId, meta.accountType, total.currency]);
    if (seen.has(key)) throw new Error('Duplicate balance account');
    seen.add(key);
    const available = (balance.balances || []).filter(item => item.balanceType === 'AVAILABLE');
    if (available.length > 1) throw new Error('Duplicate available balance');
    const amount = available.length ? money(available[0].amount?.currencyAmount, available[0].amount?.currencyCode) : null;
    if (amount && amount.currency !== total.currency) throw new Error('Mixed balance currencies');
    const region = Object.entries(markets).find(([, id]) => id === meta.marketplaceId)?.[0];
    return { account: `${region ? region.toUpperCase() : meta.marketplaceId} · ${meta.accountType}`,
      currency: total.currency, available: amount?.amount ?? null, total: total.amount,
      updatedAt: sourceTime(balance.lastUpdatedTime) };
  });
}
async function readAmazon(request, markets, signal, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const balances = [], tokens = new Set();
  let nextToken;
  for (let page = 0; page < 20; page++) {
    if (signal?.aborted) throw new Error('Balance request timed out');
    const data = await request({path: '/finances/2024-06-19/balances',
      query: { balanceType: 'TOTAL', ...(nextToken ? { nextToken } : {}) }, signal});
    if (!Array.isArray(data?.balances)) throw new Error('Invalid Amazon balance response');
    balances.push(...data.balances);
    nextToken = data.nextToken;
    if (!nextToken) return amazonRows(balances, markets);
    if (typeof nextToken !== 'string' || tokens.has(nextToken)) throw new Error('Repeated balance pagination token');
    tokens.add(nextToken);
    // listBalances permits 0.5 requests/second. Never publish a partial page set.
    await pause(2100);
  }
  throw new Error('Balance pagination limit reached');
}
// Source: Amazon Finances v2024-06-19 listTransactions / DeferredContext.maturityDate.
// Aggregate transaction totals only (item breakdowns are already included).
function amazonReleaseSchedule(transactions, at) {
  const days = new Map(), seen = new Set();
  const today = new Date(at).toISOString().slice(0, 10);
  let partial = false;
  for (const transaction of transactions) {
    if (transaction.transactionStatus !== 'DEFERRED') continue;
    if (!transaction.transactionId || seen.has(transaction.transactionId)) throw new Error('Invalid or duplicate deferred transaction');
    seen.add(transaction.transactionId);
    const contexts = (transaction.contexts || []).filter(context => context.contextType === 'DeferredContext');
    if (contexts.length !== 1 || !contexts[0].maturityDate) { partial = true; continue; }
    const maturity = sourceTime(contexts[0].maturityDate);
    const day = maturity.slice(0, 10);
    // Past dates on still-deferred transactions cannot promise an upcoming release.
    if (day < today) { partial = true; continue; }
    const value = money(transaction.totalAmount?.currencyAmount, transaction.totalAmount?.currencyCode);
    if (!days.has(day)) days.set(day, []);
    days.get(day).push({currency: value.currency, total: value.amount});
  }
  for (const [date, rows] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    const amounts = summarizeBalances([{name:'Amazon',rows}]).currencies
      .filter(row => Number(row.total) > 0).map(row => ({currency:row.currency,amount:row.total}));
    if (amounts.length) return {status:partial ? 'partial' : 'ok', date, amounts};
  }
  return {status:partial ? 'partial' : 'no_schedule', date:null, amounts:[]};
}
async function readAmazonRelease(request, at, signal, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const transactions = [], tokens = new Set();
  // API limits a date window to 180 days. Keep the same window on every page.
  const end = at - 180000;
  const query = {transactionStatus:'DEFERRED', postedAfter:new Date(end - 180 * 86400000).toISOString(), postedBefore:new Date(end).toISOString()};
  let nextToken;
  for (let page = 0; page < 20; page++) {
    if (signal?.aborted) throw new Error('Release request timed out');
    const data = await request({path:'/finances/2024-06-19/transactions', query:{...query,...(nextToken ? {nextToken} : {})},signal});
    if (!Array.isArray(data?.transactions)) throw new Error('Invalid Amazon transaction response');
    transactions.push(...data.transactions);
    nextToken = data.nextToken;
    if (!nextToken) return amazonReleaseSchedule(transactions, at);
    if (typeof nextToken !== 'string' || tokens.has(nextToken)) throw new Error('Repeated release pagination token');
    tokens.add(nextToken);
    await pause(2100);
  }
  throw new Error('Release pagination limit reached');
}
async function loadAmazonRelease(request, at, timeoutMs, pause) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      readAmazonRelease(request, at, controller.signal, pause),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Release timeout')); }, timeoutMs); })
    ]);
  } catch (_) {
    // Never expose provider errors or a partially fetched schedule.
    return {status:'unavailable', date:null, amounts:[]};
  } finally { clearTimeout(timer); }
}
function shopifyRows(balances) {
  if (!Array.isArray(balances)) throw new Error('Invalid Shopify balance response');
  const seen = new Set();
  return balances.map(item => {
    const total = money(item.amount, item.currencyCode);
    if (seen.has(total.currency)) throw new Error('Duplicate Shopify currency');
    seen.add(total.currency);
    return { account: 'Shopify Payments', currency: total.currency, available: null, total: total.amount, updatedAt: null };
  });
}
// Sum TOTAL once per account; AVAILABLE is already included in it.
function summarizeBalances(marketplaces) {
  const sums = new Map(), unavailableMarketplaces = [];
  let stale = false, checkedAt = null;
  for (const market of marketplaces) {
    let missing = !market.rows?.length;
    let included = false;
    for (const row of market.rows || []) {
      if (row.total === null || row.total === undefined) { missing = true; continue; }
      try {
        const value = money(row.total, row.currency);
        const [whole, fraction = ''] = value.amount.replace(/^-/, '').split('.');
        const scale = fraction.length;
        const units = BigInt(whole + fraction) * (value.amount.startsWith('-') ? -1n : 1n);
        const previous = sums.get(value.currency) || { units: 0n, scale: 0 };
        const nextScale = Math.max(previous.scale, scale);
        sums.set(value.currency, { units: previous.units * 10n ** BigInt(nextScale - previous.scale) + units * 10n ** BigInt(nextScale - scale), scale: nextScale });
        included = true;
      } catch (_) { missing = true; }
    }
    if (missing) unavailableMarketplaces.push(market.name);
    if (included) {
      stale ||= Boolean(market.stale);
      if (market.checkedAt && (!checkedAt || market.checkedAt < checkedAt)) checkedAt = market.checkedAt;
    }
  }
  const currencies = [...sums].sort(([a], [b]) => a.localeCompare(b)).map(([currency, value]) => {
    const digits = (value.units < 0n ? -value.units : value.units).toString().padStart(value.scale + 1, '0');
    const total = (value.units < 0n ? '-' : '') + (value.scale ? `${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}` : digits);
    return { currency, total };
  });
  return { currencies, unavailableMarketplaces, stale, checkedAt };
}
function createBalanceService({ settings = config, amazon = amazonRequest, shopify = fetchPaymentBalances,
  now = () => Date.now(), timeoutMs = 20000, pause } = {}) {
  const cache = new Map(), pending = new Map();
  const names = { amazon: 'Amazon', etsy: 'Etsy', shopify: 'Shopify', sashe: 'SAShE' };
  async function get(channel, force) {
    const previous = cache.get(channel);
    const age = previous ? now() - previous.at : Infinity;
    if (previous && age < (force ? 30000 : 300000)) return previous.value;
    if (pending.has(channel)) return pending.get(channel);
    const task = (async () => {
      const base = { channel, name: names[channel], rows: [], checkedAt: new Date(now()).toISOString(), stale: false };
      const cfg = settings[channel] || {};
      const configured = channel === 'amazon' ? cfg.lwaClientId && cfg.lwaClientSecret && cfg.refreshToken && Object.keys(cfg.marketplaceIds || {}).length
        : channel === 'shopify' ? cfg.shopDomain : true;
      let value;
      if (channel === 'etsy' || channel === 'sashe') {
        // Etsy's running ledger does not specify reserve-inclusive totals or deposit availability.
        value = { ...base, status: 'unsupported' };
      } else if (!configured) value = { ...base, status: 'not_configured' };
      else {
        const release = channel === 'amazon' ? loadAmazonRelease(amazon, now(), timeoutMs, pause) : null;
        const controller = new AbortController();
        let timer;
        try {
          const result = await Promise.race([
            channel === 'amazon' ? readAmazon(amazon, cfg.marketplaceIds, controller.signal, pause) : shopify(controller.signal).then(data => data === null ? null : shopifyRows(data)),
            new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Balance timeout')); }, timeoutMs); })
          ]);
          value = { ...base, checkedAt: new Date(now()).toISOString(), rows: result || [], status: result?.length ? 'ok' : 'no_balance' };
        } catch (error) {
          // Provider messages may contain private payloads. Return only a fixed status.
          const status = [401,403].includes(error.status) || /not authorized|requires /i.test(error.message || '') ? 'needs_access' : 'unavailable';
          value = { ...base, status };
          if (previous?.value.rows.length) value = { ...value, rows: previous.value.rows, checkedAt: previous.value.checkedAt, stale: true };
        } finally { clearTimeout(timer); }
        if (release) value.releaseSchedule = await release;
      }
      cache.set(channel, { at: now(), value });
      return value;
    })();
    pending.set(channel, task);
    try { return await task; } finally { pending.delete(channel); }
  }
  return { async load(force = false) {
    const marketplaces = await Promise.all(Object.keys(names).map(channel => get(channel, force)));
    return { marketplaces, summary: summarizeBalances(marketplaces) };
  } };
}
const service = createBalanceService();
module.exports = { amazonReleaseSchedule, readAmazonRelease, summarizeBalances, money, amazonRows, shopifyRows, readAmazon, createBalanceService, load: service.load };
