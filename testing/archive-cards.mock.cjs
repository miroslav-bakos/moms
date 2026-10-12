const {circularIcon}=require('../src/services/branding-icon');
const {productionCost,orderCost}=require('../src/services/costMath');
const { chromium } = require(process.env.MOMS_PLAYWRIGHT_MODULE || '@playwright/test');
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
 const browser=await chromium.launch({headless:true, ...(process.env.MOMS_CHROMIUM_PATH ? {executablePath:process.env.MOMS_CHROMIUM_PATH} : {})});
 const page=await browser.newPage({viewport:{width:1500,height:950},serviceWorkers:'block'});
 await page.addInitScript(()=>localStorage.setItem('mobile-connect-seen','true'));
 let labelPreviewFixture=false;
 let boardArchiveFixture=false,failBoardArchive=false,holdBoardArchive=null;const boardArchiveRequests=[];
 const archiveFixtures=Array.from({length:65},(_,index)=>({id:8000+index,external_order_id:`Archived-${index}`,channel:'manual',vendor:'Manual',skus:index===64?'Deep archive needle <safe>':'Archived product',address:'Archived customer\nSlovakia',workflow_status:'crafted',shipped:true,ship_by_date:'2020-01-01',created_at:new Date(Date.UTC(2026,9,1,0,0,65-index)).toISOString()}));
 const exportRequests=[];const openExportRequests=[];let failStatus=false,failReorder=false,failAppearance=false,failSales=false;const statusRequests=[];const salesRequests=[];let holdSalesNext=null;
 let failSync=false,syncChannels=[];const syncRequests=[];
 const errors=[];page.on('pageerror',e=>errors.push(e.stack||e.message));page.on('dialog',async dialog=>{errors.push(dialog.message());await dialog.dismiss();});
 const order={revenue_amount:'123.45',revenue_currency:'EUR',tracking_code:'Save',tracking_url:'https://example.com/tracking/TRACK-42',tracking_status:'In transit',id:42,external_order_id:'Orders',channel:'manual',vendor:'Manual',address:'Save\nSlovakia',skus:'SKU x2',workflow_status:'crafted',shipped:false,ship_by_date:'2026-10-01'};
 const statuses=[['new','NEW'],['in_progress','IN PROGRESS'],['crafted','CRAFTED'],['ready_for_pickup','READY FOR PICKUP'],['shipped','SHIPPED']].map(([id,label],position)=>({id,label,position,order_count:0}));
 await page.route('**/api/**',async route=>{
   const u=new URL(route.request().url());let data=[];
   if(/^\/api\/orders\/\d+\/costs$/.test(u.pathname)){const entered={currency:'EUR',revision:0};return route.fulfill({json:{entered,estimate:orderCost(order,productionCost(order,{products:[],materials:[],rules:[],aliases:{}}),entered,true)}});}
   if(u.pathname.startsWith('/api/state/') && route.request().method()==='PATCH') {
     syncRequests.push(route.request().postDataJSON());
     if(!failSync)syncChannels=[{channel:u.pathname.split('/').at(-1),enabled:route.request().postDataJSON().enabled}];
     return route.fulfill({status:failSync?503:200,json:failSync?{error:'Fixture sync failure'}:{ok:true}});
   }
   if(u.pathname==='/api/state')return route.fulfill({json:syncChannels});
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
     if(labelPreviewFixture && !u.searchParams.get('pinned')){
       const preview={id:965,external_order_id:'Preview-open',channel:'manual',vendor:'Manual',skus:'Preview product',workflow_status:'new',shipped:false,label_url:'/labels/fixture.pdf'};
       return route.fulfill({json:u.searchParams.get('status')==='archive'?{orders:[{...preview,id:966,external_order_id:'Preview-archived',shipped:true}],total:1}:[preview]});
     }
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
     } else data=boardArchiveFixture?[{id:9000,external_order_id:'Open shipped',channel:'manual',vendor:'Manual',workflow_status:'shipped',shipped:false,skus:'Open product'}]:[order];
   } else if(u.pathname==='/api/inventory')data={materials:[],products:[],rules:[],shopping:[],manufacturers:[],unmapped:[],movements:[]};
   else if(u.pathname==='/api/workflow-statuses')data=statuses;
   else if(u.pathname==='/api/branding')data={name:'MOMS',logo:null};
   else if(u.pathname==='/api/config')data={channels:{},shipping:{}};
   else if(u.pathname==='/api/dashboard')data=null;
   else if(['/api/authorizations','/api/tracking/statuses'].includes(u.pathname))data={};
   await route.fulfill({json:data});
 });

 async function fillBoardSearch(value) {
  if(await page.locator('#boardSearchPanel').isHidden())await page.locator('#boardSearchToggle').click();
  await page.locator('#boardSearch').fill(value);
 }
 async function clickOrderTool(selector) {
  if(selector.includes('board') && await page.locator('#boardManagementPanel').isHidden())await page.locator('#boardFiltersToggle').click();
  const button=page.locator(selector),details=button.locator('xpath=ancestor::details[contains(@class,"orders-tools")]');
  if(!(await details.evaluate(el=>el.open)))await details.locator('summary').click();
  await button.click();assert(!(await details.evaluate(el=>el.open)),'Tool menu closes after choosing an operation');
 }
 await page.goto(`http://127.0.0.1:${server.address().port}/#archive`,{waitUntil:'domcontentloaded'});
 await page.locator('#archiveTable .orders-table').waitFor();
 await page.locator('[data-archive-layout="cards"]').click();
 await page.locator('#archiveTable .order-card').waitFor();
 assert.equal(await page.locator('#archiveTable .order-card').count(),1);
 assert((await page.locator('#archiveTable .order-total strong').textContent()).includes('123'));
 assert.equal(await page.locator('#archiveTable .deadline-overdue,#archiveTable .deadline-today').count(),0);
 assert.equal(await page.locator('#archiveTable .card-customer-name').getByText('Archived <customer>',{exact:true}).count(),2);
 await page.locator('#archiveTable input[type="checkbox"]').first().check();
 assert.equal(await page.evaluate(()=>state.archiveSelectedOrderIds.size),1);
 await page.locator('[data-archive-layout="table"]').click();
 assert.equal(await page.evaluate(()=>state.archiveSelectedOrderIds.size),1);
 await page.locator('[data-archive-layout="cards"]').click();
 await page.locator('#archiveTable .archive-next-btn').click();
 await page.waitForFunction(()=>state.archivePage===1 && state.archiveOrders[0]?.id===115);
 assert.equal(await page.locator('#archiveTable .order-card').count(),1);
 assert((await page.locator('#archiveTable .order-total strong').textContent()).includes('123'));
 await page.locator('#archiveTable .action-menu-btn').click();
 assert(await page.locator('#archiveTable .action-menu-dropdown:not([hidden])').count());
 await page.reload();await page.locator('#archiveTable .order-card').waitFor();
 assert.equal(await page.evaluate(()=>state.archiveLayout),'cards');
 await page.evaluate(()=>window.i18n.setLanguage('sk'));
 assert.equal(await page.locator('[data-archive-layout="cards"]').textContent(),'Karty');
 if(process.env.MOMS_UI_SCREENSHOTS)await page.screenshot({path:process.env.MOMS_UI_SCREENSHOTS+'-desktop.png',fullPage:true});
 await page.setViewportSize({width:700,height:844});
 assert.equal(await page.locator('#archiveTable .card-list').evaluate(el=>getComputedStyle(el).display),'grid');
 await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.locator('#archiveTable .card-expand-btn').click();
 await page.locator('#archiveTable input[type="checkbox"]').first().check();
 if(process.env.MOMS_UI_SCREENSHOTS)await page.screenshot({path:process.env.MOMS_UI_SCREENSHOTS+'-mobile.png',fullPage:true});
 await page.locator('[data-archive-layout="table"]').click();
 assert(await page.locator('#archiveTable .orders-table').isVisible());
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.setViewportSize({width:1500,height:950});
 await page.evaluate(()=>renderTables());
 assert(await page.locator('#archive-column-filters').isHidden(),'Order filters start collapsed');
 await page.locator('#archiveTable [data-column-filters]').click();
 await page.locator('#archiveTable .filters input[data-key="note"]').fill('filtered-fixture');
 await page.waitForFunction(()=>state.filters.archive.note==='filtered-fixture');
 const filtersToggle=page.locator('#archiveTable [data-column-filters]');
 await filtersToggle.click();assert(await page.locator('#archive-column-filters').isHidden());
 assert.equal(await page.evaluate(()=>state.filters.archive.note),'filtered-fixture');
 await filtersToggle.click();assert(await page.locator('#archive-column-filters').isVisible());
 await page.evaluate(()=>state.archiveSelectedOrderIds.clear());
 await page.setViewportSize({width:390,height:844});
 for(const format of ['csv','xlsx']) {
   const download=page.waitForEvent('download');
   await clickOrderTool(`[data-export-archive-filtered][data-export-format="${format}"]`);
   assert.equal((await download).suggestedFilename(),`orders.${format}`);
   assert.equal(exportRequests.at(-1).filters.note,'filtered-fixture');
   assert.equal(exportRequests.at(-1).language,'sk');
   assert.equal(exportRequests.at(-1).format,format);
   assert.equal(exportRequests.at(-1).orderIds,undefined);
 }
 for(const language of ['en','sk']) {
  await page.evaluate(lang=>window.i18n.setLanguage(lang),language);
  for(const width of [1500,390]) {
   await page.setViewportSize({width,height:950});
   await page.reload();await page.waitForFunction(()=>state.openOrders.length===1);await page.evaluate(lang=>window.i18n.setLanguage(lang),language);
   await page.evaluate(()=>{state.selectedOrderIds.clear();state.filters.open={external_order_id:'Orders'};setView('open');renderTables();});
   for(const format of ['csv','xlsx']) {
    const download=page.waitForEvent('download');await clickOrderTool(`[data-export-open-filtered="open"][data-export-format="${format}"]`);
    assert.equal((await download).suggestedFilename(),`orders.${format}`);
    assert.equal(openExportRequests.at(-1).filters.external_order_id,'Orders');assert.equal(openExportRequests.at(-1).language,language);
    assert.equal(openExportRequests.at(-1).orderIds,undefined);
   }
   await page.evaluate(()=>{state.boardStage='crafted';setView('board');renderOrderBoard();});
   await fillBoardSearch('In transit');
   if(await page.locator('#boardManagementPanel').isHidden())await page.locator('#boardFiltersToggle').click();const tools=page.locator('#boardView .orders-tools');await tools.locator('summary').focus();await page.keyboard.press('Enter');assert(await tools.evaluate(el=>el.open));
   await page.keyboard.press('Escape');assert(!(await tools.evaluate(el=>el.open)));assert(await tools.locator('summary').evaluate(el=>el===document.activeElement));

   const download=page.waitForEvent('download');await clickOrderTool('[data-export-open-filtered="board"][data-export-format="csv"]');await download;
   assert.equal(openExportRequests.at(-1).view,'board');assert.equal(openExportRequests.at(-1).boardSearch,'In transit');
   assert.equal(openExportRequests.at(-1).boardStage,width<=700?'crafted':'');
   assert.deepEqual(openExportRequests.at(-1).filters,{});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
 }
 await page.evaluate(()=>{
  state.openOrders=[
   {id:501,external_order_id:'405-3504256-0919539',channel:'amazon',vendor:'Amazon.it',address:null,workflow_status:'new'},
   {id:502,external_order_id:'303-0744805-7132437',channel:'',vendor:'Amazon.de',address:'  \n ',workflow_status:'new'},
   {id:503,channel:'amazon',vendor:'Amazon.it',address:'Customer <name>\nStreet 1\nSlovakia',workflow_status:'new',skus:'Long handmade product name',tracking_code:'CA052155550SK',tracking_status:'In transit',ship_by_date:'2026-10-06'},
   {id:504,channel:'shopify',vendor:'Shopify',address:'',workflow_status:'new'}
  ];state.boardStage='new';document.getElementById('boardSearch').value='';setView('board');renderOrderBoard();
 });
 for(const language of ['en','sk']) {
  await page.evaluate(lang=>window.i18n.setLanguage(lang),language);
  for(const width of [1500,390]) {
   await page.setViewportSize({width,height:950});
   assert.equal(await page.locator('.board-missing-address').count(),2);
   const number=page.locator('[data-order-id="501"] .board-order-number');assert.equal(await number.textContent(),'405-3504256-0919539');await page.waitForFunction(()=>{const el=document.querySelector('[data-order-id="501"] .board-order-number');const badge=el?.closest('.board-order-identity').querySelector('.vendor-badge');if(!el || !badge)return false;const number=el.getBoundingClientRect(),channel=badge.getBoundingClientRect();return number.height>0 && number.width>0 && el.scrollWidth<=el.clientWidth+1 && number.left>=channel.right && number.right<=el.closest('.board-card').getBoundingClientRect().right+1;});
   await page.waitForFunction(()=>{const el=document.querySelector('[data-order-id="501"] .board-details-button');return el && getComputedStyle(el).color==='rgb(255, 255, 255)';});

   assert.equal(await page.locator('.board-missing-address').first().textContent(),language==='sk'?'Chýbajúca adresa':'Missing address');
   await page.waitForFunction(()=>{const el=document.querySelector('.board-missing-address');return el && getComputedStyle(el).fontWeight==='700';});
   for(const [theme,color] of [['light','rgb(189, 38, 57)'],['dark','rgb(255, 140, 155)']]) {
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    for(const id of [501,502]) await page.waitForFunction(({id,color})=>{const el=document.querySelector(`[data-order-id="${id}"] .board-missing-address`);return el && getComputedStyle(el).color===color;},{id,color});
   }
   assert.equal(await page.locator('[data-order-id="501"] .board-customer img,[data-order-id="502"] .board-customer img').count(),0);
   assert.equal(await page.locator('[data-order-id="501"] .board-address-copy,[data-order-id="502"] .board-address-copy').count(),0);
   assert(await page.locator('[data-order-id="503"] .board-customer').getByText('Customer <name>',{exact:true}).isVisible());
   assert.equal(await page.locator('[data-order-id="503"] .board-customer .country-flag').count(),1);
   assert.equal(await page.locator('[data-order-id="504"] .board-missing-address').count(),0);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
 }
 for(const language of ['en','sk']) {
  await page.evaluate(lang=>window.i18n.setLanguage(lang),language);
  await page.setViewportSize({width:390,height:844});
  await page.locator('#mobileMoreButton').click();
  assert(await page.locator('#mobileMoreMenu').isVisible());assert(await page.locator('main').evaluate(el=>el.inert));
  await page.keyboard.press('Escape');assert(!(await page.locator('main').evaluate(el=>el.inert)));
  assert(await page.locator('#mobileMoreButton').evaluate(el=>el===document.activeElement));
  await page.locator('[data-order-id="503"] .action-menu-btn').click();
  assert(await page.locator('#mobileOrderActions').evaluate(el=>el.open));
  assert((await page.locator('#mobileOrderActions [data-board-action]').count())>=7);
  assert((await page.locator('#mobileOrderActionsSubtitle').textContent()).includes('Customer <name>'));assert.equal(await page.locator('#mobileOrderActionsSubtitle name').count(),0);
  if(process.env.MOMS_UI_SCREENSHOTS)await page.screenshot({path:process.env.MOMS_UI_SCREENSHOTS+'-actions-'+language+'.png'});
  await page.keyboard.press('Escape');await page.locator('#mobileOrderActions').waitFor({state:'hidden'});
  await page.locator('[data-order-id="503"] .action-menu-btn').click();
  await page.locator('#mobileOrderActions [data-board-action="edit"]').click();
  await page.locator('#archiveEditDialog').waitFor();await page.locator('#archiveEditCancel').click();
  assert(!(await page.locator('#mobileOrderActions').evaluate(el=>el.open)));
  await page.locator('[data-board-select="503"]').check();
  assert(!(await page.locator('#boardSelectionBar .selection-actions-disclosure').evaluate(el=>el.open)));
  await page.locator('#boardSelectionBar summary').click();assert(await page.locator('[data-board-bulk="markShipped"]').isVisible());
  await page.locator('#boardClearSelection').click();
  if(process.env.MOMS_UI_SCREENSHOTS)await page.screenshot({path:process.env.MOMS_UI_SCREENSHOTS+'-board-'+language+'.png'});
  await page.setViewportSize({width:1500,height:950});
  await page.locator('[data-order-id="503"] .action-menu-btn').click();
  assert(!(await page.locator('#mobileOrderActions').evaluate(el=>el.open)));assert(await page.locator('[data-order-id="503"] .action-menu-dropdown').isVisible());
  await page.keyboard.press('Escape');
 }
 for(const language of ['en','sk']) {
  await page.evaluate(lang=>window.i18n.setLanguage(lang),language);await page.setViewportSize({width:1280,height:950});
  await page.evaluate(()=>{setView('board');renderOrderBoard();});
  const card=page.locator('[data-order-id="503"]');
  await card.locator('.board-products').click({button:'right'});
  assert(await page.locator('.desktop-context-menu').isVisible());
  const menuBounds=await page.locator('.desktop-context-menu').boundingBox();assert(menuBounds.x>=0 && menuBounds.x+menuBounds.width<=1280);
  await page.keyboard.press('End');assert.equal(await page.evaluate(()=>document.activeElement.dataset.boardAction),'delete');
  await page.keyboard.press('Home');assert.equal(await page.evaluate(()=>document.activeElement.dataset.boardAction),'gls');
  await page.keyboard.press('Escape');assert.equal(await page.locator('.desktop-context-menu').count(),0);
  await card.scrollIntoViewIfNeeded();await card.focus();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.keyboard.press('Shift+F10');assert(await page.locator('.desktop-context-menu').isVisible());
  await page.locator('.desktop-context-menu [data-board-action="edit"]').click();await page.locator('#archiveEditDialog').waitFor();
  await page.keyboard.press('Control+Alt+1');assert.equal(await page.evaluate(()=>state.activeView),'board');await page.locator('#archiveEditCancel').click();
  await card.locator('[data-board-select]').check();assert(await card.evaluate(el=>el.classList.contains('board-card-selected')));
  await card.locator('[data-board-select]').uncheck();assert(!(await card.evaluate(el=>el.classList.contains('board-card-selected'))));
  await card.focus();await page.keyboard.press('Control+k');assert(await page.locator('#boardSearch').evaluate(el=>el===document.activeElement));
  await page.keyboard.press('Control+Alt+1');assert.equal(await page.evaluate(()=>state.activeView),'board','Typing targets suppress navigation shortcuts');
  await card.focus();await page.keyboard.press('Meta+k');assert(await page.locator('#boardSearch').evaluate(el=>el===document.activeElement));
  await card.focus();await page.keyboard.press('Control+Alt+1');assert.equal(await page.evaluate(()=>state.activeView),'dashboard');
  await page.keyboard.press('Control+Alt+2');assert.equal(await page.evaluate(()=>state.activeView),'board');
  await page.locator('#keyboardShortcutsButton').click();assert(await page.locator('#keyboardShortcutsDialog').isVisible());await page.keyboard.press('Escape');
  for(const width of [1500,390]) {
   await page.setViewportSize({width,height:950});await page.evaluate(()=>{setView('board');renderOrderBoard();});
   await page.locator('[data-order-id="503"] [data-order-details]').click();
   await page.locator('#orderDetailsDialog').waitFor();
   assert((await page.locator('#orderDetailsContent').textContent()).includes('Customer <name>'));assert.equal(await page.locator('#orderDetailsContent name').count(),0);
   assert((await page.locator('#orderDetailsContent').textContent()).includes('CA052155550SK'));
   await page.evaluate(()=>{copyToClipboard=async value=>{window.fixtureCopied=value;};});
   await page.locator('#orderDetailsCopyTracking').click();assert.equal(await page.evaluate(()=>window.fixtureCopied),'CA052155550SK');
   await page.locator('#orderDetailsCopyAddress').click();assert((await page.evaluate(()=>window.fixtureCopied)).includes('Street 1'));
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.locator('#orderDetailsActions [data-board-action="edit"]').click();
   await page.locator('#archiveEditDialog').waitFor();await page.locator('#archiveEditCancel').click();
   assert(!(await page.locator('#orderDetailsDialog').evaluate(el=>el.open)));
   await page.locator('[data-order-id="503"]').focus();await page.keyboard.press('Enter');await page.locator('#orderDetailsDialog').waitFor();await page.keyboard.press('Escape');
   await page.locator('[data-order-id="501"] [data-order-details]').click();assert(await page.locator('#orderDetailsCopyAddress').isHidden());await page.locator('#closeOrderDetails').click();
  }
  for(const width of [1024,1280,1920]) {
   await page.setViewportSize({width,height:950});
   await page.evaluate(theme=>document.documentElement.dataset.theme=theme,width===1280?'dark':'light');
   await page.locator('.top-nav [data-view="board"]').click();
   const layout=await page.evaluate(()=>({nav:document.querySelector('.top-nav').getBoundingClientRect().toJSON(),main:document.querySelector('main').getBoundingClientRect().toJSON(),overflow:document.documentElement.scrollWidth>innerWidth}));
   assert(layout.nav.height>600);assert(layout.main.left>=layout.nav.right);assert(!layout.overflow);
   await page.evaluate(()=>window.scrollTo(0,400));
   await page.locator('.top-nav [data-view="dashboard"]').click();
   assert.equal(await page.evaluate(()=>window.scrollY),0);
   await page.evaluate(()=>{state.dashboard={openOrders:15,ordersThisMonth:8,ordersPreviousMonth:42,openByVendor:{Shopify:6,Etsy:3},thisMonthByVendor:{Shopify:3},thisMonthByCountry:{sk:3},allTimeByCountry:{sk:20},dashboardPins:[],openOrderValue:{missingAmountCount:1,currencies:[{currency:'EUR',total:'123.45'},{currency:'USD',total:'67.89'}]}};renderDashboard();});
   assert.equal(await page.locator('#dashboardContent > .dash-grid:first-child > .dash-card').count(),6);
   assert.equal(await page.locator('.open-order-value .dash-value').count(),2);
   assert((await page.locator('.open-order-value').textContent()).includes('123'));
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   if(process.env.MOMS_UI_SCREENSHOTS && width===1280)await page.screenshot({path:process.env.MOMS_UI_SCREENSHOTS+'-dashboard-'+language+'.png'});
  }
 }
 for(const language of ['en','sk']) {
  await page.evaluate(lang=>window.i18n.setLanguage(lang),language);
  for(const width of [1500,390]) {
   await page.setViewportSize({width,height:950});
   await page.evaluate(()=>{state.openOrders.find(order=>order.id===503).workflow_status='new';state.boardStage='new';setView('board');renderOrderBoard();});
   await page.locator('[data-order-id="503"] [data-order-details]').click();
   failStatus=true;await page.locator('#orderDetailsStatus').selectOption('crafted');
   await page.waitForFunction(()=>!document.getElementById('orderDetailsStatus').disabled);
   assert.equal(await page.locator('#orderDetailsStatus').inputValue(),'new');
   assert((await page.locator('#orderDetailsMessage').textContent()).includes('Fixture status save failed'));
   assert.equal(await page.evaluate(()=>state.openOrders.find(order=>order.id===503).workflow_status),'new');
   failStatus=false;await page.locator('#orderDetailsStatus').selectOption('in_progress');
   await page.waitForFunction(()=>!document.getElementById('orderDetailsStatus').disabled);
   assert.equal(await page.locator('#orderDetailsStatus').inputValue(),'in_progress');
   if(width<=700)assert.equal(await page.evaluate(()=>state.boardStage),'new');
   assert.deepEqual(statusRequests.at(-1),{workflow_status:'in_progress',confirm_marketplace_dispatch:false});
   assert.equal(await page.evaluate(()=>state.openOrders.find(order=>order.id===503).shipped),false,'Changing production status does not archive');
   assert.equal(await page.locator('#orderDetailsMessage').textContent(),language==='sk'?'Stav uložený':'Status saved');
   await page.waitForFunction(()=>document.querySelector('#orderCostForm [name=vat_cost_basis]')?.disabled);
   assert.equal(await page.evaluate(()=>document.getElementById('orderCosts').costDirty()),false,'Status changes preserve VAT controls and the saved cost baseline');
   await page.locator('#closeOrderDetails').click();
   assert.equal(await page.locator('[data-order-id="503"]').isVisible(),width>700);
  }
 }
 for(const language of ['en','sk']) {
  await page.evaluate(lang=>window.i18n.setLanguage(lang),language);
  for(const width of [1500,390]) {
   await page.setViewportSize({width,height:950});
   const forms=[['archiveEditDialog','archiveEditNote','archiveEditCancel'],['addressDialog','addressDialogText','addressDialogCancel'],['noteDialog','noteDialogText','noteDialogCancel'],['skusDialog','skusDialogText','skusDialogCancel'],['trackingDialog','trackingDialogCode','trackingDialogCancel'],['addOrderDialog','addOrderNote','addOrderCancel']];
   for(const [id,field,cancel] of forms){
    async function open(){await page.evaluate(id=>{const order=state.openOrders.find(order=>order.id===503);if(id==='archiveEditDialog')openArchiveEditDialog(order);else if(id==='addressDialog')openAddressDialog(order.id,order.address);else if(id==='noteDialog')openNoteDialog(order.id,order.note || '');else if(id==='skusDialog')openSkusDialog(order.id,order.skus);else if(id==='trackingDialog')openTrackingDialog(order);else document.getElementById('addOrder').click();document.querySelectorAll('input').forEach(input=>input._flatpickr?.close());},id);}
    await open();await page.locator('#'+cancel).click();assert(!(await page.locator('#'+id).evaluate(el=>el.open)),'Unchanged forms close immediately');
    await open();const input=page.locator('#'+field),original=await input.inputValue();await input.fill(original+' fixture draft');
    assert(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}));
    await page.locator('#'+cancel).click();const notice=page.locator('#'+id+' .unsaved-order-notice');assert(await notice.isVisible());
    assert.equal(await notice.locator('p').textContent(),language==='sk'?'Máte neuložené zmeny.':'You have unsaved changes.');
    await notice.locator('[data-keep-editing]').click();assert.equal(await input.inputValue(),original+' fixture draft');
    await input.fill(original);await page.keyboard.press('Escape');assert(!(await page.locator('#'+id).evaluate(el=>el.open)),'Reverting changes removes the warning');
    await open();await input.fill(original+' fixture draft');await page.keyboard.press('Escape');assert(await notice.isVisible());
    await notice.locator('[data-discard-changes]').click();assert(!(await page.locator('#'+id).evaluate(el=>el.open)));
    assert(!(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})));
   }
  }
 }
 for(const language of ['en','sk']) {
  await page.evaluate(lang=>window.i18n.setLanguage(lang),language);
  for(const width of [1500,390]) {
   await page.setViewportSize({width,height:950});await page.evaluate(()=>{setView('settings');setSettingsTab('workflow');});
   await page.locator('[data-workflow-id="new"] [data-workflow-move="1"]').click();
   await page.waitForFunction(()=>!workflowSettingsBusy);
   assert.deepEqual(await page.evaluate(()=>WORKFLOW_STAGES.slice(0,2).map(stage=>stage[0])),['in_progress','new']);
   assert.equal(await page.locator('#orderBoard .board-column').first().getAttribute('data-stage'),'in_progress');
   await page.locator('[data-workflow-id="new"] [data-workflow-move="-1"]').click();await page.waitForFunction(()=>!workflowSettingsBusy);
   assert.equal(await page.locator('#orderBoard .board-column').first().getAttribute('data-stage'),'new');
   failReorder=true;await page.locator('[data-workflow-id="new"] [data-workflow-move="1"]').click();await page.waitForFunction(()=>!workflowSettingsBusy);failReorder=false;
   assert.equal(await page.evaluate(()=>WORKFLOW_STAGES[0][0]),'new');assert(await page.locator('#workflowSettingsMessage').textContent());
   const overflow=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>el.getClientRects().length && el.getBoundingClientRect().right>innerWidth+1).map(el=>[el.tagName,el.id,el.className,Math.round(el.getBoundingClientRect().right)]).slice(0,16));
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),JSON.stringify(overflow));
   await page.waitForFunction(()=>[...document.querySelectorAll('button')].filter(button=>button.getClientRects().length && /[\p{L}]/u.test(button.textContent)).every(button=>button.querySelector('svg')));
  }
 }
 for(const language of ['en','sk']) for(const width of [1500,390]) for(const view of ['board','open']) {
  await page.setViewportSize({width,height:950});
  await page.evaluate(({language,view})=>{window.i18n.setLanguage(language);state.openOrders=[{id:701,channel:'manual',vendor:'Manual',skus:'<fixture>',workflow_status:'new',shipped:false},{id:702,channel:'manual',vendor:'Manual',skus:'Unknown',workflow_status:'new',shipped:false}];state.selectedOrderIds=new Set([701,702]);state.boardStage='new';setView(view);renderTables();}, {language,view});
  const bar=page.locator(view==='board'?'#boardSelectionBar':'#openSelectionBar');
  const disclosure=bar.locator('details');if(!(await disclosure.evaluate(el=>el.open)))await disclosure.locator('summary').click();
  await bar.locator(view==='board'?'[data-board-bulk="changeSelectedStatus"]':'#changeSelectedStatus').click();
  assert(await page.locator('#bulkStatusDialog').isVisible());
  assert.equal(await page.locator('#bulkStatusDialog h2').textContent(),language==='sk'?'Zmeniť stav':'Change status');
  if(process.env.MOMS_UI_SCREENSHOTS && width===390 && language==='sk' && view==='board')await page.screenshot({path:process.env.MOMS_UI_SCREENSHOTS+'-bulk-mobile.png'});
  await page.locator('#bulkStatusSelect').selectOption('shipped');
  failStatus=true;await page.locator('#bulkStatusSave').click();await page.waitForFunction(()=>!bulkStatusBusy);failStatus=false;
  assert(await page.locator('#bulkStatusMessage').textContent());
  assert(await page.evaluate(()=>state.openOrders.every(order=>order.workflow_status==='new') && state.selectedOrderIds.size===2));
  await page.locator('#bulkStatusSave').click();await page.waitForFunction(()=>!bulkStatusBusy);
  assert(await page.evaluate(()=>state.openOrders.every(order=>order.workflow_status==='shipped' && !order.shipped) && !state.selectedOrderIds.size));
  assert(!(await page.locator('#bulkStatusDialog').isVisible()));
  assert.equal(await page.evaluate(()=>state.boardStage),'shipped');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 for(const language of ['en','sk']) {
  await page.setViewportSize({width:390,height:950});
  await page.evaluate(language=>{window.i18n.setLanguage(language);state.openOrders=[{id:901,channel:'manual',vendor:'Manual',skus:'First',workflow_status:'new',shipped:false},{id:902,channel:'manual',vendor:'Manual',skus:'Remaining',workflow_status:'new',shipped:false}];state.boardStage='new';document.getElementById('boardSearch').value='';setView('board');renderTables();},language);
  await page.locator('[data-board-status="901"]').selectOption('in_progress');
  await page.waitForFunction(()=>!boardSaving);
  assert.equal(await page.evaluate(()=>state.boardStage),'new');
  assert.equal(await page.locator('#board-tab-new').getAttribute('aria-selected'),'true');
  assert(await page.locator('.board-column-active [data-order-id="902"]').isVisible());
  assert.equal(await page.locator('.board-column-active [data-order-id="901"]').count(),0);
  await page.locator('#board-tab-in_progress').click();
  assert(await page.locator('.board-column-active [data-order-id="901"]').isVisible());
 }
 for(const language of ['en','sk']) for(const width of [1500,390]) {
  await page.setViewportSize({width,height:950});await page.evaluate(language=>{window.i18n.setLanguage(language);setView('settings');setSettingsTab('workflow');},language);
  const row=page.locator('[data-workflow-id="new"]');
  await row.locator('[data-workflow-color]').fill('#2266aa');await row.locator('[data-workflow-alpha]').fill('35');
  await row.locator('[data-workflow-appearance]').click();await page.waitForFunction(()=>!workflowSettingsBusy);
  assert.equal(await page.locator('#board-column-new').evaluate(el=>el.style.backgroundColor),'rgba(34, 102, 170, 0.35)');
  if(process.env.MOMS_UI_SCREENSHOTS && language==='sk')await page.screenshot({path:`${process.env.MOMS_UI_SCREENSHOTS}-column-settings-${width}.png`});
  failAppearance=true;await row.locator('[data-workflow-alpha]').fill('50');await row.locator('[data-workflow-appearance]').click();await page.waitForFunction(()=>!workflowSettingsBusy);failAppearance=false;
  assert.equal(await page.locator('#board-column-new').evaluate(el=>el.style.backgroundColor),'rgba(34, 102, 170, 0.35)');
  await row.locator('[data-workflow-reset]').click();await page.waitForFunction(()=>!workflowSettingsBusy);
  assert.equal(await page.locator('#board-column-new').evaluate(el=>el.style.backgroundColor),'');
  await page.evaluate(()=>{setView('marketing');return loadMarketingData().then(renderMarketing);});
  assert.equal(await page.locator('#marketingView h2').textContent(),language==='sk'?'Predaje':'Sales');
  assert.equal(await page.locator('.sales-summary-card').count(),4);
  assert.equal(await page.locator('.sales-chart').count(),4);
  assert.equal(await page.locator('.marketing-table tbody tr').count(),3);
  await page.evaluate(()=>{state.salesOverview.channels[0].channel='Shopify <fixture>';renderMarketing();});
  assert((await page.locator('.marketing-channel-name').first().textContent()).includes('<fixture>'));
  assert.equal(await page.locator('.marketing-channel-name fixture').count(),0);
  await page.evaluate(()=>loadMarketingData().then(renderMarketing));
  assert(await page.locator('.sales-summary').textContent().then(text=>text.includes('150') && text.includes('200')));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(process.env.MOMS_UI_SCREENSHOTS && language==='sk')await page.screenshot({path:`${process.env.MOMS_UI_SCREENSHOTS}-sales-${width}.png`,fullPage:true});
  failSales=true;await page.locator('#refreshMarketing').click();await page.waitForFunction(()=>!document.getElementById('refreshMarketing').disabled);failSales=false;assert(await page.locator('#marketingContent [role="alert"]').isVisible());
  await page.evaluate(()=>loadMarketingData().then(renderMarketing));
  await page.evaluate(()=>{state.openOrders=[{id:950,channel:'shopify',vendor:'Shopify',skus:'Fixture',workflow_status:'new',shipped:false,revenue_amount:'0',revenue_currency:'EUR'},{id:951,channel:'manual',vendor:'Manual',skus:'Fixture',workflow_status:'new',shipped:false,revenue_amount:null,revenue_currency:'EUR'}];state.boardStage='new';setView('board');renderTables();});
  const zero=page.locator('[data-order-id="950"] .order-total strong'),missing=page.locator('[data-order-id="951"] .order-total strong');
  assert(await zero.isVisible());assert((await zero.textContent()).includes('0'));assert.equal(await missing.textContent(),'—');
  assert(!await page.evaluate(()=>document.querySelector('.order-total [data-no-translate] script')));
  if(process.env.MOMS_UI_SCREENSHOTS && language==='sk')await page.screenshot({path:`${process.env.MOMS_UI_SCREENSHOTS}-amounts-${width}.png`,fullPage:true});
 }
 await page.evaluate(()=>{setView('marketing');state.marketingPeriodDays=365;return loadMarketingData().then(renderMarketing);});
 const yearly=new Date(salesRequests.at(-1).from);assert.equal(yearly.getMonth(),0);assert.equal(yearly.getDate(),1);
 let releaseSales;holdSalesNext=new Promise(resolve=>{releaseSales=resolve;});
 await page.evaluate(()=>{state.marketingPeriodDays=90;window.lateSalesDone=false;void loadMarketingData().then(()=>{renderMarketing();window.lateSalesDone=true;});});
 await page.waitForFunction(()=>state.salesLoading);
 await page.evaluate(()=>{state.marketingPeriodDays=30;return loadMarketingData().then(renderMarketing);});
 const latestFrom=salesRequests.at(-1).from;releaseSales();await page.waitForFunction(()=>window.lateSalesDone);
 assert.equal(await page.evaluate(()=>state.salesOverview.from),latestFrom,'Late period response cannot replace the current report');
 boardArchiveFixture=true;
 for(const language of ['en','sk'])for(const width of [1500,390]){
  await page.setViewportSize({width,height:950});
  await page.evaluate(async language=>{window.i18n.setLanguage(language);document.getElementById('boardSearch').value='';state.boardStage='new';state.boardShippedCollapsed=true;state.openOrders=[{id:9000,external_order_id:'Open shipped',channel:'manual',vendor:'Manual',workflow_status:'shipped',shipped:false,skus:'Open product'}];await loadBoardArchive();setView('board');renderOrderBoard();},language);
  assert(await page.locator('#board-shipped-cards').evaluate(el=>el.hidden));
  assert.equal(await page.locator('#board-tab-shipped .board-count').textContent(),'66');
  assert.equal(await page.locator('#board-column-shipped .board-count').textContent(),'66');
  if(width===390)await page.locator('#board-tab-shipped').click();else await page.locator('[data-board-shipped-toggle]').click();
  await page.waitForFunction(()=>!boardArchiveLoading);
  assert(await page.locator('[data-order-id="8000"]').isVisible());
  assert.equal(await page.locator('#board-shipped-cards .board-card').count(),31);
  assert.equal(await page.locator('[data-order-id="8000"]').getAttribute('draggable'),'false');
  assert.equal(await page.locator('[data-order-id="8000"] [data-board-status]').count(),0);
  assert.equal(await page.locator('[data-order-id="8000"] .deadline-overdue').count(),0);
  assert.equal(await page.locator('[data-order-id="8000"] [data-board-action="archive"]').count(),0);
  await page.locator('[data-order-id="8000"] [data-order-details]').click();
  assert(await page.locator('#orderDetailsStatus').isDisabled());
  assert((await page.locator('#orderDetailsContent').textContent()).includes(language==='sk'?'Archivovaná':'Archived'));
  await page.locator('#closeOrderDetails').click();
  await page.locator('[data-board-archive-more]').click();await page.waitForFunction(()=>state.boardArchiveOrders.length===60);
  await page.locator('[data-board-archive-more]').click();await page.waitForFunction(()=>state.boardArchiveOrders.length===65);
  assert.equal(await page.locator('[data-board-archive-more]').count(),0);
  await page.locator('[data-board-shipped-toggle]').click();
  await fillBoardSearch('Deep archive needle');
  await page.waitForFunction(()=>state.boardArchiveTotal===1 && state.boardArchiveOrders[0]?.id===8064);
  assert(await page.locator('[data-order-id="8064"]').isVisible());
  assert((await page.locator('[data-order-id="8064"] .board-products').textContent()).includes('<safe>'));
  assert.equal(await page.locator('[data-order-id="8064"] safe').count(),0);
  assert.equal(await page.locator('#board-column-shipped .board-count').textContent(),'1');
  assert.equal(await page.locator('#board-column-crafted [data-order-id="8064"]').count(),0);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(process.env.MOMS_UI_SCREENSHOTS && language==='sk')await page.screenshot({path:`${process.env.MOMS_UI_SCREENSHOTS}-archive-search-${width}.png`,fullPage:true});
 }
 failBoardArchive=true;await fillBoardSearch('failure');await page.waitForFunction(()=>document.getElementById('boardMessage').textContent==='Fixture archive unavailable');failBoardArchive=false;
 let releaseArchive;holdBoardArchive=new Promise(resolve=>releaseArchive=resolve);
 await fillBoardSearch('Archived product');await page.waitForFunction(()=>boardArchiveLoading);
 await fillBoardSearch('Deep archive needle');await page.waitForFunction(()=>state.boardArchiveTotal===1);
 releaseArchive();await page.waitForTimeout(150);
 assert.equal(await page.evaluate(()=>state.boardArchiveOrders[0]?.id),8064,'Late archive search cannot replace current results');
 assert(await page.evaluate(()=>state.openOrders.every(order=>!order.shipped)),'Showing archive does not archive open orders');
 labelPreviewFixture=true;
 await page.context().route('**/labels/fixture.pdf',route=>route.fulfill({body:'Fixture label preview',contentType:'text/plain'}));
 for(const language of ['en','sk'])for(const width of [1500,390]){
  await page.setViewportSize({width,height:950});
  await page.evaluate(language=>{window.i18n.setLanguage(language);document.getElementById('boardSearch').value='';state.pinnedOrders=[];state.pinnedOrderIds.clear();state.filters.open={};state.filters.archive={};state.archivePage=0;state.openOrders=[{id:965,external_order_id:'Preview-open',channel:'manual',vendor:'Manual',skus:'Preview product',workflow_status:'new',shipped:false,label_url:'/labels/fixture.pdf'}];state.archiveOrders=[{...state.openOrders[0],id:966,external_order_id:'Preview-archived',shipped:true}];state.archiveTotal=1;state.boardArchiveOrders=state.archiveOrders;state.boardArchiveTotal=1;state.boardShippedCollapsed=false;state.boardStage='new';setView('board');renderTables();},language);
  for(const [view,id] of [['board',965],['open',965],['archive',966]]){
   await page.evaluate(({view,width})=>{if(view==='archive')state.archiveLayout=width<=640?'cards':'table';setView(view);renderTables();},{view,width});
   const scope=view==='board'?page.locator(`[data-order-id="${id}"]`):page.locator(`#${view}Table`);
   if(width<=640 && view==='archive')await scope.locator('.card-expand-btn').click();
   await scope.locator('.action-menu-btn:visible').first().click();
   const menu=width<=640?page.locator('#mobileOrderActions'):page.locator('.action-menu-dropdown:not([hidden])');
   const show=menu.locator('[data-show-label]');assert(await show.isEnabled());
   assert((await show.textContent()).includes(language==='sk'?'Zobraziť štítok':'Show label'));
   if(view==='board')assert((await menu.locator('[data-board-action="gls"]').textContent()).includes(language==='sk'?'Vygeneruj':'Generate'));
   const popupReady=page.context().waitForEvent('page');await show.click();const popup=await popupReady;await popup.waitForLoadState();assert(popup.url().endsWith('/labels/fixture.pdf'));await popup.close();
  }
  await page.evaluate(()=>{state.boardStage='shipped';setView('board');renderTables();});
  await page.locator('[data-order-id="966"] [data-order-details]').click();
  const direct=page.locator('#orderDetailsContent [data-show-label]');assert(await direct.isEnabled());
  const popupReady=page.context().waitForEvent('page');await direct.click();const popup=await popupReady;await popup.waitForLoadState();assert(popup.url().endsWith('/labels/fixture.pdf'));await popup.close();
  assert.equal(await page.locator('#orderDetailsDialog .order-details-actions summary').count(),0);assert(await page.locator('#orderDetailsActions [data-show-label]').isVisible());
  if(process.env.MOMS_UI_SCREENSHOTS && language==='sk')await page.screenshot({path:`${process.env.MOMS_UI_SCREENSHOTS}-detail-actions-${width}.png`});
  await page.locator('#closeOrderDetails').click();
  await page.evaluate(()=>{state.openOrders[0].label_url='javascript:alert(1)';state.boardStage='new';renderTables();});
  assert(await page.locator('[data-order-id="965"] [data-show-label]').isDisabled());
  await page.evaluate(()=>{state.openOrders[0].label_url='';renderTables();});
  assert(await page.locator('[data-order-id="965"] [data-show-label]').isDisabled());
 }
 for(const language of ['en','sk'])for(const width of [1500,390]){
  await page.setViewportSize({width,height:950});
  await page.evaluate(language=>{window.i18n.setLanguage(language);openArchiveEditDialog({id:965,skus:'Fixture',created_at:'2026-10-01T12:00:00Z',ship_by_date:'2026-10-20',address:'Fixture address'});},language);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'archiveEditSkus');
  assert.equal(await page.locator('#archiveEditDialog .flatpickr-calendar.open').count(),0);
  const dates=await page.locator('#archiveEditCreatedAt,#archiveEditShipByDate').evaluateAll(inputs=>inputs.map(input=>input.value));
  assert.deepEqual(dates,['01.10.2026','20.10.2026']);
  await page.locator('#archiveEditShipByDateToggle').click();assert.equal(await page.locator('#archiveEditDialog .flatpickr-calendar.open').count(),1);
  await page.evaluate(()=>fpArchiveShipByDate.close());await page.locator('#archiveEditCancel').click();
  await page.evaluate(()=>openArchiveEditDialog({id:965,skus:'Fixture',created_at:'2026-10-01T12:00:00Z',ship_by_date:'2026-10-20',address:'Fixture address'}));
  assert.equal(await page.locator('#archiveEditDialog .flatpickr-calendar.open').count(),0);await page.locator('#archiveEditCancel').click();
 }
 for(const language of ['en','sk']){
  await page.setViewportSize({width:1500,height:950});await page.evaluate(language=>window.i18n.setLanguage(language),language);
  await page.evaluate(()=>setView('board'));
  const toolbar=await page.locator('.board-controls').evaluate(el=>[el.querySelector('h2'),el.querySelector('#boardFiltersToggle'),el.querySelector('#refreshBoard')].map(item=>{const box=item.getBoundingClientRect();return box.top+box.height/2;}));assert(Math.max(...toolbar)-Math.min(...toolbar)<2,'Desktop order controls share one row');
  if(process.env.MOMS_UI_SCREENSHOTS && language==='sk')await page.screenshot({path:`${process.env.MOMS_UI_SCREENSHOTS}-desktop-toolbar.png`});
  const toggle=page.locator('#sidebarToggle');assert(await toggle.isVisible());
  if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
  const before=await page.locator('main').boundingBox();
  await toggle.click();assert(await page.locator('#desktopSidebar').isVisible());assert(await page.locator('.top-nav [data-view="inventory"] .desktop-nav-icon').isVisible());
  assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  assert.equal(await toggle.getAttribute('title'),language==='sk'?'Zobraziť názvy v menu':'Show sidebar labels');
  const after=await page.locator('main').boundingBox();assert(after.width>before.width+100);
  await page.reload();await page.locator('#sidebarToggle').waitFor();assert.equal(await page.locator('#sidebarToggle').getAttribute('aria-expanded'),'false');
  assert(await page.locator('#desktopSidebar').isVisible());assert(await page.locator('.top-nav [data-view="inventory"] .desktop-nav-icon').isVisible());
  await page.locator('#sidebarToggle').focus();await page.keyboard.press('Space');assert(await page.locator('#desktopSidebar').isVisible());
  await page.setViewportSize({width:390,height:950});assert(!(await page.locator('#sidebarToggle').isVisible()));assert(await page.locator('.mobile-bottom-nav').isVisible());
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 // Material controls preserve native keyboard interaction in both themes and languages.
 for(const language of ['en','sk'])for(const width of [1500,390])for(const theme of ['light','dark']) {
  await page.setViewportSize({width,height:950});
  await page.evaluate(({language,theme})=>{window.i18n.setLanguage(language);document.documentElement.dataset.theme=theme;setView('inventory');}, {language,theme});
  await page.evaluate(()=>{state.filters.archive={note:'Fixture <filter>'};setView('archive');renderTables();});
  assert(await page.locator('#archiveTable [data-clear-order-filters]').isVisible());
  await page.locator('#archiveTable [data-clear-order-filters]').click();
  assert.equal(await page.evaluate(()=>Object.keys(state.filters.archive).length),0);
  await page.evaluate(()=>setView('inventory'));
  if(width===390) {
   await page.waitForFunction(()=>{const nav=document.querySelector('.mobile-bottom-nav').getBoundingClientRect();return nav.height>=56 && nav.bottom<=innerHeight && nav.top>=0;});
  }
  const preference=page.locator('#inventoryShowImages');
  const before=await preference.isChecked();await preference.focus();await page.keyboard.press('Space');
  assert.equal(await preference.isChecked(),!before,'Glass switch keeps native keyboard behavior');
  assert.equal(await preference.locator('..').evaluate(el=>getComputedStyle(el).borderRadius),'999px');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Glass layout stays within viewport');
  if(process.env.MOMS_UI_SCREENSHOTS)await page.screenshot({path:`${process.env.MOMS_UI_SCREENSHOTS}-glass-${language}-${width}-${theme}.png`});
 }
 for(const language of ['en','sk'])for(const width of [1500,390]) {
  await page.setViewportSize({width,height:950});
  await page.evaluate(language=>{window.i18n.setLanguage(language);setView('settings');setSettingsTab('auth');state.channels=[];state.authorizations={};state.config={channels:{}};renderAuthorizations();},language);
  syncChannels=[];const sync=page.locator('[data-channel="etsy"]');
  await sync.focus();failSync=true;await page.keyboard.press('Space');
  await page.waitForFunction(()=>!document.querySelector('[data-channel="etsy"]').disabled);
  assert.equal(await sync.isChecked(),false,'Failed save restores switch state');
  assert((await page.locator('#authCards [data-sync-error]').first().textContent()).length>0);
  failSync=false;const before=syncRequests.length;await sync.focus();await page.keyboard.press('Space');
  await page.waitForFunction(()=>!document.querySelector('[data-channel="etsy"]').disabled);
  assert.equal(syncRequests.length,before+1);assert.equal(syncRequests.at(-1).enabled,true);assert(await sync.isChecked());
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(process.env.MOMS_UI_SCREENSHOTS)await page.screenshot({path:`${process.env.MOMS_UI_SCREENSHOTS}-glass-settings-${language}-${width}.png`});
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await page.locator('[data-channel="etsy"]').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
 for(const language of ['en','sk'])for(const width of [1500,390]) {
  await page.setViewportSize({width,height:950});
  await page.evaluate(language=>{window.i18n.setLanguage(language);setView('settings');setSettingsTab('products');state.productDraft=null;state.productFilters={sku:'',display_name:''};state.products=[{sku:'APPLE-1',display_name:'Product <safe>'},{sku:'OTHER-2',display_name:'Second product'}];renderProducts();},language);
  assert.equal(await page.locator('#productTable thead tr').count(),1,'Only column headings precede product data');
  assert.equal(await page.locator('#productTable tbody tr').count(),2);
  assert.equal(await page.locator('#productTable tr.filters').count(),0);
  const search=page.locator('#productTable [data-product-filter="sku"]');
  await search.pressSequentially('APPLE');
  assert.equal(await search.inputValue(),'APPLE');assert(await search.evaluate(el=>el===document.activeElement));
  assert.equal(await page.locator('#productTable tbody tr').count(),1);
  assert.equal(await page.locator('#productTable [data-field="display_name"]').inputValue(),'Product <safe>');
  await page.locator('#addProduct').click();assert.equal(await page.locator('#productTable tbody .draft-row').count(),1);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(process.env.MOMS_UI_SCREENSHOTS)await page.screenshot({path:`${process.env.MOMS_UI_SCREENSHOTS}-mapping-${language}-${width}.png`});
 }
 const rectangularLogo=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=80;canvas.height=40;const ctx=canvas.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,80,40);return canvas.toDataURL();});
 const pixels=await page.evaluate(async svg=>{const img=new Image();img.src='data:image/svg+xml;base64,'+btoa(svg);await img.decode();const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,64,64);return {corner:[...ctx.getImageData(0,0,1,1).data],center:[...ctx.getImageData(32,32,1,1).data]};},circularIcon(rectangularLogo));
 assert.equal(pixels.corner[3],0,'Circular favicon has transparent corners');assert.deepEqual(pixels.center,[255,0,0,255]);
 assert(await page.locator('link[rel="icon"]').getAttribute('href').then(href=>href.startsWith('/app-favicon')));
 assert.equal(await page.locator('.brand-favicon').evaluate(el=>getComputedStyle(el).borderRadius),'50%');
 for(const width of [1500,390]) {
  await page.setViewportSize({width,height:950});
  await page.evaluate(()=>{state.orderFiltersExpanded=undefined;state.archiveLayout='table';setView('archive');renderTables();});
  assert(await page.locator('#archive-column-filters').isHidden());
  assert.equal(await page.locator('#archiveTable [data-column-filters]').getAttribute('aria-expanded'),'false');
  assert(await page.locator('#open-column-filters').evaluate(el=>el.hidden),'Table column filters start collapsed on every screen');
 }
 for(const width of [1500,390])for(const language of ['en','sk'])for(const theme of ['light','dark']) {
  await page.setViewportSize({width,height:950});
  await page.evaluate(({language,theme})=>{i18n.setLanguage(language);applyTheme(theme);state.dashboard={openOrders:4,ordersThisMonth:1,ordersPreviousMonth:2,openByVendor:{},thisMonthByVendor:{},thisMonthByCountry:{},allTimeByCountry:{},dashboardPins:[],openOrderValue:{missingAmountCount:1,currencies:[{currency:'EUR',total:'123.45'},{currency:'USD',total:'67.89'},{currency:null,total:'5.00'}]}};setView('dashboard');renderDashboard();},{language,theme});
  assert.equal(await page.locator('.open-order-value .dash-value').count(),3);
  assert((await page.locator('.open-order-value p').textContent()).includes('1'));
  assert.equal(await page.locator('.open-order-value small').textContent(),language==='sk'?'Neznáma mena':'Unknown currency');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(process.env.MOMS_UI_SCREENSHOTS)await page.screenshot({path:`${process.env.MOMS_UI_SCREENSHOTS}-open-value-${language}-${width}-${theme}.png`});
  await page.evaluate(()=>{state.dashboard.openOrderValue={missingAmountCount:0,currencies:[]};renderDashboard();});
  assert((await page.locator('.open-order-value').textContent()).includes(language==='sk'?'Žiadne otvorené':'No priced open'));
 }
 assert.deepEqual(errors,[]);
 for(const language of ['en','sk'])for(const width of [1500,390]) {
  await page.setViewportSize({width,height:950});
  await page.evaluate(language=>{i18n.setLanguage(language);state.filters.open={};state.filters.archive={};state.archiveLayout='table';state.openOrders=[{id:999,channel:'manual',vendor:'Manual',external_order_id:'<safe>',skus:'SKU <safe>',address:'Customer <safe>',shipped:false}];state.archiveOrders=[{...state.openOrders[0],shipped:true}];state.archiveTotal=1;renderTables();},language);
  for(const view of ['open','archive']) {
   await page.evaluate(view=>setView(view),view);
   const root=page.locator('#'+view+'Table');
   assert.equal(await root.locator('.order-card').count(),0);
   assert.equal(await root.locator('.orders-table').evaluate(el=>getComputedStyle(el).display),'table');
   assert.equal(await root.locator('tbody tr').first().evaluate(el=>getComputedStyle(el).display),'table-row');
   assert(await root.locator('thead').isVisible());
   assert.equal(await root.locator('safe').count(),0);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   if(width===390)assert(await root.locator('.table-wrap').evaluate(el=>{el.scrollLeft=100;return el.scrollLeft>0;}));
   const buttons=page.locator('#'+view+'View [data-orders-view],#'+view+'View [data-archive-layout]');
   for(const button of await buttons.all()) {
    assert.equal(await button.locator('svg').count(),1);
    const mode=await button.getAttribute('data-orders-view') || await button.getAttribute('data-archive-layout');
    assert.equal(await button.locator('.app-button-icon').getAttribute('data-icon'),({board:'cards',cards:'cards',open:'list',table:'list',archive:'archive'})[mode]);
    assert(!/[▦☷▤]/.test(await button.innerText()));
   }
   if(process.env.MOMS_UI_SCREENSHOTS)await page.screenshot({path:process.env.MOMS_UI_SCREENSHOTS+'-'+view+'-'+language+'-'+width+'.png'});
  }
 }
 assert.deepEqual(errors,[]);
 console.log('Archive cards: desktop/mobile, cards/table preference, selection persistence, server pagination, menus, escaping, neutral dates, filtered open exports, desktop/mobile board scope and EN/SK passed.');
 await browser.close();server.close();
})().catch(e=>{console.error(e);server.close();process.exit(1)});
