'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const directory = require('../paths').getPaths().settingsDir;
const filepath = path.join(directory, 'settings.enc');
const keypath = path.join(directory, 'settings.key');
function crypt(value, key, decrypt = false) {
  if (decrypt) {
    const raw = Buffer.from(value, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64');
}
function read() {
  if (!fs.existsSync(filepath)) return { values: {} };
  return crypt(fs.readFileSync(filepath, 'utf8'), fs.readFileSync(keypath), true);
}
function write(data) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(keypath)) fs.writeFileSync(keypath, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
  const temporary = filepath + '.partial';
  const fd = fs.openSync(temporary, 'w', 0o600);
  try { fs.writeFileSync(fd, crypt(data, fs.readFileSync(keypath))); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, filepath);
  if (process.platform !== 'win32') {
    const dirfd = fs.openSync(directory, 'r');
    try { fs.fsyncSync(dirfd); } finally { fs.closeSync(dirfd); }
  }
}
function apply() {
  // A crash may leave settings.enc and its key temporarily out of sync. Boot
  // recovery first using the target connection recorded before any file changes.
  const backupDirectory = require('../paths').getPaths().backupDir;
  const journalPath = path.join(backupDirectory, 'restore-journal.json');
  if (fs.existsSync(journalPath)) {
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    if (path.dirname(path.resolve(journal.recovery)) !== path.resolve(backupDirectory) || typeof journal.databaseUrl !== 'string' || !Number.isInteger(journal.port)) throw new Error('Invalid restore journal');
    process.env.DATABASE_URL = journal.databaseUrl;
    process.env.PORT = String(journal.port);
    return;
  }
  Object.assign(process.env, read().values);
}
module.exports = { read, write, apply, crypt };
