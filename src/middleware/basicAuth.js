const { config } = require('../config');

const COOKIE_NAME = 'loa_session';
const sessions = require('../services/authSessions');

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

const PUBLIC_PATHS = new Set(['/app-logo', '/app-favicon', '/apple-touch-icon.png', '/app-icon-192.png', '/app-icon-512.png', '/manifest.json', '/sw.js', '/favicon.png', '/icon-192.png', '/icon-512.png']);

function reject(req,res,status,message){return req.path.startsWith('/api/')?res.status(status).json({error:message}):res.status(status).send(message);}

async function basicAuth(req, res, next) {
  if (!config.basicAuthUser || !config.basicAuthPassword) {
    if (req.headers.accept?.includes('text/html')) return res.redirect('/login');
    return reject(req,res,403,'Set up the owner login on this computer first.');
  }
  if (PUBLIC_PATHS.has(req.path)) return next();
  const device = getCookie(req, 'moms_device');
  if (device && req.secure) {
    try { if (await require('../services/mobilePairing').authenticate(device)) { req.authUser=config.basicAuthUser; req.authSession=device; return next(); } }
    catch (_) { return reject(req,res,503,'Authentication temporarily unavailable'); }
  }

  const token = getCookie(req, COOKIE_NAME);
  if (token) {
    try {
      if (await sessions.authenticate(token)) { req.authUser=config.basicAuthUser; req.authSession=token; return next(); }
    } catch (_) { return reject(req,res,503,'Authentication temporarily unavailable'); }
  }

  const header = req.headers.authorization || '';
  const match = header.match(/^Basic\s+(.+)$/i);
  if (match && !getCookie(req, 'moms_signed_out')) {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const username = separator >= 0 ? decoded.slice(0, separator) : '';
    const password = separator >= 0 ? decoded.slice(separator + 1) : '';
    req.basicAuthUserAttempt = username;

    if (sessions.equal(username, config.basicAuthUser) && sessions.passwordMatches(password)) {
      req.authUser = username;
      try { req.authSession = await sessions.issue(); } catch (_) { return reject(req,res,503,'Authentication temporarily unavailable'); }
      res.setHeader(
        'Set-Cookie',
        `${COOKIE_NAME}=${req.authSession}; HttpOnly;${req.secure ? ' Secure;' : ''} SameSite=Lax; Max-Age=43200; Path=/`
      );
      return next();
    }
  }

  if (req.headers.accept?.includes('text/html')) return res.redirect('/login');
  return reject(req,res,401,'Authentication required');
}

module.exports = { basicAuth, getCookie };
