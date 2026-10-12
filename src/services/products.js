const { query } = require('../db');

function normalizeSkuKey(value) {
  return String(value || '').trim().toUpperCase();
}

function cleanSkuValue(value) {
  let text = String(value || '').replace(/\r?\n/g, ' ').trim();
  let quantitySuffix = '';
  const quantityMatch = text.match(/\s+(x\d+)$/i);

  text = text.replace(/^\s*(?:(?:Seller|Variant|Product)\s+)?SKU\b\s*:?\s*/i, '');
  text = text.replace(/\s+(?:Quantity|Qty|ASIN|Title|Item|Price|Condition)\b.*$/i, '');
  text = text.replace(/[;,]+$/g, '').trim();

  if (quantityMatch) {
    quantitySuffix = ` ${quantityMatch[1].toLowerCase()}`;
    text = text.replace(/\s+x\d+$/i, '').trim();
  }

  const skuMatch = text.match(/[A-Za-z0-9][A-Za-z0-9._+\s-]*/);
  text = skuMatch ? skuMatch[0].trim() : text;

  return { sku: text, quantitySuffix };
}

async function getProductMap() {
  const result = await query('SELECT sku, display_name FROM products');
  const map = {};

  for (const row of result.rows) {
    map[normalizeSkuKey(row.sku)] = row.display_name;
  }

  return map;
}

function resolveSkuTextFromMap(rawItems, productMap) {
  const parts = [];

  for (const item of rawItems || []) {
    const rawSku = typeof item === 'string' ? item : item.sku;
    const quantity = typeof item === 'string' ? 1 : Number(item.quantity || 1);
    const variations = (typeof item === 'object' && Array.isArray(item.variations)) ? item.variations : [];
    const cleaned = cleanSkuValue(rawSku);
    const key = normalizeSkuKey(cleaned.sku);
    if (!key) continue;

    const name = productMap[key] || cleaned.sku;
    const suffix = quantity > 1 ? ` x${quantity}` : cleaned.quantitySuffix;
    parts.push(`${name}${suffix}`);

    for (const variation of variations) {
      const variationKey = normalizeSkuKey(variation);
      if (variationKey && productMap[variationKey]) {
        parts.push(productMap[variationKey]);
      }
    }
  }

  return parts.length ? parts.join(' + ') : 'Unknown SKU';
}

async function resolveSkuText(rawItems) {
  return resolveSkuTextFromMap(rawItems, await getProductMap());
}

async function listProducts() {
  const result = await query(
    `SELECT sku, display_name, metadata, updated_at
     FROM products
     ORDER BY sku`
  );
  return result.rows;
}

async function upsertProduct(sku, displayName, metadata = {}) {
  const normalizedSku = String(sku || '').trim();
  const normalizedDisplayName = String(displayName || '').trim();
  if (!normalizedSku || !normalizedDisplayName) {
    throw new Error('SKU and display name are required.');
  }

  const result = await query(
    `INSERT INTO products (sku, display_name, metadata, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (sku) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       metadata = EXCLUDED.metadata,
       updated_at = now()
     RETURNING sku, display_name, metadata, updated_at`,
    [normalizedSku, normalizedDisplayName, JSON.stringify(metadata || {})]
  );
  return result.rows[0];
}

async function saveProduct(originalSku, sku, displayName, metadata = {}) {
  const normalizedOriginalSku = String(originalSku || '').trim();
  const product = await upsertProduct(sku, displayName, metadata);

  if (normalizedOriginalSku && normalizedOriginalSku !== product.sku) {
    await query('DELETE FROM products WHERE sku = $1', [normalizedOriginalSku]);
  }

  return product;
}

async function deleteProduct(sku) {
  const result = await query('DELETE FROM products WHERE sku = $1', [String(sku || '').trim()]);
  return result.rowCount;
}

async function refreshOrderSkuMappings() {
  const productMap = await getProductMap();
  const result = await query(
    `SELECT id, raw_skus
     FROM orders
     WHERE jsonb_array_length(raw_skus) > 0 AND NOT skus_locked`
  );
  let updated = 0;

  for (const row of result.rows) {
    const skus = resolveSkuTextFromMap(row.raw_skus, productMap);
    const update = await query(
      `UPDATE orders
       SET skus = $1, updated_at = now()
       WHERE id = $2 AND skus IS DISTINCT FROM $1`,
      [skus, row.id]
    );
    updated += update.rowCount;
  }

  return updated;
}

module.exports = {
  normalizeSkuKey,
  cleanSkuValue,
  getProductMap,
  resolveSkuText,
  resolveSkuTextFromMap,
  listProducts,
  upsertProduct,
  saveProduct,
  deleteProduct,
  refreshOrderSkuMappings
};
