const crypto = require('crypto');
const { config } = require('../config');

function getKey() {
  if (!config.appSecret || config.appSecret.length < 24) {
    throw new Error('APP_SECRET must be set to a long random value before storing tokens.');
  }

  return crypto.createHash('sha256').update(config.appSecret).digest();
}

function encryptJson(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptJson(ciphertext) {
  const raw = Buffer.from(String(ciphertext || ''), 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');

  return JSON.parse(plaintext);
}

function base64Url(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function randomToken(bytes = 32) {
  return base64Url(crypto.randomBytes(bytes));
}

function sha256Base64Url(value) {
  return base64Url(crypto.createHash('sha256').update(value).digest());
}

module.exports = { encryptJson, decryptJson, randomToken, sha256Base64Url };
