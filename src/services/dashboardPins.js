const { query } = require('../db');
function validatePins(items) {
  const fail = message => { const error = new Error(message); error.statusCode = 400; throw error; };
  if (!Array.isArray(items) || items.length > 50) fail('Maximum 50 dashboard items.');
  return items.map(item => {
    if (!item || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80) fail('Enter an item name (1–80 characters).');
    if (!Array.isArray(item.skus) || !item.skus.length || item.skus.length > 30 || item.skus.some(sku => typeof sku !== 'string' || !sku.trim() || sku.length > 100 || /^[*]+$/.test(sku.trim()))) fail('Enter valid SKUs (maximum 30 per item).');
    const preparedColor = ['green', 'blue', 'orange', 'pink', 'grey', 'purple'].includes(item.preparedColor) ? item.preparedColor : null;
    return { name: item.name.trim(), skus: [...new Set(item.skus.map(sku => sku.trim()))], preparedColor };
  });
}
const { matchesSku, countPins } = require('../public/dashboard-pins');
async function listPins() {
  const result = await query('SELECT items FROM dashboard_pins WHERE id = true');
  return result.rows[0]?.items || [];
}
async function savePins(items) {
  const validated = validatePins(items);
  await query('UPDATE dashboard_pins SET items = $1::jsonb WHERE id = true', [JSON.stringify(validated)]);
  return validated;
}
async function dashboardPinCounts() {
  const [items, orders] = await Promise.all([listPins(), query("SELECT skus, skus_locked, raw_skus, workflow_status, prepared_gobbis, shipped FROM orders WHERE shipped = false AND workflow_status NOT IN ('crafted', 'ready_for_pickup', 'shipped')")]);
  return countPins(items, orders.rows);
}
module.exports = { listPins, savePins, dashboardPinCounts, validatePins, matchesSku, countPins };
