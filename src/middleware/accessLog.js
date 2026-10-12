const { logAccess } = require('../services/accessLogs');

const staticAssetPattern = /\.(css|js|map|ico|png|jpg|jpeg|gif|svg|webp|woff2?)$/i;

function shouldLog(req, res) {
  const path = req.path || '/';
  if (path === '/health') return false;
  if (req.method === 'GET' && staticAssetPattern.test(path)) return false;
  if (req.method === 'GET' && path.startsWith('/api/') && res.statusCode < 400) return false;

  if (path === '/' || path === '/index.html') return true;
  if (path.startsWith('/auth/')) return true;
  if (path.startsWith('/api/') && req.method !== 'GET') return true;
  return res.statusCode >= 400;
}

function accessLog(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    if (!shouldLog(req, res)) return;

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logAccess(req, res, durationMs).catch((error) => {
      console.error('Access log write failed:', error.message);
    });
  });

  next();
}

module.exports = { accessLog };
