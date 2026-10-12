(function (root) {
function matchesSku(sku, pattern) {
  const expression = pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + expression + '$', 'i').test(String(sku || '').trim());
}
function countPins(items, orders) {
  return items.map(item => {
    let count = 0;
    for (const order of orders) {
      if (order.shipped || ['crafted', 'ready_for_pickup', 'shipped'].includes(order.workflow_status)) continue;
      if (item.preparedColor && (order.prepared_gobbis || []).includes(item.preparedColor)) continue;
      const displayedLines = String(order.skus || '').split(/\n|,| \+ /).map(text => {
        const match = text.trim().match(/^(.*?)\s+[x×]\s*(\d+)$/i);
        return { sku: match ? match[1] : text.trim(), quantity: match ? Number(match[2]) : 1 };
      });
      const rawLines = Array.isArray(order.raw_skus) ? order.raw_skus : [];
      const total = lines => lines.reduce((sum, line) => {
        const sku = typeof line === 'string' ? line : line?.sku;
        const quantity = typeof line === 'string' ? 1 : Number(line?.quantity);
        return sum + (item.skus.some(pattern => matchesSku(sku, pattern)) ? (Number.isFinite(quantity) && quantity > 0 ? quantity : 1) : 0);
      }, 0);
      // Raw and mapped SKU names describe the same items; never add them twice.
      count += order.skus_locked ? total(displayedLines) : Math.max(total(rawLines), total(displayedLines));
    }
    return { ...item, count };
  });
}
const helpers = { matchesSku, countPins };
if (typeof module === 'object' && module.exports) module.exports = helpers;
else root.dashboardPinHelpers = helpers;
})(typeof window === 'object' ? window : globalThis);
