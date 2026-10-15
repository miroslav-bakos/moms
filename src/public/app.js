const state = {
  config: null,
  channels: [],
  authorizations: null,
  events: [],
  accessLogs: [],
  auditLogs: [],
  products: [],
  productDraft: null,
  openOrders: [],
  archiveOrders: [],
  boardArchiveOrders: [],
  boardArchiveTotal: 0,
  boardArchiveOffset: 0,
  pinnedOrderIds: new Set(),
  pinnedOrders: [],
  activeView: 'open',
  boardStage: 'new',
  boardShippedCollapsed: true,
  activeSettingsTab: 'products',
  selectedOrderIds: new Set(),
  archiveSelectedOrderIds: new Set(),
  filters: {
    open: {},
    archive: {}
  },
  productFilters: {
    sku: '',
    display_name: ''
  },
  trackingStatuses: {},
  feedbackEligibility: {},
  archiveLayout: (() => { try { const saved = localStorage.getItem('moms-archive-layout'); return ['cards','table'].includes(saved) ? saved : ''; } catch (_) { return ''; } })(),
  archivePage: 0,
  archivePageSize: 15,
  archiveTotal: 0,
  sortOpen: { key: 'ship_by_date', dir: 'asc' },
  sortArchive: { key: 'dispatched_at', dir: 'desc' },
  dashboard: null,
  salesOverview: null,
  salesLoading: false,
  salesError: '',
  marketingRoi: [],
  marketingTimeline: [],
  marketingPeriodDays: 30,
  backups: [],
  dashCountryCollapsed: { thisMonth: true, allTime: true },
  prepBatches: [],
  currentPrepBatch: null
};

const themeStorageKey = 'local-orders-theme';
const accentStorageKey = 'local-orders-accent';
const accentPresets = {
  sage: '#566b45', terracotta: '#a65338', ocean: '#3277a5',
  plum: '#80518f', gold: '#a77a16', logo: '#c8854f'
};
let preferredTheme = 'light';
const fpInstances = {};

function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  const el = document.createElement('textarea');
  el.value = text;
  el.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
  document.body.appendChild(el);
  el.focus();
  el.select();
  try { document.execCommand('copy'); } finally { document.body.removeChild(el); }
  return Promise.resolve();
}

const clipboardSvg = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>`;
const copyCheckSvg = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;



const AMAZON_SELLER_CENTRAL = {
  'ca': 'https://sellercentral.amazon.ca',
  'com': 'https://sellercentral.amazon.com',
  'com.mx': 'https://sellercentral.amazon.com.mx',
  'com.br': 'https://sellercentral.amazon.com.br',
  'ie': 'https://sellercentral.amazon.ie',
  'es': 'https://sellercentral-europe.amazon.com',
  'co.uk': 'https://sellercentral-europe.amazon.com',
  'fr': 'https://sellercentral-europe.amazon.com',
  'com.be': 'https://sellercentral.amazon.com.be',
  'nl': 'https://sellercentral.amazon.nl',
  'de': 'https://sellercentral-europe.amazon.com',
  'it': 'https://sellercentral-europe.amazon.com',
  'se': 'https://sellercentral.amazon.se',
  'pl': 'https://sellercentral.amazon.pl',
  'com.tr': 'https://sellercentral.amazon.com.tr',
};

function orderFallbackUrl(order) {
  if (order.channel === 'shopify') {
    const domain = state.config && state.config.shopifyShopDomain;
    if (!domain) return order.order_url || '';
    const handle = domain.replace(/^https?:\/\//i, '').replace(/\.myshopify\.com$/i, '');
    const shopifyId = (order.source_payload && order.source_payload.id) || order.external_order_id;
    return `https://admin.shopify.com/store/${encodeURIComponent(handle)}/orders/${encodeURIComponent(shopifyId)}`;
  }
  if (order.order_url) return order.order_url;
  const id = order.external_order_id;
  if (!id) return '';
  if (order.channel === 'etsy') return `https://www.etsy.com/your/orders/${encodeURIComponent(id)}`;
  if (order.channel === 'amazon') {
    const m = (order.vendor || '').match(/^Amazon\.(.+)$/i);
    const suffix = m ? m[1].toLowerCase() : '';
    const base = AMAZON_SELLER_CENTRAL[suffix] || 'https://sellercentral-europe.amazon.com';
    return `${base}/orders-v3/order/${encodeURIComponent(id)}`;
  }
  return '';
}

function displayOrderId(order) {
  if (String(order.channel || '').toLowerCase() !== 'shopify') return order.external_order_id || '';
  const orderNumber = order.source_payload && order.source_payload.order_number;
  if (orderNumber != null && orderNumber !== '') return String(orderNumber);
  return String(order.order_name || order.external_order_id || '').replace(/^#/, '');
}

const sheetColumns = [
  { key: 'vendor', label: 'Vendor', value: (order) => order.vendor || '', vendorBadge: true, sortable: true },
  { key: 'external_order_id', label: 'OrderId', value: (order) => displayOrderId(order), href: (order) => orderFallbackUrl(order), sortable: true, copyable: true, pendingBadge: true },
  { key: 'business_outcome', label: 'Business outcome', value: order => window.i18n.t(({active:'Active',canceled:'Canceled',refunded:'Refunded',returned:'Returned'})[order.business_outcome || 'active']), raw:order=>order.business_outcome || 'active', filterType:'outcome' },
  { key: 'workflow_status', label: 'Status', value: (order) => workflowStatusLabel(order), showIn: ['open'], sortable: true },
  { key: 'skus', label: 'SKUs', value: (order) => order.skus || '', className: 'skus', appendGift: true, sortable: true },
  { key: 'created_at', label: 'Order Date', value: (order) => fmtDate(order.created_at), raw: (order) => order.created_at || '', filterType: 'daterange', sortable: true },
  { key: 'ship_by_date', label: 'Ship Date', value: (order) => fmtDate(order.ship_by_date), raw: (order) => order.ship_by_date || '', filterType: 'daterange', sortable: true },
  { key: 'address', label: 'Address', value: (order) => order.address || '', className: 'address', multiline: true, sortable: true, copyable: true },
  { key: 'processed', label: 'Processed', value: (order) => boolText(order.processed), showIn: [] },
  { key: 'packed', label: 'Packed', value: (order) => boolText(order.packed), showIn: [] },
  { key: 'shipped', label: 'Shipped', value: (order) => boolText(order.shipped), showIn: [] },
  { key: 'shipping_weight', label: 'Weight kg', value: (order) => order.shipping_weight || '', className: 'weight-col', weightEdit: true },
  { key: 'label_created', label: 'Label', value: (order) => order.label_created, showIn: ['open', 'archive'], labelLink: true, filterType: 'bool', className: 'label-col' },
  { key: 'tracking_code', label: 'Tracking Code', value: (order) => order.tracking_code || '', sortable: true, copyable: true, trackingEdit: true },
  { key: 'tracking_url', label: 'Tracking Link', value: (order) => order.tracking_url || '', link: true, linkText: (order) => order.tracking_status || state.trackingStatuses[order.tracking_code]?.status || 'tracking' },
  { key: 'delivered_at', label: 'Delivered At', value: (order) => {
    const d = order.delivered_at || state.trackingStatuses[order.tracking_code]?.deliveredAt;
    if (!d) return '';
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()}`;
  }, sortable: false, filterType: 'daterange', raw: (order) => order.delivered_at || '' },
  { key: 'note', label: 'Note', value: (order) => order.note || '', className: 'note', textEdit: true, sortable: true },
  { key: 'is_gift', label: 'Is Gift', value: (order) => boolText(order.is_gift), showIn: [] },
  { key: 'gift_message', label: 'Gift Message', value: (order) => order.gift_message || '', className: 'note', showIn: [] },
  { key: 'feedback', label: 'Feedback', showIn: ['archive'], feedbackAction: true },
  { key: 'pin', label: 'Pin', showIn: ['archive'], pinAction: true },
  { key: 'actions', label: '', showIn: ['open', 'archive'], actionMenu: true }
];

function boolText(value) {
  return value ? 'TRUE' : 'FALSE';
}

const AMAZON_REGION_FLAG = {
  de: 'de', it: 'it', fr: 'fr', es: 'es', nl: 'nl', pl: 'pl', se: 'se', sg: 'sg', in: 'in',
  'co.uk': 'gb', com: 'us', 'co.jp': 'jp', ca: 'ca',
  'com.au': 'au', 'com.mx': 'mx', 'com.be': 'be', 'com.tr': 'tr', 'com.br': 'br'
};

function renderVendorBadge(vendor) {
  if (!vendor) return '';
  const lower = vendor.toLowerCase();
  if (lower.includes('etsy')) return `<span class="vendor-badge vendor-etsy">Etsy</span>`;
  if (lower.includes('shopify')) return `<span class="vendor-badge vendor-shopify">Shopify</span>`;
  if (lower.includes('sashe')) return `<span class="vendor-badge vendor-sashe">Sashe</span>`;
  if (lower === 'manual') return `<span class="vendor-badge vendor-manual">Manual</span>`;
  if (lower.includes('amazon')) {
    const suffix = lower.startsWith('amazon.') ? lower.slice(7) : '';
    const flagCode = AMAZON_REGION_FLAG[suffix] || '';
    const flag = flagCode ? `<img class="vendor-flag" src="https://flagcdn.com/16x12/${flagCode}.png" alt="${escapeHtml(suffix)}">` : '';
    return `<span class="vendor-badge vendor-amazon">Amazon${flag}</span>`;
  }
  return `<span class="vendor-badge vendor-other">${escapeHtml(vendor)}</span>`;
}

const SKU_COLORS = { orange: '#e07010', blue: '#2563eb', pink: '#db2777', green: '#16a34a', purple: '#7c3aed', grey: '#6b7280' };
const SKU_COLORS_DIM = { orange: '#c9a07a', blue: '#7fa8d8', pink: '#e89cc0', green: '#76b085', purple: '#a88fd4', grey: '#abb0b6' };

function renderSkuLines(text, orderId, view) {
  const numId = Number(orderId);
  const order = numId ? (
    state.openOrders.find((o) => Number(o.id) === numId) ||
    state.pinnedOrders.find((o) => Number(o.id) === numId)
  ) : null;
  const prepared = (order && order.prepared_gobbis) || [];
  return inventorySkuImages(text) + text.split('\n').map((line) => {
    const lower = line.toLowerCase();
    const matches = Object.entries(SKU_COLORS).filter(([name]) => lower.includes(name));
    if (!matches.length) return escapeHtml(line);
    const dotsHtml = matches.map(([name, hex]) => {
      const color = prepared.includes(name) ? SKU_COLORS_DIM[name] : hex;
      return `<span class="sku-dot" style="color:${color}" aria-hidden="true">●</span>`;
    }).join('');
    const allPrepared = matches.every(([name]) => prepared.includes(name));
    const colorList = matches.map(([name]) => name).join(',');
    const dotsEl = (view === 'open' && orderId)
      ? `<button class="gobbi-prep-btn" type="button" data-id="${orderId}" data-colors="${colorList}" title="${allPrepared ? 'Mark as not prepared' : 'Mark as prepared'}">${dotsHtml}</button>`
      : dotsHtml;
    return `<span class="sku-gobbi-line">${dotsEl}${escapeHtml(line)}</span>`;
  }).join('\n');
}

function pad(n) { return String(n).padStart(2, '0'); }

function toLocalIso(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fmtDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function shipDeadlineClass(value, now = new Date()) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const date = localDateKey(parsed);
  const today = localDateKey(now);
  return date < today ? 'deadline-overdue' : date === today ? 'deadline-today' : '';
}
function renderShipDeadline(value, archived = false) {
  const status = archived ? '' : shipDeadlineClass(value);
  const title = status === 'deadline-today' ? 'Due today' : status === 'deadline-overdue' ? 'Overdue' : '';
  return `<span class="ship-deadline ${status}"${title ? ` title="${title}"` : ''}>${escapeHtml(fmtDate(value) || window.i18n.t('Not set'))}</span>`;
}

function fmtDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const text = await response.text();
  if(response.status===401)throw new Error(window.i18n.t('Your session expired. Open MOMS in another tab to sign in, then try again.'));
  let data=null;
  try {data=text?JSON.parse(text):null;}
  catch(_){throw new Error(window.i18n.t('The server returned an unexpected response. Please try again.'));}
  if (!response.ok) throw new Error(data && typeof data.error==='string' ? window.i18n.t(data.error) : window.i18n.t('The request failed. Please try again.'));
  return data;
}

async function loadConfig() {
  state.config = await api('/api/config');
}

async function loadDashboard() {
  state.dashboard = await api('/api/dashboard');
  window.marketplaceBalances?.load();
  window.serviceDiagnostics?.load();
}

function renderDashboard() {
  const root = document.getElementById('dashboardContent');
  if (!root) return;
  const d = state.dashboard;
  if (!d) return;

  function totalRow(byObj) {
    const total = Object.values(byObj).reduce((s, n) => s + n, 0);
    return `<div class="dash-channel-row dash-total-row"><span>Total</span><span class="dash-num">${total}</span></div>`;
  }

  function vendorRows(byVendor) {
    const entries = Object.entries(byVendor).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return '<div class="dash-channel-row muted">—</div>';
    return entries.map(([vendor, n]) => `<div class="dash-channel-row">${renderVendorBadge(vendor)}<span class="dash-num">${n}</span></div>`).join('');
  }

  function countryRows(byCountry, limit = Infinity) {
    const allEntries = Object.entries(byCountry).sort((a, b) => b[1] - a[1]);
    const shown = Number.isFinite(limit) ? allEntries.slice(0, limit) : allEntries;
    if (!shown.length) return '<div class="dash-channel-row muted">—</div>';
    return shown.map(([code, n]) => {
      const name = escapeHtml(CODE_TO_NAME[code] || code);
      const flag = `<img class="country-flag" src="https://flagcdn.com/16x12/${code.toLowerCase()}.png" alt="${escapeHtml(code)}">`;
      return `<div class="dash-channel-row"><span class="dash-country-info">${flag}${name}</span><span class="dash-num">${n}</span></div>`;
    }).join('') + totalRow(byCountry);
  }

  const miniCards = window.dashboardPinHelpers.countPins(d.dashboardPins || [], state.openOrders).map(({ name, count, skus }) => `<div class="dash-mini-card">${inventorySkuImages(skus)}<div class="dash-label" data-no-translate>${escapeHtml(name)}</div><div class="dash-mini-num">${count}</div></div>`).join('');

  const monthCollapsed = state.dashCountryCollapsed.thisMonth;
  const allTimeCollapsed = state.dashCountryCollapsed.allTime;

  root.innerHTML = `
    <div class="dash-grid">
      <div class="dash-card">
        <div class="dash-label">Open Orders</div>
        <div class="dash-big">${d.openOrders}</div>
        <div class="dash-channels">${vendorRows(d.openByVendor)}</div>
      </div>
      <div class="dash-card open-order-value">
        <div class="dash-label">Open order value</div>
        ${d.openOrderValue ? d.openOrderValue.currencies.length ? d.openOrderValue.currencies.map(row=>`<div class="dash-value" data-no-translate>${escapeHtml(fmtCurrency(row.total,row.currency))}${row.currency ? '' : ` <small>${escapeHtml(window.i18n.t('Unknown currency'))}</small>`}</div>`).join('') : `<div class="dash-value">${window.i18n.t('No priced open orders')}</div>` : '<div class="dash-value">—</div>'}
        ${d.openOrderValue?.missingAmountCount ? `<p class="muted">${window.i18n.t('Orders without price')}: ${d.openOrderValue.missingAmountCount}</p>` : ''}
        <div id="marketplaceBalanceSummary" class="marketplace-balance-summary" data-no-translate aria-live="polite"></div>
      </div>
      <div class="dash-card">
        <div class="dash-label">Orders This Month</div>
        <div class="dash-big">${d.ordersThisMonth}</div>
        <div class="dash-channels">${vendorRows(d.thisMonthByVendor)}</div>
      </div>
      <div class="dash-card">
        <div class="dash-label">Orders Last Month</div>
        <div class="dash-big">${d.ordersPreviousMonth}</div>
      </div>
      <div class="dash-card">
        <button class="dash-collapse-btn" type="button" data-collapse="thisMonth">
          <span class="dash-label" style="margin-bottom:0">This Month by Country</span>
          <span class="dash-collapse-icon">${monthCollapsed ? '▶' : '▼'}</span>
        </button>
        <div class="dash-channels"${monthCollapsed ? ' hidden' : ''}>${countryRows(d.thisMonthByCountry)}</div>
      </div>
      <div class="dash-card">
        <button class="dash-collapse-btn" type="button" data-collapse="allTime">
          <span class="dash-label" style="margin-bottom:0">All Time by Country</span>
          <span class="dash-collapse-icon">${allTimeCollapsed ? '▶' : '▼'}</span>
        </button>
        <div class="dash-channels"${allTimeCollapsed ? ' hidden' : ''}>${countryRows(d.allTimeByCountry, 10)}</div>
      </div>
    </div>
    <section class="dash-card"><h3>Marketplace dispatch check — last 7 days</h3><strong class="dash-big">${(d.unconfirmedDispatches||[]).length}</strong><p>Orders without confirmed marketplace dispatch. Source status reflects the last successful sync.</p>${(d.unconfirmedDispatches||[]).length ? `<ul>${d.unconfirmedDispatches.map(o=>`<li><span data-no-translate>${escapeHtml(o.vendor)} · ${escapeHtml(o.order_name||o.external_order_id)}</span> — ${escapeHtml(window.i18n.t(o.marketplace_dispatch_state==='uncertain'?'Check marketplace tracking':'Marketplace dispatch not confirmed'))}</li>`).join('')}</ul>` : `<p>${window.i18n.t('No orders without dispatch confirmation.')}</p>`}</section>
    <section id="marketplaceBalances" class="marketplace-balances" data-no-translate aria-label="Marketplace balances"></section>
    <div class="dashboard-pins-heading"><p class="dash-section-label">To craft — Open Orders</p><button id="configureDashboardPins" type="button" class="secondary">Configure pinned SKUs</button></div>
    <div class="dash-mini-grid">${miniCards}</div>
    ${window.orderWorkspace?.dashboard() || ''}
    ${renderProductionNeeds(window.inventoryState)}
  `;

  window.marketplaceBalances?.render();
  window.orderWorkspace?.bindDashboard(root);
  root.querySelector('#configureDashboardPins').addEventListener('click', openDashboardPins);
  root.querySelectorAll('button.dash-collapse-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.collapse;
      state.dashCountryCollapsed[key] = !state.dashCountryCollapsed[key];
      const content = btn.nextElementSibling;
      const icon = btn.querySelector('.dash-collapse-icon');
      if (state.dashCountryCollapsed[key]) {
        content.setAttribute('hidden', '');
        icon.textContent = '▶';
      } else {
        content.removeAttribute('hidden');
        icon.textContent = '▼';
      }
    });
  });
}

async function loadChannels() {
  state.channels = await api('/api/state');
}

async function loadAuthorizations() {
  state.authorizations = await api('/api/authorizations');
}

async function loadArchiveOrders() {
 try {
  const params = new URLSearchParams({
    status: 'archive',
    paginate: 'true',
    limit: state.archivePageSize,
    offset: state.archivePage * state.archivePageSize
  });
  const filters = state.filters.archive || {};
  const search = String(filters.mobileSearch || '').trim();
  if (search) params.set('search', search);
  for (const col of ['vendor', 'external_order_id', 'skus', 'address', 'tracking_code', 'note', 'shipping_weight','business_outcome']) {
    const v = String(filters[col] || '').trim();
    if (v) params.set(col, v);
  }
  if (filters.label_created) params.set('label_created', filters.label_created);
  for (const col of ['created_at', 'ship_by_date', 'delivered_at']) {
    if (filters[col + '_from']) params.set(col + '_from', filters[col + '_from']);
    if (filters[col + '_to']) params.set(col + '_to', filters[col + '_to']);
  }
  params.set('sort_key', state.sortArchive.key);
  params.set('sort_dir', state.sortArchive.dir);
  const result = await api(`/api/orders?${params}`);
  state.archiveOrders = result.orders;
  state.archiveTotal = result.total;
  state.archiveSelectedOrderIds.clear();
  state.orderLoadErrors ||= {}; state.orderLoadErrors.archive=false;
  renderOrderLoadErrors();
 } catch (_) {state.orderLoadErrors ||= {};state.orderLoadErrors.archive=true;renderOrderLoadErrors();return false;}
}

let boardArchiveRequest = 0;
let boardArchiveLoading = false;
async function loadBoardArchive(append = false) {
  const request = ++boardArchiveRequest;
  boardArchiveLoading = true;
  const search = document.getElementById('boardSearch').value.trim();
  const params = new URLSearchParams({status:'archive',paginate:'true',limit:30,offset:append ? state.boardArchiveOffset : 0,sort_key:'dispatched_at',sort_dir:'desc'});
  if(search)params.set('search',search);
  try {
    const result = await api(`/api/orders?${params}`);
    if(request !== boardArchiveRequest)return;
    const orders = Array.isArray(result.orders) ? result.orders : [];
    state.boardArchiveOrders = append ? [...new Map([...state.boardArchiveOrders,...orders].map(order=>[Number(order.id),order])).values()] : orders;
    state.boardArchiveTotal = Number(result.total) || 0;
    state.boardArchiveOffset = (append ? state.boardArchiveOffset : 0) + orders.length;
    if(!orders.length)state.boardArchiveOffset=state.boardArchiveTotal;
  } catch(error) { if(request === boardArchiveRequest)throw error; }
  finally { if(request === boardArchiveRequest)boardArchiveLoading = false; }
}
function findBoardOrder(id) {
  return [...state.openOrders,...state.boardArchiveOrders,...state.archiveOrders,...state.pinnedOrders].find(order=>Number(order.id)===Number(id));
}

async function refreshShippedColumn(){
  const tabFocused=document.activeElement?.id==='board-tab-shipped';
  try{await loadOrders();}catch(error){document.getElementById('boardMessage').textContent=error.message;}
  if(tabFocused&&state.activeView==='board'&&state.boardStage==='shipped'&&document.activeElement===document.body)document.getElementById('board-tab-shipped')?.focus();
}

async function loadPinnedOrders() {
  try {
    const result = await api('/api/orders?pinned=true&active=false');
    state.pinnedOrders = Array.isArray(result) ? result : (result.orders || []);
    state.pinnedOrderIds = new Set(state.pinnedOrders.map((o) => Number(o.id)));
  } catch (_) {
    state.pinnedOrders = [];
    state.pinnedOrderIds = new Set();
  }
}

let archiveDebounceTimer = null;
function loadArchiveDebounced() {
  clearTimeout(archiveDebounceTimer);
  archiveDebounceTimer = setTimeout(async () => {
    state.archivePage = 0;
    await loadArchiveOrders();
    renderTables();
    loadFeedbackEligibility();
  }, 1000);
}

let openDebounceTimer = null;
function renderTablesDebounced(focus) {
  clearTimeout(openDebounceTimer);
  openDebounceTimer = setTimeout(() => renderTables(focus), 1000);
}

function renderOrderLoadErrors() {
  for (const [target, keys] of [['orderBoard', ['open', 'boardArchive']], ['archiveTable', ['archive']], ['openTable', ['open']]]) {
    let notice = document.getElementById(`${target}LoadError`);
    if (!notice) {
      notice = document.createElement('div'); notice.id = `${target}LoadError`;
      notice.className = 'feedback'; notice.setAttribute('role', 'status');
      document.getElementById(target).before(notice);
    }
    const failed = keys.filter(key => state.orderLoadErrors?.[key]);
    notice.hidden = !failed.length;
    notice.replaceChildren();
    if (failed.length) {
      const message = document.createElement('span');
      message.textContent = window.i18n?.t('Could not refresh orders. Displayed data may be outdated.') || 'Could not refresh orders. Displayed data may be outdated.';
      const retry = document.createElement('button'); retry.type = 'button';
      retry.textContent = window.i18n?.t('Retry') || 'Retry';
      retry.addEventListener('click', async () => { retry.disabled = true; await loadOrders(); renderTables(); });
      notice.append(message, ' ', retry);
    }
  }
}

async function loadOrders() {
  state.orderLoadErrors ||= {};
  const results = await Promise.allSettled([
    api('/api/orders?status=open&complete=true').then(orders => { state.openOrders = orders; }),
    loadArchiveOrders(), loadBoardArchive()
  ]);
  ['open', 'archive', 'boardArchive'].forEach((key, index) => {
    state.orderLoadErrors[key] = results[index].status === 'rejected' || results[index].value === false;
  });
  renderTables();
  renderOrderLoadErrors();
  await loadInventory().catch(() => {});
}

async function loadEvents() {
  state.events = await api('/api/events?limit=40');
}

async function loadAccessLogs() {
  state.accessLogs = await api('/api/access-logs?limit=120');
}

async function loadAuditLogs() {
  state.auditLogs = await api('/api/audit-logs?limit=200');
}

async function loadProducts() {
  state.products = await api('/api/products');
}

async function loadTrackingStatuses({ force = false } = {}) {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const allOrders = [...state.openOrders, ...state.archiveOrders, ...state.pinnedOrders, ...state.boardArchiveOrders];
  const codes = (force ? [...state.openOrders,...state.boardArchiveOrders].filter((o) => o.tracking_code && !o.delivered_at) : [
    ...allOrders.filter((o) => o.tracking_code && !o.delivered_at && o.created_at && o.created_at >= cutoff),
    ...state.pinnedOrders.filter((o) => o.tracking_code && !o.delivered_at && o.created_at && o.created_at < cutoff)
  ])
    .filter((o) => !state.trackingStatuses[o.tracking_code]?.deliveredAt)
    .map((o) => o.tracking_code)
    .filter((v, i, a) => v && a.indexOf(v) === i);
  if (!codes.length) return;
  try {
    const fresh = await api(`/api/tracking/statuses?codes=${encodeURIComponent(codes.join(','))}${force ? '&refresh=true' : ''}`);
    Object.assign(state.trackingStatuses, fresh);
    renderTables();
    for (const order of allOrders) {
      if (!order.tracking_code || order.delivered_at) continue;
      const result = fresh[order.tracking_code];
      if (result && result.deliveredAt) {
        const patch = {
          tracking_status: result.status,
          delivered_at: new Date(result.deliveredAt).toISOString()
        };
        api(`/api/orders/${order.id}`, { method: 'PATCH', body: JSON.stringify(patch) })
          .then((updated) => {
            const update = (list) => list.map((o) => Number(o.id) === Number(order.id) ? { ...o, ...updated } : o);
            state.openOrders = update(state.openOrders);
            state.archiveOrders = update(state.archiveOrders);
            state.boardArchiveOrders = update(state.boardArchiveOrders);
            state.pinnedOrders = update(state.pinnedOrders);
          })
          .catch(() => {});
      }
    }
  } catch (error) {
    if (force) throw error;
    // silently ignore - links fall back to 'tracking'
  }
}

function loadFeedbackEligibility() {}

const AMAZON_MARKETPLACE_IDS = {
  'de': 'A1PA6795UKMFR9', 'fr': 'A13V1IB3VIYZZH', 'it': 'APJ6JRA9NG5V4', 'es': 'A1RKKUPIHCS9HS',
  'co.uk': 'A1F83G8C2ARO7P', 'nl': 'A1805IZSGTT6HS', 'se': 'A2NODRKZP88ZB9', 'pl': 'A1C3SOZRARQ6R3',
  'com.tr': 'A33AVAJ2PDY3EV', 'com': 'ATVPDKIKX0DER', 'ca': 'A2EUQ1WTGCTBG2',
  'com.mx': 'A1AM78C64UM0Y8', 'com.br': 'A2Q3Y263D00KWC', 'com.au': 'A39IBJ37TRP1C6',
  'co.jp': 'A1VC38T7YXB528', 'in': 'A21TJRUUN4KGV', 'sg': 'A19VAU5U5O7RUS',
  'ae': 'A2VIGQ35RCS4UG', 'sa': 'A17E79C6D8DWNP',
};
const AMAZON_SC_URLS = {
  eu: 'https://sellercentral-europe.amazon.com',
  na: 'https://sellercentral.amazon.com',
  fe: 'https://sellercentral.amazon.com.au',
};
const AMAZON_MARKETPLACE_REGIONS = {
  'de': 'eu', 'fr': 'eu', 'it': 'eu', 'es': 'eu', 'co.uk': 'eu', 'nl': 'eu', 'se': 'eu', 'pl': 'eu', 'com.tr': 'eu',
  'com': 'na', 'ca': 'na', 'com.mx': 'na', 'com.br': 'na',
  'co.jp': 'fe', 'com.au': 'fe', 'sg': 'fe', 'in': 'fe', 'ae': 'fe', 'sa': 'fe',
};

function sellerCentralReviewUrl(order) {
  if (order.channel !== 'amazon' || order.feedback_requested || !order.external_order_id || !order.delivered_at) return null;
  const deliveredMs = new Date(order.delivered_at).getTime();
  const now = Date.now();
  if (deliveredMs < now - 30 * 24 * 60 * 60 * 1000 || deliveredMs > now - 5 * 24 * 60 * 60 * 1000) return null;
  const suffix = (order.vendor || '').replace(/^Amazon\./, '');
  const marketplaceId = AMAZON_MARKETPLACE_IDS[suffix];
  if (!marketplaceId) return null;
  const base = AMAZON_SC_URLS[AMAZON_MARKETPLACE_REGIONS[suffix] || 'eu'];
  return `${base}/messaging/reviews?orderId=${order.external_order_id}&marketplaceId=${marketplaceId}`;
}

function preferredOrdersView() {
  try { return localStorage.getItem('moms-orders-view') === 'open' ? 'open' : 'board'; }
  catch (_) { return 'board'; }
}
function setView(view) {
  const viewChanged=state.activeView!==view;
  if (view === 'board' || view === 'open') {
    try { localStorage.setItem('moms-orders-view', view); } catch (_) {}
  }
  if(view!=='scan')window.parcelScan?.stop();
  state.activeView = view;
  if(view==='scan')void window.parcelScan?.refresh();
  document.querySelectorAll('[data-orders-view]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.ordersView === view));
  });
  if (view === 'dashboard') renderDashboard();
  if (view === 'inventory') loadInventory().catch(error => { document.getElementById('inventoryMessage').textContent=error.message; });
  closeMobileMoreMenu();
  document.querySelectorAll('.tab.nav-link').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === (['open', 'archive'].includes(view) ? 'board' : view));
  });
  const moreButton = document.getElementById('mobileMoreButton');
  if (moreButton) moreButton.classList.toggle('active', !['open', 'archive', 'dashboard', 'board', 'inventory', 'scan'].includes(view));
  document.querySelectorAll('.view').forEach((section) => {
    section.classList.remove('active-view');
  });
  document.getElementById(`${view}View`).classList.add('active-view');
  const tableIds = { open: 'openTable', archive: 'archiveTable' };
  if (tableIds[view]) requestAnimationFrame(() => fixFilterRowTop(document.getElementById(tableIds[view])));
  const hash = view === 'settings' ? `settings/${state.activeSettingsTab}` : view === 'archive' ? `archive/${state.archivePage}` : view;
  if (window.location.hash !== '#' + hash) history.pushState(null, '', '#' + hash);
  if(viewChanged) window.scrollTo({top:0,left:0,behavior:'instant'});
}

function setSettingsTab(tab) {
  state.activeSettingsTab = tab;
  document.querySelectorAll('.settings-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.settingsTab === tab);
    if (btn.dataset.settingsTab === tab) requestAnimationFrame(() => {
      const nav = btn.parentElement;
      const bounds = nav.getBoundingClientRect();
      nav.scrollLeft += btn.getBoundingClientRect().left - Math.max(8, bounds.left + 8);
    });
  });
  document.querySelectorAll('.settings-subview').forEach((div) => {
    div.classList.remove('active-subview');
  });
  const tabIds = { workflow: 'settingsWorkflow', appearance: 'settingsAppearance', products: 'settingsProducts', auth: 'settingsAuth', backup: 'settingsBackup', logs: 'settingsLogs' };
  document.getElementById(tabIds[tab]).classList.add('active-subview');
  if(tab==='logs' && typeof loadVatPreferences==='function')loadVatPreferences();
  history.replaceState(null, '', `#settings/${tab}`);
}

function applyTheme(theme) {
  const safeTheme = ['light', 'dark', 'system'].includes(theme) ? theme : 'light';
  preferredTheme = safeTheme;
  const effectiveTheme = safeTheme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : safeTheme;
  document.documentElement.dataset.theme = effectiveTheme;
  localStorage.setItem(themeStorageKey, safeTheme);

  const button = document.getElementById('themeToggle');
  if (button) {
    const nextTheme = effectiveTheme === 'dark' ? 'light' : 'dark';
    button.setAttribute('aria-label', `Switch to ${nextTheme} theme`);
    button.setAttribute('title', `Switch to ${nextTheme} theme`);
    button.setAttribute('aria-pressed', effectiveTheme === 'dark' ? 'true' : 'false');

    const label = document.getElementById('themeToggleText');
    if (label) {
      label.textContent = `${safeTheme === 'system' ? 'System' : effectiveTheme === 'dark' ? 'Dark' : 'Light'} theme`;
    }
  }
  document.querySelectorAll('[data-theme-mode]').forEach((option) => {
    const selected = option.dataset.themeMode === safeTheme;
    option.classList.toggle('selected', selected);
    option.setAttribute('aria-pressed', String(selected));
  });
}

function initThemeToggle() {
  const button = document.getElementById('themeToggle');
  if (!button) return;

  const storedTheme = localStorage.getItem(themeStorageKey);
  const activeTheme = ['light', 'dark', 'system'].includes(storedTheme) ? storedTheme : (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  applyTheme(activeTheme);

  button.addEventListener('click', () => {
    const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
  });
}

function setAccentColor(color, preset = 'custom') {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return;
  const root = document.documentElement;
  const hex = color.slice(1);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const contrast = luminance > 0.58 ? '#211d18' : '#ffffff';
  const accent2 = color;
  root.style.setProperty('--accent', color);
  root.style.setProperty('--accent-2', accent2);
  root.style.setProperty('--accent-contrast', contrast);
  localStorage.setItem(accentStorageKey, JSON.stringify({ color, preset }));
  document.querySelectorAll('.accent-swatch').forEach((button) => {
    const selected = button.dataset.accent === preset;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  const customInput = document.getElementById('customAccentColor');
  if (customInput) customInput.value = color;
}

function initAppearanceSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(accentStorageKey) || 'null');
    if (saved?.color) setAccentColor(saved.color, saved.preset || 'custom');
  } catch (_) {}
  document.querySelectorAll('[data-theme-mode]').forEach((button) => {
    button.addEventListener('click', () => applyTheme(button.dataset.themeMode));
  });
  document.querySelectorAll('.accent-swatch').forEach((button) => {
    const color = accentPresets[button.dataset.accent];
    button.querySelector('span').style.backgroundColor = color;
    button.addEventListener('click', () => setAccentColor(color, button.dataset.accent));
  });
  const customInput = document.getElementById('customAccentColor');
  if (customInput) customInput.addEventListener('input', () => setAccentColor(customInput.value));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (preferredTheme === 'system') applyTheme('system');
  });
}

function authStatus(channel, auth) {
  if (!auth) return 'Not configured';
  if (channel === 'amazon' && auth.authMode === 'private') {
    return auth.configured ? 'Ready' : 'Needs refresh token or LWA config';
  }
  if (channel==='shopify' && auth.authMode==='client_credentials')return auth.configured?'Ready':'Not configured';
  if (auth.authorized) return 'Authorized';
  if (auth.configured) return 'Needs authorization';
  return 'Not configured';
}

function renderAuthorizations() {
  loadApplicationSettings(true);
  const root = document.getElementById('authCards');
  root.innerHTML = '';
  const channels = ['etsy', 'shopify', 'sashe', 'amazon'];

  for (const channel of channels) {
    const auth = state.authorizations ? state.authorizations[channel] : null;
    const channelState = state.channels.find((item) => item.channel === channel) || {};
    const channelConfig = state.config && state.config.channels[channel] ? state.config.channels[channel] : {};
    const effectiveEnabled = Boolean(channelState.enabled ?? channelConfig.envEnabled);
    const card = document.createElement('article');
    card.className = 'channel';
    card.innerHTML = `
      <div class="channel-title">
        <span>${channel}</span>
        <strong class="${auth && auth.configured ? 'ok' : 'warn'}">${authStatus(channel, auth)}</strong>
      </div>
      ${renderAuthDetails(channel, auth, channelState, channelConfig)}
      <div class="card-actions">${renderAuthActions(channel, auth)}</div>
    `;
    root.appendChild(card);

    const toggle = card.querySelector('input[data-channel]');
    if (toggle) {
      toggle.checked = effectiveEnabled;
      toggle.addEventListener('change', async () => {
        const previous = !toggle.checked;
        const message = card.querySelector('[data-sync-error]');
        toggle.disabled = true;
        message.textContent = '';
        try {
          await api(`/api/state/${toggle.dataset.channel}`, {
            method: 'PATCH', body: JSON.stringify({ enabled: toggle.checked })
          });
          await refresh();
        } catch (_) {
          toggle.checked = previous;
          message.textContent = window.i18n.t('Could not save synchronization. Try again.');
        } finally { toggle.disabled = false; }
      });
    }

    card.querySelectorAll('button[data-poll]').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        button.textContent = 'Polling...';
        try {
          await api(`/api/poll/${button.dataset.poll}`, { method: 'POST' });
          await refresh();
        } catch (error) {
          alert(error.message);
        } finally {
          button.disabled = false;
          button.textContent = 'Poll Now';
        }
      });
    });
  }
}

function renderAuthDetails(channel, auth, channelState, channelConfig) {
  const rows = [];

  rows.push(['Configured', auth && auth.configured ? 'yes' : 'no']);
  rows.push(['Last success', fmtDateTime(channelState.last_success_at)]);
  rows.push(['Cursor', fmtDateTime(channelState.cursor)]);
  if (channelState.last_error) rows.push(['Last error', `<span class="error">${escapeHtml(channelState.last_error)}</span>`]);

  if (channel === 'etsy' && auth) {
    rows.push(['Callback', escapeHtml(auth.redirectUri || '')]);
    rows.push(['Scopes', escapeHtml((auth.scopes || []).join(', '))]);
    rows.push(['Token updated', fmtDateTime(auth.token && auth.token.updated_at)]);
  }

  if (channel === 'shopify' && auth) {
    rows.push(['Shop', escapeHtml(auth.shopDomain || '')]);
    rows.push(['API version', escapeHtml(auth.apiVersion || '')]);
    rows.push(['Callback', escapeHtml(auth.redirectUri || '')]);
    rows.push(['Token updated', fmtDateTime(auth.token && auth.token.updated_at)]);
  }

  if (channel === 'sashe' && auth) {
    rows.push(['User ID', escapeHtml(auth.userId || '')]);
    rows.push(['API Key', auth.configured ? 'set' : 'missing']);
  }

  if (channel === 'amazon' && auth) {
    rows.push(['Mode', escapeHtml(auth.authMode || '')]);
    rows.push(['Application ID', auth.applicationConfigured ? 'set' : 'missing']);
    rows.push(['LWA', auth.lwaConfigured ? 'set' : 'missing']);
    rows.push(['Refresh token', auth.refreshTokenConfigured ? 'set' : 'missing']);
    rows.push(['Marketplaces', escapeHtml(Object.keys(auth.marketplaceIds || {}).join(', '))]);
  }

  return `<label class="toggle channel-sync-switch"><input type="checkbox" role="switch" aria-label="${channel}: ${escapeHtml(window.i18n.t('Synchronization enabled'))}" data-channel="${channel}">${window.i18n.t('Synchronization enabled')}</label><span class="error" role="status" data-sync-error></span><dl>${rows.map(([label, value]) => `<dt>${label}</dt><dd>${value || ''}</dd>`).join('')}</dl>`;
}

function renderAuthActions(channel, auth) {
  if (channel === 'etsy') {
    return `
      <a class="button" href="/auth/etsy/start">Authorize</a>
      <button class="secondary" type="button" data-poll="etsy">Poll Now</button>
    `;
  }

  if (channel === 'amazon') {
    return `
      <button class="secondary" type="button" data-poll="amazon">Poll Now</button>
      <span class="hint">Private Amazon app uses the saved refresh token.</span>
    `;
  }

  if (channel === 'shopify' && auth?.authMode==='client_credentials')return `<button class="secondary" type="button" data-poll="shopify">Poll Now</button><span class="hint">Your own Shopify app connects automatically using its client credentials.</span>`;
  if (channel === 'shopify') {
    return `
      <a class="button" href="/auth/shopify/start">Authorize</a>
      <button class="secondary" type="button" data-poll="shopify">Poll Now</button>
    `;
  }

  if (channel === 'sashe') {
    return `<button class="secondary" type="button" data-poll="sashe">Poll Now</button>`;
  }

  return '';
}

function columnText(order, column) {
  return String((column.raw ? column.raw(order) : column.value(order)) || '').toLowerCase();
}

function filteredOrders(view, orders) {
  const getValue=(order,key)=>{const column=sheetColumns.find(column=>column.key===key);return column?(column.raw?column.raw(order):column.value?.(order)):'';};
  return orders.filter(order=>window.orderFilterHelpers.matches(order,state.filters[view] || {},getValue)).sort((a,b)=>window.orderFilterHelpers.compare(a,b,state.sortOpen.key,state.sortOpen.dir,getValue,window.i18n.language));
}

function renderOrderGrid(view, orders, targetId, countId) {
  const isArchive = view === 'archive';
  let displayed = isArchive ? orders : filteredOrders(view, orders);
  let openDueBoundary = 0;
  if (view === 'open') {
    const today = new Date();
    const weekday = today.getDay();
    const daysToFriday = weekday === 6 ? 6 : weekday === 0 ? 5 : 5 - weekday;
    const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysToFriday);
    const cutoffKey = localDateKey(cutoff);
    const dueThisPeriod = displayed.filter((order) => {
      const shipDate = shipDateKey(order.ship_by_date);
      return shipDate > 0 && shipDate <= cutoffKey;
    });
    const afterThisPeriod = displayed.filter((order) => {
      const shipDate = shipDateKey(order.ship_by_date);
      return shipDate === 0 || shipDate > cutoffKey;
    });
    displayed = [...dueThisPeriod, ...afterThisPeriod];
    if (dueThisPeriod.length && afterThisPeriod.length) openDueBoundary = dueThisPeriod.length;
  }
  const root = document.getElementById(targetId);
  const selectCol = view === 'open' || view === 'archive';
  const selectTh = selectCol ? '<th class="col-select"></th>' : '';
  const selectFilterTh = selectCol ? '<th class="col-select"></th>' : '';
  const columns = sheetColumns.filter((c) => !c.showIn || c.showIn.includes(view));
  const totalPages = Math.max(1, Math.ceil(state.archiveTotal / state.archivePageSize));

  root.innerHTML = `
    <div class="table-wrap">
      <table class="orders-table">
        <thead>
          <tr>${selectTh}${columns.map((column) => {
            if (!column.sortable) return `<th>${column.label}</th>`;
            const sort = isArchive ? state.sortArchive : state.sortOpen;
            const active = sort.key === column.key;
            const arrow = active ? `<span class="sort-arrow">${sort.dir === 'asc' ? '↑' : '↓'}</span>` : '';
            return `<th aria-sort="${active ? sort.dir === 'asc' ? 'ascending' : 'descending' : 'none'}"><button class="sort-btn" type="button" data-sort-view="${view}" data-sort-key="${column.key}">${column.label}${arrow}</button></th>`;
          }).join('')}</tr>
          <tr class="filters" id="${view}-column-filters">${selectFilterTh}${columns.map((column) => column.filterType === 'daterange' ? `
            <th><div class="date-range-filter">
              <input class="date-range-input" type="text" size="1" readonly data-fp-view="${view}" data-fp-key="${column.key}" placeholder="Any date" aria-label="${column.label} range">
              ${(state.filters[view][column.key + '_from'] || state.filters[view][column.key + '_to']) ? `<button class="date-range-clear" type="button" data-fp-view="${view}" data-fp-key="${column.key}" aria-label="Clear ${column.label} filter">×</button>` : ''}
            </div></th>
          ` : column.filterType === 'outcome' ? `
            <th><select data-view="${view}" data-key="business_outcome"><option value="">All</option>${Object.entries({active:'Active',canceled:'Canceled',refunded:'Refunded',returned:'Returned'}).map(([value,label])=>`<option value="${value}"${state.filters[view].business_outcome===value?' selected':''}>${window.i18n.t(label)}</option>`).join('')}</select></th>
          ` : column.filterType === 'bool' ? `
            <th><select data-view="${view}" data-key="${column.key}" aria-label="Filter ${column.label}"><option value="">All</option><option value="y"${(state.filters[view][column.key] || '') === 'y' ? ' selected' : ''}>Y</option><option value="n"${(state.filters[view][column.key] || '') === 'n' ? ' selected' : ''}>N</option></select></th>
          ` : (column.feedbackAction || column.pinAction || column.actionMenu) ? `<th></th>
          ` : `
            <th><input type="search" size="1" data-view="${view}" data-key="${column.key}" value="${escapeHtml(state.filters[view][column.key] || '')}" aria-label="Filter ${column.label}"></th>
          `).join('')}</tr>
        </thead>
        <tbody>
          ${(() => {
            if (view === 'open') {
              const rows = displayed.map((order) => renderOrderRow(order, view, columns));
              if (!openDueBoundary) return rows.join('');
              rows.splice(openDueBoundary, 0, `<tr class="open-week-divider" aria-hidden="true"><td colspan="${columns.length + 1}"></td></tr>`);
              return rows.join('');
            }
            if (!isArchive) return displayed.map((order) => renderOrderRow(order, view, columns)).join('');
            const pinnedSet = new Set(state.pinnedOrders.map((o) => Number(o.id)));
            const pinnedRows = state.pinnedOrders.map((o) => renderOrderRow(o, view, columns, true)).join('');
            const regularRows = displayed.filter((o) => !pinnedSet.has(Number(o.id))).map((o) => renderOrderRow(o, view, columns)).join('');
            const divider = (pinnedRows && regularRows) ? `<tr class="pinned-section-divider"><td colspan="${columns.length + 1}"></td></tr>` : '';
            return pinnedRows + divider + regularRows;
          })()}
        </tbody>
      </table>
    </div>
    ${isArchive ? `
      <div class="archive-pagination">
        <button class="secondary archive-prev-btn" type="button"${state.archivePage === 0 ? ' disabled' : ''}>← Prev</button>
        <span class="muted">Page ${state.archivePage + 1} of ${totalPages}</span>
        <button class="secondary archive-next-btn" type="button"${(state.archivePage + 1) * state.archivePageSize >= state.archiveTotal ? ' disabled' : ''}>Next →</button>
        <select class="archive-page-size-select">
          ${[10, 15, 20, 25, 50, 100, 200].map((n) => `<option value="${n}"${state.archivePageSize === n ? ' selected' : ''}>${n} per page</option>`).join('')}
        </select>
        <span class="muted archive-total">${state.archiveTotal} total</span>
      </div>
    ` : `<div class="grid-footer"><span class="muted">${displayed.length} of ${orders.length}</span></div>`}
  `;

  const archiveCards = isArchive && (state.archiveLayout ? state.archiveLayout === 'cards' : mobileMQ.matches);
  if (isArchive) {
    root.classList.toggle('archive-cards-mode', archiveCards);
    root.classList.toggle('archive-table-mode', !archiveCards);
    document.querySelectorAll('[data-archive-layout]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.archiveLayout === (archiveCards ? 'cards' : 'table'))));
  }
  if (archiveCards) {
    const pinnedSet = new Set(state.pinnedOrders.map((o) => Number(o.id)));
    const pinnedCards = isArchive ? state.pinnedOrders.map((o) => renderOrderCard(o, view, true)).join('') : '';
    const cards = isArchive
      ? displayed.filter((o) => !pinnedSet.has(Number(o.id))).map((o) => renderOrderCard(o, view, false)).join('')
      : view === 'open' && openDueBoundary
        ? displayed.slice(openDueBoundary).map((o) => renderOrderCard(o, view, false)).join('')
        : displayed.map((o) => renderOrderCard(o, view, false)).join('');
    const openDivider = view === 'open' && openDueBoundary ? '<div class="open-week-divider" role="separator" aria-label="Orders shipping after this Friday"></div>' : '';
    const divider = isArchive
      ? ((pinnedCards && cards) ? '<div class="card-pinned-divider"></div>' : '')
      : openDivider;
    const openDueCards = view === 'open' && openDueBoundary
      ? displayed.slice(0, openDueBoundary).map((o) => renderOrderCard(o, view, false)).join('')
      : '';
    const sort = isArchive ? state.sortArchive : state.sortOpen;
    const sortOptions = isArchive
      ? [['dispatched_at:desc', 'Latest shipped first'], ['created_at:desc', 'Newest orders'], ['created_at:asc', 'Oldest orders'], ['ship_by_date:asc', 'Soonest ship date'], ['vendor:asc', 'Shop name A–Z']]
      : [['ship_by_date:asc', 'Soonest ship date'], ['ship_by_date:desc', 'Latest ship date'], ['created_at:desc', 'Newest orders'], ['vendor:asc', 'Shop name A–Z']];
    const selectedSort = `${sort.key}:${sort.dir}`;
    root.innerHTML = `
      <div class="mobile-order-tools">
        <label class="mobile-order-search-wrap">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/></svg>
          <input class="mobile-order-search" type="search" data-view="${view}" data-key="mobileSearch" value="${escapeHtml((state.filters[view] || {}).mobileSearch || '')}" placeholder="Order, customer, SKU or tracking" aria-label="Search ${isArchive ? 'archived ' : ''}orders">
        </label>
        <label class="mobile-order-sort-wrap"><span>Sort</span><select class="mobile-order-sort" data-view="${view}" aria-label="Sort orders">
          ${sortOptions.map(([value, label]) => `<option value="${value}"${selectedSort === value ? ' selected' : ''}>${label}</option>`).join('')}
        </select></label>
      </div>
      <div class="card-list">${pinnedCards}${view === 'open' ? `${openDueCards}${divider}${cards}` : `${divider}${cards}`}</div>
      ${isArchive ? `
        <div class="archive-pagination">
          <button class="secondary archive-prev-btn" type="button"${state.archivePage === 0 ? ' disabled' : ''}>← Prev</button>
          <span class="muted">Page ${state.archivePage + 1} of ${totalPages}</span>
          <button class="secondary archive-next-btn" type="button"${(state.archivePage + 1) * state.archivePageSize >= state.archiveTotal ? ' disabled' : ''}>Next →</button>
          <select class="archive-page-size-select">
            ${[10, 15, 20, 25, 50, 100, 200].map((n) => `<option value="${n}"${state.archivePageSize === n ? ' selected' : ''}>${n} per page</option>`).join('')}
          </select>
          <span class="muted archive-total">${state.archiveTotal} total</span>
        </div>
      ` : `<div class="grid-footer"><span class="muted">${displayed.length} of ${orders.length}</span></div>`}
    `;
  }

  // Like Mail's filter control, keep criteria separate from content and removable.
  state.orderFiltersExpanded ||= {open: false, archive: false};
  const filterRow = root.querySelector('tr.filters');
  const filterToolbar = document.createElement('div');
  filterToolbar.className = 'order-filter-controls';
  filterToolbar.innerHTML = `${filterRow ? `<button type="button" class="secondary" data-column-filters aria-controls="${view}-column-filters" aria-expanded="${state.orderFiltersExpanded[view]}">${window.i18n.t('Filters')}</button>` : ''}<span data-filter-summary role="status"></span><button type="button" class="secondary" data-clear-order-filters>${window.i18n.t('Clear filters')}</button>`;
  root.prepend(filterToolbar);
  const updateFilterSummary = () => {
    const active = Object.values(state.filters[view] || {}).some(value => String(value || '').trim());
    filterToolbar.hidden = !filterRow && !active;
    filterToolbar.querySelector('[data-filter-summary]').textContent = active ? window.i18n.t('Filters active') : '';
    filterToolbar.querySelector('[data-clear-order-filters]').hidden = !active;
    filterToolbar.querySelector('[data-column-filters]')?.setAttribute('aria-pressed', String(active));
  };
  updateFilterSummary();
  if (filterRow) {
    filterRow.hidden = !state.orderFiltersExpanded[view];
    filterToolbar.querySelector('[data-column-filters]').addEventListener('click', event => {
      state.orderFiltersExpanded[view] = !state.orderFiltersExpanded[view];
      filterRow.hidden = !state.orderFiltersExpanded[view];
      event.currentTarget.setAttribute('aria-expanded', String(state.orderFiltersExpanded[view]));
    });
  }
  filterToolbar.querySelector('[data-clear-order-filters]').addEventListener('click', async () => {
    state.filters[view] = {};
    if (isArchive) { clearTimeout(archiveDebounceTimer); state.archivePage = 0; await loadArchiveOrders(); }
    renderTables();
    document.getElementById(targetId).querySelector('[data-column-filters],input[type="search"]')?.focus();
  });
  root.oninput = updateFilterSummary;
  root.onchange = updateFilterSummary;

  root.querySelectorAll('.card-expand-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest('.order-card');
      const collapsed = card.classList.toggle('is-collapsed');
      button.setAttribute('aria-expanded', String(!collapsed));
      button.setAttribute('aria-label', collapsed ? 'Show order details' : 'Hide order details');
      button.querySelector('span').textContent = collapsed ? 'Details' : 'Hide';
    });
  });

  root.querySelectorAll('input[data-view][data-key]').forEach((input) => {
    input.addEventListener('input', () => {
      state.filters[input.dataset.view][input.dataset.key] = input.value;
      if (input.dataset.view === 'archive') {
        loadArchiveDebounced();
      } else {
        renderTablesDebounced(input.type === 'search' ? {
          view: input.dataset.view,
          key: input.dataset.key,
          position: input.selectionStart
        } : null);
      }
    });
  });

  root.querySelectorAll('select.mobile-order-sort').forEach((select) => {
    select.addEventListener('change', async () => {
      const [key, dir] = select.value.split(':');
      if (select.dataset.view === 'archive') {
        state.sortArchive = { key, dir };
        state.archivePage = 0;
        await loadArchiveOrders();
      } else {
        state.sortOpen = { key, dir };
      }
      renderTables();
    });
  });

  root.querySelectorAll('select[data-view][data-key]').forEach((sel) => {
    sel.addEventListener('change', () => {
      state.filters[sel.dataset.view][sel.dataset.key] = sel.value;
      if (sel.dataset.view === 'archive') {
        loadArchiveDebounced();
      } else {
        renderTables();
      }
    });
  });

  root.querySelectorAll('input[data-id][data-key]').forEach((input) => {
    input.addEventListener('change', async () => {
      await api(`/api/orders/${input.dataset.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ [input.dataset.key]: input.checked })
      });
      await loadOrders();
      renderTables();
    });
  });

  bindShippingWeightInputs(root);

  root.querySelectorAll('button.label-upload-btn').forEach((btn) => {
    btn.addEventListener('click', () => triggerLabelUpload(Number(btn.dataset.id)));
  });

  root.querySelectorAll('.action-menu-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dropdown = btn.nextElementSibling;
      const isOpen = !dropdown.hasAttribute('hidden');
      closeAllActionMenus();
      if (!isOpen) openOrderActionMenu(btn, dropdown);
    });
  });

  root.querySelectorAll('.label-reupload-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAllActionMenus();
      triggerLabelUpload(Number(btn.dataset.id));
    });
  });

  root.querySelectorAll('button.address-edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => openAddressDialog(Number(btn.dataset.id), btn.dataset.address));
  });

  root.querySelectorAll('button.note-edit-btn:not(.skus-edit-btn)').forEach((btn) => {
    btn.addEventListener('click', () => openNoteDialog(Number(btn.dataset.id), btn.dataset.note));
  });

  root.querySelectorAll('button.skus-edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => openSkusDialog(Number(btn.dataset.id), btn.dataset.skus));
  });

  root.querySelectorAll('button.tracking-edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      const order = state.openOrders.find((o) => Number(o.id) === id)
        || state.archiveOrders.find((o) => Number(o.id) === id)
        || state.pinnedOrders.find((o) => Number(o.id) === id);
      if (!order) return;
      if (view === 'open') openTrackingDialog(order);
      else openArchiveEditDialog(order);
    });
  });

  root.querySelectorAll('button.copy-btn, button.tracking-number-copy').forEach((btn) => {
    const isTrackingNumber = btn.classList.contains('tracking-number-copy');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard(btn.dataset.copy).then(() => {
        const orig = btn.innerHTML;
        btn.innerHTML = isTrackingNumber ? 'Copied' : copyCheckSvg;
        btn.classList.add('copied');
        setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 1500);
      }).catch(() => {});
    });
  });

  root.querySelectorAll('a.feedback-request-btn').forEach((link) => {
    link.addEventListener('click', () => {
      const id = Number(link.dataset.id);
      api(`/api/orders/${id}/request-feedback`, { method: 'POST' })
        .then((updated) => {
          const patch = (list) => list.map((o) => Number(o.id) === id ? { ...o, feedback_requested: updated.feedback_requested } : o);
          state.openOrders = patch(state.openOrders);
          state.archiveOrders = patch(state.archiveOrders);
          state.pinnedOrders = patch(state.pinnedOrders);
          renderTables();
        })
        .catch(() => {});
    });
  });

  root.querySelectorAll('button.pin-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const isPinned = state.pinnedOrderIds.has(id);
      await api(`/api/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ pinned: !isPinned }) });
      await loadPinnedOrders();
      renderTables();
      loadTrackingStatuses();
    });
  });

  root.querySelectorAll('button.gobbi-prep-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.id);
      const colors = btn.dataset.colors.split(',');
      const order = state.openOrders.find((o) => Number(o.id) === id);
      if (!order) return;
      const prepared = [...(order.prepared_gobbis || [])];
      const allPrepared = colors.every((c) => prepared.includes(c));
      if (allPrepared) {
        colors.forEach((c) => { const i = prepared.indexOf(c); if (i >= 0) prepared.splice(i, 1); });
      } else {
        colors.forEach((c) => { if (!prepared.includes(c)) prepared.push(c); });
      }
      const update = (arr) => arr.map((o) => Number(o.id) === id ? { ...o, prepared_gobbis: prepared } : o);
      state.openOrders = update(state.openOrders);
      renderTables();
      renderDashboard();
      api(`/api/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ prepared_gobbis: prepared }) }).catch(() => {});
    });
  });

  root.querySelectorAll('button.sort-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const sortKey = btn.dataset.sortKey;
      const sortView = btn.dataset.sortView;
      const sort = sortView === 'archive' ? state.sortArchive : state.sortOpen;
      if (sort.key === sortKey) {
        sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        sort.key = sortKey;
        sort.dir = 'desc';
      }
      if (sortView === 'archive') {
        state.archivePage = 0;
        await loadArchiveOrders();
        renderTables();
        loadFeedbackEligibility();
      } else {
        renderTables();
      }
    });
  });

  root.querySelectorAll('.date-range-input[data-fp-view][data-fp-key]').forEach((input) => {
    const v = input.dataset.fpView;
    const key = input.dataset.fpKey;
    const ikey = `${v}_${key}`;
    if (fpInstances[ikey]) fpInstances[ikey].destroy();
    const from = state.filters[v][key + '_from'];
    const to = state.filters[v][key + '_to'];
    fpInstances[ikey] = flatpickr(input, {
      mode: 'range',
      dateFormat: 'Y-m-d',
      altInput: true,
      altFormat: 'd.m.Y',
      locale: window.i18n.calendarLocale,
      defaultDate: from ? (to ? [from, to] : [from]) : undefined,
      onClose(selectedDates) {
        const f = selectedDates[0] ? toLocalIso(selectedDates[0]) : '';
        const t = selectedDates[1] ? toLocalIso(selectedDates[1]) : '';
        if (f !== (state.filters[v][key + '_from'] || '') || t !== (state.filters[v][key + '_to'] || '')) {
          state.filters[v][key + '_from'] = f;
          state.filters[v][key + '_to'] = t;
          if (v === 'archive') {
            state.archivePage = 0;
            loadArchiveOrders().then(() => renderTables());
          } else {
            renderTables();
          }
        }
      }
    });
    if (fpInstances[ikey].altInput) fpInstances[ikey].altInput.setAttribute('size', '1');
  });

  root.querySelectorAll('.date-range-clear').forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.fpView;
      state.filters[v][btn.dataset.fpKey + '_from'] = '';
      state.filters[v][btn.dataset.fpKey + '_to'] = '';
      if (v === 'archive') {
        state.archivePage = 0;
        loadArchiveOrders().then(() => renderTables());
      } else {
        renderTables();
      }
    });
  });

  if (selectCol) {
    root.querySelectorAll('input.row-select').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = Number(cb.dataset.id);
        if (isArchive) {
          if (cb.checked) state.archiveSelectedOrderIds.add(id);
          else state.archiveSelectedOrderIds.delete(id);
          updateArchiveSelectionBar();
        } else {
          if (cb.checked) state.selectedOrderIds.add(id);
          else state.selectedOrderIds.delete(id);
          updateSelectionBar();
        }
      });
    });
  }

  if (isArchive) {
    const prevBtn = root.querySelector('.archive-prev-btn');
    const nextBtn = root.querySelector('.archive-next-btn');
    const pageSizeSelect = root.querySelector('.archive-page-size-select');
    if (prevBtn) prevBtn.addEventListener('click', async () => {
      state.archivePage = Math.max(0, state.archivePage - 1);
      history.replaceState(null, '', `#archive/${state.archivePage}`);
      await loadArchiveOrders();
      renderTables();
      loadFeedbackEligibility();
    });
    if (nextBtn) nextBtn.addEventListener('click', async () => {
      state.archivePage += 1;
      history.replaceState(null, '', `#archive/${state.archivePage}`);
      await loadArchiveOrders();
      renderTables();
      loadFeedbackEligibility();
    });
    if (pageSizeSelect) pageSizeSelect.addEventListener('change', async () => {
      state.archivePageSize = Number(pageSizeSelect.value);
      state.archivePage = 0;
      history.replaceState(null, '', '#archive/0');
      await loadArchiveOrders();
      renderTables();
      loadFeedbackEligibility();
    });
  }

  requestAnimationFrame(() => fixFilterRowTop(root));
}

function fixFilterRowTop(root) {
  const labelRow = root && root.querySelector('thead tr:first-child');
  if (!labelRow) return;
  const h = labelRow.getBoundingClientRect().height;
  if (h > 0) root.querySelectorAll('tr.filters th').forEach((th) => { th.style.top = Math.ceil(h) + 'px'; });
}

function renderOrderRow(order, view, columns, isPinned) {
  const selectedSet = view === 'archive' ? state.archiveSelectedOrderIds : state.selectedOrderIds;
  const selectCell = view === 'open' || view === 'archive'
    ? `<td class="col-select"><input class="row-select" type="checkbox" data-id="${order.id}" ${selectedSet.has(Number(order.id)) ? 'checked' : ''}></td>`
    : '';
  const cells = columns.map((column) => {
    const cell = renderCell(order, column, view);
    return column.label ? cell.replace('<td', `<td data-label="${escapeHtml(column.label)}"`) : cell;
  }).join('');
  const rowClass = isPinned ? 'pinned-row' : order.status === 'Pending' ? 'pending-row' : '';
  return `<tr ${window.marketplaceAppearance?.attributes(order)||''}${rowClass ? ` class="${rowClass}"` : ''}>${selectCell}${cells}</tr>`;
}

function isAmazonFeedbackEligible(order) {
  return Boolean(sellerCentralReviewUrl(order));
}

function renderCell(order, column, view) {
  if (column.feedbackAction) {
    if (order.feedback_requested) {
      return `<td class="feedback-col"><span class="feedback-requested">Requested</span></td>`;
    }
    const reviewUrl = sellerCentralReviewUrl(order);
    if (reviewUrl) {
      return `<td class="feedback-col"><a class="feedback-request-btn" href="${reviewUrl}" target="_blank" rel="noopener" data-id="${order.id}">Request Review</a></td>`;
    }
    return `<td class="feedback-col"></td>`;
  }

  if (column.pinAction) {
    const pinned = state.pinnedOrderIds.has(Number(order.id));
    const pinSvg = `<svg viewBox="0 0 24 24" width="14" height="14" fill="${pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>`;
    return `<td class="pin-col"><button class="pin-btn${pinned ? ' pinned' : ''}" type="button" data-id="${order.id}" title="${pinned ? 'Unpin' : 'Pin to top'}">${pinSvg}</button></td>`;
  }

  if (column.actionMenu) {
    const labelAction = order.label_url ? 'Replace label' : 'Upload label';
    return `<td class="action-menu-col"><div class="action-menu-wrap"><button class="action-menu-btn" type="button" data-id="${order.id}" aria-label="Order actions" title="Actions">⋮</button><div class="action-menu-dropdown" hidden><button type="button" class="action-menu-item" data-order-details="${order.id}">Order details</button>${renderShowLabelButton(order,'action-menu-item')}<button class="label-reupload-btn action-menu-item" type="button" data-id="${order.id}">${labelAction}</button></div></div></td>`;
  }

  const value = column.value(order);
  const className = column.className ? ` class="${column.className}"` : '';
  if (column.key === 'ship_by_date') return `<td${className}>${renderShipDeadline(order.ship_by_date, order.shipped)}</td>`;

  if (column.multiline) {
    const firstLine = escapeHtml(value.split('\n')[0] || '');
    const code = detectCountryCode(value);
    const countryName = code ? escapeHtml(CODE_TO_NAME[code] || code) : '';
    const flag = code ? `<img class="country-flag" src="https://flagcdn.com/16x12/${code.toLowerCase()}.png" alt="${countryName}" title="${countryName}">` : '';
    const editSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    const copyBtn = column.copyable && value ? `<button class="copy-btn" type="button" data-copy="${escapeHtml(value)}" title="Copy address">${clipboardSvg}</button>` : '';
    return `<td${className}><div class="address-cell">${flag}<span class="address-first-line">${firstLine}</span><span class="address-full">${escapeHtml(value)}</span><button class="address-edit-btn" type="button" data-id="${order.id}" data-address="${escapeHtml(value)}" aria-label="Edit address">${editSvg}</button>${copyBtn}</div></td>`;
  }

  if (column.textEdit) {
    const firstLine = escapeHtml(value.split('\n')[0] || '');
    const editSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    return `<td${className}><div class="note-cell"><span class="note-text">${firstLine}</span><button class="note-edit-btn" type="button" data-id="${order.id}" data-note="${escapeHtml(value)}" aria-label="Edit note">${editSvg}</button></div></td>`;
  }

  if (column.weightEdit) {
    return `<td${className}><input class="weight-input" type="text" inputmode="decimal" value="${escapeHtml(value)}" data-weight-id="${order.id}" placeholder="—" aria-label="Shipping weight in kg"></td>`;
  }

  if (column.labelLink) {
    const pdfSvg = `<svg class="label-pdf-icon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
    const uploadSvg = `<svg class="label-upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
    if (!labelPreviewUrl(order.label_url)) {
      return `<td${className}><button class="label-upload-btn" type="button" data-id="${order.id}" title="Upload label">${uploadSvg}</button></td>`;
    }
    return `<td${className}><a class="label-pdf-link" href="${escapeHtml(labelPreviewUrl(order.label_url))}" target="_blank" rel="noreferrer" title="Show label">${pdfSvg}</a></td>`;
  }

  if (column.editable) {
    return `<td${className}><input class="check" type="checkbox" data-id="${order.id}" data-key="${column.key}" ${order[column.key] ? 'checked' : ''}></td>`;
  }

  if (column.href) {
    const href = column.href(order);
    const inner = href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(value)}</a>` : escapeHtml(value);
    const pendingIcon = column.pendingBadge && order.status === 'Pending'
      ? `<span class="pending-badge" title="Pending — not yet paid"><svg class="pending-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>`
      : '';
    if (column.copyable && value) {
      return `<td${className}><div class="cell-copy-wrap">${inner}${pendingIcon}<button class="copy-btn" type="button" data-copy="${escapeHtml(value)}" title="Copy">${clipboardSvg}</button></div></td>`;
    }
    return `<td${className}>${inner}${pendingIcon}</td>`;
  }

  if (column.link) {
    const linkText = typeof column.linkText === 'function' ? column.linkText(order) : column.linkText;
    return `<td${className}>${value ? `<a href="${escapeHtml(value)}" target="_blank" rel="noreferrer">${escapeHtml(linkText)}</a>` : ''}</td>`;
  }

  if (column.vendorBadge) {
    return `<td${className}>${renderVendorBadge(value)}</td>`;
  }

  if (column.appendGift) {
    const giftIcon = order.is_gift
      ? (() => { const t = escapeHtml(order.gift_message ? `Gift: ${order.gift_message}` : 'Gift order'); return `<span class="gift-badge" title="${t}"><svg class="gift-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg></span>`; })()
      : '';
    const editSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    const editBtn = `<button class="note-edit-btn skus-edit-btn" type="button" data-id="${order.id}" data-skus="${escapeHtml(value)}" aria-label="Edit SKUs">${editSvg}</button>`;
    return `<td${className}><div class="skus-cell"><div class="skus-lines">${renderSkuLines(value, order.id, view)}</div>${giftIcon}${editBtn}</div></td>`;
  }
  if (column.trackingEdit && (view === 'archive' || view === 'open')) {
    const editSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    const trackingNumber = value ? `<button class="tracking-number-copy" type="button" data-copy="${escapeHtml(value)}" title="Copy tracking number">${escapeHtml(value)}</button>` : '';
    return `<td${className}><div class="cell-copy-wrap">${trackingNumber}<button class="tracking-edit-btn" type="button" data-id="${order.id}" title="Edit tracking">${editSvg}</button></div></td>`;
  }
  if (column.copyable && value) {
    return `<td${className}><div class="cell-copy-wrap">${escapeHtml(value)}<button class="copy-btn" type="button" data-copy="${escapeHtml(value)}" title="Copy">${clipboardSvg}</button></div></td>`;
  }
  return `<td${className}>${escapeHtml(value)}</td>`;
}

function renderOrderCard(order, view, isPinned) {
  const isArchive = view === 'archive';
  const selectedSet = isArchive ? state.archiveSelectedOrderIds : state.selectedOrderIds;
  const editSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;

  const selectCb = view === 'open' || view === 'archive'
    ? `<label class="card-select"><input class="row-select" type="checkbox" data-id="${order.id}" ${selectedSet.has(Number(order.id)) ? 'checked' : ''}><span class="sr-only">Select order ${escapeHtml(displayOrderId(order))}</span></label>`
    : '';

  const orderId = displayOrderId(order);
  const orderUrl = orderFallbackUrl(order);
  const orderIdEl = orderUrl
    ? `<a href="${escapeHtml(orderUrl)}" target="_blank" rel="noreferrer">${escapeHtml(orderId)}</a>`
    : escapeHtml(orderId);
  const orderIdCopy = orderId ? `<button class="copy-btn card-order-copy" type="button" data-copy="${escapeHtml(orderId)}" title="Copy order number" aria-label="Copy order number">${clipboardSvg}</button>` : '';
  const pendingIcon = order.status === 'Pending'
    ? `<span class="pending-badge" title="Pending — not yet paid"><svg class="pending-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>`
    : '';

  const giftIcon = order.is_gift ? (() => {
    const t = escapeHtml(order.gift_message ? `Gift: ${order.gift_message}` : 'Gift order');
    return `<span class="gift-badge" title="${t}"><svg class="gift-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg></span>`;
  })() : '';

  const address = order.address || '';
  const addrLines = address.split('\n');
  const customerName = escapeHtml(addrLines[0] || '');
  const addrRest = escapeHtml(addrLines.slice(1).join(', ').trim());
  const code = detectCountryCode(address);
  const countryName = code ? escapeHtml(CODE_TO_NAME[code] || code) : '';
  const flag = code ? `<img class="country-flag" src="https://flagcdn.com/16x12/${code.toLowerCase()}.png" alt="${countryName}" title="${countryName}">` : '';

  const orderDate = fmtDate(order.created_at);
  const shipDate = fmtDate(order.ship_by_date);

  const pdfSvg = `<svg class="label-pdf-icon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
  const uploadSvg = `<svg class="label-upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
  const labelEl = labelPreviewUrl(order.label_url)
    ? `<a class="label-pdf-link" href="${escapeHtml(labelPreviewUrl(order.label_url))}" target="_blank" rel="noreferrer" title="Show label">${pdfSvg}</a>`
    : `<button class="label-upload-btn" type="button" data-id="${order.id}" title="Upload label">${uploadSvg}</button>`;

  const trackingUrl = order.tracking_url || '';
  const trackingStatus = order.tracking_status || state.trackingStatuses[order.tracking_code]?.status || '';
  const trackingNumberEl = `<span class="card-tracking-number"><span class="card-meta-label">Tracking #</span><span class="card-tracking-value"> ${order.tracking_code
    ? `<button class="tracking-number-copy" type="button" data-copy="${escapeHtml(order.tracking_code)}" title="Copy tracking number">${escapeHtml(order.tracking_code)}</button>`
    : '<span class="muted">Not set</span>'}<button class="tracking-edit-btn" type="button" data-id="${order.id}" title="Edit tracking" aria-label="Edit tracking">${editSvg}</button></span></span>`;
  const trackingInfoEl = trackingUrl
    ? `<span class="card-tracking-info"><span class="card-meta-label">Tracking status</span> <a href="${escapeHtml(trackingUrl)}" target="_blank" rel="noreferrer" class="card-tracking-link">${escapeHtml(trackingStatus || 'Track package')}</a></span>`
    : `<span class="card-tracking-info"><span class="card-meta-label">Tracking status</span> ${escapeHtml(trackingStatus || 'No status yet')}</span>`;

  const note = order.note || '';
  const noteEl = `<div class="card-note"><span class="note-text${note ? '' : ' muted'}">${escapeHtml(note ? note.split('\n')[0] : 'Add a note')}</span><button class="note-edit-btn" type="button" data-id="${order.id}" data-note="${escapeHtml(note)}" aria-label="${note ? 'Edit note' : 'Add note'}">${editSvg}</button></div>`;

  const labelAction = order.label_url ? 'Replace label' : 'Upload label';
  const actionMenu = `<div class="action-menu-wrap"><button class="action-menu-btn" type="button" data-id="${order.id}" aria-label="Order actions" title="Actions">⋮</button><div class="action-menu-dropdown" hidden><button type="button" class="action-menu-item" data-order-details="${order.id}">Order details</button>${renderShowLabelButton(order,'action-menu-item')}<button class="label-reupload-btn action-menu-item" type="button" data-id="${order.id}">${labelAction}</button></div></div>`;

  const pinned = state.pinnedOrderIds.has(Number(order.id));
  const pinSvg = `<svg viewBox="0 0 24 24" width="14" height="14" fill="${pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>`;
  const archiveActions = isArchive ? `<div class="card-archive-actions">
    <button class="pin-btn${pinned ? ' pinned' : ''}" type="button" data-id="${order.id}" title="${pinned ? 'Unpin' : 'Pin to top'}">${pinSvg}</button>
    ${order.feedback_requested
      ? `<span class="feedback-requested">Feedback requested</span>`
      : (() => { const u = sellerCentralReviewUrl(order); return u ? `<a class="feedback-request-btn" href="${u}" target="_blank" rel="noopener" data-id="${order.id}">Request Review</a>` : ''; })()}
  </div>` : '';

  return `<div class="order-card is-collapsed${isPinned ? ' pinned-card' : ''}${selectedSet.has(Number(order.id)) ? ' selected-card' : ''}${order.status === 'Pending' ? ' pending-card' : ''}" data-id="${order.id}" ${window.marketplaceAppearance?.attributes(order)||''}>
    <div class="card-header">
      ${selectCb}
      ${renderVendorBadge(order.vendor || order.channel || '')}
      <span class="card-summary-customer">${flag}<span class="card-customer-name">${customerName || 'Name not set'}</span></span>
      <span class="card-order-id">${orderIdEl}${pendingIcon}</span>
      ${orderIdCopy}
      <button class="card-expand-btn" type="button" aria-expanded="false" aria-label="Show order details"><span>Details</span><span class="card-expand-chevron" aria-hidden="true">⌄</span></button>
      ${actionMenu}
    </div>
    ${view === 'open' ? `<div class="card-workflow-status"><span class="card-meta-label">Status</span> <strong data-no-translate>${escapeHtml(workflowStatusLabel(order))}</strong></div>` : ''}
    <div class="card-customer">${customerName ? `${flag}<span class="card-customer-name">${customerName}</span>` : '<span class="card-customer-name muted">Add address</span>'}<button class="address-edit-btn" type="button" data-id="${order.id}" data-address="${escapeHtml(address)}" aria-label="${address ? 'Edit address' : 'Add address'}">${editSvg}</button>${address ? `<button class="copy-btn" type="button" data-copy="${escapeHtml(address)}" title="Copy address">${clipboardSvg}</button>` : ''}</div>
    <div class="card-skus">${renderSkuLines(order.skus || '', order.id, view)}${giftIcon}<button class="note-edit-btn skus-edit-btn" type="button" data-id="${order.id}" data-skus="${escapeHtml(order.skus || '')}" aria-label="Edit SKUs">${editSvg}</button></div>
    ${addrRest ? `<div class="card-address"><span class="address-first-line">${addrRest}</span></div>` : ''}
    <div class="card-meta">
      ${orderDate ? `<span><span class="card-meta-label">Order</span> ${orderDate}</span>` : ''}
      <span class="card-ship-date"><span class="card-meta-label">Ship by</span> ${renderShipDeadline(order.ship_by_date, order.shipped)}</span>
      <span><span class="card-meta-label">Weight kg</span> <input class="weight-input card-weight-input" type="text" inputmode="decimal" value="${escapeHtml(order.shipping_weight || '')}" data-weight-id="${order.id}" placeholder="—" aria-label="Shipping weight in kg"></span>
      <span>${labelEl}</span>
      ${trackingNumberEl}
      ${trackingInfoEl}
    </div>
    ${noteEl}
    ${archiveActions}
    <div class="order-card-footer">${renderOrderTotal(order)}${renderShopifyPayment(order)}${renderFulfillmentSummary(order)}</div>
  </div>`;
}

let WORKFLOW_STAGES = [
  ['new', 'NEW'], ['in_progress', 'IN PROGRESS'], ['crafted', 'CRAFTED'],
  ['ready_for_pickup', 'READY FOR PICKUP'], ['shipped', 'SHIPPED']
];
let boardSaving = false;
let boardActionBusy = false;

let workflowSettingsBusy = false;
let workflowStatuses = [];

async function loadWorkflowStatuses() {
  workflowStatuses = await api('/api/workflow-statuses');
  WORKFLOW_STAGES = workflowStatuses.map((status) => [status.id, status.label]);
  if (!WORKFLOW_STAGES.some(([id]) => id === state.boardStage)) state.boardStage = 'new';
  renderWorkflowSettings();
}

function renderWorkflowSettings() {
  document.getElementById('workflowSettingsList').innerHTML = workflowStatuses.map((status,index) =>
    `<div class="workflow-settings-row" data-workflow-id="${escapeHtml(status.id)}">
      <input value="${escapeHtml(status.label)}" maxlength="60" aria-label="Name for ${escapeHtml(status.label)}" ${workflowSettingsBusy ? 'disabled' : ''}>
      <span class="muted">${status.order_count} orders${status.id === 'new' ? ' · Default' : ''}</span>
      <button type="button" class="secondary" data-workflow-move="-1" aria-label="Move up" title="Move up" ${workflowSettingsBusy || index===0 ? 'disabled' : ''}>↑</button><button type="button" class="secondary" data-workflow-move="1" aria-label="Move down" title="Move down" ${workflowSettingsBusy || index===workflowStatuses.length-1 ? 'disabled' : ''}>↓</button>
      <button type="button" data-workflow-rename ${workflowSettingsBusy ? 'disabled' : ''}>Rename</button>
      ${status.id !== 'new' ? `<button type="button" class="secondary danger-button" data-workflow-delete ${workflowSettingsBusy ? 'disabled' : ''}>Remove</button>` : ''}
      <label><input type="checkbox" data-workflow-production ${status.production_complete?'checked':''} ${workflowSettingsBusy||status.id==='new'?'disabled':''}>Production complete — consume stock</label><button type="button" data-save-production ${workflowSettingsBusy?'disabled':''}>Save production meaning</button>
      <div class="workflow-appearance"><label>Column color<input type="color" data-workflow-color value="${escapeHtml(status.background_color || '#6e8fb5')}" ${workflowSettingsBusy ? 'disabled' : ''}></label><label>Opacity<input type="range" data-workflow-alpha min="0" max="100" step="1" value="${Math.round(Number(status.background_alpha ?? 0.15)*100)}" ${workflowSettingsBusy ? 'disabled' : ''}><output data-no-translate>${Math.round(Number(status.background_alpha ?? 0.15)*100)}%</output></label><span class="workflow-color-preview" aria-hidden="true" style="${workflowBackgroundStyle(status)}"></span><button type="button" class="secondary" data-workflow-appearance ${workflowSettingsBusy ? 'disabled' : ''}>Save appearance</button><button type="button" class="secondary" data-workflow-reset ${workflowSettingsBusy ? 'disabled' : ''}>Reset color</button></div>
    </div>`).join('');
  document.querySelectorAll('[data-save-production]').forEach(button=>button.onclick=()=>{
    const row=button.closest('[data-workflow-id]');saveWorkflowSettings(`/api/workflow-statuses/${encodeURIComponent(row.dataset.workflowId)}/production`,'PATCH',{production_complete:row.querySelector('[data-workflow-production]').checked});
  });
  document.querySelectorAll('.workflow-appearance').forEach(appearance => {
    const color=appearance.querySelector('[data-workflow-color]'), alpha=appearance.querySelector('[data-workflow-alpha]');
    const preview=()=>{appearance.querySelector('output').textContent=`${alpha.value}%`;appearance.querySelector('.workflow-color-preview').style.cssText=workflowBackgroundStyle({background_color:color.value,background_alpha:Number(alpha.value)/100});};
    color.addEventListener('input',preview);alpha.addEventListener('input',preview);
    for (const [selector,reset] of [['[data-workflow-appearance]',false],['[data-workflow-reset]',true]]) appearance.querySelector(selector).addEventListener('click',()=>{
      const row=appearance.closest('[data-workflow-id]');
      saveWorkflowSettings(`/api/workflow-statuses/${encodeURIComponent(row.dataset.workflowId)}/appearance`,'PATCH',{background_color:reset?null:color.value,background_alpha:reset?0.15:Number(alpha.value)/100});
    });
  });
  document.querySelectorAll('[data-workflow-move]').forEach(button=>button.addEventListener('click',()=>{
    const id=button.closest('[data-workflow-id]').dataset.workflowId,ids=workflowStatuses.map(status=>status.id),index=ids.indexOf(id),next=index+Number(button.dataset.workflowMove);
    if(next<0 || next>=ids.length)return;
    [ids[index],ids[next]]=[ids[next],ids[index]];
    saveWorkflowSettings('/api/workflow-statuses/reorder','POST',{ids});
  }));
  document.querySelectorAll('[data-workflow-rename]').forEach((button) => {
    button.addEventListener('click', () => {
      const row = button.closest('[data-workflow-id]');
      saveWorkflowSettings(`/api/workflow-statuses/${encodeURIComponent(row.dataset.workflowId)}`, 'PATCH', { label: row.querySelector('input').value });
    });
  });
  document.querySelectorAll('[data-workflow-delete]').forEach((button) => {
    button.addEventListener('click', () => {
      const row = button.closest('[data-workflow-id]');
      const status = workflowStatuses.find((item) => item.id === row.dataset.workflowId);
      const defaultName = WORKFLOW_STAGES.find(([id]) => id === 'new')[1];
      if (!confirm(`Remove "${status.label}"? Its ${status.order_count} orders will move to "${defaultName}". Archiving will not change.`)) return;
      saveWorkflowSettings(`/api/workflow-statuses/${encodeURIComponent(status.id)}`, 'DELETE');
    });
  });
  document.querySelector('#addWorkflowStatus button').disabled = workflowSettingsBusy;
}

async function saveWorkflowSettings(url, method, body) {
  if (workflowSettingsBusy) return;
  workflowSettingsBusy = true;
  renderWorkflowSettings();
  const message = document.getElementById('workflowSettingsMessage');
  message.textContent = 'Saving…';
  try {
    await api(url, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (method === 'POST' && !url.endsWith('/reorder')) document.getElementById('newWorkflowLabel').value = '';
    await loadWorkflowStatuses();
    await loadOrders();
    await loadPinnedOrders();
    renderTables();
    message.textContent = 'Order statuses saved';
  } catch (error) {
    message.textContent = `Could not save: ${error.message}`;
  } finally {
    workflowSettingsBusy = false;
    renderWorkflowSettings();
  }
}

document.getElementById('addWorkflowStatus').addEventListener('submit', (event) => {
  event.preventDefault();
  saveWorkflowSettings('/api/workflow-statuses', 'POST', { label: document.getElementById('newWorkflowLabel').value });
});


function workflowBackgroundStyle(status) {
  const color=status?.background_color, alpha=Number(status?.background_alpha);
  if(!/^#[0-9a-f]{6}$/i.test(color || '') || !Number.isFinite(alpha) || alpha<0 || alpha>1)return '';
  const rgb=[1,3,5].map(index=>parseInt(color.slice(index,index+2),16));
  return `background-color:rgba(${rgb.join(',')},${alpha});`;
}

function translatedWorkflowLabel(id, label) {
  const defaults = { new: 'NEW', in_progress: 'IN PROGRESS', crafted: 'CRAFTED', ready_for_pickup: 'READY FOR PICKUP', shipped: 'SHIPPED' };
  return label === defaults[id] ? window.i18n.t(label) : label;
}
function workflowStatusLabel(order) {
  const id = order.workflow_status || 'new';
  const label = WORKFLOW_STAGES.find(([value]) => value === id)?.[1] || 'NEW';
  return translatedWorkflowLabel(id, label);
}

function workflowStatusIcon(status) {
  const paths = {
    new: '<path d="M4 4h16v16H4z"/><path d="M4 13h5l2 3h2l2-3h5"/>',
    in_progress: '<path d="m14 6 4-4 4 4-4 4-2-2-9 9-3-3 9-9z"/><path d="m3 3 5 5m9 9 4 4"/>',
    crafted: '<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
    ready_for_pickup: '<path d="m3 7 9-4 9 4v10l-9 4-9-4z"/><path d="m3 7 9 4 9-4M12 11v10m-5-16 9 4"/>',
    shipped: '<path d="M2 5h12v12H2zM14 9h4l4 4v4h-8"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>'
  };
  return `<svg class="workflow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[status] || '<path d="M3 3h8l10 10-8 8L3 11z"/><circle cx="7" cy="7" r="1"/>'}</svg>`;
}

function boardChannelClass(order) {
  const channel = `${order.channel || ''} ${order.vendor || ''}`.toLowerCase();
  const name = ['etsy', 'shopify', 'amazon', 'sashe', 'manual'].find((value) => channel.includes(value));
  return `vendor-${name || 'other'}`;
}

function labelPreviewUrl(value) {
  try { const text=String(value || '').trim();if(!text)return '';const url=new URL(text,location.origin);return ['http:','https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
function renderShowLabelButton(order, className='secondary') {
  const url=labelPreviewUrl(order.label_url);
  return `<button type="button" class="${className}" data-show-label="${escapeHtml(url)}" ${url ? '' : 'disabled'} title="${url ? 'Show label' : 'No label'}">Show label</button>`;
}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-show-label]');if(!button || button.disabled)return;
  const url=labelPreviewUrl(button.dataset.showLabel);if(!url)return;
  closeAllActionMenus();window.open(url,'_blank','noopener,noreferrer');
},true);

function renderBoardActions(order) {
  const action = (key, label, extra = '') => `<button type="button" class="action-menu-item" data-board-action="${key}" data-id="${order.id}" ${extra} ${boardActionBusy ? 'disabled' : ''}>${escapeHtml(label)}</button>`;
  return `<div class="action-menu-wrap board-action-menu"><button type="button" class="action-menu-btn" aria-label="Actions for order ${escapeHtml(displayOrderId(order))}" aria-expanded="false" ${boardActionBusy ? 'disabled' : ''}>⋮</button>
    <div class="action-menu-dropdown" hidden>
      ${renderShowLabelButton(order,'action-menu-item')}${action('gls', 'Generate GLS Courier label')}${action('parcel', 'Generate Slovenská pošta parcel label')}
      ${action('upload', order.label_url ? 'Replace label' : 'Upload label')}${action('edit', 'Edit order')}
      ${order.shipped ? '' : action('create_batch', 'Create batch')}
      ${(order.shipped ? [] : state.prepBatches).map((batch) => action('add_batch', `Add to ${batch.name}`, `data-batch-id="${batch.id}"`)).join('')}
      ${order.shipped ? '' : action('archive', 'Mark as Shipped (archive)')}${action('delete', 'Delete order')}
    </div></div>`;
}

async function runBoardAction(button) {
  if (boardActionBusy || boardSaving) return;
  const id = Number(button.dataset.id);
  const order = findBoardOrder(id);
  if (!order) return;
  const action = button.dataset.boardAction;
  closeAllActionMenus();
  if (action === 'edit') { openArchiveEditDialog(order); return; }
  if (action === 'upload') { triggerLabelUpload(id); return; }
  if (action === 'archive' && !confirm(`Mark order ${displayOrderId(order)} as shipped and move it to Archive?`)) return;
  if (action === 'delete' && !confirm(`Permanently delete order ${displayOrderId(order)}?`)) return;
  boardActionBusy = true;
  renderOrderBoard();
  try {
    if (action === 'gls' || action === 'parcel') {
      await printLabels(button, action === 'gls' ? '/api/labels/gls' : '/api/labels/posta', { orderIds: [id], ...(action === 'parcel' ? { type: 'parcel' } : {}) });
    } else if (action === 'create_batch' || action === 'add_batch') {
      const batch = action === 'create_batch'
        ? await api('/api/prep-batches', { method: 'POST', body: JSON.stringify({ order_ids: [id] }) })
        : await api(`/api/prep-batches/${button.dataset.batchId}/orders`, { method: 'POST', body: JSON.stringify({ order_ids: [id] }) });
      await loadPrepBatches(batch.id);
      setView('batch');
    } else {
      if(action==='archive'){
        const results=await window.workflowDispatchUI.archive([order]);
        if(!results)return;
        document.getElementById('boardMessage').textContent=window.workflowDispatchUI.message(results);
        if(results.some(o=>o.dispatch_result&&o.dispatch_result.state!=='confirmed'))alert(window.i18n.t(window.workflowDispatchUI.message(results)));
      }else await api(`/api/orders/${id}`,{method:'DELETE'});
      state.selectedOrderIds.delete(id);
      await loadOrders();
      await loadPinnedOrders();
      await loadPrepBatches(state.currentPrepBatch?.id);
      renderTables();
    }
  } catch (error) {
    document.getElementById('boardMessage').textContent = `Could not complete action: ${error.message}`;
  } finally {
    boardActionBusy = false;
    renderOrderBoard();
  }
}

function renderFulfillmentSummary(order) {
  const outcome = ({canceled:'Canceled',refunded:'Refunded',returned:'Returned'})[order.business_outcome];
  const quantity = Number(order.fulfillment_quantity || 0), shipped = Number(order.fulfilled_quantity || 0);
  return `${outcome ? `<span class="business-outcome">${escapeHtml(window.i18n.t(outcome))}</span>` : ''}${quantity && shipped ? `<span class="fulfillment-summary">${escapeHtml(window.i18n.t(shipped >= quantity ? 'Fully shipped' : 'Partially shipped'))}: ${shipped} / ${quantity}</span>` : ''}`;
}

function renderShopifyPayment(order) {
  if (String(order.channel || '').toLowerCase() !== 'shopify') return '';
  const status = String(order.source_payload?.financial_status || '').toLowerCase();
  const statuses = {
    paid: ['paid', 'Paid', '✓'],
    pending: ['unpaid', 'Unpaid', '!'], authorized: ['unpaid', 'Payment authorized — not captured', '!'],
    unpaid: ['unpaid', 'Unpaid', '!'], expired: ['unpaid', 'Payment expired', '!'],
    partially_paid: ['unpaid', 'Partially paid', '!'],
    refunded: ['refunded', 'Refunded', '↶'], partially_refunded: ['refunded', 'Partially refunded', '↶'],
    voided: ['unpaid', 'Payment voided', '!']
  };
  const [kind, label, icon] = statuses[status] || ['unknown', 'Payment status unknown', '?'];
  return `<div class="shopify-payment-footer"><span class="shopify-payment shopify-payment--${kind}" title="${label}" aria-label="${label}" role="img"><span aria-hidden="true">${icon}</span><span>${label}</span></span></div>`;
}

function renderBoardTracking(order) {
  if(!order.tracking_code && !order.tracking_url && !order.tracking_status) return '';
  const tracking = state.trackingStatuses[order.tracking_code] || {};
  const status = order.tracking_status || tracking.status || 'No status yet';
  const number = escapeHtml(order.tracking_code || 'Not set');
  const url = order.tracking_url || '';
  const deliveredAt = order.delivered_at || tracking.deliveredAt;
  return `<div class="board-tracking"><div class="board-data-field"><span class="card-meta-label">Tracking #</span>
    <div class="board-tracking-number">${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer" draggable="false">${number}</a>` : number}${order.tracking_code ? `<button type="button" class="copy-btn board-tracking-copy" data-copy="${escapeHtml(order.tracking_code)}" title="Copy tracking number" aria-label="Copy tracking number">${clipboardSvg}</button>` : ''}</div>
    </div><div class="board-data-field"><span class="card-meta-label">Tracking status</span><div>${escapeHtml(status)}</div></div>
    ${deliveredAt ? `<div class="muted board-data-wide"><span>Delivered</span> ${escapeHtml(fmtDate(deliveredAt))}</div>` : ''}</div>`;
}

function renderOrderBoard() {
  const root = document.getElementById('orderBoard');
  const search = document.getElementById('boardSearch').value.trim().toLowerCase();
  const orders = [...state.openOrders.filter(order=>window.orderFilterHelpers.boardMatches(order,search) && window.orderWorkspace.matches(order)),...(Object.values(window.orderWorkspace.filters).some(Boolean)?[]:state.boardArchiveOrders.map(order=>({...order,workflow_status:'shipped'})))];
  window.orderWorkspace.render();
  const archivedExtra = Object.values(window.orderWorkspace.filters).some(Boolean) ? 0 : Math.max(0,state.boardArchiveTotal-state.boardArchiveOrders.length);
  const tabs = document.getElementById('boardTabs');
  tabs.innerHTML = WORKFLOW_STAGES.map(([status, label]) => {
    const count = orders.filter((order) => (order.workflow_status || 'new') === status).length + (status === 'shipped' ? archivedExtra : 0);
    const selected = state.boardStage === status;
    return `<button type="button" role="tab" id="board-tab-${status}" data-board-stage="${status}" aria-controls="board-column-${status}" aria-selected="${selected}" tabindex="${selected ? 0 : -1}">${workflowStatusIcon(status)}<span data-no-translate>${escapeHtml(translatedWorkflowLabel(status, label))}</span><span class="board-count">${count}</span></button>`;
  }).join('');
  tabs.querySelectorAll('[data-board-stage]').forEach((tab, index) => {
    tab.addEventListener('click', () => { state.boardStage = tab.dataset.boardStage;if(state.boardStage==='shipped')state.boardShippedCollapsed=false; renderOrderBoard(); document.getElementById(`board-tab-${state.boardStage}`).focus();if(state.boardStage==='shipped')void refreshShippedColumn(); });
    tab.addEventListener('keydown', (event) => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % WORKFLOW_STAGES.length;
      else if (event.key === 'ArrowLeft') next = (index + WORKFLOW_STAGES.length - 1) % WORKFLOW_STAGES.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = WORKFLOW_STAGES.length - 1;
      else return;
      event.preventDefault();
      state.boardStage = WORKFLOW_STAGES[next][0];
      if(state.boardStage==='shipped')state.boardShippedCollapsed=false;
      renderOrderBoard();
      document.getElementById(`board-tab-${state.boardStage}`).focus();
      if(state.boardStage==='shipped')void refreshShippedColumn();
    });
  });
  if (state.activeView === 'board' && window.matchMedia('(max-width: 700px)').matches) {
    const selectedTab = document.getElementById(`board-tab-${state.boardStage}`);
    if (selectedTab) tabs.scrollLeft = selectedTab.offsetLeft - tabs.offsetLeft;
  }
  root.innerHTML = WORKFLOW_STAGES.map(([status, label]) => {
    const cards = window.orderWorkspace.sortOrders(orders.filter((order) => (order.workflow_status || 'new') === status),status);
    const collapsed = status === 'shipped' && state.boardShippedCollapsed && !search;
    return `<section class="board-column${state.boardStage === status ? ' board-column-active' : ''}" id="board-column-${status}" data-stage="${status}" style="${workflowBackgroundStyle(workflowStatuses.find(item=>item.id===status))}" aria-label="${escapeHtml(label)}">
      <h3>${status === 'shipped' ? `<button type="button" class="board-column-toggle" data-board-shipped-toggle aria-expanded="${!collapsed}" aria-controls="board-shipped-cards">` : ''}<span class="board-column-title">${workflowStatusIcon(status)}<span data-no-translate>${escapeHtml(translatedWorkflowLabel(status, label))}</span>${status === 'shipped' ? `<span aria-hidden="true">${collapsed ? '⌄' : '⌃'}</span>` : ''}</span>${status === 'shipped' ? '</button>' : ''}<span class="board-column-tools"><span class="board-count">${cards.length + (status === 'shipped' ? archivedExtra : 0)}</span>${status === 'new' ? '<button type="button" class="board-add-order secondary" data-board-add-order title="Add Order" aria-label="Add Order">+</button>' : ''}</span></h3>
      <div class="board-cards" ${status === 'shipped' ? `id="board-shipped-cards" ${collapsed ? 'hidden' : ''}` : ''}>${cards.map((order) => {
        const missingAddress=(String(order.channel || '').toLowerCase()==='amazon' || /^amazon(?:[.\s]|$)/i.test(order.vendor || '')) && !String(order.address || '').trim();
        const customer = String(order.address || '').split('\n')[0];
        const countryCode = detectCountryCode(order.address || '');
        const countryName = countryCode ? CODE_TO_NAME[countryCode] || countryCode : '';
        const flag = countryCode ? `<img class="country-flag" src="https://flagcdn.com/16x12/${countryCode.toLowerCase()}.png" alt="${escapeHtml(countryName)}" title="${escapeHtml(countryName)}">` : '';
        const url = orderFallbackUrl(order);
        const title = escapeHtml(displayOrderId(order));
        const overdue = !order.shipped && shipDeadlineClass(order.ship_by_date) === 'deadline-overdue';
        return `<article class="board-card ${boardChannelClass(order)}" draggable="${!order.shipped}" data-order-id="${order.id}" ${window.marketplaceAppearance?.attributes(order)||''} tabindex="0">
          <div class="board-card-heading"><input type="checkbox" data-board-select="${order.id}" ${order.shipped ? 'disabled hidden' : ''} aria-label="Select order ${title}" ${state.selectedOrderIds.has(Number(order.id)) ? 'checked' : ''}><div class="board-order-identity">${renderVendorBadge(order.vendor)}${url ? `<a class="board-order-number" href="${escapeHtml(url)}" target="_blank" rel="noreferrer" draggable="false" title="${title}">${title}</a>` : `<strong class="board-order-number" title="${title}">${title}</strong>`}</div><div class="board-heading-actions">${renderBoardActions(order)}</div></div>
          <div class="board-customer">${missingAddress?'<strong class="board-missing-address">Missing address</strong>':`${flag}<span>${escapeHtml(customer)}</span>`}${!missingAddress && order.address ? `<button type="button" class="copy-btn board-address-copy" data-copy="${escapeHtml(order.address)}" title="Copy shipping address" aria-label="Copy shipping address">${clipboardSvg}</button>` : ''}</div>
          ${inventorySkuImages(order.skus)}<div class="board-products">${escapeHtml(order.skus || window.i18n.t('No products'))}</div>
          <div class="board-summary-fields">
          <div class="board-due board-data-field"><span class="card-meta-label">Ship by</span>${overdue ? '<span>Overdue</span> ' : ''} ${renderShipDeadline(order.ship_by_date, order.shipped)}</div>
          ${renderOrderTotal(order)}
          ${order.shipped ? '<span class="muted board-data-wide">Archived</span>' : `<label class="board-status-label board-data-wide"><span class="card-meta-label">Status</span><select data-board-status="${order.id}" ${boardSaving || boardActionBusy ? 'disabled' : ''} aria-label="Status for order ${title}">${WORKFLOW_STAGES.map(([value, text]) => `<option data-no-translate value="${value}"${value === status ? ' selected' : ''}>${escapeHtml(translatedWorkflowLabel(value, text))}</option>`).join('')}</select></label>`}
          </div>
          ${window.workflowDispatchUI.action(order)}
          ${order.note ? `<div class="board-note">${escapeHtml(order.note)}</div>` : ''}
          ${order.is_gift ? '<div class="board-gift">Gift order</div>' : ''}
          ${renderBoardTracking(order)}
          <div class="board-card-footer"><div class="board-weight-payment"><label class="board-shipping-weight"><span class="card-meta-label">Weight kg</span><input class="weight-input card-weight-input" type="text" inputmode="decimal" value="${escapeHtml(order.shipping_weight || '')}" data-weight-id="${order.id}" placeholder="—" aria-label="Shipping weight in kg"></label>${renderShopifyPayment(order)}</div>${renderFulfillmentSummary(order)}<button type="button" class="secondary board-details-button" data-order-details="${order.id}" title="Details" aria-label="Details"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button></div>
        </article>`;
      }).join('') || '<p class="board-empty">No orders</p>'}${status === 'shipped' && state.boardArchiveOffset < state.boardArchiveTotal ? `<button type="button" class="secondary" data-board-archive-more ${boardArchiveLoading ? 'disabled' : ''}>Load older orders</button>` : ''}</div>
    </section>`;
  }).join('');
  bindShippingWeightInputs(root);
  root.querySelector('[data-board-shipped-toggle]')?.addEventListener('click',()=>{state.boardShippedCollapsed=!state.boardShippedCollapsed;renderOrderBoard();if(!state.boardShippedCollapsed)void refreshShippedColumn();});
  root.querySelector('[data-board-archive-more]')?.addEventListener('click', async event=>{event.currentTarget.disabled=true;try{await loadBoardArchive(true);}catch(error){document.getElementById('boardMessage').textContent=error.message;}finally{renderOrderBoard();}});
  root.querySelectorAll('.board-tracking-copy, .board-address-copy').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const kind = button.classList.contains('board-address-copy') ? 'Shipping address' : 'Tracking number';
      const originalTitle = kind === 'Shipping address' ? 'Copy shipping address' : 'Copy tracking number';
      const originalLabel = originalTitle;
      try {
        await copyToClipboard(button.dataset.copy);
        button.innerHTML = copyCheckSvg;
        button.title = `${kind} copied`;
        button.setAttribute('aria-label', `${kind} copied`);
        document.getElementById('boardMessage').textContent = `${kind} copied`;
        setTimeout(() => { button.innerHTML = clipboardSvg; button.title = originalTitle; button.setAttribute('aria-label', originalLabel); }, 1500);
      } catch (error) {
        document.getElementById('boardMessage').textContent = `Could not copy ${kind.toLowerCase()}: ${error.message}`;
      }
    });
  });
  root.querySelectorAll('.board-action-menu .action-menu-btn').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const menu = button.nextElementSibling;
      const wasOpen = !menu.hidden;
      closeAllActionMenus();
      if (!wasOpen) openOrderActionMenu(button, menu);
    });
  });
  root.querySelectorAll('[data-board-action]').forEach((button) => {
    button.addEventListener('click', (event) => { event.stopPropagation(); runBoardAction(button); });
  });
  root.querySelectorAll('[data-send-shipped-order]').forEach(button=>button.onclick=event=>{event.stopPropagation();changeBoardStatus(Number(button.dataset.sendShippedOrder),'shipped',true);});
  root.querySelectorAll('[data-board-add-order]').forEach(button => button.addEventListener('click', () => document.getElementById('addOrder').click()));
  root.querySelectorAll('[data-board-select]').forEach(input => input.addEventListener('change', () => {
    const id = Number(input.dataset.boardSelect);
    if (input.checked) state.selectedOrderIds.add(id); else state.selectedOrderIds.delete(id);
    updateSelectionBar();
  }));
  updateSelectionBar();
  root.querySelectorAll('[data-board-status]').forEach((select) => {
    select.addEventListener('change', () => changeBoardStatus(Number(select.dataset.boardStatus), select.value));
  });
  root.querySelectorAll('.board-card').forEach((card) => {
    card.addEventListener('dragstart', (event) => {
      if (card.getAttribute('draggable') === 'false' || boardSaving || event.target.closest('select, input, button') || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
        event.preventDefault(); return;
      }
      event.dataTransfer.setData('application/x-jmoms-order', card.dataset.orderId);
      event.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      root.querySelectorAll('.drag-over').forEach((column) => column.classList.remove('drag-over'));
    });
  });
  root.querySelectorAll('.board-column').forEach((column) => {
    column.addEventListener('dragover', (event) => {
      if (!boardSaving && [...event.dataTransfer.types].includes('application/x-jmoms-order')) {
        event.preventDefault(); event.dataTransfer.dropEffect = 'move'; column.classList.add('drag-over');
      }
    });
    column.addEventListener('dragleave', (event) => {
      if (!column.contains(event.relatedTarget)) column.classList.remove('drag-over');
    });
    column.addEventListener('drop', (event) => {
      event.preventDefault(); column.classList.remove('drag-over');
      const id = Number(event.dataTransfer.getData('application/x-jmoms-order'));
      if (id) changeBoardStatus(id, column.dataset.stage);
    });
  });
}

async function changeBoardStatus(id, status, retry=false) {
  const order = findBoardOrder(id);
  if (boardSaving || boardActionBusy || !order || (!retry&&order.workflow_status === status)) return;
  if(!window.workflowDispatchUI.confirmTransition([order],status)){renderOrderBoard();return {saved:false,message:'Dispatch canceled'};}
  boardSaving = true;
  document.getElementById('boardMessage').textContent = 'Saving status…';
  renderOrderBoard();
  let result;
  try {
    const updated = await api(`/api/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ workflow_status: status,confirm_marketplace_dispatch:status==='shipped' }) });
    state.openOrders = state.openOrders.map((item) => Number(item.id) === id ? updated : item).filter(item=>!item.shipped);
    if(updated.shipped){state.boardArchiveOrders=[updated,...state.boardArchiveOrders.filter(item=>Number(item.id)!==id)];state.archiveOrders=[updated,...state.archiveOrders.filter(item=>Number(item.id)!==id)];}
    if(status==='shipped')state.boardShippedCollapsed=false;
    if (status==='shipped'||!window.matchMedia('(max-width: 700px)').matches) state.boardStage = status;
    document.getElementById('boardMessage').textContent = window.workflowDispatchUI.message([updated]);
    result={saved:true,message:window.workflowDispatchUI.message([updated])};
    try {
      await loadInventory();
      if (state.currentPrepBatch) await loadPrepBatches(state.currentPrepBatch.id);
    } catch (error) { result.message=`Status saved. Could not refresh inventory: ${error.message}`;document.getElementById('boardMessage').textContent=result.message; }
  } catch (error) {
    result={saved:false,message:`Could not save status: ${error.message}`};
    document.getElementById('boardMessage').textContent = result.message;
  } finally {
    boardSaving = false;
    renderTables();
    renderDashboard();
  }
  return result;
}

let boardSearchTimer;
document.getElementById('boardSearch').addEventListener('input', ()=>{++boardArchiveRequest;boardArchiveLoading=false;state.boardArchiveOrders=[];state.boardArchiveTotal=0;state.boardArchiveOffset=0;renderOrderBoard();clearTimeout(boardSearchTimer);boardSearchTimer=setTimeout(async()=>{try{await loadBoardArchive();renderOrderBoard();}catch(error){document.getElementById('boardMessage').textContent=error.message;}},300);});
document.getElementById('refreshBoard').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  document.getElementById('boardMessage').textContent = '';
  try {
    await loadOrders();
    renderTables();
    await loadTrackingStatuses({ force: true });
  } catch (error) {
    document.getElementById('boardMessage').textContent = error.message;
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
});

function renderTables(focus) {
  renderOrderBoard();
  renderOrderGrid('open', state.openOrders, 'openTable', 'openCount');
  renderOrderGrid('archive', state.archiveOrders, 'archiveTable', 'archiveCount');
  updateSelectionBar();
  updateArchiveSelectionBar();

  if (focus && focus.view && focus.key) {
    const input = document.querySelector(`input[type="search"][data-view="${focus.view}"][data-key="${focus.key}"]`);
    if (input) {
      input.focus();
      if (typeof input.setSelectionRange === 'function') {
        const position = Number(focus.position || input.value.length);
        input.setSelectionRange(position, position);
      }
    }
  }
}

function filteredProducts() {
  const skuFilter = String(state.productFilters.sku || '').trim().toLowerCase();
  const nameFilter = String(state.productFilters.display_name || '').trim().toLowerCase();

  return state.products.filter((product) => {
    const sku = String(product.sku || '').toLowerCase();
    const name = String(product.display_name || '').toLowerCase();
    return (!skuFilter || sku.includes(skuFilter)) && (!nameFilter || name.includes(nameFilter));
  });
}

function productRow(product, isDraft = false) {
  return `
    <tr data-original-sku="${escapeHtml(product.sku || '')}" ${isDraft ? 'class="draft-row"' : ''}>
      <td><input class="grid-input" data-field="sku" value="${escapeHtml(product.sku || '')}" placeholder="Marketplace SKU"></td>
      <td><input class="grid-input" data-field="display_name" value="${escapeHtml(product.display_name || '')}" placeholder="Display name"></td>
      <td>${isDraft ? '' : escapeHtml(fmtDateTime(product.updated_at))}</td>
      <td class="row-actions">
        <button class="secondary" type="button" data-save-product>Save</button>
        ${isDraft ? '' : '<button class="secondary danger-button" type="button" data-delete-product>Delete</button>'}
      </td>
    </tr>
  `;
}

function renderProducts() {
  const root = document.getElementById('productTable');
  if (!root) return;

  const products = filteredProducts();
  root.innerHTML = `
    <div class="product-filter-toolbar">
      <label><span>Marketplace SKU</span><input type="search" data-product-filter="sku" value="${escapeHtml(state.productFilters.sku)}" aria-label="Search Marketplace SKU"></label>
      <label><span>Substitution</span><input type="search" data-product-filter="display_name" value="${escapeHtml(state.productFilters.display_name)}" aria-label="Search Substitution"></label>
      <span class="muted" role="status">${products.length} of ${state.products.length}</span>
    </div>
    <div class="table-wrap product-table-wrap">
      <table class="product-table">
        <thead>
          <tr>
            <th>Marketplace SKU</th>
            <th>Substitution</th>
            <th>Updated</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${state.productDraft ? productRow(state.productDraft, true) : ''}
          ${products.map((product) => productRow(product)).join('')}
        </tbody>
      </table>
    </div>
  `;

  root.querySelectorAll('input[data-product-filter]').forEach((input) => {
    input.addEventListener('input', () => {
      state.productFilters[input.dataset.productFilter] = input.value;
      const key = input.dataset.productFilter;
      const position = input.selectionStart;
      renderProducts();
      const replacement = root.querySelector(`input[data-product-filter="${key}"]`);
      replacement.focus();
      if (position !== null) replacement.setSelectionRange(position, position);
    });
  });

  root.querySelectorAll('button[data-save-product]').forEach((button) => {
    button.addEventListener('click', async () => {
      const row = button.closest('tr');
      const originalSku = row.dataset.originalSku || row.querySelector('input[data-field="sku"]').value;
      const sku = row.querySelector('input[data-field="sku"]').value.trim();
      const displayName = row.querySelector('input[data-field="display_name"]').value.trim();
      if (!sku || !displayName) return alert('SKU and substitution are required.');

      await api(`/api/products/${encodeURIComponent(originalSku || sku)}`, {
        method: 'PUT',
        body: JSON.stringify({ sku, display_name: displayName })
      });
      state.productDraft = null;
      await Promise.all([loadProducts(), loadOrders()]);
      renderProducts();
      renderTables();
    });
  });

  root.querySelectorAll('button[data-delete-product]').forEach((button) => {
    button.addEventListener('click', async () => {
      const row = button.closest('tr');
      const originalSku = row.dataset.originalSku;
      if (!originalSku || !confirm(`Delete mapping for ${originalSku}?`)) return;

      await api(`/api/products/${encodeURIComponent(originalSku)}`, { method: 'DELETE' });
      await Promise.all([loadProducts(), loadOrders()]);
      renderProducts();
      renderTables();
    });
  });
}

function renderEvents() {
  const root = document.getElementById('events');
  root.innerHTML = state.events.map((event) => `
    <div class="event">
      <span>${fmtDateTime(event.created_at)}</span>
      <strong class="${event.level === 'error' ? 'error' : ''}">${escapeHtml(event.source)}</strong>
      <span>${escapeHtml(event.message)}</span>
    </div>
  `).join('');
}

function networkClass(value) {
  const normalized = String(value || 'unknown').toLowerCase();
  return `network-${normalized.replace(/[^a-z0-9_-]/g, '') || 'unknown'}`;
}

function renderAuditLogs() {
  const root = document.getElementById('auditLog');
  if (!root) return;
  const count = document.getElementById('auditLogCount');
  if (count) count.textContent = `${state.auditLogs.length} latest`;
  if (!state.auditLogs.length) {
    root.innerHTML = '<p class="muted">No changes recorded yet.</p>';
    return;
  }
  root.innerHTML = `
    <div class="table-wrap logs-table-wrap">
      <table class="logs-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>User</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          ${state.auditLogs.map((entry) => `
            <tr>
              <td style="white-space:nowrap">${escapeHtml(fmtDateTime(entry.created_at))}</td>
              <td style="white-space:nowrap">${escapeHtml(entry.username || '—')}</td>
              <td>${escapeHtml(entry.description)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderAccessLogs() {
  const root = document.getElementById('accessLogs');
  const count = document.getElementById('accessLogCount');
  if (!root || !count) return;

  count.textContent = `${state.accessLogs.length} latest`;
  root.innerHTML = `
    <div class="table-wrap logs-table-wrap">
      <table class="logs-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Network</th>
            <th>IP</th>
            <th>Who</th>
            <th>Request</th>
            <th>Status</th>
            <th>Duration</th>
            <th>User Agent</th>
          </tr>
        </thead>
        <tbody>
          ${state.accessLogs.map((entry) => {
            const who = entry.tailscale_user_login || entry.tailscale_user_name || entry.basic_auth_user || '';
            const network = String(entry.source_network || 'unknown');
            return `
              <tr class="${network === 'outside' ? 'outside-row' : ''}">
                <td>${escapeHtml(fmtDateTime(entry.created_at))}</td>
                <td><strong class="${networkClass(network)}">${escapeHtml(network.toUpperCase())}</strong></td>
                <td>${escapeHtml(entry.ip || '')}</td>
                <td>${escapeHtml(who)}</td>
                <td>${escapeHtml(`${entry.method} ${entry.path}`)}</td>
                <td>${escapeHtml(entry.status_code)}</td>
                <td>${escapeHtml(`${entry.duration_ms} ms`)}</td>
                <td class="user-agent">${escapeHtml(entry.user_agent || '')}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function loadBackups() {
  state.backups = await api('/api/backup/list');
}

function renderBackupList() {
  const el = document.getElementById('backupList');
  if (!state.backups.length) {
    el.innerHTML = '<p class="muted">No automated backups yet. First backup runs at midnight.</p>';
    return;
  }
  const rows = state.backups.map((b) => `
    <tr>
      <td>${escapeHtml(fmtDateTime(b.created_at))}</td>
      <td class="muted" style="font-size:0.8rem">${escapeHtml(b.filename)}</td>
      <td style="text-align:right">${escapeHtml(formatBytes(Number(b.size_bytes)))}</td>
      <td class="backup-row-actions">
        <button class="secondary backup-restore-btn" style="padding:2px 8px;min-height:unset;font-size:0.8rem" type="button" data-id="${b.id}" data-file="${escapeHtml(b.filename)}">Restore</button>
        <button class="secondary danger-button backup-delete-btn" style="padding:2px 8px;min-height:unset;font-size:0.8rem" type="button" data-id="${b.id}">Delete</button>
      </td>
    </tr>`).join('');
  el.innerHTML = `<table class="backup-list-table"><thead><tr><th>Created</th><th>File</th><th style="text-align:right">Size</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;

  el.querySelectorAll('.backup-restore-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Restore from "${btn.dataset.file}"?\n\nThis will overwrite all current data.`)) return;
      btn.disabled = true;
      btn.textContent = 'Restoring…';
      try {
        await api(`/api/backup/${btn.dataset.id}/restore`, { method: 'POST' });
        alert('Restore complete. Reloading…');
        setTimeout(() => window.location.reload(), 5000);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Restore';
        alert(`Restore failed: ${err.message}`);
      }
    });
  });

  el.querySelectorAll('.backup-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this backup file?')) return;
      btn.disabled = true;
      try {
        await api(`/api/backup/${btn.dataset.id}`, { method: 'DELETE' });
        state.backups = state.backups.filter((b) => Number(b.id) !== Number(btn.dataset.id));
        renderBackupList();
      } catch (err) {
        btn.disabled = false;
        alert(`Failed: ${err.message}`);
      }
    });
  });
}

let salesRequest = 0;
async function loadMarketingData() {
  const request = ++salesRequest;
  let to = new Date();
  let from;
  const period = state.marketingPeriodDays;
  if (period === 'month' || period === 'previous-month') {
    from = new Date(to.getFullYear(), to.getMonth() - (period === 'previous-month' ? 1 : 0), 1);
    if (period === 'previous-month') to = new Date(to.getFullYear(), to.getMonth(), 1);
  } else if (period === 'week') {
    from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - 6);
  } else {
    from = period === 365 ? new Date(to.getFullYear(), 0, 1) : new Date(to.getTime() - period * 86400000);
  }
  state.salesLoading = true; state.salesError = ''; renderMarketing();
  try {
    const overview = await api(`/api/analytics/sales-overview?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`);
    if (request === salesRequest) state.salesOverview = overview;
  } catch (error) { if (request === salesRequest) state.salesError = error.message; }
  finally { if (request === salesRequest) state.salesLoading = false; }
}

function fmtCurrency(amount, currency) {
  if (amount == null) return '—';
  const opts = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  if (currency) {
    try { return Number(amount).toLocaleString(window.i18n.locale, { style: 'currency', currency, ...opts }); } catch (_) {}
  }
  return Number(amount).toLocaleString(window.i18n.locale, opts);
}

// Each chart has its own currency scale; the accompanying list exposes exact values
// on touch screens and to assistive technology without relying on hover tooltips.
function renderSalesChart(title, currency, entries) {
  const values = entries.map(([, value]) => Number(value));
  const low = Math.min(0, ...values), high = Math.max(0, ...values);
  const range = high - low || 1;
  const y = value => 180 - (value - low) / range * 150;
  const zero = y(0), step = 540 / Math.max(1, entries.length);
  const bars = entries.map(([label, value], index) => {
    const x = 50 + step * index + step * .2;
    return `<rect class="sales-chart-bar" x="${x}" y="${Math.min(zero,y(value))}" width="${step*.6}" height="${Math.abs(y(value)-zero)}" rx="3"><title>${escapeHtml(label)}: ${escapeHtml(fmtCurrency(value,currency))}</title></rect><text x="${x+step*.3}" y="205" text-anchor="middle">${index+1}</text>`;
  }).join('');
  return `<section class="sales-chart"><h3><span>${title}</span> <span data-no-translate>${escapeHtml(currency || window.i18n.t('Unknown currency'))}</span></h3><svg viewBox="0 0 620 220" aria-hidden="true" focusable="false"><line x1="50" x2="590" y1="${zero}" y2="${zero}" class="sales-chart-axis"/><text x="40" y="${zero+4}" text-anchor="end">0</text>${bars}</svg><ol class="sales-chart-values">${entries.map(([label,value])=>`<li><span data-no-translate>${escapeHtml(label)}</span><strong data-no-translate>${escapeHtml(fmtCurrency(value,currency))}</strong></li>`).join('')}</ol></section>`;
}

function renderProfitability(data) {
  if (!data) return '';
  const table = (title, rows, kind) => !rows?.length ? '' : `<h3>${title}</h3><div class="table-wrap"><table class="marketing-table"><thead><tr><th>${kind}</th><th>Currency</th><th>VAT treatment</th><th>Complete / all orders</th><th>Estimated orders</th><th>Revenue with complete costs</th><th>Recorded costs</th><th>Profit after recorded costs</th><th>Margin</th></tr></thead><tbody>${rows.map(row => `<tr><td data-no-translate>${escapeHtml(row.label === null ? window.i18n.t('Mixed or unmapped products') : row.label || row.currency)}</td><td data-no-translate>${escapeHtml(row.currency)}</td><td>${escapeHtml(window.i18n.t(({payer:'VAT adjusted',nonpayer:'Not VAT registered',unreviewed:'VAT not reviewed'})[row.vat_mode] || 'VAT not reviewed'))}</td><td data-no-translate>${row.complete} / ${row.orders}</td><td data-no-translate>${row.estimated}</td>${['revenue','cost','profit'].map(field => `<td data-no-translate>${row[field] === null ? '—' : escapeHtml(fmtCurrency(row[field],row.currency))}</td>`).join('')}<td data-no-translate>${row.margin_percent === null ? '—' : escapeHtml(row.margin_percent) + '%'}</td></tr>`).join('')}</tbody></table></div>`;
  return `<section class="profitability"><h2>Profit after recorded costs</h2><p class="muted">Only orders with complete, matching-currency costs are included in profit. Missing historical costs, refunds and cancellations are excluded. Open orders use current recipe estimates. This is not net profit.</p>${table('Period profitability',data.totals,'Currency')}${table('Profit by channel',data.channels,'Channel')}${table('Monthly profit',data.months,'Month')}${table('Profit by product',data.products,'Product')}<p class="muted">Product profit covers orders containing a single product type. Mixed or unmapped orders stay in a separate group; their revenue and fees are not arbitrarily split between products.</p></section>`;
}

function renderMarketing() {
  const root = document.getElementById('marketingContent');
  if (!root) return;
  if (state.salesLoading) { root.innerHTML = '<p role="status">Loading sales…</p>'; return; }
  if (state.salesError) { root.innerHTML = `<p role="alert">${escapeHtml(window.i18n.t(state.salesError))}</p>`; return; }
  const sales = state.salesOverview;
  if (!sales) { root.innerHTML = ''; return; }
  const money = (amount, currency) => escapeHtml(fmtCurrency(amount, currency));
  const currencyName = currency => currency || window.i18n.t('Unknown currency');
  const channelName = channel => ({amazon:'Amazon',etsy:'Etsy',shopify:'Shopify',sashe:'SAShE',manual:window.i18n.t('Manual')})[channel] || channel;
  const currencyCards = (sales.currencies || []).map(item => `<article class="sales-summary-card"><span data-no-translate>${escapeHtml(currencyName(item.currency))}</span><strong data-no-translate>${money(item.total,item.currency)}</strong><span>Order totals</span><small><span>Average order value</span> <span data-no-translate>${money(item.average,item.currency)}</span></small></article>`).join('');
  const channelCards = (sales.channels || []).map(item => `<article class="marketing-channel-card"><div class="marketing-channel-name" data-no-translate>${escapeHtml(channelName(item.channel))} · ${escapeHtml(currencyName(item.currency))}</div><div class="marketing-channel-revenue" data-no-translate>${money(item.totalRevenue,item.currency)}</div><div class="marketing-channel-meta"><span data-no-translate>${item.orderCount}</span><span>orders</span><span>·</span><span>Average</span><span data-no-translate>${money(item.avgOrderValue,item.currency)}</span></div></article>`).join('');
  const monthly = new Map();
  for (const entry of sales.timeline || []) {
    const period = entry.periodLabel || new Date(entry.period).toISOString().slice(0,7), key = entry.currency || '';
    if (!monthly.has(key)) monthly.set(key, new Map());
    const values = monthly.get(key); values.set(period, (values.get(period) || 0) + Number(entry.totalRevenue));
  }
  const charts = `<div class="sales-charts">${[...monthly].map(([currency, values]) => {
    const periods = [...values.keys()].sort();
    // Keep empty months visible so the timeline does not imply continuous sales.
    if (periods.length > 1 && periods.every(period => /^\d{4}-\d{2}$/.test(period))) {
      const cursor = new Date(`${periods[0]}-01T00:00:00Z`);
      const last = periods[periods.length-1];
      while (cursor.toISOString().slice(0,7) < last) {
        const month = cursor.toISOString().slice(0,7);
        if (!values.has(month)) values.set(month,0);
        cursor.setUTCMonth(cursor.getUTCMonth()+1);
      }
    }
    const channels = (sales.channels || []).filter(item => (item.currency || '') === currency).map(item => [channelName(item.channel), item.totalRevenue]);
    return renderSalesChart('Monthly sales',currency,[...values].sort()) + renderSalesChart('Sales by marketplace',currency,channels);
  }).join('')}</div>`;
  const tableRows = (sales.timeline || []).map(entry => `<tr><td data-no-translate>${escapeHtml(entry.periodLabel || new Date(entry.period).toISOString().slice(0,7))}</td><td data-no-translate>${escapeHtml(channelName(entry.channel))}</td><td data-no-translate>${escapeHtml(currencyName(entry.currency))}</td><td data-no-translate>${entry.orderCount}</td><td data-no-translate>${money(entry.totalRevenue,entry.currency)}</td></tr>`).join('');
  root.innerHTML = `<p class="muted sales-scope">Includes open and archived orders, including unpaid orders. Currencies are shown separately.</p><div class="sales-summary"><article class="sales-summary-card"><span>Orders in period</span><strong data-no-translate>${sales.orderCount}</strong><small><span>Open orders</span> <span data-no-translate>${sales.openOrderCount}</span></small></article>${currencyCards}<article class="sales-summary-card"><span>Orders without amount</span><strong data-no-translate>${sales.missingAmountCount}</strong><small>Missing amounts are not treated as zero.</small></article></div>${sales.orderCount ? ` ${charts}<h3>Sales by channel</h3><div class="marketing-cards">${channelCards || '<p class="muted">No order amounts in this period.</p>'}</div>${tableRows ? `<h3>Sales breakdown</h3><div class="table-wrap"><table class="marketing-table"><thead><tr><th>Month</th><th>Channel</th><th>Currency</th><th>Orders</th><th>Order totals</th></tr></thead><tbody>${tableRows}</tbody></table></div>` : ''}` : '<p class="muted">No orders in this period.</p>'}`;
  root.insertAdjacentHTML('beforeend', renderProfitability(sales.profitability));
  window.i18n?.apply();
}

function renderOrderTotal(order) {
  const amount = order.revenue_amount;
  const valid = amount !== null && amount !== undefined && String(amount).trim() !== '' && Number.isFinite(Number(amount));
  return `<div class="order-total"><span class="card-meta-label">Order total</span><strong data-no-translate>${valid ? escapeHtml(fmtCurrency(amount,order.revenue_currency)) : '—'}</strong></div>`;
}

function updateLastApiUpdate() {
  const el = document.getElementById('lastApiUpdate');
  if (el) el.textContent = `Last API update: ${fmtDateTime(new Date())}`;
}

function localDateKey(date) {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

function shipDateKey(value) {
  if (!value) return 0;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3]);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : localDateKey(parsed);
}

function renderBatchView() {
  const batch = state.currentPrepBatch;
  const configuredProducts = batch?.production?.products || [];
  const fallbackPins = window.dashboardPinHelpers.countPins(state.dashboard?.dashboardPins || [], batch?.orders || []);
  const productCards = (batch?.production?.rules?.length ? configuredProducts.map(product => ({ name:product.name,count:product.required })) : fallbackPins);
  const summary = document.getElementById('batchSummary');
  summary.textContent = batch ? `${batch.name} · ${(batch.orders || []).length} open orders` : 'No active batch selected.';
  document.getElementById('batchContent').innerHTML = `
    <div class="batch-material-grid">${productCards.map(({name,count})=>`<article class="batch-material-card">${inventoryImage(configuredProducts.find(item=>item.name===name))}<span data-no-translate>${escapeHtml(name)}</span><strong>${count}</strong></article>`).join('') || '<p class="muted">Configure products and SKUs in Inventory.</p>'}</div>
    ${renderProductionNeeds(batch?.production)}
    <div class="batch-order-list">${(batch?.orders || []).length ? batch.orders.map((order) => `<article class="week-prep-order"><div class="week-prep-order-head">${renderVendorBadge(order.vendor || order.channel || '')}<span class="week-prep-customer">${escapeHtml(String(order.address || '').split('\n')[0] || 'Name not set')}</span><span class="week-prep-number">${escapeHtml(displayOrderId(order))}</span></div><div class="week-prep-order-foot"><span class="week-prep-date">${renderShipDeadline(order.ship_by_date, order.shipped)}</span><span class="week-prep-skus">${escapeHtml(order.skus || 'No SKU details')}</span></div></article>`).join('') : '<p class="muted">This batch has no open orders. All material counts are zero.</p>'}</div>`;
  const picker = document.getElementById('batchPicker');
  picker.innerHTML = '<option value="">No batch selected</option>' + state.prepBatches.map((item) => `<option value="${item.id}"${String(item.id) === String(batch?.id) ? ' selected' : ''}>${escapeHtml(item.name)} (${item.order_count})</option>`).join('');
  const addPicker = document.getElementById('addToBatchSelect');
  addPicker.innerHTML = '<option value="">Add to current batch…</option>' + state.prepBatches.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
  document.getElementById('boardAddToBatchSelect').innerHTML = addPicker.innerHTML;
  document.getElementById('deleteBatch').disabled = !batch;
}

async function loadPrepBatches(preferredId) {
  state.prepBatches = await api('/api/prep-batches');
  const savedId = preferredId || localStorage.getItem('local-orders-active-prep-batch');
  const selected = state.prepBatches.find((batch) => String(batch.id) === String(savedId)) || state.prepBatches[0];
  state.currentPrepBatch = selected ? await api(`/api/prep-batches/${selected.id}`) : null;
  if (state.currentPrepBatch) localStorage.setItem('local-orders-active-prep-batch', state.currentPrepBatch.id);
  else localStorage.removeItem('local-orders-active-prep-batch');
  renderBatchView();
}

async function loadVersion() {
  try {
    const v = await fetch('/version.json').then((r) => r.json());
    const el = document.getElementById('appVersion');
    if (el) el.textContent = `v${v.version} · built ${v.built}`;
  } catch (_) {}
}

async function refresh() {
  await loadConfig();
  await loadBranding();
  await loadWorkflowStatuses();
  await window.marketplaceAppearance?.load();
  await Promise.all([loadChannels(), loadAuthorizations(), loadOrders(), loadProducts(), loadEvents(), loadAccessLogs(), loadAuditLogs(), loadDashboard(), loadPinnedOrders()]);
  await loadPrepBatches().catch((error) => console.error('Could not load prep batches:', error));
  renderAuthorizations();
  renderTables();
  renderDashboard();
  window.localSetup.show();
  renderProducts();
  renderEvents();
  renderAccessLogs();
  renderAuditLogs();
  loadTrackingStatuses();
  loadFeedbackEligibility();
  updateLastApiUpdate();
}

function updateSelectionBar() {
  const bar = document.getElementById('openSelectionBar');
  const count = document.getElementById('openSelectionCount');
  const editBtn = document.getElementById('openEditSelected');
  const n = state.selectedOrderIds.size;
  document.querySelectorAll('#openTable input.row-select, [data-board-select]').forEach(input => { input.checked = state.selectedOrderIds.has(Number(input.dataset.id || input.dataset.boardSelect)); const card=input.closest('.board-card');if(card)card.classList.toggle('board-card-selected',input.checked); });
  if (n === 0) bar.setAttribute('hidden', ''); else bar.removeAttribute('hidden');
  count.textContent = `${n} order${n !== 1 ? 's' : ''} selected`;
  if (editBtn) editBtn.disabled = n !== 1;
  const boardBar = document.getElementById('boardSelectionBar');
  boardBar.hidden = n === 0;
  document.getElementById('boardSelectionCount').textContent = count.textContent;
  document.querySelectorAll('[data-board-bulk]').forEach(button => { button.disabled = document.getElementById(button.dataset.boardBulk).disabled; });
  const upload = document.getElementById('boardUploadSelected');
  upload.disabled = n !== 1;
  const selectedOrder = n === 1 ? state.openOrders.find(order => Number(order.id) === Number([...state.selectedOrderIds][0])) : null;
  upload.textContent = selectedOrder?.label_url ? 'Replace label' : 'Upload label';
}

function updateArchiveSelectionBar() {
  const bar = document.getElementById('archiveSelectionBar');
  const count = document.getElementById('archiveSelectionCount');
  const editBtn = document.getElementById('archiveEditSelected');
  if (!bar) return;
  const n = state.archiveSelectedOrderIds.size;
  if (n === 0) bar.setAttribute('hidden', ''); else bar.removeAttribute('hidden');
  count.textContent = `${n} order${n !== 1 ? 's' : ''} selected`;
  if (editBtn) editBtn.disabled = n !== 1;
}

const COUNTRY_MAP = {
  'albania': 'AL', 'andorra': 'AD', 'algeria': 'DZ',
  'austria': 'AT', 'österreich': 'AT',
  'belarus': 'BY',
  'belgium': 'BE', 'belgique': 'BE', 'belgië': 'BE',
  'bosnia': 'BA', 'bulgaria': 'BG',
  'canada': 'CA', 'croatia': 'HR', 'hrvatska': 'HR',
  'czech republic': 'CZ', 'czechia': 'CZ', 'česká republika': 'CZ', 'česko': 'CZ',
  'denmark': 'DK', 'danmark': 'DK',
  'estonia': 'EE', 'eesti': 'EE',
  'finland': 'FI', 'suomi': 'FI',
  'france': 'FR',
  'germany': 'DE', 'deutschland': 'DE',
  'greece': 'GR',
  'hungary': 'HU', 'magyarország': 'HU',
  'iceland': 'IS', 'ireland': 'IE', 'israel': 'IL',
  'italy': 'IT', 'italia': 'IT',
  'latvia': 'LV', 'liechtenstein': 'LI',
  'lithuania': 'LT', 'lietuva': 'LT',
  'luxembourg': 'LU', 'malta': 'MT',
  'moldova': 'MD', 'monaco': 'MC', 'montenegro': 'ME',
  'netherlands': 'NL', 'the netherlands': 'NL', 'nederland': 'NL', 'holland': 'NL',
  'north macedonia': 'MK', 'norway': 'NO', 'norge': 'NO',
  'poland': 'PL', 'polska': 'PL',
  'portugal': 'PT', 'romania': 'RO', 'românia': 'RO',
  'san marino': 'SM', 'serbia': 'RS',
  'slovakia': 'SK', 'slovensko': 'SK',
  'slovenia': 'SI', 'slovenija': 'SI',
  'spain': 'ES', 'españa': 'ES',
  'sweden': 'SE', 'sverige': 'SE',
  'switzerland': 'CH', 'schweiz': 'CH', 'suisse': 'CH',
  'turkey': 'TR', 'türkiye': 'TR',
  'ukraine': 'UA',
  'united kingdom': 'GB', 'england': 'GB', 'great britain': 'GB',
  'united states': 'US', 'usa': 'US',
  'australia': 'AU', 'japan': 'JP', 'china': 'CN', 'thailand': 'TH',
  'reunion': 'RE', 'réunion': 'RE', 'la reunion': 'RE',
  'guadeloupe': 'GP', 'martinique': 'MQ', 'mayotte': 'YT',
  'french guiana': 'GF', 'guyane': 'GF',
  'new caledonia': 'NC', 'french polynesia': 'PF',
  'wallis and futuna': 'WF', 'wallis and futuna islands': 'WF',
  'saint pierre and miquelon': 'PM',
  'saint barthelemy': 'BL', 'saint barthélemy': 'BL',
  'saint martin': 'MF',
};

const CODE_TO_NAME = {
  AD: 'Andorra', AL: 'Albania', AT: 'Austria', AU: 'Australia', BA: 'Bosnia',
  BE: 'Belgium', BG: 'Bulgaria', BY: 'Belarus', CA: 'Canada', CH: 'Switzerland',
  CN: 'China', CZ: 'Czech Republic', DE: 'Germany', DK: 'Denmark', DZ: 'Algeria',
  EE: 'Estonia', ES: 'Spain', FI: 'Finland', FR: 'France', GB: 'United Kingdom',
  GR: 'Greece', HR: 'Croatia', HU: 'Hungary', IE: 'Ireland', IL: 'Israel',
  IS: 'Iceland', IT: 'Italy', JP: 'Japan', LI: 'Liechtenstein', LT: 'Lithuania',
  LU: 'Luxembourg', LV: 'Latvia', MC: 'Monaco', MD: 'Moldova', ME: 'Montenegro',
  MK: 'North Macedonia', MT: 'Malta', NL: 'Netherlands', NO: 'Norway', PL: 'Poland',
  PT: 'Portugal', RO: 'Romania', RS: 'Serbia', SE: 'Sweden', SI: 'Slovenia',
  SK: 'Slovakia', SM: 'San Marino', TH: 'Thailand', TR: 'Turkey', UA: 'Ukraine', US: 'United States',
  BL: 'Saint Barthélemy', GF: 'French Guiana', GP: 'Guadeloupe', MF: 'Saint Martin',
  MQ: 'Martinique', NC: 'New Caledonia', PF: 'French Polynesia',
  PM: 'Saint Pierre and Miquelon', RE: 'Réunion', WF: 'Wallis and Futuna', YT: 'Mayotte',
};


function detectCountryCode(address) {
  if (!address) return null;
  const lines = address.split('\n').map((l) => l.trim()).filter(Boolean).reverse();
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (COUNTRY_MAP[lower]) return COUNTRY_MAP[lower];
    const afterComma = lower.split(',').pop().trim();
    if (afterComma && COUNTRY_MAP[afterComma]) return COUNTRY_MAP[afterComma];
    if (/^[a-z]{2}$/.test(lower) && CODE_TO_NAME[lower.toUpperCase()]) return lower.toUpperCase();
  }
  return null;
}

let fpAddOrderCreatedAt = null;
let fpAddOrderShipDate = null;

function initAddOrderDialog() {
  const dlg = document.createElement('dialog');
  dlg.id = 'addOrderDialog';
  dlg.innerHTML = `
    <p class="section-kicker">Add Manual Order</p>
    <div class="edit-dialog-form">
      <label class="edit-dialog-label">Vendor<input id="addOrderVendor" class="grid-input" type="text" placeholder="Manual"></label>
      <label class="edit-dialog-label">Order ID<input id="addOrderExternalId" class="grid-input" type="text" placeholder="Auto-generated if blank"></label>
      <label class="edit-dialog-label">Order Date<div class="date-input-wrap"><input id="addOrderCreatedAt" class="grid-input" type="text" placeholder="DD.MM.YYYY"><button type="button" class="date-input-toggle" id="addOrderCreatedAtToggle" title="Pick date"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></button></div></label>
      <label class="edit-dialog-label">Ship Date<div class="date-input-wrap"><input id="addOrderShipDate" class="grid-input" type="text" placeholder="DD.MM.YYYY"><button type="button" class="date-input-toggle" id="addOrderShipDateToggle" title="Pick date"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></button></div></label>
      <label class="edit-dialog-label">SKUs<textarea id="addOrderSkus" autofocus class="address-dialog-text" rows="3" placeholder="One SKU per line"></textarea></label>
      <label class="edit-dialog-label">Address<textarea id="addOrderAddress" class="address-dialog-text" rows="4"></textarea></label>
      <label class="edit-dialog-label">Note<textarea id="addOrderNote" class="address-dialog-text" rows="2"></textarea></label>
      <label class="edit-dialog-label">Tracking Code<input id="addOrderTrackingCode" class="grid-input" type="text"></label>
      <label class="edit-dialog-label">Tracking URL<input id="addOrderTrackingUrl" class="grid-input" type="text"></label>
    </div>
    <div class="dialog-actions">
      <button id="addOrderCancel" class="secondary" type="button">Cancel</button>
      <button id="addOrderSave" type="button">Add Order</button>
    </div>`;
  document.body.appendChild(dlg);

  const reposFp = (fp) => requestAnimationFrame(() => {
    const cal = fp.calendarContainer;
    const inputRect = fp.element.getBoundingClientRect();
    const dlgRect = dlg.getBoundingClientRect();
    const calW = cal.offsetWidth;
    const calH = cal.offsetHeight;
    let top = inputRect.bottom - dlgRect.top + 4;
    if (top + calH > dlgRect.height - 4) top = inputRect.top - dlgRect.top - calH - 4;
    let left = inputRect.left - dlgRect.left;
    if (left + calW > dlgRect.width - 4) left = Math.max(0, dlgRect.width - calW - 4);
    cal.style.top = top + 'px';
    cal.style.left = left + 'px';
  });
  fpAddOrderCreatedAt = flatpickr('#addOrderCreatedAt', { locale: window.i18n.calendarLocale, dateFormat: 'd.m.Y', allowInput: true, appendTo: dlg, onOpen(_, __, fp) { reposFp(fp); } });
  fpAddOrderShipDate = flatpickr('#addOrderShipDate', { locale: window.i18n.calendarLocale, dateFormat: 'd.m.Y', allowInput: true, appendTo: dlg, onOpen(_, __, fp) { reposFp(fp); } });
  document.getElementById('addOrderCreatedAtToggle').addEventListener('click', () => fpAddOrderCreatedAt.open());
  document.getElementById('addOrderShipDateToggle').addEventListener('click', () => fpAddOrderShipDate.open());

  document.getElementById('addOrderCancel').addEventListener('click', () => dlg.close());
  document.getElementById('addOrderSave').addEventListener('click', async () => {
    const parseDmy = (val) => {
      const m = String(val || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
      return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
    };
    const body = {
      vendor: document.getElementById('addOrderVendor').value.trim(),
      order_id: document.getElementById('addOrderExternalId').value.trim(),
      skus: document.getElementById('addOrderSkus').value.trim(),
      address: document.getElementById('addOrderAddress').value.trim(),
      note: document.getElementById('addOrderNote').value.trim(),
      created_at: parseDmy(document.getElementById('addOrderCreatedAt').value),
      ship_by_date: parseDmy(document.getElementById('addOrderShipDate').value),
      tracking_code: document.getElementById('addOrderTrackingCode').value.trim(),
      tracking_url: document.getElementById('addOrderTrackingUrl').value.trim()
    };
    const btn = document.getElementById('addOrderSave');
    btn.disabled = true;
    try {
      await api('/api/orders', { method: 'POST', body: JSON.stringify(body) });
      dlg.close();
      await loadOrders();
      renderTables();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  });
}

let archiveEditOrderId = null;
let fpArchiveCreatedAt = null;
let fpArchiveShipByDate = null;

function initArchiveEditDialog() {
  const dlg = document.createElement('dialog');
  dlg.id = 'archiveEditDialog';
  dlg.innerHTML = `
    <p class="section-kicker">Edit Order</p>
    <div class="edit-dialog-form">
      <label class="edit-dialog-label">Order Date<div class="date-input-wrap"><input id="archiveEditCreatedAt" class="grid-input" type="text" placeholder="DD.MM.YYYY"><button type="button" class="date-input-toggle" id="archiveEditCreatedAtToggle" title="Pick date"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></button></div></label>
      <label class="edit-dialog-label">Ship Date<div class="date-input-wrap"><input id="archiveEditShipByDate" class="grid-input" type="text" placeholder="DD.MM.YYYY"><button type="button" class="date-input-toggle" id="archiveEditShipByDateToggle" title="Pick date"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></button></div></label>
      <label class="edit-dialog-label">SKUs<textarea id="archiveEditSkus" autofocus class="address-dialog-text" rows="3"></textarea></label>
      <label class="edit-dialog-label">Address<textarea id="archiveEditAddress" class="address-dialog-text" rows="4"></textarea></label>
      <label class="edit-dialog-label">Note<textarea id="archiveEditNote" class="address-dialog-text" rows="2"></textarea></label>
      <label class="edit-dialog-label">Tracking Code<input id="archiveEditCode" class="grid-input" type="text"></label>
      <label class="edit-dialog-label">Tracking URL<input id="archiveEditUrl" class="grid-input" type="text"></label>
    </div>
    <div class="dialog-actions">
      <button id="archiveEditCancel" class="secondary" type="button">Cancel</button>
      <button id="archiveEditSave" type="button">Save</button>
    </div>`;
  document.body.appendChild(dlg);

  const reposFp = (fp) => requestAnimationFrame(() => {
    const cal = fp.calendarContainer;
    const inputRect = fp.element.getBoundingClientRect();
    const dlgRect = dlg.getBoundingClientRect();
    const calW = cal.offsetWidth;
    const calH = cal.offsetHeight;
    let top = inputRect.bottom - dlgRect.top + 4;
    if (top + calH > dlgRect.height - 4) top = inputRect.top - dlgRect.top - calH - 4;
    let left = inputRect.left - dlgRect.left;
    if (left + calW > dlgRect.width - 4) left = Math.max(0, dlgRect.width - calW - 4);
    cal.style.top = top + 'px';
    cal.style.left = left + 'px';
  });
  fpArchiveCreatedAt = flatpickr('#archiveEditCreatedAt', { locale: window.i18n.calendarLocale, dateFormat: 'd.m.Y', allowInput: true, appendTo: dlg, onOpen(_, __, fp) { reposFp(fp); } });
  fpArchiveShipByDate = flatpickr('#archiveEditShipByDate', { locale: window.i18n.calendarLocale, dateFormat: 'd.m.Y', allowInput: true, appendTo: dlg, onOpen(_, __, fp) { reposFp(fp); } });
  document.getElementById('archiveEditCreatedAtToggle').addEventListener('click', () => fpArchiveCreatedAt.open());
  document.getElementById('archiveEditShipByDateToggle').addEventListener('click', () => fpArchiveShipByDate.open());

  document.getElementById('archiveEditCancel').addEventListener('click', () => dlg.close());
  document.getElementById('archiveEditSave').addEventListener('click', async () => {
    if (!archiveEditOrderId) return;
    const parseDmy = (val) => {
      const m = String(val || '').trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
      return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
    };
    const patch = {
      created_at: parseDmy(document.getElementById('archiveEditCreatedAt').value),
      ship_by_date: parseDmy(document.getElementById('archiveEditShipByDate').value),
      skus: document.getElementById('archiveEditSkus').value,
      address: document.getElementById('archiveEditAddress').value,
      note: document.getElementById('archiveEditNote').value,
      tracking_code: document.getElementById('archiveEditCode').value.trim(),
      tracking_url: document.getElementById('archiveEditUrl').value.trim()
    };
    const controls=[...dlg.querySelectorAll('input,textarea,select,button')];controls.forEach(control=>control.disabled=true);
    try {
      await api(`/api/orders/${archiveEditOrderId}`, { method: 'PATCH', body: JSON.stringify(patch) });
      dlg.close();
      await Promise.all([loadOrders(), loadPinnedOrders()]);
      renderTables();
    } catch (err) {
      alert(err.message);
    } finally {controls.forEach(control=>control.disabled=false);}
  });
}

function openArchiveEditDialog(order) {
  archiveEditOrderId = order.id;
  if (order.created_at) fpArchiveCreatedAt.setDate(new Date(order.created_at), false);
  else fpArchiveCreatedAt.clear();
  if (order.ship_by_date) fpArchiveShipByDate.setDate(new Date(order.ship_by_date), false);
  else fpArchiveShipByDate.clear();
  document.getElementById('archiveEditSkus').value = order.skus || '';
  document.getElementById('archiveEditAddress').value = order.address || '';
  document.getElementById('archiveEditNote').value = order.note || '';
  document.getElementById('archiveEditCode').value = order.tracking_code || '';
  document.getElementById('archiveEditUrl').value = order.tracking_url || '';
  document.getElementById('archiveEditDialog').showModal();
}

let trackingDialogOrderId = null;

function initTrackingDialog() {
  const dlg = document.createElement('dialog');
  dlg.id = 'trackingDialog';
  dlg.innerHTML = `
    <p class="section-kicker">Edit Tracking</p>
    <div class="edit-dialog-form">
      <label class="edit-dialog-label">Tracking Code<input id="trackingDialogCode" class="grid-input" type="text"></label>
      <label class="edit-dialog-label">Tracking URL<input id="trackingDialogUrl" class="grid-input" type="url"></label>
    </div>
    <div class="dialog-actions">
      <button id="trackingDialogCancel" class="secondary" type="button">Cancel</button>
      <button id="trackingDialogSave" type="button">Save</button>
    </div>`;
  document.body.appendChild(dlg);
  document.getElementById('trackingDialogCancel').addEventListener('click', () => dlg.close());
  document.getElementById('trackingDialogSave').addEventListener('click', async () => {
    if (!trackingDialogOrderId) return;
    const patch = {
      tracking_code: document.getElementById('trackingDialogCode').value.trim(),
      tracking_url: document.getElementById('trackingDialogUrl').value.trim()
    };
    try {
      await api(`/api/orders/${trackingDialogOrderId}`, { method: 'PATCH', body: JSON.stringify(patch) });
      dlg.close();
      await loadOrders();
      renderTables();
    } catch (error) {
      alert(error.message);
    }
  });
}

function openTrackingDialog(order) {
  trackingDialogOrderId = order.id;
  document.getElementById('trackingDialogCode').value = order.tracking_code || '';
  document.getElementById('trackingDialogUrl').value = order.tracking_url || '';
  document.getElementById('trackingDialog').showModal();
}

let pendingLabelOrderId = null;
let labelUploadListenerAttached = false;

let mobileActionOrigin=null;
function restoreMobileActionMenu() {
  if(!mobileActionOrigin) return;
  const {menu,parent,trigger}=mobileActionOrigin;mobileActionOrigin=null;
  menu.hidden=true;
  if(parent.isConnected) parent.appendChild(menu);else menu.remove();
  trigger.setAttribute('aria-expanded','false');
  document.body.classList.remove('mobile-actions-open');
}
function openOrderActionMenu(trigger,menu) {
  trigger.setAttribute('aria-expanded','true');menu.hidden=false;
  if(!window.matchMedia('(max-width: 640px)').matches) return;
  const dialog=document.getElementById('mobileOrderActions');
  mobileActionOrigin={menu,parent:menu.parentElement,trigger};
  const id=trigger.closest('[data-order-id]')?.dataset.orderId || trigger.dataset.id;
  const order=findBoardOrder(id) || state.archiveOrders.find(order=>Number(order.id)===Number(id));
  document.getElementById('mobileOrderActionsSubtitle').textContent=order?`${displayOrderId(order)} · ${String(order.address || '').split('\n')[0]}`:'';
  document.getElementById('mobileOrderActionsContent').appendChild(menu);
  document.body.classList.add('mobile-actions-open');dialog.showModal();
}
function closeAllActionMenus() {
  restoreDesktopContextMenu();
  const sheet=document.getElementById('mobileOrderActions');
  if(sheet?.open) sheet.close();
  restoreMobileActionMenu();
  document.querySelectorAll('.action-menu-dropdown:not([hidden])').forEach((m) => m.setAttribute('hidden', ''));
  document.querySelectorAll('.action-menu-btn[aria-expanded="true"]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
}

function triggerLabelUpload(orderId) {
  pendingLabelOrderId = orderId;
  const labelInput = document.getElementById('labelUploadFile');
  if (!labelUploadListenerAttached) {
    labelUploadListenerAttached = true;
    labelInput.addEventListener('change', () => {
      const file = labelInput.files[0];
      const id = pendingLabelOrderId;
      labelInput.value = '';
      pendingLabelOrderId = null;
      if (file && id) handleLabelUpload(file, id);
    });
  }
  labelInput.click();
}

const mobileOrderActions=document.getElementById('mobileOrderActions');
mobileOrderActions.addEventListener('close',()=>{if(!mobileOrderActions.open)restoreMobileActionMenu();});
mobileOrderActions.addEventListener('click',event=>{
  event.stopPropagation();
  if(event.target===mobileOrderActions) {
    const rect=mobileOrderActions.getBoundingClientRect();
    if(event.clientY<rect.top || event.clientX<rect.left || event.clientX>rect.right) closeAllActionMenus();
  }
});
document.getElementById('closeMobileOrderActions').addEventListener('click',closeAllActionMenus);
window.matchMedia('(max-width: 640px)').addEventListener('change',closeAllActionMenus);
document.addEventListener('click', closeAllActionMenus);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllActionMenus(); });

async function handleLabelUpload(file, id) {
  const existingOrder = [...state.openOrders, ...state.archiveOrders, ...state.pinnedOrders, ...state.boardArchiveOrders].find((o) => Number(o.id) === id);
  if (existingOrder && existingOrder.label_url) {
    if (!confirm('This order already has a label. Replace it?')) return;
  }
  try {
    const res = await fetch(`/api/orders/${id}/label`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': file.name },
      body: file
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Upload failed'); return; }
    const apply = (arr) => arr.map((o) => Number(o.id) === id ? { ...o, label_url: data.label_url, label_created: true } : o);
    state.openOrders = apply(state.openOrders);
    state.archiveOrders = apply(state.archiveOrders);
    state.boardArchiveOrders = apply(state.boardArchiveOrders);
    state.pinnedOrders = apply(state.pinnedOrders);
    renderTables();
  } catch (err) {
    alert('Upload failed: ' + err.message);
  }
}

let addressDialogOrderId = null;

function initAddressDialog() {
  if (!document.getElementById('addressDialog')) {
    const dlg = document.createElement('dialog');
    dlg.id = 'addressDialog';
    dlg.innerHTML = `
      <p class="section-kicker">Edit Address</p>
      <textarea id="addressDialogText" class="address-dialog-text" rows="10"></textarea>
      <div class="dialog-actions">
        <button id="addressDialogCancel" class="secondary" type="button">Cancel</button>
        <button id="addressDialogSave" type="button">Save</button>
      </div>`;
    document.body.appendChild(dlg);
  }
  document.getElementById('addressDialogSave').addEventListener('click', async () => {
    if (!addressDialogOrderId) return;
    const newAddress = document.getElementById('addressDialogText').value;
    const btn = document.querySelector(`button.address-edit-btn[data-id="${addressDialogOrderId}"]`);
    try {
      await api(`/api/orders/${addressDialogOrderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ address: newAddress })
      });
      if (btn) {
        btn.dataset.address = newAddress;
        btn.closest('.address-cell').querySelector('.address-first-line').textContent = newAddress.split('\n')[0] || '';
        const fullSpan = btn.closest('.address-cell').querySelector('.address-full');
        if (fullSpan) fullSpan.textContent = newAddress;
      }
      document.getElementById('addressDialog').close();
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById('addressDialogCancel').addEventListener('click', () => {
    document.getElementById('addressDialog').close();
  });
}

function openAddressDialog(orderId, fullAddress) {
  addressDialogOrderId = orderId;
  document.getElementById('addressDialogText').value = fullAddress;
  document.getElementById('addressDialog').showModal();
}

let noteDialogOrderId = null;

function initNoteDialog() {
  if (!document.getElementById('noteDialog')) {
    const dlg = document.createElement('dialog');
    dlg.id = 'noteDialog';
    dlg.innerHTML = `
      <p class="section-kicker">Edit Note</p>
      <textarea id="noteDialogText" class="address-dialog-text" rows="5"></textarea>
      <div class="dialog-actions">
        <button id="noteDialogCancel" class="secondary" type="button">Cancel</button>
        <button id="noteDialogSave" type="button">Save</button>
      </div>`;
    document.body.appendChild(dlg);
  }
  document.getElementById('noteDialogSave').addEventListener('click', async () => {
    if (!noteDialogOrderId) return;
    const newNote = document.getElementById('noteDialogText').value;
    try {
      const updated = await api(`/api/orders/${noteDialogOrderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ note: newNote })
      });
      const apply = (arr) => arr.map((o) => Number(o.id) === noteDialogOrderId ? { ...o, note: updated.note } : o);
      state.openOrders = apply(state.openOrders);
      state.archiveOrders = apply(state.archiveOrders);
      state.pinnedOrders = apply(state.pinnedOrders);
      document.getElementById('noteDialog').close();
      renderTables();
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById('noteDialogCancel').addEventListener('click', () => {
    document.getElementById('noteDialog').close();
  });
}

function openNoteDialog(orderId, note) {
  noteDialogOrderId = orderId;
  document.getElementById('noteDialogText').value = note;
  document.getElementById('noteDialog').showModal();
}

let skusDialogOrderId = null;

function initSkusDialog() {
  if (!document.getElementById('skusDialog')) {
    const dlg = document.createElement('dialog');
    dlg.id = 'skusDialog';
    dlg.innerHTML = `
      <p class="section-kicker">Edit SKUs</p>
      <textarea id="skusDialogText" class="address-dialog-text" rows="5"></textarea>
      <div class="dialog-actions">
        <button id="skusDialogCancel" class="secondary" type="button">Cancel</button>
        <button id="skusDialogSave" type="button">Save</button>
      </div>`;
    document.body.appendChild(dlg);
  }
  document.getElementById('skusDialogSave').addEventListener('click', async () => {
    if (!skusDialogOrderId) return;
    const newSkus = document.getElementById('skusDialogText').value;
    try {
      const updated = await api(`/api/orders/${skusDialogOrderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ skus: newSkus })
      });
      const apply = (arr) => arr.map((o) => Number(o.id) === skusDialogOrderId ? { ...o, skus: updated.skus } : o);
      state.openOrders = apply(state.openOrders);
      state.archiveOrders = apply(state.archiveOrders);
      state.pinnedOrders = apply(state.pinnedOrders);
      document.getElementById('skusDialog').close();
      renderTables();
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById('skusDialogCancel').addEventListener('click', () => {
    document.getElementById('skusDialog').close();
  });
}

function openSkusDialog(orderId, skus) {
  skusDialogOrderId = orderId;
  document.getElementById('skusDialogText').value = skus;
  document.getElementById('skusDialog').showModal();
}

function triggerPdfDownload(pdfBase64, fileName) {
  const binary = atob(pdfBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 5000);
}

// Tracked so label generation never races a weight edit the user just typed.
let pendingWeightSave = Promise.resolve(true);
const failedWeightSaves = new Set();
function bindShippingWeightInputs(root) {
  root.querySelectorAll('input.weight-input').forEach(input=>input.addEventListener('change',()=>{
    const value=input.value.trim();
    const invalid=value && (!/^\d*[.,]?\d+$/.test(value) || Number(value.replace(',','.'))<=0);
    input.classList.toggle('invalid',Boolean(invalid));
    input.setAttribute('aria-invalid',String(Boolean(invalid)));
    if(invalid)return;
    const id=Number(input.dataset.weightId);
    pendingWeightSave=pendingWeightSave.then(async()=>{
      const saved=await saveShippingWeight(id,value);
      if(saved)failedWeightSaves.delete(id);else failedWeightSaves.add(id);
      return saved;
    });
  }));
}

async function saveShippingWeight(id, value) {
  try {
    const updated = await api(`/api/orders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ shipping_weight: value })
    });
    const apply = (arr) => arr.map((o) => Number(o.id) === id ? { ...o, shipping_weight: updated.shipping_weight } : o);
    state.openOrders = apply(state.openOrders);
    state.archiveOrders = apply(state.archiveOrders);
    state.pinnedOrders = apply(state.pinnedOrders);
    state.boardArchiveOrders = apply(state.boardArchiveOrders);
    return true;
  } catch (error) {
    alert(error.message);
    return false;
  }
}

async function printLabels(buttonId, path, body) {
  const n = body.orderIds ? body.orderIds.length : 0;
  const selected = new Set((body.orderIds || []).map(Number));
  const existing = [...state.openOrders, ...state.archiveOrders, ...state.pinnedOrders, ...state.boardArchiveOrders]
    .filter(order => selected.has(Number(order.id)) && (order.label_created || order.label_url));
  const replaceLabels = Object.fromEntries(existing.map(order => [order.id, order.label_url || '']));
  if (existing.length && !confirm('Some selected orders already have a shipping label. Replace the saved labels with newly generated labels? This creates new shipments and does not cancel the original shipments with the carrier.')) return;
  body = { ...body, replaceLabels };
  const labelType = path.includes('gls') ? 'GLS Courier' : body.type === 'registered_letter' ? 'Letter' : 'Parcel';
  if (!existing.length && !confirm(`Generate ${labelType} label${n !== 1 ? 's' : ''} for ${n} order${n !== 1 ? 's' : ''}?`)) return;
  const button = typeof buttonId === 'string' ? document.getElementById(buttonId) : buttonId;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Creating...';
  try {
    await pendingWeightSave;
    const selectedIds=body.orderIds?.map(Number) || [];
    if ([...document.querySelectorAll('input.weight-input.invalid')].some(input=>selectedIds.includes(Number(input.dataset.weightId))) || selectedIds.some(id=>failedWeightSaves.has(id))) throw new Error(window.i18n.t('Save a valid shipping weight before printing labels.'));
    const result = await api(path, { method: 'POST', body: JSON.stringify(body) });
    for (const dl of result.downloads) {
      triggerPdfDownload(dl.pdfBase64, dl.fileName);
    }
    const failed = result.results.filter((r) => !r.success);
    if (failed.length) {
      alert(window.i18n.t('Failed') + ':\n' + failed.map((r) => `${r.externalOrderId}: ${window.i18n.t(r.error)}`).join('\n'));
    }
    await loadOrders();
    renderTables();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

document.querySelectorAll('.tab.nav-link').forEach((tab) => {
  tab.addEventListener('click', () => {
    setView(tab.dataset.view === 'board' ? preferredOrdersView() : tab.dataset.view);
    if (tab.dataset.view === 'marketing') {
      loadMarketingData().then(renderMarketing).catch(console.error);
    }
    if (tab.dataset.view === 'batch') loadPrepBatches().catch((error) => alert(error.message));
  });
});

document.getElementById('createBatch').addEventListener('click', async () => {
  const orderIds = [...state.selectedOrderIds].map(Number);
  if (!orderIds.length) return;
  const button = document.getElementById('createBatch');
  button.disabled = true;
  try {
    const batch = await api('/api/prep-batches', { method: 'POST', body: JSON.stringify({ order_ids: orderIds }) });
    state.selectedOrderIds.clear();
    updateSelectionBar();
    renderTables();
    await loadPrepBatches(batch.id);
    setView('batch');
  } catch (error) { alert(error.message); }
  finally { button.disabled = false; }
});

async function addSelectedOrdersToBatch(event) {
  const batchId = event.target.value;
  const orderIds = [...state.selectedOrderIds].map(Number);
  if (!batchId || !orderIds.length) { event.target.value = ''; return; }
  event.target.disabled = true;
  try {
    await api(`/api/prep-batches/${batchId}/orders`, { method: 'POST', body: JSON.stringify({ order_ids: orderIds }) });
    state.selectedOrderIds.clear();
    updateSelectionBar();
    renderTables();
    await loadPrepBatches(batchId);
    event.target.value = '';
  } catch (error) { alert(error.message); }
  finally { event.target.disabled = false; }
}
document.getElementById('addToBatchSelect').addEventListener('change', addSelectedOrdersToBatch);
document.getElementById('boardAddToBatchSelect').addEventListener('change', addSelectedOrdersToBatch);

document.getElementById('batchPicker').addEventListener('change', async (event) => {
  await loadPrepBatches(event.target.value || null);
});

document.getElementById('deleteBatch').addEventListener('click', async () => {
  if (!state.currentPrepBatch || !confirm(`Delete ${state.currentPrepBatch.name}?`)) return;
  await api(`/api/prep-batches/${state.currentPrepBatch.id}`, { method: 'DELETE' });
  await loadPrepBatches();
});

document.querySelectorAll('.settings-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    setSettingsTab(tab.dataset.settingsTab);
    if (tab.dataset.settingsTab === 'backup') {
      loadBackups().then(renderBackupList).catch(console.error);
    }
  });
});

document.getElementById('printGls').addEventListener('click', () =>
  printLabels('printGls', '/api/labels/gls', { orderIds: [...state.selectedOrderIds] })
);

document.getElementById('printPostaParcel').addEventListener('click', () =>
  printLabels('printPostaParcel', '/api/labels/posta', { orderIds: [...state.selectedOrderIds], type: 'parcel' })
);

async function deleteSelectedOrders(ids, selection) {
  const results = await Promise.allSettled(ids.map(id => api(`/api/orders/${id}`, { method: 'DELETE' })));
  const completed = [], failed = [], failedIds = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') { completed.push(ids[index]); selection.delete(ids[index]); }
    else { failedIds.push(ids[index]); failed.push(`${ids[index]}: ${window.i18n?.t(result.reason.message) || result.reason.message}`); }
  });
  await loadOrders(); failedIds.forEach(id => selection.add(id)); renderTables();
  if (failed.length) alert(`${window.i18n?.t('Deleted') || 'Deleted'}: ${completed.join(', ') || '—'}\n${window.i18n?.t('Failed') || 'Failed'}: ${failed.join('\n')}`);
}

document.getElementById('deleteSelected').addEventListener('click', async () => {
  const ids = [...state.selectedOrderIds];
  const n = ids.length;
  if (!confirm(`Permanently delete ${n} order${n !== 1 ? 's' : ''}?`)) return;
  const button = document.getElementById('deleteSelected');
  button.disabled = true;
  try {
    await deleteSelectedOrders(ids, state.selectedOrderIds);
  } catch (err) {
    alert(err.message);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('clearSelection').addEventListener('click', () => {
  state.selectedOrderIds.clear();
  updateSelectionBar();
  renderTables();
});

document.getElementById('archivePrintGls').addEventListener('click', () =>
  printLabels('archivePrintGls', '/api/labels/gls', { orderIds: [...state.archiveSelectedOrderIds] })
);

document.getElementById('archivePrintPostaParcel').addEventListener('click', () =>
  printLabels('archivePrintPostaParcel', '/api/labels/posta', { orderIds: [...state.archiveSelectedOrderIds], type: 'parcel' })
);

document.getElementById('archiveEditSelected').addEventListener('click', () => {
  const checked = document.querySelector('#archiveTable input.row-select:checked');
  if (!checked) return;
  const id = Number(checked.dataset.id);
  const order = state.archiveOrders.find((o) => Number(o.id) === id)
    || state.pinnedOrders.find((o) => Number(o.id) === id);
  if (order) openArchiveEditDialog(order);
});

document.getElementById('openEditSelected').addEventListener('click', () => {
  if (state.selectedOrderIds.size !== 1) return;
  const id = Number([...state.selectedOrderIds][0]);
  const order = state.openOrders.find((o) => Number(o.id) === id)
    || state.pinnedOrders.find((o) => Number(o.id) === id);
  if (order) openArchiveEditDialog(order);
});

document.getElementById('archiveDeleteSelected').addEventListener('click', async () => {
  const ids = [...state.archiveSelectedOrderIds];
  const n = ids.length;
  if (!confirm(`Permanently delete ${n} order${n !== 1 ? 's' : ''}?`)) return;
  const button = document.getElementById('archiveDeleteSelected');
  button.disabled = true;
  try {
    await deleteSelectedOrders(ids, state.archiveSelectedOrderIds);
  } catch (err) {
    alert(err.message);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('archiveClearSelection').addEventListener('click', () => {
  state.archiveSelectedOrderIds.clear();
  updateArchiveSelectionBar();
  renderTables();
});

document.getElementById('addOrder').addEventListener('click', () => {
  document.getElementById('addOrderVendor').value = '';
  document.getElementById('addOrderExternalId').value = '';
  fpAddOrderCreatedAt.clear();
  fpAddOrderShipDate.clear();
  document.getElementById('addOrderSkus').value = '';
  document.getElementById('addOrderAddress').value = '';
  document.getElementById('addOrderNote').value = '';
  document.getElementById('addOrderTrackingCode').value = '';
  document.getElementById('addOrderTrackingUrl').value = '';
  document.getElementById('addOrderDialog').showModal();
});

document.getElementById('markShipped').addEventListener('click', async () => {
  const button = document.getElementById('markShipped');
  const ids = [...state.selectedOrderIds];
  const n = ids.length;
  if (!confirm(`Mark ${n} order${n !== 1 ? 's' : ''} as shipped and move to Archive?`)) return;
  button.disabled = true;
  button.textContent = 'Moving...';
  try {
    const selected=ids.map(findBoardOrder).filter(Boolean);
    if(selected.length!==ids.length)throw new Error('Selected orders changed. Refresh and try again.');
    const results=await window.workflowDispatchUI.archive(selected);
    if(!results)return;
    if(results.some(o=>o.dispatch_result&&o.dispatch_result.state!=='confirmed'))alert(window.i18n.t(window.workflowDispatchUI.message(results)));
    state.selectedOrderIds.clear();
    updateSelectionBar();
    await loadOrders();
    await loadPrepBatches(state.currentPrepBatch?.id);
    renderTables();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Mark as Shipped';
  }
});

document.getElementById('refreshAuth').addEventListener('click', refresh);

document.getElementById('addProduct').addEventListener('click', () => {
  state.productDraft = { sku: '', display_name: '' };
  renderProducts();
});

document.getElementById('refreshProductMappings').addEventListener('click', async () => {
  await api('/api/products/refresh-order-skus', { method: 'POST' });
  await loadOrders();
  renderTables();
});

document.getElementById('pollNow').addEventListener('click', async () => {
  const button = document.getElementById('pollNow');
  button.disabled = true;
  button.querySelector('.poll-label-full').textContent = 'Polling…';
  button.querySelector('.poll-label-short').textContent = 'Syncing';
  try {
    await api('/api/poll', {
      method: 'POST',
      body: JSON.stringify({ force: true })
    });
    await refresh();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.querySelector('.poll-label-full').textContent = 'Poll All';
    button.querySelector('.poll-label-short').textContent = 'Sync';
  }
});

document.getElementById('refreshDashboard').addEventListener('click', async (event) => {
  const btn = event.currentTarget;
  btn.disabled = true;
  try {
    await loadDashboard();
    renderDashboard();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('refreshOpen').addEventListener('click', async (event) => {
  const btn = event.currentTarget;
  btn.disabled = true;
  try {
    await loadOrders();
    renderTables();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('refreshArchive').addEventListener('click', async (event) => {
  const btn = event.currentTarget;
  btn.disabled = true;
  try {
    await loadArchiveOrders();
    renderTables();
    loadFeedbackEligibility();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('refreshTracking').addEventListener('click', async (event) => {
  const btn = event.currentTarget;
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = 'Refreshing…';
  try {
    const codes = [...state.archiveOrders, ...state.pinnedOrders]
      .map((o) => o.tracking_code)
      .filter((v, i, a) => v && a.indexOf(v) === i);
    if (codes.length) {
      const fresh = await api(`/api/tracking/statuses?codes=${encodeURIComponent(codes.join(','))}`);
      Object.assign(state.trackingStatuses, fresh);
      renderTables();
    }
  } catch (err) {
    alert(`Failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
});

document.getElementById('backupNow').addEventListener('click', async (event) => {
  const btn = event.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Creating backup…';
  try {
    const record = await api('/api/backup/now', { method: 'POST' });
    state.backups = [record, ...state.backups];
    if(record.off_device_copy==='failed')alert('Local backup created, but copying failed. Check the configured drive or network folder.');
    window.serviceDiagnostics?.load();
    renderBackupList();
  } catch (err) {
    alert(`Backup failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Backup Now';
  }
});

document.getElementById('backupDownload').addEventListener('click', () => {
  window.location.href = '/api/backup/download';
});

document.getElementById('backupVerifyBtn').addEventListener('click', () => {
  document.getElementById('backupVerifyFile').click();
});

document.getElementById('backupVerifyFile').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';

  const btn = document.getElementById('backupVerifyBtn');
  const status = document.getElementById('backupVerifyStatus');
  const result = document.getElementById('backupVerifyResult');

  btn.disabled = true;
  status.textContent = 'Verifying…';
  result.hidden = true;

  try {
    const res = await fetch('/api/backup/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || res.statusText);

    status.textContent = data.complete ? `Backup is valid — ${data.labels} labels, settings and database` : 'Backup is valid — database only (legacy backup)';
    if (data.counts) {
      const rows = Object.entries(data.counts)
        .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${Number(v).toLocaleString()}</td></tr>`)
        .join('');
      result.innerHTML = `<table class="backup-verify-table"><thead><tr><th>Table</th><th>Rows in backup</th></tr></thead><tbody>${rows}</tbody></table>`;
      result.hidden = false;
    }
  } catch (err) {
    status.textContent = '';
    result.innerHTML = `<p class="danger-text">Verification failed: ${escapeHtml(err.message)}</p>`;
    result.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('backupRestoreBtn').addEventListener('click', () => {
  document.getElementById('backupRestoreFile').click();
});

document.getElementById('backupRestoreFile').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';
  if (!confirm(`Restore from "${file.name}"?\n\nThis will overwrite all current data.`)) return;

  const btn = document.getElementById('backupRestoreBtn');
  const status = document.getElementById('backupRestoreStatus');
  btn.disabled = true;
  status.textContent = 'Restoring…';

  try {
    const res = await fetch('/api/backup/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    status.textContent = 'Restore complete. Reloading…';
    setTimeout(() => window.location.reload(), 5000);
  } catch (err) {
    status.textContent = '';
    alert(`Restore failed: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('refreshMarketing').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    await loadMarketingData();
    renderMarketing();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
});

document.querySelectorAll('.marketing-period-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.marketingPeriodDays = btn.dataset.period || Number(btn.dataset.days);
    document.querySelectorAll('.marketing-period-btn').forEach((b) => { b.classList.toggle('active', b === btn); b.setAttribute('aria-pressed', String(b === btn)); });
    loadMarketingData().then(renderMarketing).catch(console.error);
  });
});

for (const [name, initialize] of [
  ['manual order dialog', initAddOrderDialog],
  ['archive edit dialog', initArchiveEditDialog],
  ['tracking dialog', initTrackingDialog],
  ['address dialog', initAddressDialog],
  ['note dialog', initNoteDialog],
  ['SKU dialog', initSkusDialog],
  ['theme controls', initThemeToggle],
  ['appearance settings', initAppearanceSettings]
]) {
  try { initialize(); }
  catch (error) { console.error(`Could not initialize ${name}:`, error); }
}

const VALID_VIEWS = new Set(['dashboard', 'open', 'archive', 'board', 'batch', 'inventory', 'marketing', 'settings', 'scan']);
const VALID_SETTINGS_TABS = new Set(['workflow', 'appearance', 'products', 'auth', 'backup', 'logs']);

function parseHash(hash) {
  const raw = hash.replace(/^#/, '') || 'dashboard';
  const i = raw.indexOf('/');
  return i < 0 ? [raw, ''] : [raw.slice(0, i), raw.slice(i + 1)];
}

window.addEventListener('hashchange', () => {
  const [view, sub] = parseHash(window.location.hash);
  if (view === 'settings') {
    const tab = VALID_SETTINGS_TABS.has(sub) ? sub : state.activeSettingsTab;
    state.activeSettingsTab = tab;
    setView('settings');
    setSettingsTab(tab);
    if (tab === 'backup') loadBackups().then(renderBackupList).catch(console.error);
  } else if (view === 'archive') {
    const page = sub !== '' ? parseInt(sub, 10) : 0;
    if (!isNaN(page) && page >= 0 && page !== state.archivePage) {
      state.archivePage = page;
      loadArchiveOrders().then(renderTables).catch(console.error);
    }
    setView('archive');
  } else if (view === 'marketing') {
    setView('marketing');
    loadMarketingData().then(renderMarketing).catch(console.error);

  } else if (VALID_VIEWS.has(view)) {
    setView(view);
  }
});

{
  const [startView, startSub] = parseHash(window.location.hash);
  if (startView === 'settings') {
    const tab = VALID_SETTINGS_TABS.has(startSub) ? startSub : 'products';
    state.activeSettingsTab = tab;
  } else if (startView === 'archive' && startSub !== '') {
    const page = parseInt(startSub, 10);
    if (!isNaN(page) && page >= 0) state.archivePage = page;
  }
  const initialView = VALID_VIEWS.has(startView) ? startView : 'dashboard';
  if (initialView !== 'board') setView(initialView);
  else {
    setView('board');
    history.replaceState(null, '', '#board');
  }
  if (initialView === 'settings') {
    const tab = state.activeSettingsTab;
    setSettingsTab(tab);
    if (tab === 'backup') loadBackups().then(renderBackupList).catch(console.error);
  }
}

refresh().catch(console.error);
loadVersion();

const sidebarToggle=document.getElementById('sidebarToggle');
function updateSidebarToggle() {
  const hidden=document.body.classList.contains('sidebar-hidden');
  const label=window.i18n.t(hidden?'Show sidebar labels':'Hide sidebar labels');
  sidebarToggle.setAttribute('aria-expanded',String(!hidden));
  sidebarToggle.setAttribute('aria-label',label);sidebarToggle.title=label;
  document.querySelectorAll('.top-nav .nav-link').forEach(button=>{const text=button.querySelector('.desktop-nav-label')?.textContent.trim();if(text)button.title=text;});
}
try { document.body.classList.toggle('sidebar-hidden',localStorage.getItem('moms-sidebar-hidden')==='true'); } catch (_) {}
sidebarToggle.addEventListener('click',()=>{
  const hidden=document.body.classList.toggle('sidebar-hidden');
  try { localStorage.setItem('moms-sidebar-hidden',String(hidden)); } catch (_) {}
  updateSidebarToggle();
  sidebarToggle.focus();
});
window.addEventListener('languagechange',updateSidebarToggle);
updateSidebarToggle();

// Hamburger menu
const hamburgerBtn = document.getElementById('hamburgerBtn');
const desktopToggleBtn = document.getElementById('desktopToggle');
const topbar = document.querySelector('.topbar');
const topNav = document.querySelector('.top-nav');
const mobileMoreButton = document.getElementById('mobileMoreButton');
const mobileMoreMenu = document.getElementById('mobileMoreMenu');
const mobileMoreBackdrop = document.getElementById('mobileMoreBackdrop');
const closeMobileMoreButton = document.getElementById('closeMobileMore');
const mobileMQ = window.matchMedia('(max-width: 640px)');
let forceDesktop = localStorage.getItem('local-orders-force-desktop') === 'true';

const monitorSvg = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>`;
const phoneSvg = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>`;

function applyMobileNav(isMobile) {
  hamburgerBtn.style.display = 'none';
  topNav.style.display = isMobile ? 'none' : '';
  topbar.classList.remove('nav-open');
  hamburgerBtn.setAttribute('aria-expanded', 'false');
  if (desktopToggleBtn) {
    desktopToggleBtn.style.display = (isMobile || forceDesktop) ? 'inline-flex' : 'none';
    if (forceDesktop) {
      desktopToggleBtn.innerHTML = `${phoneSvg}<span class="desktop-toggle-text">Mobile</span>`;
      desktopToggleBtn.setAttribute('aria-label', 'Switch to mobile view');
      desktopToggleBtn.setAttribute('title', 'Switch to mobile view');
    } else {
      desktopToggleBtn.innerHTML = `${monitorSvg}<span class="desktop-toggle-text">Desktop</span>`;
      desktopToggleBtn.setAttribute('aria-label', 'Switch to desktop view');
      desktopToggleBtn.setAttribute('title', 'Switch to desktop view');
    }
  }
}

function closeMobileMoreMenu() {
  const menu = document.getElementById('mobileMoreMenu');
  const backdrop = document.getElementById('mobileMoreBackdrop');
  const button = document.getElementById('mobileMoreButton');
  if (!menu || !backdrop || !button) return;
  menu.hidden = true;
  backdrop.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('mobile-menu-open');
  document.querySelectorAll('main,.topbar,.mobile-bottom-nav').forEach(el=>el.inert=false);
  if(document.activeElement && menu.contains(document.activeElement)) button.focus();
}

function openMobileMoreMenu() {
  if (!mobileMoreMenu || !mobileMoreBackdrop || !mobileMoreButton) return;
  closeAllActionMenus();
  mobileMoreMenu.hidden = false;
  mobileMoreBackdrop.hidden = false;
  mobileMoreButton.setAttribute('aria-expanded', 'true');
  document.body.classList.add('mobile-menu-open');
  document.querySelectorAll('main,.topbar,.mobile-bottom-nav').forEach(el=>el.inert=true);
  closeMobileMoreButton.focus();
}

applyMobileNav(mobileMQ.matches);
mobileMQ.addEventListener('change', (e) => { applyMobileNav(e.matches); renderTables(); });

function setOfflineBanner(offline) {
  const b = document.getElementById('offline-banner');
  if (b) b.style.display = offline ? '' : 'none';
}

window.addEventListener('offline', () => setOfflineBanner(true));
window.addEventListener('online', () => { setOfflineBanner(false); refresh(); });

async function autoRefresh() {
  if (document.querySelector('dialog[open]')) return;
  const focused = document.activeElement;
  const openTable = document.getElementById('openTable');
  const archiveTable = document.getElementById('archiveTable');
  if ((openTable && openTable.contains(focused)) || (archiveTable && archiveTable.contains(focused))) return;
  await Promise.all([loadOrders(), loadPinnedOrders()]).catch(() => {});
  renderTables();
}

setInterval(autoRefresh, 60_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) autoRefresh(); });

hamburgerBtn.addEventListener('click', () => {
  const open = topbar.classList.toggle('nav-open');
  topNav.style.display = open ? '' : 'none';
  hamburgerBtn.setAttribute('aria-expanded', String(open));
});
topbar.addEventListener('click', (e) => {
  if (e.target.closest('.nav-link') && topbar.classList.contains('nav-open')) {
    topbar.classList.remove('nav-open');
    topNav.style.display = 'none';
    hamburgerBtn.setAttribute('aria-expanded', 'false');
  }
});

if (desktopToggleBtn) {
  desktopToggleBtn.addEventListener('click', () => {
    forceDesktop = !forceDesktop;
    localStorage.setItem('local-orders-force-desktop', String(forceDesktop));
    const vp = document.querySelector('meta[name="viewport"]');
    if (vp) vp.content = forceDesktop ? 'width=1280, viewport-fit=cover' : 'width=device-width, initial-scale=1, viewport-fit=cover';
  });
}

mobileMoreButton.addEventListener('click', () => {
  if (mobileMoreMenu.hidden) openMobileMoreMenu();
  else closeMobileMoreMenu();
});
closeMobileMoreButton.addEventListener('click', closeMobileMoreMenu);
mobileMoreBackdrop.addEventListener('click', closeMobileMoreMenu);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !mobileMoreMenu.hidden) {
    closeMobileMoreMenu();
    mobileMoreButton.focus();
  }
});

 document.querySelectorAll('[data-orders-view]').forEach((button) => {
  button.addEventListener('click', () => setView(button.dataset.ordersView));
});

let settingsLoading = false;
let settingsSaving = false;
let settingsRequest = 0;
function applicationSettingsDirty(form) {
  return [...form.querySelectorAll('[name]')].some(input=>input.value!==input.dataset.originalValue) || [...form.querySelectorAll('[data-clear]')].some(input=>input.checked);
}
function updateSettingsDraft(form) {
  const dirty=applicationSettingsDirty(form);
  form.querySelector('[data-settings-dirty]').hidden=!dirty;
  form.querySelector('[data-reset-settings]').disabled=!dirty || settingsSaving;
}
window.addEventListener('beforeunload',event=>{
  if(settingsSaving || [...document.querySelectorAll('#applicationSettings form')].some(applicationSettingsDirty)){event.preventDefault();event.returnValue='';}
});
function setSettingsBusy(group) {
  document.querySelectorAll('#applicationSettings form').forEach(form=>{
    form.querySelector('button[type="submit"]').disabled=settingsSaving;
    if(form.dataset.settingsGroup===group)form.querySelectorAll('[name],[data-clear]').forEach(input=>input.disabled=settingsSaving);
    updateSettingsDraft(form);
  });
}
async function loadApplicationSettings(force = false) {
  const root = document.getElementById('applicationSettings');
  if (!root || settingsLoading || settingsSaving || (!force && root.querySelector('form'))) return;
  settingsLoading = true;
  const request=++settingsRequest;
  try { const fields=await api('/api/application-settings');if(request===settingsRequest)renderApplicationSettings(fields); }
  catch (error) { if(request===settingsRequest){if(root.querySelector('form')){let message=root.querySelector('[data-settings-load-error]');if(!message){message=document.createElement('p');message.dataset.settingsLoadError='';message.setAttribute('role','alert');root.prepend(message);}message.textContent=`Settings unavailable: ${error.message}`;}else root.textContent=`Settings unavailable: ${error.message}`;} }
  finally { settingsLoading = false; }
}
function renderApplicationSettings(fields, savedGroup) {
  const root = document.getElementById('applicationSettings');
  const drafts = [];
  root.querySelectorAll('form').forEach(form => {
    if (form.dataset.settingsGroup === savedGroup) return;
    drafts.push({ group: form.dataset.settingsGroup, open: form.closest('details').open, message: form.querySelector('[data-settings-message]').textContent, values: [...form.querySelectorAll('[name]')].filter(input => input.value !== input.dataset.originalValue).map(input => [input.name, input.value]), clears: [...form.querySelectorAll('[data-clear]')].filter(input => input.checked).map(input => input.dataset.clear) });
  });
  const groups = { application: 'Application, login and synchronization', etsy: 'Etsy', shopify: 'Shopify', amazon: 'Amazon', sashe: 'SAShE', gls: 'GLS', posta: 'Slovenská pošta' };
  const help = {
    application: 'Changes apply after restart. For a changed port, also update the host port mapping. Keep a configuration backup before changing the database or application secret.',
    etsy: 'Enter the application key and shop ID, register the same callback URL in Etsy, then restart and use Authorize. <a href="https://developers.etsy.com/documentation/" target="_blank" rel="noopener noreferrer">Etsy API documentation</a>',
    shopify: 'Use your .myshopify.com domain. Enter an existing Admin API access token or OAuth client credentials, restart, then authorize if needed. <a href="https://shopify.dev/docs/apps/build/authentication-authorization" target="_blank" rel="noopener noreferrer">Shopify authorization guide</a>',
    amazon: 'For a private application, enter LWA credentials, refresh token, region and marketplace IDs. Public applications use seller authorization after setup. <a href="https://developer-docs.amazon.com/sp-api/docs/connecting-to-the-selling-partner-api" target="_blank" rel="noopener noreferrer">Amazon connection guide</a>',
    sashe: 'Enter your user ID and API key for the existing SAShE integration. If you do not have API access, request access details from SAShE support.',
  };
  root.innerHTML = Object.entries(groups).map(([group, label]) => {
    const items = fields.filter(field => field.group === group);
    return `<details class="settings-group"><summary>${escapeHtml(label)}${items.some(field => field.pending) ? ' — restart pending' : ''}</summary><form data-settings-group="${group}">${help[group] ? `<p class="muted">${help[group]}</p>` : ''}<div class="settings-fields">${items.map(field => `<div class="settings-field"><label for="setting-${field.env}">${escapeHtml(field.label)}${field.pending ? ' · pending restart' : ''}</label><small>${escapeHtml(field.env)}</small>${field.type === 'bool' ? `<select id="setting-${field.env}" name="${field.env}" data-original-value="${escapeHtml(field.value)}"><option value="true"${field.value === 'true' ? ' selected' : ''}>Yes</option><option value="false"${field.value === 'false' ? ' selected' : ''}>No</option></select>` : `<input id="setting-${field.env}" name="${field.env}" data-original-value="${field.secret ? '' : escapeHtml(field.value)}" type="${field.secret ? 'password' : field.type === 'number' ? 'number' : 'text'}" ${field.type === 'number' ? 'min="0" step="any"' : ''} value="${field.secret ? '' : escapeHtml(field.value)}" autocomplete="off" placeholder="${field.secret ? field.configured ? 'Saved — enter a replacement' : 'Not configured' : ''}">`}${field.secret ? `<span class="settings-secret-state">${field.configured ? 'Secret saved' : 'Not configured'} <label><input type="checkbox" data-clear="${field.env}"> Clear</label></span>` : ''}</div>`).join('')}</div><div class="card-actions"><button type="submit">Save ${escapeHtml(label)}</button><button type="button" class="secondary" data-reset-settings disabled>Discard changes</button><span role="status" data-settings-message></span><span class="settings-draft-status" data-settings-dirty hidden>Unsaved changes</span></div></form></details>`;
  }).join('');
  for (const draft of drafts) {
    const form = root.querySelector(`[data-settings-group="${draft.group}"]`);
    form.closest('details').open = draft.open;
    form.querySelector('[data-settings-message]').textContent = draft.message;
    for (const [name,value] of draft.values) form.elements.namedItem(name).value = value;
    for (const name of draft.clears) form.querySelector(`[data-clear="${name}"]`).checked = true;
  }
  root.querySelectorAll('form').forEach(form => {
    form.addEventListener('input',()=>updateSettingsDraft(form));
    form.addEventListener('change',()=>updateSettingsDraft(form));
    form.querySelector('[data-reset-settings]').addEventListener('click',()=>{if(settingsSaving)return;form.querySelectorAll('[name]').forEach(input=>input.value=input.dataset.originalValue);form.querySelectorAll('[data-clear]').forEach(input=>input.checked=false);form.querySelector('[data-settings-message]').textContent='';updateSettingsDraft(form);});
    updateSettingsDraft(form);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if(settingsSaving)return;
      const message = form.querySelector('[data-settings-message]');
      const groupFields = fields.filter(field => field.group === form.dataset.settingsGroup);
      const changes = {};
      for (const field of groupFields) {
        const input = form.elements.namedItem(field.env);
        if (field.secret) {
          if (form.querySelector(`[data-clear="${field.env}"]`).checked) changes[field.env] = '';
          else if (input.value) changes[field.env] = input.value;
        } else if (input.value !== field.value) changes[field.env] = input.value;
      }
      if (!Object.keys(changes).length) { message.textContent = 'No changes.'; return; }
      if ((Object.hasOwn(changes, 'APP_SECRET') || Object.hasOwn(changes, 'DATABASE_URL') || Object.hasOwn(changes, 'PORT')) && !confirm('These changes affect startup or encrypted data. Keep a backup of the current configuration and database. Save for the next restart?')) return;
      settingsSaving=true;++settingsRequest;setSettingsBusy(form.dataset.settingsGroup);
      message.textContent = 'Saving…';
      try {
        const saved = await api('/api/application-settings', { method: 'PATCH', body: JSON.stringify(changes) });
        renderApplicationSettings(saved, form.dataset.settingsGroup);
        setSettingsBusy(form.dataset.settingsGroup);
        const newForm = root.querySelector(`[data-settings-group="${form.dataset.settingsGroup}"]`);
        newForm.closest('details').open = true;
        newForm.querySelector('[data-settings-message]').textContent = Object.keys(changes).every(key => /^(ETSY|SHOPIFY|AMAZON|SASHE)_ENABLED$/.test(key)) ? 'Saved. Synchronization setting applied immediately.' : 'Saved. Restart the application to apply changes.';
        try { await loadChannels();renderAuthorizations(); }
        catch(error){newForm.querySelector('[data-settings-message]').textContent += ` Could not refresh channel status: ${error.message}`;}
      } catch (error) { message.textContent = error.message; }
      finally { settingsSaving=false;setSettingsBusy(form.dataset.settingsGroup); }
    });
  });
}

window.addEventListener('languagechange', () => {
  renderOrderBoard();
  renderTables();
  renderMarketing();
  renderInventory();
  renderBatchView();
  const calendars = new Set([...document.querySelectorAll('input')].map(input => input._flatpickr).filter(Boolean));
  for (const calendar of calendars) calendar.set('locale', window.i18n.calendarLocale);
  window.i18n.apply();
});

// HTTPS can carry a five-minute, single-use pairing code in the URL fragment.
async function openMobileConnect() {
  const dialog = document.getElementById('mobileConnectDialog');
  const message = document.getElementById('mobileConnectMessage');
  message.textContent = '';
  try {
    const connection = await api('/api/mobile-connect');
    document.getElementById('mobileConnectQr').src = connection.qr;
    const address = document.getElementById('mobileConnectAddress');
    address.textContent = connection.url;
    address.href = connection.url;
    document.getElementById('mobileHttpsNotice').hidden = connection.url.startsWith('https:');
    document.getElementById('mobilePairingHelp').textContent = connection.paired ? 'This QR code pairs one phone and expires in 5 minutes. Open again for a new code.' : 'Scan the QR code and sign in with your application username and password.';
    window.i18n.apply();
    document.getElementById('mobileConnectEveryLogin').checked = localStorage.getItem('mobile-connect-every-login') === 'true';
    dialog.showModal();
    localStorage.setItem('mobile-connect-seen', 'true');
  } catch (error) { alert(error.message); }
}
document.getElementById('connectPhone').addEventListener('click', openMobileConnect);
async function devicePush(enable) {
  const message=document.getElementById('pushMessage');
  const buttons=[document.getElementById('enablePush'),document.getElementById('disablePush')];buttons.forEach(button=>button.disabled=true);
  try {
    if(!window.isSecureContext||!('PushManager' in window)||!('serviceWorker' in navigator)||!('Notification' in window))throw new Error('Notifications require trusted HTTPS and a supported installed web app.');
    if(enable&&await Notification.requestPermission()!=='granted')throw new Error('Notification permission was not granted.');
    const registration=await navigator.serviceWorker.getRegistration();
    if(!registration?.active)throw new Error('Reload the application and try again.');
    let subscription=await registration.pushManager.getSubscription();
    if(enable){
      const settings=await api('/api/push');if(!settings.enabled)throw new Error('Enable push notifications and set a contact address in application settings, then restart.');
      const encoded=settings.publicKey.replace(/-/g,'+').replace(/_/g,'/');
      const key=Uint8Array.from(atob(encoded+'='.repeat((4-encoded.length%4)%4)),c=>c.charCodeAt(0));
      const created=!subscription;
      if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
      try {await api('/api/push',{method:'POST',body:JSON.stringify(subscription.toJSON())});}
      catch(error){if(created)await subscription.unsubscribe();throw error;}
      message.textContent='Notifications enabled. Messages contain no customer details.';
    }else{
      if(subscription){await api('/api/push',{method:'DELETE',body:JSON.stringify({endpoint:subscription.endpoint})});await subscription.unsubscribe();}
      message.textContent='Notifications disabled on this device.';
    }
  }catch(error){message.textContent=error.message;}
  finally{buttons.forEach(button=>button.disabled=false);window.i18n.apply();}
}
document.getElementById('enablePush').addEventListener('click',()=>devicePush(true));
document.getElementById('disablePush').addEventListener('click',()=>devicePush(false));
document.getElementById('revokeMobileDevices').addEventListener('click', async event => {
  event.target.disabled=true;
  try { await api('/api/mobile-devices',{method:'DELETE'});document.getElementById('mobileConnectQr').removeAttribute('src');document.getElementById('mobileConnectAddress').textContent='';document.getElementById('mobileConnectAddress').removeAttribute('href');document.getElementById('mobileConnectMessage').textContent='Paired phones signed out. Open again for a new QR code.';window.i18n.apply(); }
  catch(error){document.getElementById('mobileConnectMessage').textContent=error.message;}
  finally{event.target.disabled=false;}
});
document.getElementById('closeMobileConnect').addEventListener('click', () => document.getElementById('mobileConnectDialog').close());
document.getElementById('mobileConnectEveryLogin').addEventListener('change', event => localStorage.setItem('mobile-connect-every-login', String(event.target.checked)));
document.getElementById('copyMobileAddress').addEventListener('click', async () => {
  try {
    const text = document.getElementById('mobileConnectAddress').textContent;
    if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
    else {
      const field = document.createElement('textarea');
      field.value = text;
      field.style.cssText = 'position:fixed;opacity:0';
      document.getElementById('mobileConnectDialog').appendChild(field);
      try {
        field.select();
        if (!document.execCommand('copy')) throw new Error('Copy unavailable');
      } finally { field.remove(); }
    }
    document.getElementById('mobileConnectMessage').textContent = 'Address copied.';
  } catch (_) { document.getElementById('mobileConnectMessage').textContent = 'Select the address and copy it manually.'; }
});
try {
  if (matchMedia('(min-width: 900px)').matches && (!localStorage.getItem('mobile-connect-seen') || localStorage.getItem('mobile-connect-every-login') === 'true')) openMobileConnect();
} catch (_) {}

let dashboardPinDraft = [];
function renderDashboardPinEditor() {
  const root = document.getElementById('dashboardPinRows');
  root.innerHTML = dashboardPinDraft.map((item, index) => `<div class="dashboard-pin-row"><label>Display name<input data-pin-name="${index}" value="${escapeHtml(item.name)}" maxlength="80"></label><label>SKUs (comma separated)<input data-pin-skus="${index}" value="${escapeHtml(item.skus.join(', '))}"></label><button type="button" data-remove-pin="${index}" class="secondary">Unpin</button></div>`).join('');
  root.querySelectorAll('[data-pin-name]').forEach(input => input.addEventListener('input', () => { dashboardPinDraft[Number(input.dataset.pinName)].name = input.value; }));
  root.querySelectorAll('[data-pin-skus]').forEach(input => input.addEventListener('input', () => { dashboardPinDraft[Number(input.dataset.pinSkus)].skus = input.value.split(',').map(value => value.trim()).filter(Boolean); dashboardPinDraft[Number(input.dataset.pinSkus)].preparedColor = null; }));
  root.querySelectorAll('[data-remove-pin]').forEach(button => button.addEventListener('click', () => { dashboardPinDraft.splice(Number(button.dataset.removePin), 1); renderDashboardPinEditor(); }));
  window.i18n?.apply();
}
async function openDashboardPins() {
  try {
    dashboardPinDraft = await api('/api/dashboard-pins');
    document.getElementById('dashboardPinMessage').textContent = '';
    renderDashboardPinEditor();
    document.getElementById('dashboardPinsDialog').showModal();
  } catch (error) { alert(error.message); }
}
document.getElementById('addDashboardPin').addEventListener('click', () => { dashboardPinDraft.push({name:'',skus:[]}); renderDashboardPinEditor(); });
document.getElementById('closeDashboardPins').addEventListener('click', () => document.getElementById('dashboardPinsDialog').close());
document.getElementById('saveDashboardPins').addEventListener('click', async event => {
  event.target.disabled = true;
  try {
    await api('/api/dashboard-pins', { method:'PUT', body:JSON.stringify(dashboardPinDraft) });
    await loadDashboard();
    renderDashboard();
    document.getElementById('dashboardPinsDialog').close();
  } catch (error) { document.getElementById('dashboardPinMessage').textContent = error.message; }
  finally { event.target.disabled = false; }
});

document.getElementById('boardClearSelection').addEventListener('click', () => { state.selectedOrderIds.clear(); renderTables(); updateSelectionBar(); });
document.querySelectorAll('[data-export-orders], [data-export-archive-filtered], [data-export-open-filtered]').forEach(button => button.addEventListener('click', async () => {
  const selected = button.dataset.exportOrders === 'archive' ? state.archiveSelectedOrderIds : state.selectedOrderIds;
  const openFiltered=button.hasAttribute('data-export-open-filtered');
  const allFiltered = button.hasAttribute('data-export-archive-filtered') || openFiltered;
  const board=button.dataset.exportOpenFiltered==='board';
  if (!allFiltered && !selected.size) return;
  button.disabled = true;
  try {
    const payload={format:button.dataset.exportFormat,language:window.i18n.language};
    let endpoint='/api/orders/export';
    if(openFiltered) {
      endpoint='/api/orders/export/open';
      Object.assign(payload,{view:board?'board':'open',filters:board?{}:state.filters.open,sortKey:state.sortOpen.key,sortDir:state.sortOpen.dir});
      if(board) Object.assign(payload,{boardToday:window.orderFilterHelpers.todayKey(),boardFilters:window.orderWorkspace.filters,boardSearch:document.getElementById('boardSearch').value,boardStage:!Object.values(window.orderWorkspace.filters).some(Boolean)&&getComputedStyle(document.getElementById('boardTabs')).display!=='none'?state.boardStage:''});
    } else if(allFiltered) {
      endpoint='/api/orders/export/archive';
      Object.assign(payload,{filters:state.filters.archive,sortKey:state.sortArchive.key,sortDir:state.sortArchive.dir});
    } else payload.orderIds=[...selected].map(Number);
    const response = await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    if (!response.ok) { const error = await response.json(); throw new Error(window.i18n.t(error.error || 'Export failed.')); }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url; link.download = `orders.${button.dataset.exportFormat}`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) { alert(error.message); }
  finally { button.disabled = false; }
}));

const defaultBrandingName = 'MOMS — Multichannel Order Management System';
document.getElementById('reloadApplication').addEventListener('click',()=>window.location.reload());
let brandingLogoDraft;
function applyBranding(branding) {
  document.title = branding.name;
  document.querySelector('.brand-name-full').textContent = branding.name;
  document.querySelector('.brand-name-short').textContent = branding.name === defaultBrandingName ? 'MOMS' : branding.name;
  document.getElementById('mobileBrandName').textContent = branding.name === defaultBrandingName ? 'MOMS' : branding.name;
  const logoUrl = '/app-logo?v=' + Date.now();
  document.querySelector('.brand-favicon').src = logoUrl;
  document.querySelector('link[rel="icon"]').href = '/app-favicon?v=' + Date.now();
  document.querySelector('link[rel="apple-touch-icon"]').href = '/apple-touch-icon.png?v=' + Date.now();
  document.getElementById('brandingPreview').src = logoUrl;
  document.getElementById('brandingName').value = branding.name;
}
async function loadBranding() {
  const branding = await api('/api/branding');
  applyBranding(branding);
}
document.getElementById('brandingLogo').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 1048576 || !['image/png','image/jpeg','image/webp'].includes(file.type)) {
    document.getElementById('brandingMessage').textContent = 'Choose a PNG, JPEG or WebP logo up to 1 MB.';
    event.target.value = ''; return;
  }
  const reader = new FileReader();
  reader.onload = () => { brandingLogoDraft = reader.result; document.getElementById('brandingPreview').src = reader.result; };
  reader.readAsDataURL(file);
});
async function saveBrandingForm(reset) {
  const form = document.getElementById('brandingForm');
  const buttons = [...form.querySelectorAll('button')];
  buttons.forEach(button => button.disabled = true);
  try {
    const body = reset ? { name: defaultBrandingName, logo: null } : {name:document.getElementById('brandingName').value};
    if (!reset && brandingLogoDraft !== undefined) body.logo = brandingLogoDraft;
    const branding = await api('/api/branding', {method:'PUT',body:JSON.stringify(body)});
    applyBranding(branding); brandingLogoDraft = undefined; document.getElementById('brandingLogo').value = '';
    document.getElementById('brandingMessage').textContent = 'Application name and logo saved.';
  } catch (error) { document.getElementById('brandingMessage').textContent = error.message; }
  finally { buttons.forEach(button => button.disabled = false); }
}
document.getElementById('brandingForm').addEventListener('submit', event => {event.preventDefault(); saveBrandingForm(false);});
document.getElementById('resetBranding').addEventListener('click', () => saveBrandingForm(true));

let deadlineCalendarDay = localDateKey(new Date());
function refreshDeadlineDay() {
  const today = localDateKey(new Date());
  if (today === deadlineCalendarDay) return;
  deadlineCalendarDay = today;
  renderTables(); renderBatchView();
}
setInterval(refreshDeadlineDay, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDeadlineDay(); });

document.querySelectorAll('[data-board-bulk]').forEach(button => {
  const target = document.getElementById(button.dataset.boardBulk);
  button.addEventListener('click', () => target.click());
  new MutationObserver(() => { button.disabled = target.disabled; }).observe(target, {attributes:true,attributeFilter:['disabled']});
});

document.getElementById('boardUploadSelected').addEventListener('click', () => {
  if (state.selectedOrderIds.size === 1) triggerLabelUpload(Number([...state.selectedOrderIds][0]));
});

// Open synchronously from the click so browsers (including mobile) allow the
// print tab. Fetch fresh selected rows rather than relying on cached card data.
document.querySelectorAll('[data-print-orders]').forEach(button => button.addEventListener('click', async () => {
  const selected = button.dataset.printOrders === 'archive' ? state.archiveSelectedOrderIds : state.selectedOrderIds;
  if (!selected.size) return;
  const preview = window.open('', '_blank');
  if (!preview) { alert(window.i18n.t('Allow pop-ups to open the print preview.')); return; }
  preview.opener = null;
  preview.document.body.textContent = window.i18n.t('Preparing print preview…');
  button.disabled = true;
  try {
    const response = await fetch('/api/orders/print', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ orderIds:[...selected].map(Number), view:button.dataset.printView, language:window.i18n.language, timezone:Intl.DateTimeFormat().resolvedOptions().timeZone }) });
    if (!response.ok) { const error = await response.json(); throw new Error(window.i18n.t(error.error || 'Print preview failed.')); }
    const html = await response.text();
    if (preview.closed) return;
    preview.document.open(); preview.document.write(html); preview.document.close();
    await Promise.all([...preview.document.images].map(image => image.decode().catch(() => {})));
    if (!preview.closed) { preview.focus(); preview.print(); }
  } catch (error) { if (!preview.closed) preview.close(); alert(error.message); }
  finally { button.disabled = false; }
}));

document.querySelectorAll('[data-archive-layout]').forEach(button => button.addEventListener('click', () => {
  state.archiveLayout = button.dataset.archiveLayout;
  try { localStorage.setItem('moms-archive-layout', state.archiveLayout); } catch (_) {}
  renderTables();
}));

document.getElementById('mobileMoreMenu').addEventListener('keydown',event=>{
  if(event.key!=='Tab') return;
  const controls=[...event.currentTarget.querySelectorAll('button:not([hidden]):not(:disabled)')].filter(el=>el.getClientRects().length);
  const first=controls[0],last=controls.at(-1);
  if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
});

const mobileBulkDetails=[];
document.querySelectorAll('.selection-bar').forEach(bar=>{
  const actions=bar.querySelector(':scope > .actions');if(!actions)return;
  const details=document.createElement('details');details.className='selection-actions-disclosure';
  const summary=document.createElement('summary');summary.textContent=window.i18n.t('Selected order actions');
  details.appendChild(summary);details.appendChild(actions);bar.appendChild(details);mobileBulkDetails.push(details);
});
function updateMobileBulkLayout(){mobileBulkDetails.forEach(details=>details.open=!window.matchMedia('(max-width: 640px)').matches);}
updateMobileBulkLayout();window.matchMedia('(max-width: 640px)').addEventListener('change',updateMobileBulkLayout);

var desktopContextOrigin=null;
function restoreDesktopContextMenu(){
  if(!desktopContextOrigin)return;
  const {menu,parent,trigger}=desktopContextOrigin;
  const restoreFocus=menu.contains(document.activeElement);desktopContextOrigin=null;
  menu.hidden=true;menu.classList.remove('desktop-context-menu');menu.style.removeProperty('left');menu.style.removeProperty('top');
  if(parent.isConnected)parent.appendChild(menu);else menu.remove();
  if(restoreFocus && trigger.isConnected)trigger.focus();
}
function openDesktopContextMenu(card,x,y){
  const trigger=card.querySelector('.action-menu-btn'),menu=trigger?.nextElementSibling;
  if(!menu || trigger.disabled)return;
  closeAllActionMenus();desktopContextOrigin={menu,parent:menu.parentElement,trigger};
  trigger.setAttribute('aria-expanded','true');menu.hidden=false;menu.classList.add('desktop-context-menu');document.body.appendChild(menu);
  const rect=menu.getBoundingClientRect();
  menu.style.left=`${Math.max(8,Math.min(x,innerWidth-rect.width-8))}px`;
  menu.style.top=`${Math.max(8,Math.min(y,innerHeight-rect.height-8))}px`;
  menu.querySelector('button:not(:disabled)')?.focus();
}
document.addEventListener('contextmenu',event=>{
  if(!matchMedia('(min-width: 641px) and (pointer: fine)').matches)return;
  if(event.target.closest('input,textarea,select,a'))return;
  const card=event.target.closest('.board-card');if(!card)return;
  event.preventDefault();openDesktopContextMenu(card,event.clientX,event.clientY);
});
document.addEventListener('keydown',event=>{
  const context=event.target.closest('.desktop-context-menu');
  if(context && ['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
    const items=[...context.querySelectorAll('button:not(:disabled)')];const index=items.indexOf(document.activeElement);
    const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
    event.preventDefault();items[next]?.focus();return;
  }
  if(event.defaultPrevented || event.isComposing || document.querySelector('dialog[open]') || !document.getElementById('mobileMoreMenu').hidden)return;
  if(event.target.closest('input,textarea,select,[contenteditable="true"]'))return;
  if(!matchMedia('(min-width: 641px)').matches)return;
  if((event.shiftKey && event.key==='F10') || event.key==='ContextMenu'){
    const card=event.target.closest('.board-card');if(!card)return;
    event.preventDefault();const rect=card.getBoundingClientRect();openDesktopContextMenu(card,rect.left+16,rect.top+44);return;
  }
  if((event.metaKey || event.ctrlKey) && event.altKey && !event.shiftKey){
    const views={'1':'dashboard','2':'board','3':'inventory','4':'settings'};
    if(views[event.key]){event.preventDefault();closeAllActionMenus();setView(views[event.key]);}return;
  }
  if(((event.metaKey || event.ctrlKey) && event.key.toLowerCase()==='k' && !event.altKey && !event.shiftKey) || (event.key==='/' && !event.metaKey && !event.ctrlKey && !event.altKey)){
    const search=state.activeView==='board'?document.getElementById('boardSearch'):state.activeView==='inventory'?document.getElementById('inventorySearch'):null;
    if(search){event.preventDefault();if(state.activeView==='board'){document.getElementById('boardSearchPanel').hidden=false;document.getElementById('boardSearchToggle').setAttribute('aria-expanded','true');}search.focus();search.select();}
  }
});
document.getElementById('keyboardShortcutsButton').addEventListener('click',()=>document.getElementById('keyboardShortcutsDialog').showModal());
document.getElementById('closeKeyboardShortcuts').addEventListener('click',()=>document.getElementById('keyboardShortcutsDialog').close());

window.addEventListener('resize',()=>{if(desktopContextOrigin)closeAllActionMenus();});
document.addEventListener('scroll',event=>{if(desktopContextOrigin && !desktopContextOrigin.menu.contains(event.target))closeAllActionMenus();},true);

document.querySelectorAll('.orders-tools').forEach(details=>{
  details.addEventListener('toggle',()=>{if(details.open)document.querySelectorAll('.orders-tools').forEach(other=>{if(other!==details)other.open=false;});});
});
document.addEventListener('click',event=>document.querySelectorAll('.orders-tools[open]').forEach(details=>{
  if(!details.contains(event.target) || event.target.closest('.orders-tools-menu button')) details.open=false;
}));
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  document.querySelectorAll('.orders-tools[open]').forEach(details=>{details.open=false;details.querySelector('summary').focus();});
});

function openBoardOrderDetails(id){
  const order=findBoardOrder(id);if(!order)return;
  closeAllActionMenus();const dialog=document.getElementById('orderDetailsDialog');
  const field=(label,value,wide=false,copyId='')=>{
    const copyLabel=copyId==='orderDetailsCopyAddress'?'Copy shipping address':'Copy tracking number';
    return `<div class="order-detail-field${wide?' order-detail-wide':''}"><dt>${window.i18n.t(label)}</dt><dd class="${copyId?'order-detail-copy-value':''}" data-no-translate><span>${escapeHtml(value || window.i18n.t('Not set'))}</span>${copyId?`<button id="${copyId}" type="button" class="copy-btn detail-copy-icon" title="${escapeHtml(window.i18n.t(copyLabel))}" aria-label="${escapeHtml(window.i18n.t(copyLabel))}">${clipboardSvg}</button>`:''}</dd></div>`;
  };
  document.getElementById('orderDetailsNumber').textContent=displayOrderId(order);
  const tracking=state.trackingStatuses[order.tracking_code] || {};
  document.getElementById('orderDetailsContent').innerHTML=`<dl class="order-detail-grid"><div class="order-detail-field"><dt><label for="orderDetailsStatus">${window.i18n.t('Status')}</label></dt><dd><select id="orderDetailsStatus" ${order.shipped || boardSaving || boardActionBusy?'disabled':''}>${WORKFLOW_STAGES.map(([value,label])=>`<option data-no-translate value="${value}"${value===(order.workflow_status || 'new')?' selected':''}>${escapeHtml(translatedWorkflowLabel(value,label))}</option>`).join('')}</select></dd></div>${order.shipped ? field('Archived',window.i18n.t('Yes')) : ''}${field('Ship by',fmtDate(order.ship_by_date))}${field('Order total',order.revenue_amount == null ? '' : fmtCurrency(order.revenue_amount,order.revenue_currency))}${field('Products',order.skus,true)}<div class="order-detail-field"><dt>${window.i18n.t('Label')}</dt><dd>${renderShowLabelButton(order)}</dd></div>${field('Shipping address',order.address,true,'orderDetailsCopyAddress')}${field('Tracking #',order.tracking_code,false,'orderDetailsCopyTracking')}${field('Tracking status',order.tracking_status || tracking.status)}${order.note?field('Note',order.note,true):''}</dl>${window.workflowDispatchUI.action(order)}${renderShopifyPayment(order)}`;
  const template=document.createElement('template');template.innerHTML=renderBoardActions(order);
  document.getElementById('orderDetailsActions').innerHTML=template.content.querySelector('.action-menu-dropdown').innerHTML;
  document.getElementById('orderDetailsCopyAddress').hidden=!String(order.address || '').trim();
  document.getElementById('orderDetailsCopyTracking').hidden=!order.tracking_code;
  dialog.dataset.detailId=order.id;document.getElementById('orderDetailsMessage').textContent='';dialog.showModal();
  loadOrderHistory(order.id);
  loadOrderFulfillment(order.id);
  loadOrderCosts(order.id);
}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-order-details]');
  if(button){openBoardOrderDetails(button.dataset.orderDetails);return;}
  const card=event.target.closest('.board-card');
  if(card && !event.target.closest('button,a,input,select,label') && !window.getSelection()?.toString())openBoardOrderDetails(card.dataset.orderId);
});
document.addEventListener('keydown',event=>{
  if(event.key==='Enter' && event.target.matches('.board-card')){event.preventDefault();openBoardOrderDetails(event.target.dataset.orderId);}
});
document.getElementById('closeOrderDetails').addEventListener('click',()=>document.getElementById('orderDetailsDialog').close());
document.getElementById('orderDetailsActions').addEventListener('click',event=>{
  const button=event.target.closest('[data-board-action]');if(!button)return;
  document.getElementById('orderDetailsDialog').close();runBoardAction(button);
});
document.getElementById('orderDetailsContent').addEventListener('click',async event=>{
  const button=event.target.closest('.detail-copy-icon');if(!button)return;
  const property=button.id==='orderDetailsCopyAddress'?'address':'tracking_code';
  const label=property==='address'?'Shipping address copied':'Tracking number copied';
  const dialog=document.getElementById('orderDetailsDialog'),order=findBoardOrder(dialog.dataset.detailId);
  if(!order?.[property])return;
  try{await copyToClipboard(order[property]);document.getElementById('orderDetailsMessage').textContent=window.i18n.t(label);}
  catch(error){document.getElementById('orderDetailsMessage').textContent=error.message;}
});

document.getElementById('orderDetailsContent').addEventListener('click',async event=>{const button=event.target.closest('[data-send-shipped-order]');if(!button)return;button.disabled=true;await changeBoardStatus(Number(button.dataset.sendShippedOrder),'shipped',true);openBoardOrderDetails(Number(button.dataset.sendShippedOrder));});

document.getElementById('orderDetailsContent').addEventListener('change',async event=>{
  if(event.target.id!=='orderDetailsStatus')return;
  const dialog=document.getElementById('orderDetailsDialog'),id=Number(dialog.dataset.detailId);
  const select=event.target,order=state.openOrders.find(order=>Number(order.id)===id);if(!order)return;
  if(boardSaving || boardActionBusy){select.value=order.workflow_status || 'new';return;}
  const controls=[...dialog.querySelectorAll('button:not(#closeOrderDetails),select')],disabled=controls.map(control=>control.disabled);controls.forEach(control=>control.disabled=true);
  document.getElementById('orderDetailsMessage').textContent=window.i18n.t('Saving status…');
  try{
    const result=await changeBoardStatus(id,select.value);
    if(result?.saved){document.querySelector('.order-fulfillment')?.remove();loadOrderFulfillment(id);}
    if(Number(dialog.dataset.detailId)!==id)return;
    const updated=findBoardOrder(id);select.value=updated?.workflow_status || 'new';
    document.getElementById('orderDetailsMessage').textContent=window.i18n.t(result?.message || '');
  }finally{if(Number(dialog.dataset.detailId)===id){controls.forEach((control,index)=>control.disabled=disabled[index]);select.disabled=Boolean(findBoardOrder(id)?.shipped);await refreshOrderCosts(id);}}
});

// Capture a fresh baseline each time an order editor opens; never store its contents.
const orderEditorGuards=[];
for(const [dialogId,cancelId] of [['addOrderDialog','addOrderCancel'],['archiveEditDialog','archiveEditCancel'],['addressDialog','addressDialogCancel'],['noteDialog','noteDialogCancel'],['skusDialog','skusDialogCancel'],['trackingDialog','trackingDialogCancel']]){
  const dialog=document.getElementById(dialogId),cancel=document.getElementById(cancelId);if(!dialog || !cancel)continue;
  let baseline='',lastFocus=null;
  const snapshot=()=>JSON.stringify([...dialog.querySelectorAll('input,textarea,select')].filter(el=>!el.closest('.flatpickr-calendar')).map(el=>[el.id,el.type==='checkbox'?el.checked:el.value]));
  const dirty=()=>dialog.open && snapshot()!==baseline;
  const notice=document.createElement('section');notice.className='unsaved-order-notice';notice.hidden=true;notice.setAttribute('role','alert');
  notice.innerHTML='<p>You have unsaved changes.</p><div class="actions"><button type="button" class="secondary" data-keep-editing>Keep editing</button><button type="button" class="secondary danger-button" data-discard-changes>Discard changes</button></div>';
  dialog.appendChild(notice);
  const originalShow=dialog.showModal.bind(dialog);
  dialog.showModal=()=>{baseline=snapshot();notice.hidden=true;originalShow();};
  const guard=event=>{
    if(dialog.querySelector('button[id$="Save"]:disabled')){event.preventDefault();event.stopImmediatePropagation();return;}
    if(!dirty())return;
    event.preventDefault();event.stopImmediatePropagation();lastFocus=document.activeElement;
    notice.hidden=false;notice.querySelector('[data-keep-editing]').focus();notice.scrollIntoView({block:'nearest'});
  };
  cancel.addEventListener('click',guard,true);
  dialog.addEventListener('cancel',guard);
  notice.querySelector('[data-keep-editing]').addEventListener('click',()=>{notice.hidden=true;lastFocus?.focus();});
  notice.querySelector('[data-discard-changes]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{if(!dialog.open)notice.hidden=true;});
  orderEditorGuards.push(dirty);
}
window.addEventListener('beforeunload',event=>{
  if(orderEditorGuards.some(dirty=>dirty())){event.preventDefault();event.returnValue='';}
});

// Selection is captured when opening; a refresh cannot silently change the batch.
let bulkStatusIds = [], bulkStatusBusy = false;
const bulkStatusDialog = document.getElementById('bulkStatusDialog');
document.getElementById('changeSelectedStatus').addEventListener('click', () => {
  if (boardSaving || boardActionBusy || !state.selectedOrderIds.size) return;
  bulkStatusIds = [...state.selectedOrderIds].map(Number);
  document.getElementById('bulkStatusCount').textContent = `${bulkStatusIds.length} orders selected`;
  document.getElementById('bulkStatusSelect').innerHTML = WORKFLOW_STAGES.map(([id, label]) => `<option data-no-translate value="${escapeHtml(id)}">${escapeHtml(translatedWorkflowLabel(id, label))}</option>`).join('');
  document.getElementById('bulkStatusMessage').textContent = '';
  bulkStatusDialog.showModal();
});
document.getElementById('bulkStatusCancel').addEventListener('click', () => { if (!bulkStatusBusy) bulkStatusDialog.close(); });
bulkStatusDialog.addEventListener('cancel', event => { if (bulkStatusBusy) event.preventDefault(); });
document.getElementById('bulkStatusSave').addEventListener('click', async () => {
  if (bulkStatusBusy || boardSaving || boardActionBusy) return;
  const status=document.getElementById('bulkStatusSelect').value;
  if(!window.workflowDispatchUI.confirmTransition(bulkStatusIds.map(id=>state.openOrders.find(o=>Number(o.id)===id)).filter(Boolean),status))return;
  bulkStatusBusy = boardSaving = true;
  const controls = [...bulkStatusDialog.querySelectorAll('button,select')];
  controls.forEach(control => { control.disabled = true; });
  const message = document.getElementById('bulkStatusMessage');
  message.textContent = window.i18n.t('Saving status…');
  try {
    const orders = await api('/api/orders/workflow', { method: 'POST', body: JSON.stringify({ ids: bulkStatusIds, workflow_status: status,confirm_marketplace_dispatch:status==='shipped' }) });
    const updated = new Map(orders.map(order => [Number(order.id), order]));
    state.openOrders = state.openOrders.map(order => updated.get(Number(order.id)) || order).filter(order=>!order.shipped);
    const archived=orders.filter(order=>order.shipped);
    state.boardArchiveOrders=[...archived,...state.boardArchiveOrders.filter(order=>!updated.has(Number(order.id)))];
    state.archiveOrders=[...archived,...state.archiveOrders.filter(order=>!updated.has(Number(order.id)))];
    if(status==='shipped')state.boardShippedCollapsed=false;
    if (status==='shipped'||!window.matchMedia('(max-width: 700px)').matches) state.boardStage = status;
    state.selectedOrderIds.clear();
    bulkStatusDialog.close();
    document.getElementById('boardMessage').textContent = window.workflowDispatchUI.message(orders);
    try { await loadInventory(); if (state.currentPrepBatch) await loadPrepBatches(state.currentPrepBatch.id); }
    catch (error) { document.getElementById('boardMessage').textContent = `Status saved. Could not refresh inventory: ${error.message}`; }
  } catch (error) { message.textContent = window.i18n.t(error.message); }
  finally { bulkStatusBusy = boardSaving = false; controls.forEach(control => { control.disabled = false; }); renderTables(); renderDashboard(); }
});

async function loadOrderHistory(id) {
  const section = document.createElement('section'); section.className = 'order-history';
  document.getElementById('orderDetailsContent').append(section);
  section.textContent = window.i18n.t('Loading history…');
  try {
    const events = await api(`/api/orders/${id}/history`);
    if (document.getElementById('orderDetailsDialog').dataset.detailId !== String(id)) return;
    section.innerHTML = `<h3>${escapeHtml(window.i18n.t('Order history'))}</h3><p>${escapeHtml(window.i18n.t('Latest 200 recorded changes. Older changes may not be available.'))}</p>` +
      (events.length ? `<ol>${events.map(event => `<li><time>${escapeHtml(new Date(event.created_at).toLocaleString(window.i18n.locale))}</time> — <span data-no-translate>${escapeHtml(event.username || '—')}</span><p>${escapeHtml(window.i18n.t(event.action))}</p>${Object.entries(event.changes?.after || {}).map(([key,value])=>`<div><strong>${escapeHtml(window.i18n.t(key))}</strong>: <span data-no-translate>${escapeHtml(event.changes.before?.[key] == null ? '—' : String(event.changes.before[key]))} → ${escapeHtml(String(value))}</span></div>`).join('')}${!event.changes?`<p>${escapeHtml(window.i18n.t('Earlier values were not recorded.'))}</p>`:''}</li>`).join('')}</ol>` : `<p>${escapeHtml(window.i18n.t('No recorded changes.'))}</p>`);
  } catch (_) {
    section.replaceChildren(); const retry = document.createElement('button');
    retry.textContent = window.i18n.t('Could not load history. Retry');
    retry.onclick = () => { section.remove(); loadOrderHistory(id); }; section.append(retry);
  }
}
