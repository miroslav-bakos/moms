require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { upsertProduct, refreshOrderSkuMappings } = require('../src/services/products');
const { upsertOrder, updateOrderFlags } = require('../src/services/orders');
const { closePool, query } = require('../src/db');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted && char === '"' && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (!quoted && char === ',') {
      row.push(cell);
      cell = '';
      continue;
    }

    if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some((value) => String(value || '').trim())) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((value) => String(value || '').trim())) rows.push(row);
  return rows;
}

function parseSheetDate(value) {
  const text = String(value || '').trim();
  let match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (match) {
    return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 12));
  }

  match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function checkbox(value) {
  return String(value || '').trim().toUpperCase() === 'TRUE';
}

function channelFromVendor(vendor) {
  const text = String(vendor || '').toLowerCase();
  if (text.includes('etsy')) return 'etsy';
  if (text.includes('shopify')) return 'shopify';
  if (text.includes('amazon')) return 'amazon';
  if (text.includes('ebay')) return 'ebay';
  return 'other';
}

function extractHyperlink(value) {
  const text = String(value || '').trim();
  const match = text.match(/HYPERLINK\("([^"]+)"/i) || text.match(/https?:\/\/[^\s")]+/i);
  return match ? match[1] || match[0] : text;
}

async function importProducts(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  let count = 0;

  for (const row of rows) {
    const sku = String(row[0] || '').trim();
    const displayName = String(row[1] || '').trim();
    if (!sku || !displayName || /^sku$/i.test(sku)) continue;
    await upsertProduct(sku, displayName);
    count += 1;
  }

  const refreshed = await refreshOrderSkuMappings();
  console.log(`Imported ${count} product mapping(s). Refreshed ${refreshed} order row(s).`);
}

async function importOrders(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  let count = 0;

  for (const row of rows) {
    const vendor = String(row[0] || '').trim();
    const orderId = String(row[1] || '').trim();
    if (!vendor || !orderId || /^vendor$/i.test(vendor)) continue;

    const inserted = await upsertOrder({
      channel: channelFromVendor(vendor),
      vendor,
      externalOrderId: orderId,
      orderName: orderId,
      skus: String(row[2] || '').trim() || 'Unknown SKU',
      rawSkus: [],
      createdAt: parseSheetDate(row[3]),
      shipByDate: parseSheetDate(row[4]),
      address: row[5] || '',
      note: row[13] || '',
      isGift: checkbox(row[14]),
      giftMessage: row[15] || '',
      trackingCode: row[10] || '',
      trackingUrl: extractHyperlink(row[11]),
      orderUrl: extractHyperlink(row[12]),
      sourcePayload: { importedFromCsv: path.basename(file) }
    });

    await updateOrderFlags(inserted.id, {
      processed: checkbox(row[6]),
      packed: checkbox(row[7]),
      shipped: checkbox(row[8]),
      label_created: checkbox(row[8]) || checkbox(row[9])
    });
    count += 1;
  }

  console.log(`Imported ${count} order row(s).`);
}

async function main() {
  const [, , type, file] = process.argv;
  if (!type || !file) {
    throw new Error('Usage: node scripts/import-csv.js <products|orders> <file.csv>');
  }

  if (type === 'products') {
    await importProducts(file);
  } else if (type === 'orders') {
    await importOrders(file);
  } else {
    throw new Error(`Unknown import type: ${type}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
