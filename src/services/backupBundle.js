'use strict';
// A versioned gzip container deliberately uses no archive extraction. Every file
// has an allowlisted relative path, a length and a SHA-256 digest.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const MAX_BYTES = 750 * 1024 * 1024;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function entry(name, bytes) { return { name, size: bytes.length, sha256: digest(bytes), data: bytes.toString('base64') }; }
function allowed(name) {
  return typeof name === 'string' && !name.includes('\\') && !name.includes('\0') && !name.split('/').some(p => !p || p === '.' || p === '..') &&
    (name === 'database.dump' || name === 'configuration.json' || ['settings/settings.enc', 'settings/settings.key'].includes(name) || name.startsWith('labels/'));
}
async function pack(files) {
  return gzip(Buffer.from(JSON.stringify({ format: 'moms-backup', version: 1, createdAt: new Date().toISOString(), files })), { level: 6 });
}
async function unpack(compressed) {
  const raw = await gunzip(compressed, { maxOutputLength: MAX_BYTES });
  if (raw[0] !== 123) {
    // Legacy pg_dump uses COPY terminators and, in recent clients, restrict
    // markers. Reject other psql commands (including shell/connection commands).
    for (const line of raw.toString('utf8').split('\n')) {
      if (/^\s*\\/.test(line) && !/^\\(?:\.$|N(?:\t|$)|restrict [A-Za-z0-9]+$|unrestrict [A-Za-z0-9]+$)/.test(line)) throw new Error('Unsafe command in legacy backup');
    }
    return { legacy: true, sql: raw };
  }
  const bundle = JSON.parse(raw.toString('utf8'));
  if (bundle.format !== 'moms-backup' || bundle.version !== 1 || !Array.isArray(bundle.files)) throw new Error('Unsupported backup format');
  const files = new Map();
  for (const item of bundle.files) {
    if (!allowed(item.name) || files.has(item.name) || typeof item.data !== 'string') throw new Error('Invalid backup file path');
    const bytes = Buffer.from(item.data, 'base64');
    if (bytes.toString('base64') !== item.data || bytes.length !== item.size || digest(bytes) !== item.sha256) throw new Error('Backup checksum mismatch');
    files.set(item.name, bytes);
  }
  if (!files.has('database.dump') || !files.has('configuration.json')) throw new Error('Incomplete backup');
  const configuration = JSON.parse(files.get('configuration.json').toString());
  if (!configuration.values || typeof configuration.values !== 'object' || Array.isArray(configuration.values)) throw new Error('Invalid configuration');
  const schema = require('../settings/schema.json');
  const names = new Set(schema.map(field => field.env));
  const retained = values => {
    const result = {};
    for (const [name,value] of Object.entries(values)) {
      if (!/^[A-Z][A-Z0-9_]*$/.test(name) || typeof value !== 'string') throw new Error('Invalid configuration value');
      if (names.has(name)) result[name] = value;
    }
    return result;
  };
  // Settings retired in newer releases must not prevent recovery of older orders.
  configuration.values = retained(configuration.values);
  files.set('configuration.json',Buffer.from(JSON.stringify(configuration)));
  if (files.has('settings/settings.enc') !== files.has('settings/settings.key')) throw new Error('Missing settings encryption key');
  if (files.has('settings/settings.enc')) {
    const saved = require('../settings/store').crypt(files.get('settings/settings.enc').toString(), files.get('settings/settings.key'), true);
    if (!saved || typeof saved !== 'object' || !saved.values || typeof saved.values !== 'object' || Array.isArray(saved.values)) throw new Error('Invalid encrypted settings');
    saved.values = retained(saved.values);
    if (saved.previousAppSecret !== undefined && typeof saved.previousAppSecret !== 'string') throw new Error('Invalid previous encryption key');
    if (saved.keyHistory !== undefined && (!Array.isArray(saved.keyHistory) || saved.keyHistory.some(key => typeof key !== 'string'))) throw new Error('Invalid encryption key history');
    files.set('settings/settings.enc',Buffer.from(require('../settings/store').crypt(saved,files.get('settings/settings.key'))));
  }
  return { legacy: false, files, configuration, createdAt: bundle.createdAt };
}
function collect(directory, prefix) {
  const files = [];
  if (!fs.existsSync(directory)) return files;
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, item.name);
    if (item.isSymbolicLink()) throw new Error('Cannot back up symbolic links');
    if (item.isDirectory()) files.push(...collect(full, `${prefix}/${item.name}`));
    else if (item.isFile()) files.push(entry(`${prefix}/${item.name}`, fs.readFileSync(full)));
  }
  return files;
}
module.exports = { entry, pack, unpack, collect };
