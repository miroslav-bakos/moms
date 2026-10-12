const os = require('os');
const net = require('net');
function privateAddress(address) {
  if (!net.isIPv4(address)) return false;
  const [a,b] = address.split('.').map(Number);
  return a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31;
}
function connectionUrl(req, config, interfaces = os.networkInterfaces(), env = process.env) {
  let url;
  try { url = new URL(`${req.protocol}://${req.get('host')}`); } catch (_) { throw new Error('Invalid application address'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid application address');
  // Phone access follows the local connection, independently of OAuth callbacks.
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    if (env.MOMS_LAN_ADDRESS && !privateAddress(env.MOMS_LAN_ADDRESS)) throw new Error('Set MOMS_LAN_ADDRESS to the computer\'s local Wi-Fi IPv4 address.');
    // A bridged Docker container cannot discover the host's Wi-Fi interface.
    if (env.MOMS_DOCKER === 'true' && !env.MOMS_LAN_ADDRESS) throw new Error('For Docker phone access, open MOMS using the computer\'s Wi-Fi address or set MOMS_LAN_ADDRESS.');
    const address = env.MOMS_LAN_ADDRESS || Object.values(interfaces).flat().find(entry => entry && !entry.internal && entry.family === 'IPv4' && privateAddress(entry.address))?.address;
    if (!address) throw new Error('Connect the computer to your local network before connecting a phone.');
    url.hostname = address;
  }
  return url.origin;
}
module.exports = { connectionUrl, privateAddress };
