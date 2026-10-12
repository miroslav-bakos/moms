const ExcelJS = require('exceljs');
const columns = [
  ['external_order_id', 'Order number', 'Číslo objednávky', 24],
  ['vendor', 'Sales channel', 'Predajný kanál', 18],
  ['workflow_label', 'Board status', 'Stav na boarde', 22],
  ['shipped', 'Archived', 'Archivovaná', 14],
  ['address', 'Shipping address', 'Dodacia adresa', 42],
  ['skus', 'Products / SKUs', 'Produkty / SKU', 36],
  ['ship_by_date', 'Ship by', 'Odoslať do', 16],
  ['tracking_code', 'Tracking number', 'Sledovacie číslo', 28],
  ['tracking_url', 'Tracking URL', 'Odkaz na sledovanie', 42],
  ['note', 'Note', 'Poznámka', 42],
  ['source_order_id', 'Source order ID', 'Zdrojové ID objednávky', 28],
  ['business_outcome', 'Business outcome', 'Výsledok objednávky', 18]
];
function validateExport(body) {
  const { orderIds, format, language } = body || {};
  if (!Array.isArray(orderIds) || !orderIds.length || orderIds.length > 5000 || orderIds.some(id => !Number.isSafeInteger(id) || id <= 0) || !['csv', 'xlsx'].includes(format)) {
    const error = new Error('Select 1–5000 orders and a valid export format.'); error.statusCode = 400; throw error;
  }
  return { orderIds: [...new Set(orderIds)], format, language: language === 'sk' ? 'sk' : 'en' };
}
function cellValue(order, key, language) {
  if (key === 'source_order_id') return String(order.external_order_id || order.id);
  if (key === 'shipped') return order.shipped ? (language === 'sk' ? 'Áno' : 'Yes') : (language === 'sk' ? 'Nie' : 'No');
  if (key === 'external_order_id') {
    if (String(order.channel || '').toLowerCase() === 'shopify') return String(order.source_payload?.order_number || order.order_name || order.external_order_id || order.id).replace(/^#/, '');
    return String(order.external_order_id || order.id);
  }
  if (key === 'workflow_label') {
    const defaults = { new: ['NEW','NOVÉ'], in_progress: ['IN PROGRESS','VO VÝROBE'], crafted: ['CRAFTED','VYROBENÉ'], ready_for_pickup: ['READY FOR PICKUP','PRIPRAVENÉ NA VYZDVIHNUTIE'], shipped: ['SHIPPED','ODOSLANÉ'] };
    const stage = defaults[order.workflow_status];
    const label = String(order.workflow_label || stage?.[0] || order.workflow_status || '');
    return language === 'sk' && stage && label === stage[0] ? stage[1] : label;
  }
  if (key === 'business_outcome') return language === 'sk' ? ({active:'Aktívna',canceled:'Stornovaná',refunded:'Refundovaná',returned:'Vrátená'})[order.business_outcome || 'active'] : order.business_outcome || 'active';
  if (key === 'ship_by_date') return order.ship_by_date ? new Date(order.ship_by_date).toISOString().slice(0, 10) : '';
  return String(order[key] || '');
}
function csvCell(value) {
  // Spreadsheets must treat customer-entered values as text, never formulas.
  const safe = /^[\s]*[=+\-@\t\r]/.test(value) ? "'" + value : value;
  return '"' + safe.replace(/"/g, '""') + '"';
}
async function exportOrders(orders, format, language) {
  const headers = columns.map(column => column[language === 'sk' ? 2 : 1]);
  const rows = orders.map(order => columns.map(([key]) => cellValue(order, key, language)));
  if (format === 'csv') return Buffer.from('\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(language === 'sk' ? 'Objednávky' : 'Orders', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map((column, index) => ({ header: headers[index], key: column[0], width: column[3] }));
  rows.forEach(row => sheet.addRow(row));
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  sheet.eachRow(row => { row.alignment = { vertical: 'top', wrapText: true }; });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
module.exports = { validateExport, exportOrders, cellValue };
