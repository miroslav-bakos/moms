'use strict';
const net = require('node:net');
const { privateAddress } = require('./mobileConnect');

function secureOrigin(value = '') {
  if (!value) return '';
  const url = new URL(value);
  const octets = url.hostname.split('.').map(Number);
  const tailnet = net.isIP(url.hostname) === 4 && octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
  if (url.protocol !== 'https:' || url.origin !== value || !(url.hostname.endsWith('.ts.net') || privateAddress(url.hostname) || tailnet)) {
    throw new Error('Invalid secure Scan address.');
  }
  return value;
}

module.exports = { secureOrigin };
