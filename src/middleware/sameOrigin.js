'use strict';
// HTTP Basic authentication is cached by browsers. Require browser writes to
// originate from this application's host; CLI clients have no Origin header.
function sameOrigin(req, res, next) {
  const origin = req.get('Origin');
  const site = req.get('Sec-Fetch-Site');
  if (site === 'cross-site') return res.status(403).json({ error: 'Cross-site requests are not allowed.' });
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (origin) {
    try {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.host !== req.get('Host')) throw new Error();
    } catch (_) { return res.status(403).json({ error: 'Cross-site requests are not allowed.' }); }
  }
  next();
}
module.exports = { sameOrigin };
