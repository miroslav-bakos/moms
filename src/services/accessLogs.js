const { query } = require('../db');

function headerValue(req, name) {
  const value = req.headers[String(name).toLowerCase()];
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function firstForwardedIp(value) {
  return String(value || '').split(',')[0].trim();
}

function normalizeIp(value) {
  let ip = firstForwardedIp(value);
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip.startsWith('[')) {
    const end = ip.indexOf(']');
    return end >= 0 ? ip.slice(1, end) : ip;
  }
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(ip)) {
    return ip.split(':')[0];
  }
  return ip;
}

function ipv4Parts(ip) {
  const parts = String(ip || '').split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts;
}

function isLoopback(ip) {
  if (ip === '::1') return true;
  const parts = ipv4Parts(ip);
  return Boolean(parts && parts[0] === 127);
}

function isTailscaleIp(ip) {
  const parts = ipv4Parts(ip);
  return Boolean(parts && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
}

function isLanIp(ip) {
  const lower = String(ip || '').toLowerCase();
  if (lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:')) return true;

  const parts = ipv4Parts(ip);
  if (!parts) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  return false;
}

function classifySourceNetwork(ip, details) {
  if (details.tailscaleUserLogin || details.tailscaleUserName || details.tailscaleAppCapabilitiesPresent) {
    return 'tailscale';
  }
  if (!ip) return 'unknown';
  if (isTailscaleIp(ip)) return 'tailscale';
  if (isLoopback(ip)) return 'local';
  if (isLanIp(ip)) return 'lan';
  return 'outside';
}

function getClientIp(req) {
  return normalizeIp(
    headerValue(req, 'x-forwarded-for') ||
    headerValue(req, 'x-real-ip') ||
    req.ip ||
    (req.socket && req.socket.remoteAddress) ||
    ''
  );
}

async function logAccess(req, res, durationMs) {
  const details = {
    forwardedFor: headerValue(req, 'x-forwarded-for'),
    realIp: headerValue(req, 'x-real-ip'),
    forwardedHost: headerValue(req, 'x-forwarded-host'),
    forwardedProto: headerValue(req, 'x-forwarded-proto'),
    tailscaleUserLogin: headerValue(req, 'tailscale-user-login'),
    tailscaleUserName: headerValue(req, 'tailscale-user-name'),
    tailscaleAppCapabilitiesPresent: Boolean(headerValue(req, 'tailscale-app-capabilities')),
    queryKeys: Object.keys(req.query || {})
  };
  const ip = getClientIp(req);
  const sourceNetwork = classifySourceNetwork(ip, details);

  await query(
    `INSERT INTO access_logs (
       method, path, status_code, duration_ms, ip, source_network,
       tailscale_user_login, tailscale_user_name, basic_auth_user,
       user_agent, referer, details
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      req.method,
      req.path || '/',
      res.statusCode || 0,
      Math.max(0, Math.round(durationMs || 0)),
      ip,
      sourceNetwork,
      details.tailscaleUserLogin,
      details.tailscaleUserName,
      req.authUser || req.basicAuthUserAttempt || '',
      headerValue(req, 'user-agent'),
      headerValue(req, 'referer'),
      JSON.stringify(details)
    ]
  );
}

async function listAccessLogs(limit = 100) {
  const result = await query(
    `SELECT id, method, path, status_code, duration_ms, ip, source_network,
            tailscale_user_login, tailscale_user_name, basic_auth_user,
            user_agent, referer, details, created_at
     FROM access_logs
     ORDER BY created_at DESC
     LIMIT $1`,
    [Math.min(Number(limit) || 100, 500)]
  );
  return result.rows;
}

module.exports = { logAccess, listAccessLogs, classifySourceNetwork, normalizeIp };
