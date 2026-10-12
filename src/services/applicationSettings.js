'use strict';
const { config } = require('../config');
const schema = require('../settings/schema.json');
const store = require('../settings/store');
const { withClient } = require('../db');
const { listChannelState, setChannelEnabled } = require('./channelState');
function enabledField(field) { return ['etsy', 'shopify', 'amazon', 'sashe'].includes(field.group) && field.env.endsWith('_ENABLED'); }
function valueOf(field) { return field.path.reduce((obj, key) => obj[key], config); }
function stringValue(field) {
  const value = valueOf(field);
  if (field.type === 'map') return Object.entries(value).map(([key,id]) => `${key}:${id}`).join(',');
  if (field.type === 'list') return value.join(' ');
  return String(value);
}
const active = Object.fromEntries(schema.map(field => [field.env, stringValue(field)]));
async function listApplicationSettings() {
  const states = await listChannelState();
  const saved = store.read().values;
  return schema.map(field => {
    const runtime = enabledField(field);
    const state = states.find(item => item.channel === field.group);
    const value = runtime ? String(state ? state.enabled : config[field.group].enabled) : Object.hasOwn(saved, field.env) ? saved[field.env] : active[field.env];
    return { ...field, path: undefined, configured: Boolean(value), pending: !runtime && Object.hasOwn(saved, field.env) && value !== active[field.env], ...(field.secret ? {} : { value }) };
  });
}
function invalid(message) { const err = new Error(message); err.statusCode = 400; return err; }
function validate(env, value) {
  if(env==='SUPPORT_EMAIL' && value && (typeof value!=='string'||! /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value)||value.length>254))throw invalid('Enter one valid support email address.');
  const field = schema.find(item => item.env === env);
  if (!field || typeof value !== 'string' || value.length > 8192 || /[\r\n\0]/.test(value)) throw invalid('Invalid setting.');
  if (field.type === 'bool' && !['true', 'false'].includes(value)) throw invalid(`${env}: choose true or false.`);
  if (field.type === 'number' && (value.trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0)) throw invalid(`${env}: enter a non-negative number.`);
  if (env === 'PORT' && (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 65535)) throw invalid('Port must be between 1 and 65535.');
  if (env === 'LABEL_RETENTION_DAYS' && (!Number.isInteger(Number(value)) || Number(value) > 36500)) throw invalid('Label retention must be a whole number from 0 to 36500 days.');
  if (env === 'POLL_INTERVAL_MINUTES' && Number(value) < 1) throw invalid('Polling interval must be at least one minute.');
  if (env === 'WEB_PUSH_SUBJECT' && value && !require('./webPush').subjectValid(value)) throw invalid('Use a mailto:email or public HTTPS contact address.');
  if (['APP_BASIC_AUTH_USER','APP_BASIC_AUTH_PASSWORD'].includes(env) && !value.trim()) throw invalid('Owner login cannot be disabled.');
  if (env === 'APP_SECRET' && value.length < 24) throw invalid('Application secret needs at least 24 characters.');
  if (env === 'SHOPIFY_SHOP_DOMAIN' && value && !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(value)) throw invalid('Enter shopname.myshopify.com without a protocol or path.');
  if (env === 'SHOPIFY_AUTH_MODE' && !['oauth','client_credentials'].includes(value)) throw invalid('Shopify mode must be oauth or client_credentials.');
  if (env === 'AMAZON_AUTH_MODE' && !['private','public'].includes(value)) throw invalid('Amazon mode must be private or public.');
  if (env === 'AMAZON_REGION_GROUP' && !['eu','na','fe'].includes(value)) throw invalid('Amazon region must be eu, na or fe.');
  if (field.type === 'map' && value && !value.split(',').every(entry => /^[a-z0-9_-]+:[A-Z0-9]+$/i.test(entry.trim()))) throw invalid('Use marketplace entries such as de:A1PA6795UKMFR9.');
  if (env !== 'DATABASE_URL' && (env.endsWith('_URL') || env.endsWith('_URI')) && value) {
    let url; try { url = new URL(value); } catch (_) { throw invalid(`${env}: invalid URL.`); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw invalid(`${env}: use an HTTP or HTTPS URL.`);
  }
  if (env === 'DATABASE_URL') {
    let url; try { url = new URL(value); } catch (_) { throw invalid('Invalid database connection URL.'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw invalid('Use a PostgreSQL connection URL.');
  }
  return value;
}
async function saveApplicationSettings(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw invalid('Invalid settings.');
  const patch = Object.fromEntries(Object.entries(values).map(([key,value]) => [key, validate(key,value)]));
  if (patch.DATABASE_URL && patch.DATABASE_URL !== active.DATABASE_URL) {
    const { Pool } = require('pg');
    const candidate = new Pool({ connectionString: patch.DATABASE_URL, connectionTimeoutMillis: 5000, max: 1 });
    try { await candidate.query('SELECT 1'); }
    catch (_) { throw invalid('Cannot connect to the new database. Check the connection URL; no settings were changed.'); }
    finally { await candidate.end(); }
  }
  const saved = store.read();
  const previousSaved = JSON.parse(JSON.stringify(saved));
  const effective = { ...active, ...saved.values, ...patch };
  if (Boolean(effective.APP_BASIC_AUTH_USER) !== Boolean(effective.APP_BASIC_AUTH_PASSWORD)) throw invalid('Set both a login name and password, or clear both.');
  if (!effective.APP_BASIC_AUTH_USER || !effective.APP_BASIC_AUTH_PASSWORD) throw invalid('Configure a login name and password before editing application settings.');
  if (effective.APP_BASIC_AUTH_USER.includes(':')) throw invalid('Login name cannot contain a colon.');
  // Preserve the old key until startup has safely re-encrypted existing OAuth tokens.
  if (patch.APP_SECRET && patch.APP_SECRET !== active.APP_SECRET) {
    saved.previousAppSecret = saved.previousAppSecret || config.appSecret;
    saved.keyHistory = [...new Set([...(saved.keyHistory || []), config.appSecret])].filter(Boolean);
  }
  const invalidations = new Set(saved.invalidations || []);
  for (const channel of ['etsy', 'shopify', 'amazon']) {
    const identityFields = schema.filter(field => field.group === channel && /AUTH_MODE|CLIENT|SHOP_ID|SHOP_DOMAIN|APPLICATION_ID|ACCESS_TOKEN|REFRESH_TOKEN/.test(field.env));
    if (identityFields.some(field => Object.hasOwn(patch, field.env) && patch[field.env] !== (saved.values[field.env] ?? active[field.env]))) invalidations.add(channel);
  }
  const enabledChanges = schema.filter(field => enabledField(field) && Object.hasOwn(patch, field.env));
  const next = { ...saved, invalidations: [...invalidations], values: { ...saved.values, ...patch } };
  if (enabledChanges.length) {
    await withClient(async client => {
      await client.query('BEGIN');
      try {
        for (const field of enabledChanges) await setChannelEnabled(field.group, patch[field.env] === 'true', client.query.bind(client));
        store.write(next);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        store.write(previousSaved);
        throw error;
      }
    });
  } else store.write(next);
  return listApplicationSettings();
}
async function prepareApplicationSettings() {
  const saved = store.read();
  const rotate = saved.previousAppSecret && saved.previousAppSecret !== config.appSecret;
  if (!rotate && !(saved.invalidations || []).length) return;
  const crypto = require('crypto');
  const oldKey = crypto.createHash('sha256').update(saved.previousAppSecret || config.appSecret).digest();
  const newKey = crypto.createHash('sha256').update(config.appSecret).digest();
  await withClient(async client => {
    await client.query('BEGIN');
    try {
      for (const channel of saved.invalidations || []) await client.query('DELETE FROM oauth_tokens WHERE channel = $1', [channel]);
      const tokens = await client.query('SELECT channel, token_ciphertext FROM oauth_tokens FOR UPDATE');
      for (const token of tokens.rows) {
        let decoded;
        try { decoded = store.crypt(token.token_ciphertext, newKey, true); }
        catch (_) { decoded = store.crypt(token.token_ciphertext, oldKey, true); }
        await client.query('UPDATE oauth_tokens SET token_ciphertext = $2 WHERE channel = $1', [token.channel, store.crypt(decoded, newKey)]);
      }
      await client.query('COMMIT');
    } catch (err) { await client.query('ROLLBACK'); throw err; }
  });
  delete saved.previousAppSecret;
  delete saved.invalidations;
  store.write(saved);
}
module.exports = { listApplicationSettings, saveApplicationSettings, prepareApplicationSettings };
