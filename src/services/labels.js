'use strict';

const crypto = require('crypto');
const fs = require('fs').promises;
const nodePath = require('path');
const { config } = require('../config');
const { query } = require('../db');
const operations=require('./labelOperations');

const LABELS_DIR = require('../paths').getPaths().labelsDir;

const EU_COUNTRIES = new Set(['AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR','HR','HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK']);

const COUNTRY_NAME_MAP = {
  SLOVAKIA: 'SK', 'SLOVAK REPUBLIC': 'SK', SLOVENSKO: 'SK',
  CZECHIA: 'CZ', 'CZECH REPUBLIC': 'CZ', ČESKO: 'CZ',
  GERMANY: 'DE', DEUTSCHLAND: 'DE',
  AUSTRIA: 'AT', ÖSTERREICH: 'AT',
  HUNGARY: 'HU', MAGYARORSZÁG: 'HU',
  POLAND: 'PL', POLSKA: 'PL',
  FRANCE: 'FR', ITALY: 'IT', SPAIN: 'ES',
  NETHERLANDS: 'NL', 'THE NETHERLANDS': 'NL', HOLLAND: 'NL', BELGIUM: 'BE', IRELAND: 'IE',
  PORTUGAL: 'PT', DENMARK: 'DK', SWEDEN: 'SE', FINLAND: 'FI',
  ESTONIA: 'EE', LATVIA: 'LV', LITHUANIA: 'LT',
  SLOVENIA: 'SI', CROATIA: 'HR', ROMANIA: 'RO', BULGARIA: 'BG',
  GREECE: 'GR', CYPRUS: 'CY', MALTA: 'MT', LUXEMBOURG: 'LU',
  USA: 'US', 'U.S.A.': 'US', 'UNITED STATES': 'US', 'UNITED STATES OF AMERICA': 'US',
  UK: 'GB', 'UNITED KINGDOM': 'GB', 'GREAT BRITAIN': 'GB',
  ENGLAND: 'GB', SCOTLAND: 'GB', WALES: 'GB', 'NORTHERN IRELAND': 'GB',
  CANADA: 'CA', AUSTRALIA: 'AU', SWITZERLAND: 'CH', NORWAY: 'NO',
  THAILAND: 'TH',
  'UNITED ARAB EMIRATES': 'AE', UAE: 'AE', MONACO: 'MC',
  REUNION: 'RE', RÉUNION: 'RE', 'LA REUNION': 'RE',
  GUADELOUPE: 'GP', MARTINIQUE: 'MQ', MAYOTTE: 'YT',
  'FRENCH GUIANA': 'GF', GUYANE: 'GF', 'GUYANE FRANÇAISE': 'GF',
  'NEW CALEDONIA': 'NC', 'NOUVELLE-CALÉDONIE': 'NC',
  'FRENCH POLYNESIA': 'PF', 'POLYNÉSIE FRANÇAISE': 'PF',
  'WALLIS AND FUTUNA': 'WF', 'WALLIS AND FUTUNA ISLANDS': 'WF',
  'SAINT PIERRE AND MIQUELON': 'PM',
  'SAINT BARTHELEMY': 'BL', 'SAINT BARTHÉLEMY': 'BL',
  'SAINT MARTIN': 'MF'
};

const STATE_MAP = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR',
  CALIFORNIA: 'CA', COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE',
  'DISTRICT OF COLUMBIA': 'DC', FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI',
  IDAHO: 'ID', ILLINOIS: 'IL', INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS',
  KENTUCKY: 'KY', LOUISIANA: 'LA', MAINE: 'ME', MARYLAND: 'MD',
  MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN', MISSISSIPPI: 'MS',
  MISSOURI: 'MO', MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV',
  'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK',
  OREGON: 'OR', PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT',
  VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV',
  WISCONSIN: 'WI', WYOMING: 'WY'
};

// ── Address parsing (ported from ShippingService.gs) ──────────────────────────

function toCountryIso(value) {
  const norm = String(value || '').trim().toUpperCase();
  return COUNTRY_NAME_MAP[norm] || (/^[A-Z]{2}$/.test(norm) ? norm : '');
}

function toStateCode(value) {
  const norm = String(value || '').replace(/[.,]+$/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(norm) ? norm : (STATE_MAP[norm] || '');
}

function looksLikePostalCode(value) {
  const c = String(value || '').replace(/[\s-]/g, '').toUpperCase();
  return /^\d{4,10}$/.test(c) || /^[A-Z]{1,2}\d{4,6}$/.test(c) ||
    /^\d{4}[A-Z]{2}$/.test(c) || /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(c) ||
    /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(c);
}

function normalizePostalCode(value) {
  return String(value || '').replace(/^[A-Z]{2}\s*-\s*/i, '').replace(/\s+/g, ' ').trim();
}

function extractLabeledValue(value) {
  const parts = String(value || '').trim().split(/\s*:\s*/, 2);
  return parts.length === 2 ? parts[1] : parts[0];
}

function looksLikeEmailLine(value) { return /@/.test(extractLabeledValue(value)); }

function looksLikePhoneLine(value) {
  const s = extractLabeledValue(value).replace(/\s+/g, ' ').trim();
  return s.replace(/[^\d]/g, '').length >= 7 && /^[\d\s()+\-/]+$/.test(s);
}

function isIgnorableLine(value) {
  const s = String(value || '').trim().toLowerCase();
  return /^address\s*type\s*:/.test(s) || /^contact\s*buyer\s*:/.test(s) || /^buyer\s*:/.test(s);
}

function looksLikeHouseNumber(value) {
  return /^\d+[A-Za-z]?(?:[\/-][A-Za-z0-9]+)?$/.test(String(value || '').trim());
}

function splitInlineUnitInfo(value) {
  const m = String(value || '').trim().match(/^(.+?)\s+((?:app\.|apt\.|apartment\b|unit\b|flat\b|suite\b|ste\.|building\b|bldg\.|floor\b|fl\.|door\b|villa\b).*)$/i);
  return m ? { street: m[1].trim(), info: m[2].trim() } : { street: String(value || '').trim(), info: '' };
}

function parseStreetLine(streetLine) {
  const line = String(streetLine || '').replace(/\s+/g, ' ').trim();
  if (!line) return { street: '', houseNumber: '', houseNumberInfo: '' };

  const sections = line.split(/\s*,\s*/).filter(Boolean);
  let primaryLine;

  if (sections.length > 1 && looksLikeHouseNumber(sections[0]) && /[A-Za-z]/.test(sections[1])) {
    primaryLine = sections.shift() + ' ' + sections.shift();
  } else if (sections.length > 1 && /[A-Za-z]/.test(sections[0]) && looksLikeHouseNumber(sections[1])) {
    primaryLine = sections.shift() + ' ' + sections.shift();
  } else {
    primaryLine = sections.shift() || '';
  }

  const infoParts = sections;
  const si = splitInlineUnitInfo(primaryLine);
  primaryLine = si.street;
  if (si.info) infoParts.unshift(si.info);

  let houseNumber = '';
  let m = primaryLine.match(/^(\d+[A-Za-z]?(?:[\/-][A-Za-z0-9]+)?)\s+(.+)$/);
  if (m) {
    houseNumber = m[1];
    primaryLine = m[2].trim();
  } else {
    m = primaryLine.match(/^(.*?)[,\s]+(\d+[A-Za-z]?(?:[\/-][A-Za-z0-9]+)?)$/);
    if (m) { primaryLine = m[1].trim(); houseNumber = m[2]; }
  }

  let houseNumberInfo = '';
  if (houseNumber.includes('/')) {
    houseNumberInfo = houseNumber.substring(houseNumber.indexOf('/'));
    houseNumber = houseNumber.substring(0, houseNumber.indexOf('/'));
  }
  if (houseNumberInfo) infoParts.unshift(houseNumberInfo);

  return { street: primaryLine, houseNumber, houseNumberInfo: infoParts.join(', ') };
}

function parseCityZipLine(line) {
  const s = String(line || '').replace(/[;,]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return { city: '', zipCode: '', stateCode: '' };

  let m = s.match(/^(.+?)(?:,\s*|\s+)([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
  if (m) return { city: m[1].trim(), zipCode: m[3].trim(), stateCode: m[2].toUpperCase() };

  m = s.match(/^(.+?)(?:,\s*|\s+)([A-Za-z][A-Za-z .'-]+)\s+(\d{5}(?:-\d{4})?)$/);
  if (m && toStateCode(m[2])) return { city: m[1].trim(), zipCode: m[3].trim(), stateCode: toStateCode(m[2]) };

  m = s.match(/^(\d{4,10})\s+(.+?)\s+([A-Z]{2,3})$/);
  if (m && looksLikePostalCode(m[1]) && /[A-Za-z]/.test(m[2])) return { zipCode: normalizePostalCode(m[1]), city: m[2].trim(), stateCode: m[3] };

  const words = s.split(' ');
  for (let wc = Math.min(2, words.length - 1); wc >= 1; wc--) {
    const zipCandidate = words.slice(0, wc).join(' ');
    const city = words.slice(wc).join(' ');
    if (looksLikePostalCode(zipCandidate) && city && /[A-Za-z]/.test(city)) {
      return { zipCode: zipCandidate, city, stateCode: '' };
    }
  }

  m = s.match(/^(.+?)\s+([A-Z]{0,2}[- ]?\d[\dA-Z -]{2,10})$/i);
  if (m && looksLikePostalCode(m[2]) && /[A-Za-z]/.test(m[1])) return { city: m[1].trim(), zipCode: m[2].trim(), stateCode: '' };

  if (looksLikePostalCode(s)) return { city: '', zipCode: normalizePostalCode(s), stateCode: '' };
  return { city: s, zipCode: '', stateCode: '' };
}

function cleanCityLine(cityLine, stateLine) {
  let city = String(cityLine || '').replace(/[;,]+/g, ' ').replace(/\s+/g, ' ').trim();
  const state = String(stateLine || '').trim();
  if (state && !toStateCode(state) && city.toUpperCase() === state.toUpperCase()) return '';
  return city.replace(/\s+[A-Z]{2,3}$/, '').replace(/,+$/, '').trim();
}

function extractCityZipFromLines(lines) {
  const working = [...lines];

  for (let i = working.length - 1; i >= Math.max(0, working.length - 3); i--) {
    const p = parseCityZipLine(working[i]);
    if (p.zipCode && p.city) { working.splice(i, 1); return { ...p, streetLines: working }; }
  }

  if (working.length && looksLikePostalCode(working[working.length - 1])) {
    const zipLine = working.pop();
    let stateLine = '', stateCode = '';
    if (working.length) {
      const candidate = String(working[working.length - 1] || '').trim();
      if (/^[A-Z]{2,3}$/i.test(candidate) || toStateCode(candidate)) {
        stateLine = working.pop();
        stateCode = toStateCode(stateLine) || stateLine.trim().toUpperCase();
      }
    }
    const cityLine = working.length ? working.pop() : '';
    return { city: cleanCityLine(cityLine, stateLine), zipCode: normalizePostalCode(zipLine), stateCode, streetLines: working };
  }

  if (working.length >= 2) {
    const a = working[working.length - 2];
    const b = working[working.length - 1];
    const bNorm = String(b || '').replace(/\s+/g, ' ').trim();
    let p = null;
    if (looksLikePostalCode(bNorm)) p = { city: cleanCityLine(a), zipCode: normalizePostalCode(bNorm), stateCode: '' };
    else if (looksLikePostalCode(a)) p = { city: cleanCityLine(b), zipCode: normalizePostalCode(a), stateCode: '' };
    if (p && p.zipCode && p.city) { working.splice(working.length - 2, 2); return { ...p, streetLines: working }; }
  }

  if (working.length) {
    const cityLine = working.pop();
    return { city: cleanCityLine(cityLine), zipCode: '', stateCode: '', streetLines: working };
  }

  return { city: '', zipCode: '', stateCode: '', streetLines: working };
}

function parseRecipientAddress(addressText) {
  let lines = String(addressText || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 1 && lines[0].includes(',')) {
    lines = lines[0].split(/\s*,\s*/).map((l) => l.trim()).filter(Boolean);
  }
  if (!lines.length) return {};

  let email = '', phone = '';
  let countryIso = config.shipping.gls.defaultCountryIso || 'SK';

  for (let i = lines.length - 1; i >= 0; i--) {
    if (!email && looksLikeEmailLine(lines[i])) { email = extractLabeledValue(lines.splice(i, 1)[0]).trim(); continue; }
    if (!phone && looksLikePhoneLine(lines[i])) { phone = extractLabeledValue(lines.splice(i, 1)[0]).trim(); continue; }
    if (isIgnorableLine(lines[i])) lines.splice(i, 1);
  }

  if (!lines.length) return {};

  for (let i = lines.length - 1; i >= 0; i--) {
    const iso = toCountryIso(lines[i]);
    if (iso || /^[A-Z]{2}$/.test(String(lines[i] || '').trim())) {
      countryIso = iso || String(lines[i] || '').trim().toUpperCase();
      lines.splice(i, 1);
      break;
    }
  }

  const name = lines.shift() || '';
  const loc = extractCityZipFromLines(lines);
  const sp = parseStreetLine(loc.streetLines.join(', '));
  if (!sp.street && loc.streetLines.length) sp.street = loc.streetLines.join(', ');

  return {
    Name: name, ContactName: name, ContactEmail: email, ContactPhone: phone,
    Street: sp.street, HouseNumber: sp.houseNumber, HouseNumberInfo: sp.houseNumberInfo,
    City: loc.city, ZipCode: loc.zipCode, StateCode: loc.stateCode || '', CountryIsoCode: countryIso
  };
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

function limitText(value, max) {
  return String(value || '').trim().substring(0, max);
}

function resolveProductText(skuText, productMap) {
  const text = String(skuText || '').trim();
  if (!text || !productMap) return text;
  return text.split(/\s+\+\s+/).map((part) => {
    const clean = part.trim();
    return productMap[clean] || clean;
  }).join(' + ');
}

// Manual per-order weight override; accepts both "0.5" and "0,5".
function parseWeightKg(value) {
  const num = Number(String(value == null ? '' : value).trim().replace(',', '.'));
  return Number.isFinite(num) && num > 0 ? num : null;
}

function dateStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
}

async function getProductMap() {
  const res = await query('SELECT sku, display_name FROM products');
  const map = {};
  for (const row of res.rows) { if (row.sku) map[row.sku] = row.display_name || row.sku; }
  return map;
}

async function getOrdersByIds(ids) {
  if (!ids || !ids.length) return [];
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  const res = await query(`SELECT * FROM orders WHERE id IN (${placeholders})`, ids);
  return res.rows;
}

async function saveLabelFile(fileName, pdfBytes) {
  try {
    await fs.mkdir(LABELS_DIR, { recursive: true });
    await fs.writeFile(nodePath.join(LABELS_DIR, fileName), pdfBytes);
    return `/labels/${fileName}`;
  } catch {
    throw new Error('Could not save the generated label.');
  }
}

// ── GLS ───────────────────────────────────────────────────────────────────────

function glsPickupAddress() {
  const p = config.shipping.gls.pickupAddress;
  return {
    Name: p.name, ContactName: p.contactName || p.name,
    ContactPhone: p.contactPhone || '', ContactEmail: p.contactEmail || '',
    Street: p.street, HouseNumber: p.houseNumber || '', HouseNumberInfo: p.houseNumberInfo || '',
    City: p.city, ZipCode: p.zipCode, CountryIsoCode: p.countryIsoCode || 'SK'
  };
}

async function callGlsApi(shipments) {
  const gls = config.shipping.gls;
  const url = gls.apiUrl.replace(/\/$/, '') + '/ParcelService.svc/json/PrintLabels';
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const passwordHash = Array.from(crypto.createHash('sha512').update(gls.password, 'utf8').digest());

  const payload = {
    Username: gls.username,
    Password: passwordHash,
    ParcelList: shipments.map((s) => ({
      ClientNumber: String(gls.clientNumber),
      CODAmount: 0, CODReference: '',
      Content: s.parcelText, Count: 1,
      DeliveryAddress: s.recipient,
      PickupAddress: glsPickupAddress(),
      PickupDate: `/Date(${midnight.getTime()})/`,
      ServiceList: []
    })),
    PrintPosition: 1, ShowPrintDialog: 0
  };

  const res = await fetch(url, {
    method: 'POST', signal:AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload)
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`GLS API error ${res.status}: ${body}`);

  const data = JSON.parse(body);
  const errors = data.PrintLabelsErrorList || data.printLabelsErrorList || [];
  if (errors.length) {
    throw new Error('GLS: ' + errors.map((e) => e.ErrorDescription || e.errorDescription || e.ErrorCode || JSON.stringify(e)).join('; '));
  }
  if (!data.Labels) throw new Error('GLS response missing label PDF data.');

  const pdfBytes = Array.isArray(data.Labels)
    ? Buffer.from(data.Labels.map((v) => (v < 0 ? v + 256 : v)))
    : Buffer.from(data.Labels, 'base64');

  const infoList = data.PrintLabelsInfoList || data.printLabelsInfoList || [];
  const trackingNumbers = shipments.map((_, i) =>
    String((infoList[i] && (infoList[i].ParcelNumber || infoList[i].parcelNumber)) || '')
  );

  return { pdfBytes, trackingNumbers };
}

async function createGlsLabels(orders, productMap, replacements) {
  const shipments = [];
  const failed = [];

  for (const order of orders) {
    try {
      const skuText = String(order.skus || '');
      const productText = resolveProductText(skuText, productMap);
      const recipient = parseRecipientAddress(String(order.address || ''));
      if (!recipient.Name || !recipient.City || !recipient.ZipCode) throw new Error('Could not parse recipient address.');
      shipments.push({
        orderId: order.id,
        externalOrderId: String(order.external_order_id || ''),
        parcelText: limitText(productText || skuText || order.external_order_id, 100),
        recipient
      });
    } catch (err) {
      failed.push({ orderId: order.id, externalOrderId: String(order.external_order_id || ''), success: false, error: err.message });
    }
  }

  if (!shipments.length) return { downloads: [], results: failed };

  const downloads = new Map();
  const results = [...failed];
  const pending = [];
  const addOutcome = outcome => {
    for (const download of outcome.downloads) downloads.set(download.fileName, download);
    results.push(...outcome.results);
  };
  for (const shipment of shipments) {
    try {
      const previous = await operations.acquire(shipment.orderId, 'gls', replacements[shipment.orderId]);
      if (previous) addOutcome(previous);
      else pending.push(shipment);
    } catch (error) {
      results.push({ orderId: shipment.orderId, externalOrderId: shipment.externalOrderId, success: false, error: error.message });
    }
  }
  if (!pending.length) return { downloads: [...downloads.values()], results };

  const failure = 'The carrier request did not finish. Check the carrier portal and contact support before retrying.';
  let pdfBytes, trackingNumbers, fileName, labelUrl;
  try {
    ({ pdfBytes, trackingNumbers } = await callGlsApi(pending));
    for (const [index, shipment] of pending.entries()) {
      await operations.checkpoint(shipment.orderId, { trackingNumber: trackingNumbers[index] || '' });
    }
    const stamp = dateStamp() + '_' + crypto.randomUUID();
    fileName = pending.length === 1 ? `GLS_Label_${pending[0].orderId}_${stamp}.pdf` : `GLS_Labels_${stamp}.pdf`;
    labelUrl = await saveLabelFile(fileName, pdfBytes);
  } catch (error) {
    for (const shipment of pending) {
      await operations.failed(shipment.orderId);
      results.push({ orderId: shipment.orderId, externalOrderId: shipment.externalOrderId, success: false, error: failure });
    }
    return { downloads: [...downloads.values()], results };
  }

  const download = { pdfBase64: pdfBytes.toString('base64'), fileName };
  for (const [index, shipment] of pending.entries()) {
    const trackingNumber = trackingNumbers[index] || '';
    const trackingUrl = trackingNumber ? `https://gls-group.eu/SK/sk/sledovanie-zasielok/?match=${encodeURIComponent(trackingNumber)}` : '';
    const outcome = { downloads: [download], results: [{ orderId: shipment.orderId, externalOrderId: shipment.externalOrderId, success: true, trackingNumber }] };
    try {
      // Persist each order's result independently; retries share the same batch PDF.
      await operations.prepare(shipment.orderId, outcome, trackingNumber, trackingUrl, labelUrl);
      addOutcome(outcome);
    } catch (error) {
      await operations.failed(shipment.orderId);
      results.push({ orderId: shipment.orderId, externalOrderId: shipment.externalOrderId, success: false, error: failure });
    }
  }
  return { downloads: [...downloads.values()], results };
}

// ── Posta ──────────────────────────────────────────────────────────────────────

const POSTA_TYPE_CONFIGS = {
  registered_letter: {
    parcelCategory: () => config.shipping.posta.registeredLetterCategory || 'r',
    weightKg: () => config.shipping.posta.registeredLetterWeightKg || 0.5,
    customsValueEur: () => config.shipping.posta.registeredLetterCustomsValueEur || 10,
    contentCategory: 'documents', customsCategory: 'documents',
    filePrefix: 'POSTA_Registered_Letter_Label'
  },
  parcel: {
    parcelCategory: () => config.shipping.posta.parcelCategory || 'b',
    weightKg: () => config.shipping.posta.parcelWeightKg || 2.3,
    customsValueEur: () => config.shipping.posta.parcelCustomsValueEur || 34,
    contentCategory: 'goods', customsCategory: 'gift',
    filePrefix: 'POSTA_Parcel_Label'
  }
};

async function postaFetch(method, path, payload) {
  const posta = config.shipping.posta;
  const res = await fetch(posta.baseUrl.replace(/\/+$/, '') + path, {
    method: method.toUpperCase(), signal:AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'x-api-auth': `apikey ${posta.userId}:${posta.apiKey}` },
    body: payload != null ? JSON.stringify(payload) : undefined
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Posta API ${res.status}: ${text}`);
  const data = JSON.parse(text);
  if (data.status === 'validation_failed') {
    const errs = (data.validation_errors || []).map((e) => `${e.attribute}: ${e.error}`).join('; ');
    throw new Error(`Posta validation: ${errs || 'validation_failed'}`);
  }
  return data;
}

function postaRecipient(parsed) {
  const street = [parsed.Street, parsed.HouseNumber, parsed.HouseNumberInfo]
    .filter((p) => String(p || '').trim()).join(' ').replace(/\s+/g, ' ').trim();
  const country = String(parsed.CountryIsoCode || 'SK').toLowerCase();
  let zip = normalizePostalCode(parsed.ZipCode || '');
  if (country === 'us' && parsed.StateCode && !zip.startsWith(parsed.StateCode)) zip = parsed.StateCode + zip;
  return { name: parsed.Name, organization: '', street, city: parsed.City, zip, country, phone: parsed.ContactPhone || '', email: parsed.ContactEmail || '' };
}

function buildCustomsDeclaration(country, productText, weightKg, customsValueEur, customsCategory) {
  if (EU_COUNTRIES.has(String(country || '').toUpperCase())) return null;
  const posta = config.shipping.posta;
  const tariff = String(posta.customsTariffNumber || '950300').replace(/\D/g, '').substring(0, 6) || '950300';
  const description = customsCategory === 'documents' ? 'Documents' : limitText(posta.customsDescription || 'Toys and games', 100);

  const text = String(productText || '');
  const setMatches = text.match(/\b(\d+)\s*set/gi);
  const multiplier = Number(((text.match(/\bx\s*(\d+)\b/i) || [])[1]) || 1);
  let total = 0;
  if (setMatches) { setMatches.forEach((m) => { total += Number((m.match(/\d+/) || [0])[0]); }); }
  else { total = text.split(/\s+\+\s+/).filter((p) => p.trim()).length || 1; }
  const quantity = Math.max(1, total * Math.max(1, multiplier));

  const decl = {
    category: customsCategory || 'gift',
    items: [{ description, quantity, weight: Number(weightKg || 0), tariff_number: tariff, origin_country: posta.customsOriginCountry || 'SK', value: Number(customsValueEur || 10) }]
  };
  const note = limitText(text.replace(/[\r\n\t]+/g, ' '), 200).trim();
  if (note) decl.note = note;
  return decl;
}

async function createPostaLabels(orders, productMap, typeKey, replacements) {
  const tc = POSTA_TYPE_CONFIGS[typeKey];
  if (!tc) throw new Error(`Unknown Posta label type: ${typeKey}`);

  const posta = config.shipping.posta;
  const sender = {
    name: posta.sender.name || '', organization: posta.sender.organization || '',
    street: String(posta.sender.street || '').replace(/\s+/g, ' ').trim(),
    city: posta.sender.city, zip: String(posta.sender.zip || '').replace(/\s+/g, ''),
    country: String(posta.sender.country || 'SK').toUpperCase(),
    phone: posta.sender.phone || '', email: posta.sender.email || ''
  };

  const results = [];
  const downloads = [];

  for (const order of orders) {
    let acquired=false;
    try {
      const skuText = String(order.skus || '');
      const productText = resolveProductText(skuText, productMap);
      const parsed = parseRecipientAddress(String(order.address || ''));
      if (!parsed.Name || !parsed.City || !parsed.Street) throw new Error('Could not parse recipient address for Posta.');

      const recipient = postaRecipient(parsed);
      const weightKg = parseWeightKg(order.shipping_weight) || tc.weightKg();
      const customsDecl = buildCustomsDeclaration(parsed.CountryIsoCode, productText, weightKg, tc.customsValueEur(), tc.customsCategory);

      const previous=await operations.acquire(order.id,'posta:'+typeKey,replacements[order.id]);if(previous)return previous;acquired=true;
      const sheetData = await postaFetch('put', '/sheets', {
        sheet: {
          parcel_category: tc.parcelCategory(), sender,
          reception_method: posta.receptionMethod || 'post',
          payment_type: posta.paymentType || 'up',
          contract: posta.contract !== false,
          own_parcel_numbers: Boolean(posta.ownParcelNumbers),
          skip_parcel_numbers: Boolean(posta.skipParcelNumbers)
        }
      });
      const sheetId = sheetData.sheet.id;
      await operations.checkpoint(order.id,{sheetId});

      const parcelPayload = {
        parcel: {
          recipient, weight: weightKg, packaging: posta.packaging || 'standard',
          custom_identifier: String(order.external_order_id || order.id),
          note: limitText(productText || skuText || String(order.external_order_id || ''), 100)
        }
      };
      if (customsDecl) { parcelPayload.parcel.cd = customsDecl; parcelPayload.parcel.content_category = tc.contentCategory; }

      const parcelData = await postaFetch('put', `/sheets/${encodeURIComponent(sheetId)}/parcels`, parcelPayload);
      const parcelId = parcelData.parcel.id;
      const trackingNumber = parcelData.parcel.parcel_number || '';
      await operations.checkpoint(order.id,{parcelId,trackingNumber});

      const labelData = await postaFetch('post', `/sheets/${encodeURIComponent(sheetId)}/parcels/${encodeURIComponent(parcelId)}/labels`, { format: 'pdf' });
      if (labelData.status !== 'ok' || !labelData.labels?.url) throw new Error(`Posta label not available for parcel ${parcelId}`);

      const pdfRes = await fetch(labelData.labels.url,{signal:AbortSignal.timeout(30000)});
      if (!pdfRes.ok) throw new Error(`Failed to download Posta label PDF: ${pdfRes.status}`);
      const pdfBytes = Buffer.from(await pdfRes.arrayBuffer());

      await postaFetch('post', `/sheets/${encodeURIComponent(sheetId)}/register`, {});

      const postaTrackingUrl = trackingNumber ? `https://tandt.posta.sk/en/items/${encodeURIComponent(trackingNumber)}` : '';
      const stamp = dateStamp() + '_' + crypto.randomUUID();
      const fileName = `${tc.filePrefix}_${order.id}_${stamp}.pdf`;
      const labelUrl = await saveLabelFile(fileName, pdfBytes);
      const outcome={downloads:[{pdfBase64:pdfBytes.toString('base64'),fileName}],results:[{orderId:order.id,externalOrderId:String(order.external_order_id||''),success:true,trackingNumber}]};
      await operations.prepare(order.id,outcome,trackingNumber,postaTrackingUrl,labelUrl);
      downloads.push({ pdfBase64: pdfBytes.toString('base64'), fileName });
      results.push({ orderId: order.id, externalOrderId: String(order.external_order_id || ''), success: true, trackingNumber });
    } catch (err) {
      if(acquired){await operations.failed(order.id);err=new Error('The carrier request did not finish. Check the carrier portal and contact support before retrying.');}
      results.push({ orderId: order.id, externalOrderId: String(order.external_order_id || ''), success: false, error: err.message });
    }
  }

  return { downloads, results };
}

async function guarded(orders,create){
 const combined={downloads:[],results:[]};
 for(const order of orders){try{const result=await create([order]);combined.downloads.push(...result.downloads);combined.results.push(...result.results);}catch(error){combined.results.push({orderId:order.id,externalOrderId:String(order.external_order_id||''),success:false,error:error.message});}}
 return combined;
}
const printGlsLabels=(orders,map,replacements={})=>createGlsLabels(orders,map,replacements);
const printPostaLabels=(orders,map,type,replacements={})=>guarded(orders,list=>createPostaLabels(list,map,type,replacements));
module.exports = { printGlsLabels, printPostaLabels, getProductMap, getOrdersByIds };
