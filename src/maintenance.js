'use strict';
const { AsyncLocalStorage } = require('async_hooks');
const context = new AsyncLocalStorage();
let active = false;
let requests = 0;
function middleware(req, res, next) {
  if (active) return res.status(503).json({ error: 'Backup or restore in progress. Please try again shortly.' });
  if (!req.path.startsWith('/api') && !req.path.startsWith('/auth')) return next();
  requests++;
  let ended = false;
  const finish = () => { if (!ended) { ended = true; requests--; } };
  res.once('finish', finish); res.once('close', finish);
  context.run({ request: true }, next);
}
async function enter() {
  if (active) throw new Error('Another restore is already running');
  active = true;
  const deadline = Date.now() + 60000;
  const ownRequest = context.getStore()?.request ? 1 : 0;
  while (requests > ownRequest || require('./scheduler').isBusy()) {
    if (Date.now() > deadline) { active = false; throw new Error('Application is busy; try restoring again later'); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
function leave() { active = false; }
module.exports = { middleware, enter, leave, isActive: () => active };
