'use strict';

const crypto = require('crypto');
const { config } = require('../config');
const { query } = require('../db');

const memCache = new Map();
const CACHE_TTL_MS = 20 * 60 * 1000;

function glsPasswordHash() {
  return Array.from(crypto.createHash('sha512').update(config.shipping.gls.password, 'utf8').digest());
}

function isGls(code) {
  return /^\d+$/.test(code);
}

function isPosta(code) {
  return /^[A-Z]{2}\d{9}[A-Z]{2}$/i.test(code);
}

function parseGlsDate(s) {
  const m = String(s || '').match(/\/Date\((\d+)/);
  return m ? new Date(Number(m[1])) : null;
}

async function fetchGlsStatus(code) {
  const gls = config.shipping.gls;
  const url = gls.apiUrl.replace(/\/$/, '') + '/ParcelService.svc/json/GetParcelListStatuses';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      Username: gls.username,
      Password: glsPasswordHash(),
      ParcelNumberList: [Number(code)],
      ReturnPOD: false
    })
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`GLS ${res.status}`);
  const raw = JSON.parse(body);
  const errors = raw.GetParcelListStatusesErrors || [];
  if (errors.some((e) => e.ErrorCode !== 0)) return null;
  const parcelList = raw.ParcelList || [];
  if (!parcelList.length) return null;
  const events = parcelList[0].ParcelStatusList || [];
  if (!events.length) return null;
  const latest = events[0];
  const desc = (latest.StatusDescription || latest.StatusCode || '').trim();
  if (!desc) return null;
  const city = (latest.DepotCity || '').trim();
  const info = (latest.StatusInfo || '').trim();
  const key = desc.toLowerCase();

  // APL-Registration reappears when a parcel crosses a border and re-registers at a foreign depot.
  // If any physical movement event (e.g. pick-up) preceded it, the parcel is still in transit.
  if (key === 'apl-registration') {
    const hadActivity = events.slice(1).some((e) => {
      const d = (e.StatusDescription || e.StatusCode || '').toLowerCase();
      return d !== 'data sent' && d !== 'apl-registration';
    });
    if (hadActivity) return { status: 'In transit', deliveredAt: null };
  }

  const known = {
    'delivered':        { label: 'Delivered',              extra: 'info' },
    'depot storage':    { label: 'Held at depot',          extra: 'city' },
    'statuskey_st02':   { label: 'In transit',             extra: 'city' },
    'apl-registration': { label: 'Registered',             extra: null   },
    'data sent':        { label: 'Data sent',              extra: null   },
  };
  const entry = known[key];
  let status;
  if (entry) {
    if (entry.extra === 'info' && info) status = `${entry.label} (${info})`;
    else if (entry.extra === 'city' && city) status = `${entry.label} (${city})`;
    else status = entry.label;
  } else {
    status = city ? `${desc} (${city})` : (info ? `${desc}: ${info}` : desc);
  }

  const deliveredAt = key === 'delivered' ? parseGlsDate(latest.StatusDate) : null;
  return { status, deliveredAt };
}

async function fetchPostaStatus(code) {
  const res = await fetch(`https://api.posta.sk/tracking?q=${encodeURIComponent(code)}&l=en`);
  const body = await res.text();
  if (!res.ok) throw new Error(`Posta ${res.status}`);
  const data = JSON.parse(body);
  if (data.status !== 'ok') return null;
  const result = (data.results || [])[0];
  if (!result || result.status !== 'ok') return null;
  const events = result.events || [];
  if (!events.length) return null;
  const POSTA_LABELS = { 'Delivered to addressee': 'Delivered' };
  const latest = events[events.length - 1];
  const status = POSTA_LABELS[latest.detailDescription] || latest.detailDescription || latest.stateCode || null;
  if (!status) return null;
  const deliveredAt = latest.stateCode === 'delivered' && latest.localDate
    ? new Date(latest.localDate)
    : null;
  return { status, deliveredAt };
}

async function persistToDb(code, result) {
  await query(
    `INSERT INTO tracking_cache (tracking_code, status, delivered_at, fetched_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (tracking_code) DO UPDATE SET status = $2, delivered_at = $3, fetched_at = now()`,
    [code, result.status, result.deliveredAt || null]
  );
}

async function readFromDb(code) {
  const { rows } = await query(
    'SELECT status, delivered_at FROM tracking_cache WHERE tracking_code = $1',
    [code]
  );
  if (!rows.length) return null;
  return { status: rows[0].status, deliveredAt: rows[0].delivered_at || null };
}

async function fetchTrackingStatus(code, { force = false } = {}) {
  if (!code) return null;

  // L1: in-memory cache
  const cached = memCache.get(code);
  if (cached && (cached.permanent || (!force && Date.now() - cached.fetchedAt < CACHE_TTL_MS))) return cached.result;

  let result = null;
  let fetchError = false;
  try {
    if (isGls(code)) result = await fetchGlsStatus(code);
    else if (isPosta(code)) result = await fetchPostaStatus(code);
  } catch (err) {
    console.error(`[tracking] ${code}: ${err.message}`);
    fetchError = true;
  }

  if (result !== null) {
    memCache.set(code, { result, fetchedAt: Date.now(), permanent: result.deliveredAt !== null });
    persistToDb(code, result).catch((err) => console.error(`[tracking] db write ${code}: ${err.message}`));
    return result;
  }

  // On network error fall back to last known value from DB
  if (fetchError) {
    try {
      const dbResult = await readFromDb(code);
      if (dbResult) {
        memCache.set(code, { result: dbResult, fetchedAt: Date.now(), permanent: dbResult.deliveredAt !== null });
        return dbResult;
      }
    } catch (err) {
      console.error(`[tracking] db read ${code}: ${err.message}`);
    }
  }

  return null;
}

module.exports = { fetchTrackingStatus };
