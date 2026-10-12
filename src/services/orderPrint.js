'use strict';
const fs = require('fs');
const path = require('path');
const { validateExport, cellValue } = require('./orderExport');
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
function validatePrint(body) {
  const selection = validateExport({ ...body, format: 'csv' });
  if (!['cards', 'table'].includes(body?.view)) { const error = new Error('Choose cards or table for printing.'); error.statusCode = 400; throw error; }
  const timezone = body.timezone || 'Europe/Bratislava';
  try { if (typeof timezone !== 'string' || timezone.length > 100) throw new Error(); new Intl.DateTimeFormat('en', { timeZone: timezone }); }
  catch (_) { const error = new Error('Invalid time zone.'); error.statusCode = 400; throw error; }
  return { ...selection, view: body.view, timezone };
}
function printOrders(orders, options, branding, now = new Date()) {
  const { language, view, timezone } = options;
  const sk = language === 'sk';
  const t = (en, slovak) => sk ? slovak : en;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year:'numeric', month:'2-digit', day:'2-digit' }).format(now);
  const value = (order, key) => escape(cellValue(order, key, language));
  const deadline = order => {
    const date = cellValue(order, 'ship_by_date', language);
    return `<span class="${order.shipped ? '' : date && date < today ? 'overdue' : date === today ? 'today' : ''}">${escape(date || '—')}</span>`;
  };
  const stage = order => `${value(order, 'workflow_label')}${order.shipped ? ' · ' + t('Archived','Archivovaná') : ''}`;
  const headings = [t('Order / channel','Objednávka / kanál'), t('Status / ship by','Stav / odoslať do'), t('Products / SKUs','Produkty / SKU'), t('Shipping address','Dodacia adresa'), t('Tracking number','Sledovacie číslo'), t('Note','Poznámka')];
  const logo = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(branding.logo || '') ? branding.logo : 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '../public/icon-192.png')).toString('base64');
  const content = view === 'table' ? `<table><thead><tr>${headings.map(label => `<th>${label}</th>`).join('')}</tr></thead><tbody>${orders.map(order => `<tr><td><strong>${value(order,'external_order_id')}</strong><br>${value(order,'vendor')}</td><td>${stage(order)}<br>${deadline(order)}</td><td>${value(order,'skus')}</td><td>${value(order,'address')}</td><td>${value(order,'tracking_code')}</td><td>${value(order,'note')}</td></tr>`).join('')}</tbody></table>` : `<main class="cards">${orders.map(order => `<article><div class="card-heading"><strong>${value(order,'external_order_id')}</strong><span>${value(order,'vendor')}</span></div><p class="status">${stage(order)}</p><dl><dt>${headings[2]}</dt><dd>${value(order,'skus') || '—'}</dd><dt>${t('Ship by','Odoslať do')}</dt><dd>${deadline(order)}</dd><dt>${headings[3]}</dt><dd>${value(order,'address') || '—'}</dd>${order.tracking_code ? `<dt>${headings[4]}</dt><dd>${value(order,'tracking_code')}</dd>` : ''}${order.note ? `<dt>${headings[5]}</dt><dd>${value(order,'note')}</dd>` : ''}</dl></article>`).join('')}</main>`;
  return `<!doctype html><html lang="${sk ? 'sk' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${escape(branding.name)} — ${t('Orders','Objednávky')}</title><style>
@page{size:A4 ${view === 'table' ? 'landscape' : 'portrait'};margin:12mm}*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#172b32;margin:24px}header{display:flex;gap:12px;align-items:center;margin-bottom:18px}header img{width:40px;height:40px;object-fit:contain}h1{font-size:18px;margin:0 0 5px}header p{margin:0;color:#53656c}.hint{background:#eef6f6;padding:12px;margin-bottom:18px}.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:start}article{border:1px solid #b4c4ca;border-radius:6px;padding:12px;break-inside:avoid}.card-heading{display:flex;justify-content:space-between;gap:8px}.card-heading strong{font-size:16px}.status{font-size:11px;color:#53656c}dl{margin:0}dt{font-weight:bold;font-size:10px;color:#53656c;margin-top:10px}dd{margin:3px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:10px}th,td{border:1px solid #b4c4ca;padding:7px;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#eef6f6}th:nth-child(1){width:12%}th:nth-child(2){width:16%}th:nth-child(3){width:20%}th:nth-child(4){width:24%}th:nth-child(5){width:13%}th:nth-child(6){width:15%}thead{display:table-header-group}tr{break-inside:avoid}.today{color:#c56b00;font-weight:bold}.overdue{color:#bb2222;font-weight:bold}@media(max-width:600px){.cards{grid-template-columns:1fr}body{margin:12px}table{min-width:850px}}@media print{body{margin:0}.hint{display:none}.cards{grid-template-columns:repeat(2,minmax(0,1fr))}body,th{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
</style></head><body><header><img alt="" src="${escape(logo)}"><div><h1>${escape(branding.name)}</h1><p>${t('Selected orders','Vybrané objednávky')}: ${orders.length} · ${escape(new Intl.DateTimeFormat(sk ? 'sk-SK' : 'en-GB', { timeZone: timezone, dateStyle:'medium', timeStyle:'short' }).format(now))}</p></div></header><p class="hint">${t('Use your browser’s Print command to print or choose Save as PDF.','Použite tlač v prehliadači na vytlačenie alebo vyberte Uložiť ako PDF.')}</p>${content}</body></html>`;
}
module.exports = { validatePrint, printOrders };
