const { chromium } = require('@playwright/test');
const fs = require('fs');
const http = require('http');
const assert = require('assert/strict');
const root = require('path').resolve(__dirname, '..');
const server = http.createServer((req,res) => {
 const file = root + '/src/public/' + (req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
 try { res.setHeader('Content-Type', file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'); res.end(fs.readFileSync(file)); } catch {res.statusCode=404;res.end();}
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.MOMS_CHROMIUM_PATH || undefined});
 const page=await browser.newPage({viewport:{width:1500,height:950},serviceWorkers:'block'});
 await page.addInitScript(()=>localStorage.setItem('mobile-connect-seen','true'));
 let boardArchiveFixture=false,failBoardArchive=false,holdBoardArchive=null;const boardArchiveRequests=[];
 const archiveFixtures=Array.from({length:65},(_,index)=>({id:8000+index,external_order_id:`Archived-${index}`,channel:'manual',vendor:'Manual',skus:index===64?'Deep archive needle <safe>':'Archived product',address:'Archived customer\nSlovakia',workflow_status:'crafted',shipped:true,ship_by_date:'2020-01-01',created_at:new Date(Date.UTC(2026,9,1,0,0,65-index)).toISOString()}));
 const exportRequests=[];const openExportRequests=[];let failStatus=false,failReorder=false,failAppearance=false,failSales=false;const statusRequests=[];const salesRequests=[];let holdSalesNext=null;
 let failAccess=false; const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async dialog=>{errors.push(dialog.message());await dialog.dismiss();});
 const order={revenue_amount:'123.45',revenue_currency:'EUR',tracking_code:'Save',tracking_url:'https://example.com/tracking/TRACK-42',tracking_status:'In transit',id:42,external_order_id:'Orders',channel:'manual',vendor:'Manual',address:'Save\nSlovakia',skus:'SKU x2',workflow_status:'crafted',shipped:false,ship_by_date:'2026-10-01'};
 const statuses=[['new','NEW'],['in_progress','IN PROGRESS'],['crafted','CRAFTED'],['ready_for_pickup','READY FOR PICKUP'],['shipped','SHIPPED']].map(([id,label],position)=>({id,label,position,order_count:0}));
 await page.route('https://**',route=>route.fulfill({status:200,body:''}));
 await page.route('**/api/**',async route=>{
   const u=new URL(route.request().url());let data=[];if(failAccess&&u.pathname==='/api/access-logs')return route.fulfill({status:503,json:{error:'Synthetic log outage'}});
   if(u.pathname==='/api/analytics/sales-overview') {
     salesRequests.push({from:u.searchParams.get('from'),to:u.searchParams.get('to')});
     if(holdSalesNext){const held=holdSalesNext;holdSalesNext=null;await held;}
     if(failSales)return route.fulfill({status:503,json:{error:'Fixture sales load failed'}});
     return route.fulfill({json:{from:u.searchParams.get('from'),to:u.searchParams.get('to'),orderCount:4,openOrderCount:3,pricedOrderCount:3,missingAmountCount:1,currencies:[{currency:'EUR',total:150,average:75,orders:2},{currency:'USD',total:200,average:200,orders:1}],channels:[{channel:'shopify',currency:'EUR',totalRevenue:150,avgOrderValue:75,orderCount:2},{channel:'amazon',currency:'USD',totalRevenue:200,avgOrderValue:200,orderCount:1}],timeline:[{period:'2026-09-01T00:00:00Z',channel:'shopify',currency:'EUR',totalRevenue:100,orderCount:1},{period:'2026-10-01T00:00:00Z',channel:'shopify',currency:'EUR',totalRevenue:50,orderCount:1},{period:'2026-10-01T00:00:00Z',channel:'amazon',currency:'USD',totalRevenue:200,orderCount:1}]}});
   }
   if(/^\/api\/workflow-statuses\/[^/]+\/appearance$/.test(u.pathname)) {
     if(failAppearance)return route.fulfill({status:400,json:{error:'Choose a valid color and opacity between 0 and 100%.'}});
     const status=statuses.find(status=>status.id===u.pathname.split('/')[3]);Object.assign(status,route.request().postDataJSON());
     return route.fulfill({json:status});
   }
   if(u.pathname==='/api/orders/workflow') {
     const body=route.request().postDataJSON();
     if(failStatus)return route.fulfill({status:409,json:{error:'Selected orders changed. Refresh and try again.'}});
     const orders=await page.evaluate(body=>state.openOrders.filter(order=>body.ids.includes(Number(order.id))).map(order=>({...order,workflow_status:body.workflow_status})),body);
     return route.fulfill({json:orders});
   }
   if(u.pathname==='/api/workflow-statuses/reorder') {
     if(failReorder)return route.fulfill({status:409,json:{error:'Statuses changed. Refresh and try again.'}});
     const ids=route.request().postDataJSON().ids,ordered=ids.map(id=>statuses.find(status=>status.id===id));statuses.splice(0,statuses.length,...ordered);
     return route.fulfill({json:{ok:true}});
   }
   if(/^\/api\/orders\/\d+$/.test(u.pathname) && route.request().method()==='PATCH') {
     const body=route.request().postDataJSON();statusRequests.push(body);
     if(failStatus)return route.fulfill({status:409,json:{error:'Fixture status save failed'}});
     const id=Number(u.pathname.split('/').at(-1)),existing=await page.evaluate(id=>state.openOrders.find(order=>Number(order.id)===id),id);
     return route.fulfill({json:{...existing,...body,shipped:false}});
   }
   if(u.pathname==='/api/orders/export/open') {
     openExportRequests.push(route.request().postDataJSON());return route.fulfill({body:'fixture export',headers:{'Content-Type':'text/csv'}});
   }
   if(u.pathname==='/api/orders/export/archive') {
     exportRequests.push(route.request().postDataJSON());
     return route.fulfill({body:'fixture export',headers:{'Content-Type':'text/csv'}});
   }
   if(u.pathname==='/api/orders') {
     if(u.searchParams.get('pinned'))data=[];
     else if(u.searchParams.get('status')==='archive'){
       const offset=Number(u.searchParams.get('offset')||0);
       if(boardArchiveFixture && u.searchParams.get('limit')==='30'){
         const search=u.searchParams.get('search') || '';boardArchiveRequests.push({search,offset});
         if(holdBoardArchive){const held=holdBoardArchive;holdBoardArchive=null;await held;}
         if(failBoardArchive)return route.fulfill({status:503,json:{error:'Fixture archive unavailable'}});
         const filtered=archiveFixtures.filter(order=>[order.skus,order.external_order_id,order.address].join(' ').toLowerCase().includes(search.toLowerCase()));
         return route.fulfill({json:{orders:filtered.slice(offset,offset+30),total:filtered.length}});
       }
       data={orders:[{...order,id:offset+100,external_order_id:'Archive-'+offset,shipped:true,address:'Archived <customer>\nSlovakia'}],total:30};
     } else data=Array.from({length:1001},(_,i)=>({...order,id:42+i,external_order_id:'AUDIT-'+i,workflow_status:statuses[i%4].id,address:'Audit customer '+i+' with a long synthetic name\nExample street 123\nSlovakia',skus:i===0?'LongProductNameWithoutSpaces'.repeat(4):'Sample product × 2',note:i===1?'A synthetic customer instruction requiring careful packing and a delivery deadline.':''})).slice(0,u.searchParams.get('complete') === 'true' ? Infinity : Number(u.searchParams.get('limit')||500));
   } else if(u.pathname==='/api/inventory')data={materials:[],products:[],rules:[],shopping:[],manufacturers:[],unmapped:[],movements:[]};
   else if(u.pathname==='/api/workflow-statuses')data=statuses;
   else if(u.pathname==='/api/branding')data={name:'MOMS',logo:null};
   else if(u.pathname==='/api/config')data={channels:{},shipping:{}};
   else if(u.pathname==='/api/dashboard')data={openOrders:1001,ordersThisMonth:67,ordersPreviousMonth:81,openByVendor:{Manual:24},thisMonthByVendor:{Manual:67},thisMonthByCountry:{sk:30,de:20,it:17},allTimeByCountry:{sk:220,de:80,it:55},dashboardPins:[]};
   else if(['/api/authorizations','/api/tracking/statuses'].includes(u.pathname))data={};
   await route.fulfill({json:data});
 });



 for (const width of [390, 1500]) for (const language of ['en', 'sk']) {
   await page.setViewportSize({width,height:950});
   boardArchiveFixture=true;failBoardArchive=true;
   await page.goto(`http://127.0.0.1:${server.address().port}/#board`);
   await page.waitForFunction(() => state.openOrders.length === 1001);
   await page.evaluate(language => window.i18n.setLanguage(language), language);
   assert.equal(await page.locator('#orderBoardLoadError').isVisible(),true);
   assert.equal(await page.evaluate(() => state.openOrders.some(order=>order.external_order_id==='AUDIT-1000')),true);
   if(await page.locator('#boardSearchPanel').isHidden())await page.locator('#boardSearchToggle').click();
   await page.locator('#boardSearch').fill('AUDIT-1000');
   assert.equal(await page.locator('.board-card').count(),1);
   failBoardArchive=false;
   await page.locator('#orderBoardLoadError button').click();
   await page.waitForFunction(() => !state.orderLoadErrors.boardArchive);
   failBoardArchive=true;
   await page.evaluate(async()=>{await loadOrders();renderTables();});
   assert.equal(await page.evaluate(()=>state.openOrders.length),1001);
   assert.equal(await page.locator('#orderBoardLoadError').isVisible(),true);
 }
 await browser.close();server.close();console.log('Complete order loading and archive recovery: EN/SK desktop/mobile passed.');
})().catch(e=>{console.error(e);server.close();process.exit(1);});
