const express = require('express');
const fs = require('fs').promises;
const nodePath = require('path');
const { config } = require('../config');
const { query } = require('../db');
const { detectCountryCode } = require('../utils/countries');
const { listOrders, updateOrderFlags, updateOrderWorkflow, upsertOrder, deleteOrder } = require('../services/orders');
const {
  listProducts,
  saveProduct,
  deleteProduct,
  refreshOrderSkuMappings
} = require('../services/products');
const { listWorkflowStatuses, saveWorkflowStatus, deleteWorkflowStatus, reorderWorkflowStatuses, saveWorkflowAppearance } = require('../services/workflow');
const { listEvents } = require('../services/events');
const { listAccessLogs } = require('../services/accessLogs');
const { logAudit, listAuditLogs } = require('../services/auditLog');
const {
  listChannelState,
  setChannelEnabled,
  setChannelCursor
} = require('../services/channelState');
const { pollAll, pollChannel } = require('../scheduler');
const { printGlsLabels, printPostaLabels, getProductMap, getOrdersByIds } = require('../services/labels');
const { fetchTrackingStatus } = require('../services/tracking');
const { getChannelRoi, getRevenueTimeline, getSalesOverview, getOpenOrderValue } = require('../services/analytics');
const { requestFeedback, getSolicitationEligibility } = require('../channels/amazon');
const { listPrepBatches, getPrepBatch, createPrepBatch, addOrdersToPrepBatch, deletePrepBatch } = require('../services/prepBatches');

const router = express.Router();
router.get('/support', (req,res)=>res.set('Cache-Control','no-store').json({email:require('../config').config.supportEmail,version:require('../../package.json').version}));
router.use(require('../middleware/sameOrigin').sameOrigin);
router.get('/vat-preferences',async(req,res,next)=>{try{res.json(await require('../services/vat').get());}catch(error){next(error);}});
router.put('/vat-preferences',async(req,res,next)=>{try{res.json(await require('../services/vat').save(req.body));}catch(error){next(error);}});
router.post('/vat-calculate',async(req,res,next)=>{try{res.json(require('../services/vat').fromGross(req.body.amount,req.body.rate));}catch(error){next(error);}});
let callbackSetupRunning=false;
router.post('/marketplace-callbacks',async(req,res,next)=>{
 if(callbackSetupRunning)return res.status(409).json({error:'Callback setup is already running.'});
 callbackSetupRunning=true;
 try {
  const {action}=req.body||{};if(!['status','enable','disable'].includes(action))return res.status(400).json({error:'Invalid callback action.'});
  const listener=require('../desktop/marketplaceCallbacks'),targetPort=config.port+1;
  if(action==='enable')await listener.start(targetPort);
  const result=await require('../desktop/funnel').configure({action,targetPort});
  if(action==='enable'){
   const response=await fetch(result.url+'/moms-callback-health/'+listener.nonce,{signal:AbortSignal.timeout(15000),redirect:'error'});
   if(!response.ok||(await response.json()).nonce!==listener.nonce)throw new Error('Public callback verification failed. Check Tailscale permissions and try again.');
  }
  if(action!=='status'){
   const store=require('../settings/store'),saved=store.read();saved.values.MARKETPLACE_CALLBACKS_ENABLED=String(action==='enable');config.marketplaceCallbacksEnabled=action==='enable';
   if(action==='enable')for(const channel of ['etsy','shopify','amazon']){const url=result.url+'/auth/'+channel+'/callback';saved.values[channel.toUpperCase()+'_REDIRECT_URI']=url;config[channel].redirectUri=url;}
   store.write(saved);if(action==='disable')await listener.stop();
  }
  res.json(result);
 }catch(error){res.status(400).json({error:error.message,approvalUrl:error.approvalUrl||null});}finally{callbackSetupRunning=false;}
});
router.post('/accounting-export',async(req,res,next)=>{
 try{const bytes=await require('../services/accountingExport').exportAccounting(req.body);res.set({'Cache-Control':'no-store','Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="moms-accounting.csv"'}).send(bytes);}catch(error){next(error);}
});
router.get('/service-diagnostics',async(req,res,next)=>{
 try{res.set('Cache-Control','no-store').json(await require('../services/diagnostics').read());}catch(error){next(error);}
});
router.get('/setup-readiness', async(req,res,next)=>{
 try {
  const [channels,counts,backup]=await Promise.all([listChannelState(),query('SELECT (SELECT COUNT(*) FROM orders) AS orders,(SELECT COUNT(*) FROM manufacturing_skus) AS mappings'),query('SELECT max(created_at) AS last_backup FROM backups')]);
  let phoneUrl='',phoneError='';try{phoneUrl=require('../services/mobileConnect').connectionUrl(req,config);}catch(error){phoneError=error.message;}
  res.set('Cache-Control','no-store').json({login: Boolean(config.basicAuthUser&&config.basicAuthPassword),channels:channels.map(channel=>({channel:channel.channel,enabled:channel.enabled,last_success_at:channel.last_success_at,has_error:Boolean(channel.last_error)})),orders:Number(counts.rows[0].orders),mappings:Number(counts.rows[0].mappings),last_backup:backup.rows[0].last_backup,phone_url:phoneUrl,phone_error:phoneError});
 }catch(error){next(error);}
});
// Read-only rehearsal: never create an order or consume stock.
router.post('/setup-trial', async (req, res, next) => {
 try { res.set('Cache-Control', 'no-store').json(await require('../services/setupTrial').preview(req.body)); }
 catch(error) { next(error); }
});
router.get('/scan-camera-access', async(req,res,next)=>{
  try {const url=require('../services/scanAccess').secureOrigin(process.env.MOMS_SCAN_HTTPS_URL);res.set('Cache-Control','no-store').json({url});}catch(error){next(error);}
});
// Only the public CA certificate is mounted here; private keys remain in Caddy's volume.
router.get('/scan-root-certificate', (req,res,next)=>{
  res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.download('/https-public/root.crt','moms-root.crt',error=>{if(error){if(error.code==='ENOENT')return res.status(404).json({error:'Scan certificate is not configured.'});next(error);}});
});
router.get('/webapp-profile',async(req,res,next)=>{
  try {
    const branding=await require('../services/branding').getBranding();
    const profile=await require('../services/webappProfile').create(branding,process.env.MOMS_SCAN_HTTPS_URL);
    res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Type':'application/x-apple-aspen-config','Content-Disposition':'attachment; filename="moms-webapp.mobileconfig"'}).send(profile);
  } catch(error) { next(error); }
});
router.get('/mobile-connect', require('../middleware/sameOrigin').sameOrigin, async (req, res, next) => {
  try {
    let url = require('../services/mobileConnect').connectionUrl(req, config);
    const paired = req.secure && url.startsWith('https:') && Boolean(config.basicAuthUser && config.basicAuthPassword);
    if (paired) url += '/pair#' + await require('../services/mobilePairing').issue();
    const qr = await require('qrcode').toDataURL(url, { width: 256, margin: 4 });
    res.set('Cache-Control', 'no-store').json({ url, qr, paired });
  } catch (error) { next(error); }
});
router.delete('/mobile-devices', require('../middleware/sameOrigin').sameOrigin, async(req,res)=>{
  try { await require('../services/mobilePairing').revoke();res.json({ok:true}); }
  catch(_){res.status(503).json({error:'Unable to revoke paired devices.'});}
});
const { listApplicationSettings, saveApplicationSettings } = require('../services/applicationSettings');
router.get('/application-settings', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await listApplicationSettings());
  } catch (error) { next(error); }
});
router.patch('/application-settings', async (req, res, next) => {
  try {
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({ error: 'Use settings from this application.' });
    const settings = await saveApplicationSettings(req.body);
    logAudit({ username: reqUser(req), action: 'settings.update', entityType: 'settings', entityId: '', description: 'Updated application settings; restart required' }).catch(() => {});
    res.setHeader('Cache-Control', 'no-store');
    res.json(settings);
  } catch (error) { next(error); }
});


const LABELS_DIR = require('../paths').getPaths().labelsDir;

router.get('/workflow-statuses', async (req, res, next) => {
  try { res.json(await listWorkflowStatuses()); } catch (error) { next(error); }
});
router.post('/workflow-statuses', async (req, res, next) => {
  try {
    const status = await saveWorkflowStatus(null, req.body.label);
    logAudit({ username: reqUser(req), action: 'workflow.create', entityType: 'workflow', entityId: status.id, description: `Added order status ${status.label}` }).catch(() => {});
    res.status(201).json(status);
  } catch (error) { next(error); }
});
router.post('/workflow-statuses/reorder', async (req,res,next)=>{
  try {res.json(await reorderWorkflowStatuses(req.body.ids));}catch(error){next(error);}
});
router.patch('/workflow-statuses/:id/production', async(req,res,next)=>{
 try {res.json(await require('../services/workflow').saveProductionMeaning(req.params.id,req.body));}
 catch(error){next(error);}
});
router.patch('/workflow-statuses/:id/appearance', async (req, res, next) => {
  try { res.json(await saveWorkflowAppearance(req.params.id, req.body || {})); }
  catch (error) { next(error); }
});
router.patch('/workflow-statuses/:id', async (req, res, next) => {
  try {
    const status = await saveWorkflowStatus(req.params.id, req.body.label);
    logAudit({ username: reqUser(req), action: 'workflow.rename', entityType: 'workflow', entityId: status.id, description: `Renamed order status to ${status.label}` }).catch(() => {});
    res.json(status);
  } catch (error) { next(error); }
});
router.delete('/workflow-statuses/:id', async (req, res, next) => {
  try {
    await deleteWorkflowStatus(req.params.id);
    logAudit({ username: reqUser(req), action: 'workflow.delete', entityType: 'workflow', entityId: req.params.id, description: 'Removed order status and moved its orders to the default status' }).catch(() => {});
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.get('/prep-batches', async (req, res, next) => {
  try { res.json(await listPrepBatches()); } catch (error) { next(error); }
});

router.get('/prep-batches/:id', async (req, res, next) => {
  try {
    const batch = await getPrepBatch(Number(req.params.id));
    if (!batch) return res.status(404).json({ error: 'Batch not found.' });
    res.json(batch);
  } catch (error) { next(error); }
});

router.post('/prep-batches', async (req, res, next) => {
  try {
    const ids = [...new Set((Array.isArray(req.body?.order_ids) ? req.body.order_ids : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    if (!ids.length) return res.status(400).json({ error: 'Select at least one open order.' });
    res.status(201).json(await createPrepBatch(ids, reqUser(req)));
  } catch (error) { next(error); }
});

router.post('/prep-batches/:id/orders', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const ids = [...new Set((Array.isArray(req.body?.order_ids) ? req.body.order_ids : []).map(Number).filter((orderId) => Number.isInteger(orderId) && orderId > 0))];
    if (!Number.isInteger(id) || id <= 0 || !ids.length) return res.status(400).json({ error: 'Choose a batch and at least one open order.' });
    res.json(await addOrdersToPrepBatch(id, ids));
  } catch (error) { next(error); }
});

router.delete('/prep-batches/:id', async (req, res, next) => {
  try {
    if (!(await deletePrepBatch(Number(req.params.id)))) return res.status(404).json({ error: 'Batch not found.' });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

function reqUser(req) {
  return req.authUser || req.headers['tailscale-user-login'] || req.headers['tailscale-user-name'] || '';
}

function channelConfigured(channel) {
  if (channel === 'etsy') return Boolean(config.etsy.clientId && config.etsy.shopId);
  if (channel === 'shopify' && config.shopify.authMode==='client_credentials')return Boolean(config.shopify.shopDomain && config.shopify.clientId && config.shopify.clientSecret);
  if (channel === 'shopify') return Boolean(
    config.shopify.shopDomain && (
      config.shopify.accessToken ||
      (config.shopify.clientId && config.shopify.clientSecret)
    )
  );
  if (channel === 'amazon') {
    return Boolean(
      config.amazon.lwaClientId &&
      config.amazon.lwaClientSecret &&
      config.amazon.refreshToken &&
      Object.keys(config.amazon.marketplaceIds).length
    );
  }
  if (channel === 'sashe') return Boolean(config.sashe.userId && config.sashe.apiKey);
  return false;
}

router.get('/config', async (req, res) => {
  res.json({
    appBaseUrl: config.appBaseUrl,
    pollIntervalMinutes: config.pollIntervalMinutes,
    shopifyShopDomain: config.shopify.shopDomain || '',
    callbacks: {
      etsy: config.etsy.redirectUri,
      amazon: config.amazon.redirectUri
    },
    channels: {
      etsy: { envEnabled: config.etsy.enabled, configured: channelConfigured('etsy') },
      shopify: { envEnabled: config.shopify.enabled, configured: channelConfigured('shopify') },
      sashe: { envEnabled: config.sashe.enabled, configured: channelConfigured('sashe') },
      amazon: {
        envEnabled: config.amazon.enabled,
        configured: channelConfigured('amazon'),
        ordersApiVersion: config.amazon.ordersApiVersion,
        authMode: config.amazon.authMode,
        applicationConfigured: Boolean(config.amazon.applicationId),
        lwaConfigured: Boolean(config.amazon.lwaClientId && config.amazon.lwaClientSecret),
        refreshTokenConfigured: Boolean(config.amazon.refreshToken),
        marketplaceConfigured: Boolean(Object.keys(config.amazon.marketplaceIds).length)
      }
    }
  });
});

router.get('/inventory', async (req, res, next) => {
  try { res.set('Cache-Control','no-store').json(await require('../services/inventory').overview()); } catch (error) { next(error); }
});
router.post('/inventory/shopping/export', require('../middleware/sameOrigin').sameOrigin, async(req,res,next)=>{
  try {
    const result=await require('../services/shoppingExport').exportShopping(req.body);
    res.set('Cache-Control','no-store');
    res.type(result.format==='html'?'html':result.format==='csv'?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    if(result.format!=='html') res.set('Content-Disposition',`attachment; filename="shopping-list.${result.format}"`);
    res.send(result.body);
  }catch(error){next(error);}
});
router.post('/inventory/shopping/shortages', async(req,res,next)=>{
  try {res.json(await require('../services/inventory').addShoppingShortages());}catch(error){next(error);}
});
router.put('/inventory/shopping/:id', async (req,res,next) => {
  try { res.json(await require('../services/inventory').saveShopping(req.params.id,req.body || {})); } catch(error) { next(error); }
});
router.delete('/inventory/shopping/:id', async (req,res,next) => {
  try { await require('../services/inventory').removeShopping(req.params.id); res.json({ok:true}); } catch(error) { next(error); }
});
router.post('/inventory/shopping/:id/receive', async (req,res,next) => {
  try { res.json(await require('../services/inventory').receiveShopping(req.params.id,req.body || {})); } catch(error) { next(error); }
});
router.post('/inventory/products/:id/stock', async(req,res,next)=>{
  try {
    const result=await require('../services/inventory').changeFinishedStock(req.params.id,req.body || {});
    logAudit({username:reqUser(req),action:'inventory.finished-stock',entityType:'product',entityId:result.id,description:'Recorded finished product stock operation',changes:{request_key:req.body.request_key,kind:req.body.kind}}).catch(()=>{});
    res.json(result);
  }catch(error){next(error);}
});
for (const [kind, save] of [['materials','saveMaterial'],['products','saveProduct'],['skus','saveRule']]) {
  const update = async (req,res,next) => {
    try {
      const result = await require('../services/inventory')[save](req.params.id || null,req.body || {});
      logAudit({username:reqUser(req),action:'inventory.update',entityType:kind,entityId:result.id,description:'Updated inventory configuration'}).catch(()=>{});
      res.json(result);
    } catch (error) {next(error);}
  };
  router.post('/inventory/'+kind,update);
  router.patch('/inventory/'+kind+'/:id',update);
  router.delete('/inventory/'+kind+'/:id',async(req,res,next)=>{
    try {await require('../services/inventory').remove(kind,req.params.id);res.json({ok:true});} catch(error){next(error);}
  });
}

router.get('/marketplace-appearance',async(req,res,next)=>{
 try{res.set('Cache-Control','no-store').json(await require('../services/marketplaceAppearance').list());}catch(error){next(error);}
});
router.patch('/marketplace-appearance/:channel',async(req,res,next)=>{
 try{const value=await require('../services/marketplaceAppearance').save(req.params.channel,req.body);logAudit({username:reqUser(req),action:'marketplace.appearance',entityType:'settings',entityId:value.channel,description:'Updated marketplace order background'}).catch(()=>{});res.json(value);}catch(error){next(error);}
});
router.get('/branding', async (req, res, next) => {
  try { res.set('Cache-Control', 'no-store').json(await require('../services/branding').getBranding()); } catch (error) { next(error); }
});
router.put('/branding', async (req, res, next) => {
  try {
    const branding = await require('../services/branding').saveBranding(req.body);
    logAudit({ username: reqUser(req), action: 'branding.update', entityType: 'settings', entityId: '', description: 'Updated application name and logo' }).catch(() => {});
    res.json(branding);
  } catch (error) { next(error); }
});
router.get('/dashboard-pins', async (req, res, next) => {
  try { res.json(await require('../services/dashboardPins').listPins()); } catch (error) { next(error); }
});
router.put('/dashboard-pins', async (req, res, next) => {
  try {
    const saved = await require('../services/dashboardPins').savePins(req.body);
    logAudit({ username: reqUser(req), action: 'dashboard.pins.update', entityType: 'settings', entityId: '', description: 'Updated pinned dashboard SKUs' }).catch(() => {});
    res.json(saved);
  } catch (error) { next(error); }
});
router.get('/marketplace-balances', async (req, res, next) => {
  try { res.set('Cache-Control', 'no-store').json(await require('../services/marketplaceBalances').load(req.query.refresh === '1')); }
  catch (error) { next(error); }
});
router.get('/orders/scan-match', async (req,res,next) => {
  try {res.json(await require('../services/orderScan').match(req.query.code,req.query.mode==='search'));}
  catch(error){next(error);}
});
router.all('/scan-list',require('../middleware/sameOrigin').sameOrigin);
router.get('/scan-list',async(req,res,next)=>{
  try{res.set('Cache-Control','no-store').json(await require('../services/scanList').list());}catch(error){next(error);}
});
router.post('/scan-list',async(req,res,next)=>{
  try{res.set('Cache-Control','no-store').json(await require('../services/scanList').add(req.body.code));}catch(error){next(error);}
});
router.delete('/scan-list',async(req,res,next)=>{
  try{res.set('Cache-Control','no-store').json(await require('../services/scanList').remove(req.body.ids));}catch(error){next(error);}
});

router.get('/dashboard', async (req, res, next) => {
  try {
    const [thisMonthRes, openRes, countryRes, prevMonthRes] = await Promise.all([
      query(`
        SELECT vendor, COUNT(*) as count
        FROM orders
        WHERE DATE_TRUNC('month', COALESCE(created_at, imported_at)) = DATE_TRUNC('month', NOW())
        GROUP BY vendor
      `),
      query(`
        SELECT vendor, COUNT(*) as count
        FROM orders
        WHERE shipped = false
        GROUP BY vendor
      `),
      query(
        `SELECT COALESCE(created_at, imported_at) AS effective_date, address
         FROM orders WHERE address IS NOT NULL AND address != ''`
      ),
      query(`
        SELECT COUNT(*) as count
        FROM orders
        WHERE DATE_TRUNC('month', COALESCE(created_at, imported_at)) = DATE_TRUNC('month', NOW() - INTERVAL '1 month')
      `)
    ]);

    const thisMonthByVendor = {};
    let ordersThisMonth = 0;
    for (const row of thisMonthRes.rows) {
      thisMonthByVendor[row.vendor] = Number(row.count);
      ordersThisMonth += Number(row.count);
    }
    const openByVendor = {};
    let openOrders = 0;
    for (const row of openRes.rows) {
      openByVendor[row.vendor] = Number(row.count);
      openOrders += Number(row.count);
    }

    const now = new Date();
    const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const thisMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const thisMonthByCountry = {};
    const allTimeByCountry = {};
    for (const row of countryRes.rows) {
      const code = detectCountryCode(row.address);
      if (!code) continue;
      allTimeByCountry[code] = (allTimeByCountry[code] || 0) + 1;
      const d = row.effective_date ? new Date(row.effective_date) : null;
      if (d && d >= thisMonthStart && d < thisMonthEnd) {
        thisMonthByCountry[code] = (thisMonthByCountry[code] || 0) + 1;
      }
    }

    const ordersPreviousMonth = Number(prevMonthRes.rows[0]?.count || 0);

    const [dashboardPins, openOrderValue] = await Promise.all([require('../services/dashboardPins').dashboardPinCounts(), getOpenOrderValue()]);
    const unconfirmedDispatches = await require('../services/orderScan').unconfirmedDispatches();
    res.json({ unconfirmedDispatches, dashboardPins, openOrderValue, ordersThisMonth, ordersPreviousMonth, openOrders, openByVendor, thisMonthByVendor, thisMonthByCountry, allTimeByCountry });
  } catch (error) {
    next(error);
  }
});

router.post('/orders/print', async (req, res, next) => {
  try {
    const { validatePrint, printOrders } = require('../services/orderPrint');
    const options = validatePrint(req.body);
    const result = await query(`SELECT o.*, s.label AS workflow_label FROM orders o
      LEFT JOIN order_workflow_statuses s ON s.id = o.workflow_status
      WHERE o.id = ANY($1::bigint[]) ORDER BY o.id`, [options.orderIds]);
    if (result.rows.length !== options.orderIds.length) return res.status(409).json({ error: 'Some selected orders no longer exist. Refresh and try again.' });
    const branding = await require('../services/branding').getBranding();
    res.set('Cache-Control', 'no-store').type('html').send(printOrders(result.rows, options, branding));
  } catch (error) { next(error); }
});

router.post('/orders/export/open', require('../middleware/sameOrigin').sameOrigin, async(req,res,next)=>{
  try {
    const {bytes,format}=await require('../services/openExport').exportOpen(req.body);
    res.set('Cache-Control','no-store').type(format==='csv'?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition',`attachment; filename="open-orders.${format}"`).send(bytes);
  }catch(error){next(error);}
});
router.post('/orders/export/archive', require('../middleware/sameOrigin').sameOrigin, async (req,res,next)=>{
  try {
    const {bytes,format}=await require('../services/archiveExport').exportArchive(req.body);
    res.set('Cache-Control','no-store');
    res.set('Content-Type',format==='csv'?'text/csv; charset=utf-8':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition',`attachment; filename="archive.${format}"`);
    res.send(bytes);
  }catch(error){next(error);}
});

router.post('/orders/export', async (req, res, next) => {
  try {
    const { validateExport, exportOrders } = require('../services/orderExport');
    const { orderIds, format, language } = validateExport(req.body);
    const result = await query(`SELECT o.*, s.label AS workflow_label FROM orders o
      LEFT JOIN order_workflow_statuses s ON s.id = o.workflow_status
      WHERE o.id = ANY($1::bigint[]) ORDER BY o.id`, [orderIds]);
    if (result.rows.length !== orderIds.length) return res.status(409).json({ error: 'Some selected orders no longer exist. Refresh and try again.' });
    const bytes = await exportOrders(result.rows, format, language);
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="orders.${format}"`);
    res.send(bytes);
  } catch (error) { next(error); }
});

router.get('/orders', async (req, res, next) => {
  try {
    const paginate = req.query.paginate === 'true';
    const options = {
      limit: req.query.limit,
      offset: req.query.offset,
      activeOnly: req.query.active !== 'false',
      status: req.query.status || '',
      paginate,
      complete: req.query.complete === 'true',
      pinnedOnly: req.query.pinned === 'true'
    };
    if (req.query.ids) {
      const ids = String(req.query.ids).split(',').map(Number).filter(Boolean);
      if (ids.length) options.ids = ids;
    }
    if (paginate) {
      if (req.query.search) options.search = req.query.search;
      for (const col of ['vendor', 'external_order_id', 'skus', 'address', 'tracking_code', 'note', 'shipping_weight','business_outcome']) {
        if (req.query[col]) options[col] = req.query[col];
      }
      if (req.query.label_created) options.label_created = req.query.label_created;
      for (const col of ['created_at', 'ship_by_date']) {
        if (req.query[`${col}_from`]) options[`${col}_from`] = req.query[`${col}_from`];
        if (req.query[`${col}_to`]) options[`${col}_to`] = req.query[`${col}_to`];
      }
      if (req.query.sort_key) options.sortKey = req.query.sort_key;
      if (req.query.sort_dir) options.sortDir = req.query.sort_dir;
    }
    res.json(await listOrders(options));
  } catch (error) {
    next(error);
  }
});

router.get('/authorizations', async (req, res, next) => {
  try {
    const tokenResult = await query(
      `SELECT channel, expires_at, updated_at
       FROM oauth_tokens
       ORDER BY channel`
    );
    const tokens = {};
    for (const row of tokenResult.rows) {
      tokens[row.channel] = {
        present: true,
        expires_at: row.expires_at,
        updated_at: row.updated_at
      };
    }

    res.json({
      etsy: {
        configured: Boolean(config.etsy.clientId && config.etsy.shopId),
        authorized: Boolean(tokens.etsy),
        token: tokens.etsy || null,
        redirectUri: config.etsy.redirectUri,
        scopes: config.etsy.scopes
      },
      shopify: {
        authMode: config.shopify.authMode,
        configured: channelConfigured('shopify'),
        authorized: Boolean((config.shopify.authMode!=='client_credentials' && config.shopify.accessToken) || tokens.shopify),
        shopDomain: config.shopify.shopDomain || '',
        apiVersion: config.shopify.apiVersion,
        token: tokens.shopify || null,
        redirectUri: config.shopify.redirectUri
      },
      sashe: {
        configured: channelConfigured('sashe'),
        authorized: channelConfigured('sashe'),
        userId: config.sashe.userId || ''
      },
      amazon: {
        configured: channelConfigured('amazon'),
        authorized: Boolean(config.amazon.refreshToken || tokens.amazon_lwa),
        token: tokens.amazon_lwa || null,
        authMode: config.amazon.authMode,
        applicationConfigured: Boolean(config.amazon.applicationId),
        lwaConfigured: Boolean(config.amazon.lwaClientId && config.amazon.lwaClientSecret),
        refreshTokenConfigured: Boolean(config.amazon.refreshToken),
        marketplaceConfigured: Boolean(Object.keys(config.amazon.marketplaceIds).length),
        marketplaceIds: config.amazon.marketplaceIds,
        ordersApiVersion: config.amazon.ordersApiVersion,
        loginUri: `${config.appBaseUrl}/auth/amazon/login`,
        redirectUri: config.amazon.redirectUri
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/orders/feedback-eligibility', async (req, res, next) => {
  try {
    const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean);
    if (!ids.length) return res.json({});
    const orders = await listOrders({ ids });
    const list = Array.isArray(orders) ? orders : (orders.orders || []);
    const result = {};
    await Promise.all(list.map(async (order) => {
      result[order.id] = await getSolicitationEligibility(order);
    }));
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/orders/workflow', async (req, res, next) => {
  try {
    const orders = await require('../services/workflowDispatch').bulk(req.body?.ids, req.body?.workflow_status,req.body?.confirm_marketplace_dispatch);
    logAudit({ username: reqUser(req), action: 'order.workflow.bulk', entityType: 'order', description: `Changed workflow for ${orders.length} orders`, changes: { ids: orders.map(order => order.id), workflow_status: req.body.workflow_status } }).catch(() => {});
    res.json(orders);
  } catch (error) { next(error); }
});

router.patch('/orders/:id', async (req, res, next) => {
  try {
    const [before] = await listOrders({ids:[Number(req.params.id)]});
    const order = await require('../services/workflowDispatch').change(req.params.id, req.body || {});
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const changes = req.body || {};
    const name = order.order_name || order.external_order_id || req.params.id;
    const parts = Object.entries(changes).map(([k, v]) => `${k}=${v}`).join(', ');
    logAudit({ username: reqUser(req), action: 'order.update', entityType: 'order', entityId: req.params.id, description: `Updated order ${name}`, changes: {before:Object.fromEntries(Object.keys(changes).filter(key => key !== 'source_payload').map(key=>[key,before?.[key]])),after:changes} }).catch(() => {});
    res.json(order);
  } catch (error) {
    next(error);
  }
});

router.post('/orders/:id/request-feedback', async (req, res, next) => {
  try {
    const [order] = await listOrders({ ids: [Number(req.params.id)] });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    await requestFeedback(order).catch(() => {});
    const updated = await updateOrderFlags(req.params.id, { feedback_requested: true });
    const name = order.order_name || order.external_order_id || req.params.id;
    logAudit({ username: reqUser(req), action: 'order.feedback_requested', entityType: 'order', entityId: req.params.id, description: `Requested feedback for order ${name}` }).catch(() => {});
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.post('/orders', async (req, res, next) => {
  try {
    const { vendor, order_id, skus, address, note, created_at, ship_by_date, tracking_code, tracking_url } = req.body || {};
    const externalOrderId = (order_id && String(order_id).trim()) || `manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const order = await upsertOrder({
      channel: 'manual',
      vendor: (vendor && String(vendor).trim()) || 'Manual',
      externalOrderId,
      skus: String(skus || ''),
      address: String(address || ''),
      note: String(note || ''),
      createdAt: created_at || null,
      shipByDate: ship_by_date || null,
      trackingCode: String(tracking_code || ''),
      trackingUrl: String(tracking_url || '')
    });
    logAudit({ username: reqUser(req), action: 'order.create', entityType: 'order', entityId: String(order.id), description: `Created manual order ${order.id}` }).catch(() => {});
    res.status(201).json(order);
  } catch (error) {
    next(error);
  }
});

router.get('/orders/:id/fulfillment', async (req,res,next)=>{
  try { res.json(await require('../services/orderFulfillment').get(Number(req.params.id))); } catch(error){next(error);}
});
for (const [path,operation,action] of [
  ['/orders/:id/shipments','ship','order.shipment.create'],
  ['/orders/:id/returns','returnLine','order.return.create']
]) router.post(path,async(req,res,next)=>{
  try {const record=await require('../services/orderFulfillment')[operation](Number(req.params.id),req.body);await logAudit({username:reqUser(req),action,entityType:'order',entityId:req.params.id,description:action,changes:{record_id:record.id}});res.json(record);}catch(error){next(error);}
});
router.post('/orders/:id/shipments/:shipmentId/marketplace',async(req,res,next)=>{
 try{res.json(await require('../services/marketplaceDispatch').dispatch(req.params.id,req.params.shipmentId,req.body?.carrier_name||'other'));}catch(error){next(error);}
});
router.post('/orders/:id/shipments/:shipmentId/cancel',async(req,res,next)=>{
  try {const record=await require('../services/orderFulfillment').cancel(Number(req.params.id),req.params.shipmentId);await logAudit({username:reqUser(req),action:'order.shipment.cancel',entityType:'order',entityId:req.params.id,description:'Canceled shipment',changes:{record_id:record.id}});res.json(record);}catch(error){next(error);}
});
router.post('/orders/:id/returns/:returnId/receive',async(req,res,next)=>{
  try {const record=await require('../services/orderFulfillment').receive(Number(req.params.id),req.params.returnId,req.body);await logAudit({username:reqUser(req),action:'order.return.receive',entityType:'order',entityId:req.params.id,description:'Received return',changes:{record_id:record.id,restocked:record.restocked}});res.json(record);}catch(error){next(error);}
});
router.post('/orders/:id/shipments/:shipmentId/label',express.raw({type:'*/*',limit:'20mb'}),async(req,res,next)=>{
  try {
    const ext=nodePath.extname(String(req.headers['x-filename']||'')).toLowerCase();
    if(!['.pdf','.png','.jpg','.jpeg'].includes(ext)||!Buffer.isBuffer(req.body)||!req.body.length)return res.status(400).json({error:'Only PDF, PNG, JPG files are allowed'});
    const record=await require('../services/orderFulfillment').label(Number(req.params.id),req.params.shipmentId,async()=>{
      const fileName=`shipment-${req.params.shipmentId}-${require('crypto').randomUUID()}${ext}`;
      await fs.mkdir(LABELS_DIR,{recursive:true});await fs.writeFile(nodePath.join(LABELS_DIR,fileName),req.body);return `/labels/${fileName}`;
    });
    await logAudit({username:reqUser(req),action:'order.shipment.label',entityType:'order',entityId:req.params.id,description:'Uploaded shipment label',changes:{record_id:record.id}});res.json(record);
  }catch(error){next(error);}
});

router.get('/orders/:id/costs', async (req,res,next)=>{
  try{res.json(await require('../services/orderCosts').get(Number(req.params.id)));}catch(error){next(error);}
});
router.put('/orders/:id/costs', async (req,res,next)=>{
  try{
    const result=await require('../services/orderCosts').save(Number(req.params.id),req.body);
    await logAudit({username:reqUser(req),action:'order.costs',entityType:'order',entityId:req.params.id,description:'Updated order costs',changes:{revision:result.entered.revision}});res.json(result);
  }catch(error){next(error);}
});

router.get('/orders/:id/history', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({error:'Invalid order ID'});
    res.json(await require('../services/auditLog').orderHistory(id));
  } catch (error) { next(error); }
});

router.delete('/orders/:id', async (req, res, next) => {
  try {
    const [order] = await listOrders({ ids: [Number(req.params.id)] });
    const deleted = await deleteOrder(Number(req.params.id));
    if (!deleted) return res.status(404).json({ error: 'Order not found' });
    const name = order ? (order.order_name || order.external_order_id || req.params.id) : req.params.id;
    logAudit({ username: reqUser(req), action: 'order.delete', entityType: 'order', entityId: req.params.id, description: `Deleted order ${name}` }).catch(() => {});
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post('/orders/:id/label', express.raw({ type: '*/*', limit: '20mb' }), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid order ID' });
    const rawName = String(req.headers['x-filename'] || '').replace(/[^\w.-]/g, '');
    const ext = nodePath.extname(rawName).toLowerCase();
    if (!['.pdf', '.png', '.jpg', '.jpeg'].includes(ext)) {
      return res.status(400).json({ error: 'Only PDF, PNG, JPG files are allowed' });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `label-${id}-${stamp}${ext}`;
    await fs.mkdir(LABELS_DIR, { recursive: true });
    await fs.writeFile(nodePath.join(LABELS_DIR, fileName), req.body);
    const labelUrl = `/labels/${fileName}`;
    const order = await updateOrderFlags(id, { label_url: labelUrl, label_created: true });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const name = order.order_name || order.external_order_id || String(id);
    logAudit({ username: reqUser(req), action: 'order.label_upload', entityType: 'order', entityId: String(id), description: `Uploaded label for order ${name}` }).catch(() => {});
    res.json({ ok: true, label_url: labelUrl });
  } catch (error) {
    next(error);
  }
});

router.get('/state', async (req, res, next) => {
  try {
    res.json(await listChannelState());
  } catch (error) {
    next(error);
  }
});

router.patch('/state/:channel', async (req, res, next) => {
  try {
    const parts = [];
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'enabled')) {
      await setChannelEnabled(req.params.channel, Boolean(req.body.enabled));
      parts.push(`enabled=${req.body.enabled}`);
    }
    if (req.body && req.body.cursor) {
      await setChannelCursor(req.params.channel, new Date(req.body.cursor));
      parts.push(`cursor=${req.body.cursor}`);
    }
    if (parts.length) logAudit({ username: reqUser(req), action: 'channel.update', entityType: 'channel', entityId: req.params.channel, description: `Updated channel ${req.params.channel}: ${parts.join(', ')}` }).catch(() => {});
    res.json(await listChannelState());
  } catch (error) {
    next(error);
  }
});

router.post('/poll', async (req, res, next) => {
  try {
    res.json(await pollAll({ force: Boolean(req.body && req.body.force) }));
  } catch (error) {
    next(error);
  }
});

router.post('/poll/:channel', async (req, res, next) => {
  try {
    res.json(await pollChannel(req.params.channel, { force: true }));
  } catch (error) {
    next(error);
  }
});

router.get('/products', async (req, res, next) => {
  try {
    res.json(await listProducts());
  } catch (error) {
    next(error);
  }
});

router.put('/products/:sku', async (req, res, next) => {
  try {
    const product = await saveProduct(
      req.params.sku,
      req.body.sku || req.params.sku,
      req.body.display_name || req.body.displayName,
      req.body.metadata || {}
    );
    const refreshedOrders = await refreshOrderSkuMappings();
    const displayName = req.body.display_name || req.body.displayName || '';
    logAudit({ username: reqUser(req), action: 'product.save', entityType: 'product', entityId: req.params.sku, description: `Saved product mapping: ${req.params.sku} → ${displayName}` }).catch(() => {});
    res.json({ ok: true, product, refreshedOrders });
  } catch (error) {
    next(error);
  }
});

router.delete('/products/:sku', async (req, res, next) => {
  try {
    const deleted = await deleteProduct(req.params.sku);
    const refreshedOrders = await refreshOrderSkuMappings();
    logAudit({ username: reqUser(req), action: 'product.delete', entityType: 'product', entityId: req.params.sku, description: `Deleted product mapping: ${req.params.sku}` }).catch(() => {});
    res.json({ ok: true, deleted, refreshedOrders });
  } catch (error) {
    next(error);
  }
});

router.post('/products/refresh-order-skus', async (req, res, next) => {
  try {
    const refreshedOrders = await refreshOrderSkuMappings();
    logAudit({ username: reqUser(req), action: 'product.refresh_skus', entityType: 'product', entityId: '', description: `Applied product mappings to ${refreshedOrders} orders` }).catch(() => {});
    res.json({ ok: true, refreshedOrders });
  } catch (error) {
    next(error);
  }
});

router.post('/labels/gls', async (req, res, next) => {
  try {
    const ids = (req.body.orderIds || []).map(Number).filter(Boolean);
    if (!ids.length) return res.status(400).json({ error: 'orderIds required' });
    const [orders, productMap] = await Promise.all([getOrdersByIds(ids), getProductMap()]);
    res.json(await printGlsLabels(orders, productMap, req.body.replaceLabels || {}));
  } catch (error) {
    next(error);
  }
});

router.post('/labels/posta', async (req, res, next) => {
  try {
    const ids = (req.body.orderIds || []).map(Number).filter(Boolean);
    const type = req.body.type || 'parcel';
    if (!ids.length) return res.status(400).json({ error: 'orderIds required' });
    if (!['registered_letter', 'parcel'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
    const [orders, productMap] = await Promise.all([getOrdersByIds(ids), getProductMap()]);
    res.json(await printPostaLabels(orders, productMap, type, req.body.replaceLabels || {}));
  } catch (error) {
    next(error);
  }
});

const importOrigin = require('../middleware/sameOrigin').sameOrigin;
router.post('/import/orders/preview', importOrigin, async (req, res, next) => {
  try { res.json(await require('../services/orderImport').previewImport(req.body)); }
  catch (error) { next(error); }
});
router.post('/import/orders/commit', importOrigin, async (req, res, next) => {
  try {
    const result = await require('../services/orderImport').commitImport(req.body);
    logAudit({ username:reqUser(req), action:'order.import_spreadsheet',entityType:'order',entityId:'',description:`Imported ${result.imported} orders; skipped ${result.skipped} duplicates` }).catch(() => {});
    res.json(result);
  } catch (error) { next(error); }
});
// Legacy clients retain the positional CSV API, now with transactional validation
// and duplicate skipping. The GUI always uses the review/confirm flow above.
router.post('/import/orders', importOrigin, async (req, res, next) => {
  try {
    const csv = req.body?.csv;
    if(typeof csv !== 'string' || !csv.trim()) return res.status(400).json({error:'csv field required'});
    const service = require('../services/orderImport');
    const rows = service.parseCsv(csv);
    const width = Math.max(...rows.map(row => row.length));
    const fields = ['vendor','source_order_id','skus','created_at','ship_by_date','address','processed','packed','label_created',null,'tracking_code','tracking_url','order_url','note','is_gift','gift_message'];
    const mapping = Object.fromEntries(fields.flatMap((field,index) => field && index<width ? [[field,index]] : []));
    for(const row of rows) if(row.length>8) row[8].value=[row[8],row[9]].some(cell=>String(cell?.value||'').trim().toUpperCase()==='TRUE')?'true':'false';
    const legacyCsv=rows.map(row=>row.map(cell=>'\"'+cell.value.replace(/\"/g,'\"\"')+'\"').join(',')).join('\n');
    res.json(await service.commitImport({filename:'legacy.csv',base64:Buffer.from(legacyCsv).toString('base64'),hasHeader:/^vendor$/i.test(rows[0]?.[0]?.value||''),mapping,defaultArchived:true,duplicatePolicy:'skip',confirmed:true}));
  } catch(error) { next(error); }
});

router.get('/tracking/statuses', async (req, res, next) => {
  try {
    const codes = String(req.query.codes || '').split(',')
      .map((s) => s.trim())
      .filter((s) => /^[A-Z0-9]{1,35}$/i.test(s));
    const entries = await Promise.all(codes.map(async (code) => [code, await fetchTrackingStatus(code, { force: req.query.refresh === 'true' })]));
    res.json(Object.fromEntries(entries.filter(([, v]) => v && v.status)));
  } catch (error) {
    next(error);
  }
});

router.get('/analytics/sales-overview', async (req, res, next) => {
  try {
    res.json(await getSalesOverview(req.query.from || new Date(Date.now() - 30 * 86400000).toISOString(), req.query.to || new Date().toISOString()));
  } catch (error) { next(error); }
});

router.get('/analytics/channel-roi', async (req, res, next) => {
  try {
    const from = req.query.from || new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    const to = req.query.to || new Date().toISOString();
    res.json(await getChannelRoi(from, to));
  } catch (error) {
    next(error);
  }
});

router.get('/analytics/revenue-timeline', async (req, res, next) => {
  try {
    const from = req.query.from || new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
    const to = req.query.to || new Date().toISOString();
    const granularity = req.query.granularity || 'month';
    res.json(await getRevenueTimeline(from, to, granularity));
  } catch (error) {
    next(error);
  }
});

router.get('/events', async (req, res, next) => {
  try {
    res.json(await listEvents(Number(req.query.limit) || 50));
  } catch (error) {
    next(error);
  }
});

router.get('/access-logs', async (req, res, next) => {
  try {
    res.json(await listAccessLogs(Number(req.query.limit) || 100));
  } catch (error) {
    next(error);
  }
});

router.get('/audit-logs', async (req, res, next) => {
  try {
    res.json(await listAuditLogs(Number(req.query.limit) || 200));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
