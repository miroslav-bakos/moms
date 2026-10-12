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
 let failAccess=false; const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const mutations=[];const uiErrors=[];let partialDeletion=false;const dialogs=[];page.on('pageerror',error=>uiErrors.push(error.stack));
 let shippedQuantity=2;const order={revenue_amount:'123.45',revenue_currency:'EUR',tracking_code:'Save',tracking_url:'https://example.com/tracking/TRACK-42',tracking_status:'In transit',id:42,external_order_id:'Orders',channel:'manual',vendor:'Manual',address:'Save\nSlovakia',skus:'SKU x2',workflow_status:'crafted',shipped:false,ship_by_date:'2026-10-01'};
 const statuses=[['new','NEW'],['in_progress','IN PROGRESS'],['crafted','CRAFTED'],['ready_for_pickup','READY FOR PICKUP'],['shipped','SHIPPED']].map(([id,label],position)=>({id,label,position,order_count:0}));
 await page.route('https://**',route=>route.fulfill({status:200,body:''}));
 await page.route('**/api/**',async route=>{
   const u=new URL(route.request().url());let data=[];
   if(partialDeletion&&route.request().method()==='DELETE'&&/\/api\/orders\/\d+$/.test(u.pathname))return route.fulfill({status:u.pathname.endsWith('/42')?200:409,json:u.pathname.endsWith('/42')?{ok:true}:{error:'Protected fixture'}});
   if(/^\/api\/orders\/\d+\/costs$/.test(u.pathname))return route.fulfill({json:{entered:{currency:'EUR',revision:0},estimate:{currency:'EUR',production:{amount:null,basis:'Unknown',products:[],materials:[]},missing:[],total:null,profit:null,margin_percent:null}}});
   if(u.pathname==='/api/setup-readiness')return route.fulfill({json:{login:true,channels:[],orders:24,mappings:0,last_backup:null,phone_url:'http://192.168.1.100:3080'}});
   if(/\/api\/orders\/\d+\/history$/.test(u.pathname))return route.fulfill({json:[{id:1,created_at:'2026-10-07T10:00:00Z',username:'<script>fixture</script>',action:'order.update',changes:{before:{note:'old'},after:{note:'<img src=x onerror=alert(1)>'}}}]});
   if(/\/api\/orders\/\d+\/fulfillment$/.test(u.pathname))return route.fulfill({json:{business_outcome:'active',produced:true,lines:[{id:1,sku:'Save <fixture>',quantity:4,shipped:shippedQuantity,remaining:4-shippedQuantity,remaining_to_produce:0,material_snapshot:[]}],shipments:[{id:'00000000-0000-4000-8000-000000000001',tracking_code:'TRACK-1',tracking_url:'https://example.com/track',label_url:'',lines:[{line_id:1,quantity:shippedQuantity}]}],returns:[]}});
   if(/\/api\/orders\/\d+\/(shipments|returns)$/.test(u.pathname)){
     const body=route.request().postDataJSON();mutations.push({path:u.pathname,body});if(u.pathname.endsWith('shipments'))shippedQuantity+=body.lines.reduce((sum,line)=>sum+line.quantity,0);return route.fulfill({json:{id:'00000000-0000-4000-8000-000000000002'}});
   }
   if(u.pathname==='/api/poll'){mutations.push({path:u.pathname});return route.fulfill({json:[]});}
if(failAccess&&u.pathname==='/api/access-logs')return route.fulfill({status:503,json:{error:'Synthetic log outage'}});
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
     } else data=Array.from({length:24},(_,i)=>({...order,id:42+i,external_order_id:'AUDIT-'+i,workflow_status:statuses[i%4].id,address:'Audit customer '+i+' with a long synthetic name\nExample street 123\nSlovakia',skus:i===0?'LongProductNameWithoutSpaces'.repeat(4):'Sample product × 2',note:i===1?'A synthetic customer instruction requiring careful packing and a delivery deadline.':''})).slice(0,u.searchParams.get('complete') === 'true' ? Infinity : Number(u.searchParams.get('limit')||500));
   } else if(u.pathname==='/api/inventory')data={materials:[],products:[],rules:[],shopping:[],manufacturers:[],unmapped:[],movements:[]};
   else if(u.pathname==='/api/workflow-statuses')data=statuses;
   else if(u.pathname==='/api/branding')data={name:'MOMS',logo:null};
   else if(u.pathname==='/api/config')data={channels:{},shipping:{}};
   else if(u.pathname==='/api/dashboard')data={openOrders:1001,ordersThisMonth:67,ordersPreviousMonth:81,openByVendor:{Manual:24},thisMonthByVendor:{Manual:67},thisMonthByCountry:{sk:30,de:20,it:17},allTimeByCountry:{sk:220,de:80,it:55},dashboardPins:[]};
   else if(['/api/authorizations','/api/tracking/statuses'].includes(u.pathname))data={};
   await route.fulfill({json:data});
 });



 page.on('dialog',async dialog=>{dialogs.push(dialog.message());if(dialog.type()==='prompt')await dialog.accept('My <local> view');else await dialog.accept();});
 for (const width of [390, 1500]) for (const language of ['en','sk']) for (const theme of ['light','dark']) {
  await page.setViewportSize({width,height:950});await page.goto(`http://127.0.0.1:${server.address().port}/?case=${width}-${language}-${theme}#board`);
  await page.waitForFunction(()=>state.openOrders.length===24);await page.evaluate(()=>i18n.ready);
  await page.evaluate(({language,theme})=>{i18n.setLanguage(language);applyTheme(theme);}, {language,theme});
  assert(await page.locator('#boardManagementPanel').isHidden());
  assert(await page.locator('#boardSearch').isHidden());assert(await page.locator('#boardView .orders-tools').isHidden());
  assert(await page.evaluate(()=>document.getElementById('boardFiltersToggle').getBoundingClientRect().left>=document.getElementById('refreshBoard').getBoundingClientRect().right));
  await page.locator('#boardFiltersToggle').click();
  assert(await page.locator('#boardManagementPanel').isVisible());
  assert(await page.locator('#boardSearch').isHidden());assert(await page.locator('#boardView .orders-tools').isVisible());
  await page.locator('#boardSearchToggle').click();
  await page.locator('#boardSearch').fill('SKU');
  await page.locator('#boardSearchToggle').click();assert(await page.locator('#boardSearch').isHidden());
  assert.equal(await page.locator('#boardSearch').inputValue(),'SKU');
  await page.locator('#boardSearchToggle').click();await page.locator('#boardSearch').fill('');
  await page.selectOption('#workLabel','n');
  await page.locator('#boardFiltersToggle').click();assert(await page.locator('#boardManagementPanel').isHidden());
  assert.equal(await page.locator('#boardFiltersToggle').getAttribute('aria-pressed'),'true');
  await page.locator('#boardFiltersToggle').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);
  assert.equal(await page.locator('.work-filter-summary').innerText().then(text=>text.includes('24 / 24')),true);
  await page.locator('#workSave').click();assert.equal(await page.locator('#workSaved option').count()>1,true);
  await page.locator('#workRename').click();await page.locator('#workDelete').click();await page.locator('#workClear').click();
  await page.locator('#boardFiltersToggle').click();
  await page.evaluate(()=>{setView('dashboard');renderDashboard();localSetup.show();});
  await page.locator('[data-work-alert="overdue"]').click();
  assert.equal(await page.evaluate(()=>document.querySelectorAll('.board-card[data-shipped="true"]').length),0);
  await page.evaluate(()=>openBoardOrderDetails(42));await page.locator('.order-fulfillment #shipmentForm').waitFor();
  await page.locator('.order-history ol').waitFor();
  assert.equal(await page.locator('.order-history script,.order-history img').count(),0);
  assert.equal(await page.locator('.fulfillment-lines strong').innerText(),'Save <fixture>');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);
  await page.locator('#closeOrderDetails').click();
  await page.evaluate(()=>{setView('settings');setSettingsTab('auth');});await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>{const r=document.querySelector('.settings-tab.active').getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth;}),true);
 }
 shippedQuantity=2;await page.evaluate(()=>{setView('board');openBoardOrderDetails(42);});await page.locator('[data-ship-line]').waitFor();
 await page.locator('[data-ship-line]').fill('1');await page.locator('#shipmentForm [name=tracking_code]').fill('TRACK-2');await page.locator('#shipmentForm button').click();
 await page.waitForFunction(()=>document.querySelector('[data-ship-line]')?.max==='1');
 assert.equal(mutations.filter(request=>request.path.endsWith('shipments')).length,1);
 assert.equal(mutations.some(request=>request.path==='/api/poll'),false);
 await page.locator('#closeOrderDetails').click();await page.locator('#restartLocalSetup').evaluate(el=>el.click());
 await page.locator('#localSetupNext').click();await page.locator('#localSetupNext').click();await page.locator('#localSetupAction').click();
 await page.waitForTimeout(200);assert.equal(mutations.filter(request=>request.path==='/api/poll').length,0);assert(await page.locator('#addOrderDialog').isVisible());await page.locator('#addOrderCancel').click();
 partialDeletion=true;await page.evaluate(async()=>{state.selectedOrderIds=new Set([42,43]);await deleteSelectedOrders([42,43],state.selectedOrderIds);});
 assert.equal(await page.evaluate(()=>state.selectedOrderIds.has(43)&&!state.selectedOrderIds.has(42)),true);assert(dialogs.some(text=>text.includes('42')&&text.includes('43: Protected fixture')));
 await page.evaluate(()=>setView('board'));const download=page.waitForEvent('download');await page.evaluate(()=>document.querySelector('[data-export-open-filtered=board][data-export-format=csv]').click());await download;
 assert.match(openExportRequests.at(-1).boardToday,/^\d{4}-\d{2}-\d{2}$/);assert.equal(openExportRequests.at(-1).boardFilters.attention,'overdue');
 for(const width of [1500,390])for(const language of ['en','sk']) {
  await page.setViewportSize({width,height:950});
  await page.evaluate(language=>{i18n.setLanguage(language);setView('settings');setSettingsTab('auth');},language);
  await page.locator('#restartLocalSetup').click();
  assert(await page.locator('#localSetup').isVisible());
  await page.locator('#localSetupNext').click();await page.locator('#localSetupSkip').click();
  await page.locator('#resumeLocalSetup').click();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('moms-local-setup-v1')).step),1,'Continue later preserves progress');
  for(let step=1;step<=6;step++)await page.locator('#localSetupNext').click();
  assert(await page.locator('#localSetup').isHidden());
  assert.equal(await page.locator('#resumeLocalSetup').count(),0,'Finished guide leaves no dashboard launcher');
  await page.reload();await page.waitForFunction(()=>Boolean(window.localSetup));
  await page.evaluate(language=>{i18n.setLanguage(language);setView('dashboard');localSetup.show();},language);
  assert(await page.locator('#localSetup').isHidden(),'Completed guide stays hidden after reload and language change');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('moms-local-setup-v1')).done),true);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 assert.deepEqual(uiErrors,[]);await browser.close();server.close();console.log('Working views, alerts, escaped history, shipments and local onboarding: EN/SK mobile/desktop, light/dark passed.');
})().catch(e=>{console.error(e);server.close();process.exit(1);});
