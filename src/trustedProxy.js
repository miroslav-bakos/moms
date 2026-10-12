'use strict';
const net = require('node:net');
function addresses(env = process.env) {
  const result = env.MOMS_TRUST_LOOPBACK_PROXY === 'true' ? ['loopback'] : [];
  if (env.MOMS_TRUST_PROXY_IP) {
    if (!net.isIP(env.MOMS_TRUST_PROXY_IP)) throw new Error('The HTTPS proxy must be one explicit IP address.');
    result.push(env.MOMS_TRUST_PROXY_IP);
  }
  if(env.MOMS_TRUST_TAILSCALE_PROXY_IP){if(!net.isIP(env.MOMS_TRUST_TAILSCALE_PROXY_IP))throw new Error('The Tailscale proxy must be one explicit IP address.');result.push(env.MOMS_TRUST_TAILSCALE_PROXY_IP);}
  return result;
}
module.exports = { addresses };
