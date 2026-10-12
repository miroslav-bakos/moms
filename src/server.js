const path = require('path');
const express = require('express');
const { config } = require('./config');
const apiRoutes = require('./routes/api');
const backupRoutes = require('./routes/backup');
const oauthRoutes = require('./routes/oauth');
const { accessLog } = require('./middleware/accessLog');
const { basicAuth } = require('./middleware/basicAuth');
const { startScheduler, stopScheduler } = require('./scheduler');
const { closePool } = require('./db');

let server, startup, databaseClose;
const closeDatabase = () => databaseClose || (databaseClose = closePool());
const lifecycle = require('./lifecycle').createShutdown({ getServer: () => server, stopJobs: () => Promise.all([stopScheduler(),require('./desktop/marketplaceCallbacks').stop()]), closeDatabase, ready: () => startup });

const app = express();
const trustedProxies = require('./trustedProxy').addresses();
if (trustedProxies.length) app.set('trust proxy', trustedProxies);

app.use((req, res, next) => lifecycle.isStopping() ? res.status(503).set('Connection', 'close').json({ error: 'Application is restarting. Please try again shortly.' }) : next());
app.use(express.json({ limit: '10mb' }));
app.get('/health', (req, res) => {
  res.json({ ok: true });
});
app.use(require('./maintenance').middleware);
app.use(accessLog);
// Old certificate-guide bookmarks now open the ordinary local application.
app.get('/phone-setup', (req,res) => res.redirect('/'));
app.use('/login', require('./routes/login'));
app.use('/auth', oauthRoutes);
app.use('/pair', require('./routes/pairing'));
app.use(basicAuth);
app.get('/app-logo', async (req, res, next) => {
  try {
    const { logo } = await require('./services/branding').getBranding();
    res.set('Cache-Control', 'no-cache');
    res.set('X-Content-Type-Options', 'nosniff');
    if (!logo) return res.sendFile(path.join(__dirname, 'public/icon-512.png'));
    const match = logo.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    res.type(match[1]).send(Buffer.from(match[2], 'base64'));
  } catch (error) { next(error); }
});
app.get('/app-favicon', async (req, res, next) => {
  try {
    const { logo } = await require('./services/branding').getBranding();
    const image = logo || 'data:image/png;base64,' + (await require('fs').promises.readFile(path.join(__dirname, 'public/icon-512.png'))).toString('base64');
    res.set('Cache-Control', 'no-cache').set('X-Content-Type-Options', 'nosniff')
      .type('image/svg+xml').send(require('./services/branding-icon').circularIcon(image));
  } catch (error) { next(error); }
});
for (const [route,size] of [['/apple-touch-icon.png',180],['/app-icon-192.png',192],['/app-icon-512.png',512]]) {
  app.get(route,async(req,res,next)=>{
    try {
      const {logo}=await require('./services/branding').getBranding();
      const image=await require('./services/branding-icon').installIcon(logo,size);
      res.set({'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}).type('image/png').send(image);
    } catch(error) { next(error); }
  });
}
app.get('/manifest.json', async (req, res, next) => {
  try {
    const branding = await require('./services/branding').getBranding();
    const manifest = require('./public/manifest.json');
    res.set('Cache-Control', 'no-cache').type('application/manifest+json').send({ ...manifest, name: branding.name, short_name: branding.name === require('./services/branding').DEFAULT_NAME ? 'MOMS' : branding.name.slice(0, 24) });
  } catch (error) { next(error); }
});
app.use('/labels', express.static(require('./paths').getPaths().labelsDir));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    if (filePath.endsWith('manifest.json')) res.setHeader('Content-Type', 'application/manifest+json');
  }
}));
app.use('/api', apiRoutes);
app.use('/api/push', require('./routes/push'));
app.use('/api/backup', backupRoutes);

app.use((error, req, res, next) => {
  console.error(error);
  res.status(error.statusCode || 500).json({
    error: error.message || String(error)
  });
});

startup = require('./services/backup').recoverInterruptedRestore().then(async (recovered) => {
  if (recovered) { await closeDatabase(); process.exit(0); }
  await require('./services/applicationSettings').prepareApplicationSettings();
}).then(async () => {
  if(lifecycle.isStopping())return;
  if(config.marketplaceCallbacksEnabled)await require('./desktop/marketplaceCallbacks').start(config.port+1).catch(()=>console.error('Marketplace callback listener unavailable. Reconnect in setup.'));
  if (lifecycle.isStopping()) return;
  server = require('./httpServer').create(app).listen(config.port, process.env.MOMS_LISTEN_HOST || undefined, () => {
    console.log(`MOMS listening on ${config.port}`);
    if (process.connected) process.send({ type: 'moms-ready', port: config.port, secure: Boolean(process.env.MOMS_TLS_CERT) }, () => {});
    if (!lifecycle.isStopping()) startScheduler();
  });
}).catch(() => {
  console.error('Unable to start application. Check bootstrap configuration, HTTPS files and restore keys.');
  return closeDatabase().finally(() => process.exit(1));
});

process.on('SIGTERM', () => lifecycle.shutdown());
process.on('SIGINT', () => lifecycle.shutdown());

// Desktop supervision uses IPC because Windows cannot deliver a graceful SIGTERM.
// A lost supervisor also drains the worker instead of leaving an orphan import.
if (process.send) {
  process.on('message', message => { if (message?.type === 'moms-shutdown') lifecycle.shutdown(); });
  process.once('disconnect', () => lifecycle.shutdown());
}
