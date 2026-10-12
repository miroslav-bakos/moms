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
 const browser=await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'],headless:true,executablePath:process.env.MOMS_CHROMIUM_PATH || undefined});
 const page=await browser.newPage({viewport:{width:1500,height:950},serviceWorkers:'block'});
 await page.addInitScript(()=>localStorage.setItem('mobile-connect-seen','true'));
 await page.addInitScript(()=>{window.fixtureCodes=[];window.BarcodeDetector=class{static async getSupportedFormats(){return ['qr_code','code_128'];}async detect(source){if(!(source instanceof HTMLCanvasElement)||Math.abs(source.width/source.height-3)>.02)throw new Error('Detector did not receive the visible crop');return window.fixtureCodes.splice(0).map(rawValue=>({rawValue}));}};});
 let boardArchiveFixture=false,failBoardArchive=false,holdBoardArchive=null;const boardArchiveRequests=[];
 const archiveFixtures=Array.from({length:65},(_,index)=>({id:8000+index,external_order_id:`Archived-${index}`,channel:'manual',vendor:'Manual',skus:index===64?'Deep archive needle <safe>':'Archived product',address:'Archived customer\nSlovakia',workflow_status:'crafted',shipped:true,ship_by_date:'2020-01-01',created_at:new Date(Date.UTC(2026,9,1,0,0,65-index)).toISOString()}));
 const exportRequests=[];const openExportRequests=[];let failStatus=false,failReorder=false,failAppearance=false,failSales=false;const statusRequests=[];const salesRequests=[];let holdSalesNext=null;
 let failAccess=false; const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const mutations=[];const uiErrors=[];let partialDeletion=false;const dialogs=[];page.on('pageerror',error=>uiErrors.push(error.message));
 let shippedQuantity=2;const order={revenue_amount:'123.45',revenue_currency:'EUR',tracking_code:'Save',tracking_url:'https://example.com/tracking/TRACK-42',tracking_status:'In transit',id:42,external_order_id:'Orders',channel:'manual',vendor:'Manual',address:'Save\nSlovakia',skus:'SKU x2',workflow_status:'crafted',shipped:false,ship_by_date:'2026-10-01'};
 const statuses=[['new','NEW'],['in_progress','IN PROGRESS'],['crafted','CRAFTED'],['ready_for_pickup','READY FOR PICKUP'],['shipped','SHIPPED']].map(([id,label],position)=>({id,label,position,order_count:0}));
 await page.route('https://**',route=>route.fulfill({status:200,body:''}));
 const sharedScans=new Map();
 const apiFixture=async route=>{
   const u=new URL(route.request().url());let data=[];
   if(partialDeletion&&route.request().method()==='DELETE'&&/\/api\/orders\/\d+$/.test(u.pathname))return route.fulfill({status:u.pathname.endsWith('/42')?200:409,json:u.pathname.endsWith('/42')?{ok:true}:{error:'Protected fixture'}});
   if(u.pathname==='/api/scan-list'){
     const method=route.request().method();
     if(method==='POST'){
       const code=route.request().postDataJSON().code;
       if(code==='UNKNOWN')return route.fulfill({status:409,json:{error:'No matching order.'}});
       const id=code==='SECOND'?43:42;
       sharedScans.set(id,{...order,id,shipped:true,external_order_id:'AUDIT-'+(id-42),order_name:'<img src=x onerror=alert(1)>',address:'Audit customer '+(id-42)+' with a long synthetic name\nSlovakia'});
     }
     if(method==='DELETE')for(const id of route.request().postDataJSON().ids)sharedScans.delete(id);
     return route.fulfill({json:[...sharedScans.values()]});
   }
   if(u.pathname==='/api/orders/scan-match'){const code=u.searchParams.get('code');return route.fulfill(code==='UNKNOWN'?{status:409,json:{error:'No matching order.'}}:{json:{...order,id:42,order_name:'<img src=x onerror=alert(1)>',external_order_id:'AUDIT-0'}});}
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
   else if(u.pathname==='/api/dashboard')data={openOrders:1001,ordersThisMonth:67,ordersPreviousMonth:81,openByVendor:{Manual:24},thisMonthByVendor:{Manual:67},thisMonthByCountry:{sk:30,de:20,it:17},allTimeByCountry:{sk:220,de:80,it:55},dashboardPins:[],unconfirmedDispatches:[{id:42,vendor:'Etsy',external_order_id:'<script>fixture</script>',marketplace_dispatch_state:'uncertain'}]};
   else if(['/api/authorizations','/api/tracking/statuses'].includes(u.pathname))data={};
   await route.fulfill({json:data});
 };
 await page.route('**/api/**',apiFixture);




 page.on('dialog',dialog=>dialog.accept());
 for(const width of [1500,390])for(const language of ['en','sk']){
  await page.setViewportSize({width,height:950});await page.goto(`http://127.0.0.1:${server.address().port}/?case=${width}-${language}#board`);
  await page.waitForFunction(()=>state.openOrders.length===24);await page.evaluate(()=>i18n.ready);
  await page.evaluate(language=>i18n.setLanguage(language),language);
  assert.equal(await page.locator('#scanPhoto,#scanStart,#scanStop').count(),0);
  assert.equal(await page.locator('#scanTorch svg').count(),1);
  assert.equal((await page.locator('#scanTorch').textContent()).trim(),'');
  if(width===390){
   assert.deepEqual(await page.locator('.mobile-bottom-nav button:visible').evaluateAll(buttons=>buttons.map(button=>button.dataset.view||'more')),['dashboard','board','inventory','scan','more']);
   await page.locator('.mobile-bottom-nav [data-view="scan"]').click();assert.equal(await page.evaluate(()=>state.activeView),'scan');
   assert.equal(await page.locator('#mobileMoreButton').evaluate(button=>button.classList.contains('active')),false);
   assert.equal(await page.locator('.mobile-bottom-nav [data-view="scan"]').evaluate(button=>button.classList.contains('active')),true);
   const positions=await page.locator('.mobile-bottom-nav button:visible').evaluateAll(buttons=>buttons.map(button=>button.getBoundingClientRect().top));assert.ok(positions.every(y=>Math.abs(y-positions[0])<1));
   await page.locator('#mobileMoreButton').click();assert.equal(await page.locator('#mobileMoreMenu [data-view="scan"] svg').count(),1);
   await page.locator('#mobileMoreMenu [data-view="scan"]').click();assert.equal(await page.locator('#mobileMoreMenu').isVisible(),false);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.locator('.mobile-bottom-nav [data-view="board"]').click();
  }
  await page.locator('#boardFiltersToggle').click();assert(await page.locator('#boardSearch').isHidden());
  await page.locator('#boardSearchToggle').click();assert(await page.locator('#boardSearch').isVisible());
  await page.locator('#boardSearch').fill('not-a-match');assert.equal(await page.locator('.board-card').count(),0);
  await page.locator('#boardScanSearch').click();assert(await page.locator('#scanView').isVisible());
  await page.evaluate(()=>window.fixtureCodes.push('Save'));
  await page.waitForFunction(()=>state.activeView==='board');assert(await page.evaluate(()=>document.getElementById('scanVideo').srcObject===null));assert.equal(await page.locator('#boardSearch').inputValue(),'Save');
  await page.evaluate(()=>setView('scan'));await page.locator('[data-view="scan"]').first().evaluate(el=>el.click());
  assert(await page.locator('#scanForm').isHidden());
  await page.locator('#scanAdd').click();
  await page.waitForFunction(()=>Boolean(document.getElementById('scanVideo').srcObject));
  await page.evaluate(()=>window.fixtureCodes.push('Save'));
  await page.waitForFunction(()=>!document.getElementById('scanAddDialog').open);
  assert.equal(await page.locator('#scanList .scan-parcel').count(),1);assert(await page.evaluate(()=>document.getElementById('scanVideo').srcObject===null));
  await page.locator('#scanAdd').click();
  await page.evaluate(()=>window.fixtureCodes.push('Save'));
  await page.waitForFunction(()=>!document.getElementById('scanAddDialog').open);
  assert(await page.locator('#scanApply').isEnabled());
  assert.equal(await page.locator('#scanList .scan-parcel').count(),1);assert.equal(await page.locator('#scanList img:not(.country-flag)').count(),0);
  assert((await page.locator('#scanList .scan-parcel-customer').innerText()).includes('Audit customer 0'));
  assert.equal(await page.locator('#scanList .country-flag').getAttribute('src'),'https://flagcdn.com/16x12/sk.png');
  assert(await page.locator('#scanAddDialog').isHidden());
  await page.locator('[data-scan-layout="list"]').click();assert(await page.locator('#scanList').evaluate(el=>el.classList.contains('scan-list')));
  assert(await page.locator('#scanList .scan-parcel').first().evaluate(el=>{
   const fields=[...el.children];const tops=fields.map(field=>field.getBoundingClientRect().top+field.getBoundingClientRect().height/2);
   return Math.max(...tops)-Math.min(...tops)<2;
  }),'List fields stay in one horizontal row');
  if(process.env.MOMS_UI_SCREENSHOTS)await page.screenshot({path:process.env.MOMS_UI_SCREENSHOTS+'-scan-list-'+language+'-'+width+'.png'});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(width===390)assert(await page.locator('#scanList').evaluate(el=>{el.scrollLeft=100;return el.scrollLeft>0;}));
  await page.locator('#scanList .scan-parcel').click();assert(await page.locator('#orderDetailsDialog').isVisible());await page.locator('#closeOrderDetails').click();
  await page.locator('#scanAdd').click();
  await page.locator('#scanCode').fill('Save');await page.locator('#scanForm button').click();await page.waitForFunction(()=>!document.querySelector('#scanForm button').disabled);assert.equal(await page.locator('#scanList .scan-parcel').count(),1);
  await page.locator('#scanAdd').click();
  await page.waitForFunction(()=>/Point the camera|Namierte kameru/.test(document.getElementById('scanAddMessage').textContent));
  assert.equal(await page.locator('#scanTorch').isVisible(),true,'Unsupported light is visible with an explanation');assert.equal(await page.locator('#scanTorch').isDisabled(),true);assert.ok(await page.locator('#scanTorch').getAttribute('title'));
  await page.locator('#scanCode').fill('UNKNOWN');await page.locator('#scanForm button').click();await page.waitForFunction(()=>document.getElementById('scanMessage').textContent.includes('order')||document.getElementById('scanMessage').textContent.includes('objedn'));assert.ok((await page.locator('#scanAddMessage').textContent()).includes('UNKNOWN'));
  await page.locator('#scanClose').click();
  await page.locator('#scanApply').click();assert(await page.locator('#bulkStatusDialog').isVisible());
  await page.locator('#bulkStatusSelect').selectOption('ready_for_pickup');await page.locator('#bulkStatusSave').click();await page.waitForFunction(()=>!document.getElementById('bulkStatusDialog').open);
  await page.waitForFunction(()=>document.querySelectorAll('#scanList .scan-parcel').length===0);
  await page.evaluate(()=>setView('dashboard'));assert.equal(await page.locator('#dashboardContent script').count(),0);
  assert(await page.locator('#dashboardContent').innerText().then(text=>text.includes('<script>fixture</script>')));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 const desktop=await browser.newPage({viewport:{width:1500,height:950},serviceWorkers:'block'});
 desktop.on('pageerror',error=>uiErrors.push(error.message));
 await desktop.route('https://**',route=>route.fulfill({status:200,body:''}));
 await desktop.route('**/api/**',apiFixture);
 await desktop.addInitScript(()=>localStorage.setItem('mobile-connect-seen','true'));
 await desktop.goto(`http://127.0.0.1:${server.address().port}/#scan`);
 await desktop.waitForFunction(()=>state.activeView==='scan');
 await page.evaluate(()=>setView('scan'));
 const scanInto=async target=>{await target.locator('#scanAdd').click();await target.waitForFunction(()=>/Point the camera|Namierte kameru/.test(document.getElementById('scanAddMessage').textContent));await target.locator('#scanCode').fill('Save');await target.locator('#scanForm button').click();await target.waitForFunction(()=>!document.getElementById('scanAddDialog').open);};
 await scanInto(page);
 await desktop.waitForFunction(()=>document.querySelectorAll('#scanList .scan-parcel').length===1);
 await desktop.reload();await desktop.waitForFunction(()=>document.querySelectorAll('#scanList .scan-parcel').length===1);
 await desktop.locator('#scanClear').click();await page.waitForFunction(()=>document.querySelectorAll('#scanList .scan-parcel').length===0);
 await scanInto(page);
 // Simulate a second device scanning after this client's bulk snapshot was taken.
 await page.locator('#scanApply').click();
 sharedScans.set(43,{...order,id:43,external_order_id:'SECOND'});
 await page.locator('#bulkStatusSelect').selectOption('ready_for_pickup');await page.locator('#bulkStatusSave').click();
 await page.waitForFunction(()=>document.querySelectorAll('#scanList .scan-parcel').length===1 && document.getElementById('scanList').textContent.includes('SECOND'));
 await desktop.waitForFunction(()=>document.getElementById('scanList').textContent.includes('SECOND'));
 await desktop.locator('#scanClear').click();await page.waitForFunction(()=>document.querySelectorAll('#scanList .scan-parcel').length===0);
 await desktop.close();
 for(const [file,code] of [['gls-domestic','012345678904'],['gls-international','910000000018'],['posta','CA000000001SK']]){
  const svg=fs.readFileSync(require('path').join(__dirname,'fixtures/scan',file+'.svg'),'utf8');
  for(const angle of [0,90])assert.deepEqual(await page.evaluate(async ({svg,angle})=>{const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(svg);await image.decode();const canvas=document.createElement('canvas');canvas.width=angle?image.height:image.width;canvas.height=angle?image.width:image.height;const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.translate(canvas.width/2,canvas.height/2);context.rotate(angle*Math.PI/180);context.drawImage(image,-image.width/2,-image.height/2);return parcelCodeReader.decode(canvas,new ZXingBrowser.BrowserMultiFormatReader());},{svg,angle}),[code]);
  // Very low contrast with a brightness gradient defeats global thresholds.
  // Column reconstruction must restore the bars without changing their symbols.
  assert.deepEqual(await page.evaluate(async svg=>{
   const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(svg);await image.decode();
   const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
   const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0);
   const pixels=context.getImageData(0,0,canvas.width,canvas.height);
   for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
    const i=(y*canvas.width+x)*4,ink=pixels.data[i]<128;
    const value=(y+x)%32<8?255:130+75*x/canvas.width+(ink?0:20);
    pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=value;
   }
   context.putImageData(pixels,0,0);
   const reader={decodeFromCanvas(){throw new Error('Low contrast');}};
   return parcelCodeReader.decode(canvas,reader);
  },svg),[code]);
  for(const angle of [0,90])assert.deepEqual(await page.evaluate(async({svg,angle})=>{
   const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(svg);await image.decode();
   const faded=document.createElement('canvas');faded.width=image.width;faded.height=image.height;
   const f=faded.getContext('2d');f.drawImage(image,0,0);f.fillStyle='white';f.globalAlpha=.45;f.fillRect(0,0,faded.width,faded.height);
   f.globalAlpha=.85;f.fillRect(0,faded.height*.49,faded.width,faded.height*.04);
   const canvas=document.createElement('canvas');canvas.width=angle?faded.height:faded.width;canvas.height=angle?faded.width:faded.height;
   const c=canvas.getContext('2d');c.translate(canvas.width/2,canvas.height/2);c.rotate(angle*Math.PI/180);c.drawImage(faded,-faded.width/2,-faded.height/2);
   // Force the fallback, then exercise its bounded progression across frames.
   const reader={decodeFromCanvas(){throw new Error('Fixture glare');}};let codes=[];
   for(let frame=0;frame<546&&!codes.length;frame++)codes=parcelCodeReader.decode(canvas,reader,{attempts:1});
   return codes;
  },{svg,angle}),[code]);
 }
 // Exercise the real live loop without native BarcodeDetector, using an
 // faded barcode delivered as a camera video stream. Outside-guide codes
 // must be ignored until moved into the visible scanning window.
 const liveSvg=fs.readFileSync(require('path').join(__dirname,'fixtures/scan/posta.svg'),'utf8');
 await page.evaluate(async svg=>{
  window.savedMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  window.savedDetector=window.BarcodeDetector;window.BarcodeDetector=undefined;
  const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(svg);await image.decode();
  const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;
  const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,1920,1080);
  context.drawImage(image,200,90,1400,200);context.globalAlpha=.45;context.fillRect(200,90,1400,200);
  window.liveFixtureCanvas=canvas;
  window.liveFixtureTimer=setInterval(()=>context.drawImage(canvas,0,0),100);
  navigator.mediaDevices.getUserMedia=async constraints=>{window.liveRequestedConstraints=constraints;const stream=canvas.captureStream(10),track=stream.getVideoTracks()[0];track.getCapabilities=()=>({focusMode:['continuous'],torch:document.getElementById('scanVideo').readyState>=2?[false,true]:false});window.fixtureTorchCalls=[];track.applyConstraints=async constraints=>{if('torch' in constraints.advanced[0]){window.fixtureTorchCalls.push(constraints.advanced[0].torch);if(window.fixtureTorchReject)throw new Error('Fixture light failure');}else window.liveFocusConstraints=constraints;};return stream;};
 },liveSvg);
 await page.locator('#scanAdd').click();
 await page.waitForFunction(()=>!document.getElementById('scanCameraFrame').hidden);
 const guide=await page.locator('#scanCameraFrame').boundingBox();assert.ok(Math.abs(guide.width/guide.height-3)<.1);
 await page.waitForFunction(()=>!document.getElementById('scanTorch').hidden&&!document.getElementById('scanTorch').disabled);
 assert.equal(await page.locator('#scanTorch').isVisible(),true);
 assert.deepEqual(await page.evaluate(()=>window.fixtureTorchCalls),[],'Light never turns on automatically');
 await page.locator('#scanTorch').click();await page.waitForFunction(()=>document.getElementById('scanTorch').getAttribute('aria-pressed')==='true');
 await page.locator('#scanTorch').click();await page.waitForFunction(()=>document.getElementById('scanTorch').getAttribute('aria-pressed')==='false');
 assert.deepEqual(await page.evaluate(()=>window.fixtureTorchCalls),[true,false]);
 assert.equal(await page.locator('#scanTorch svg').count(),1);assert.equal((await page.locator('#scanTorch').textContent()).trim(),'');
 await page.evaluate(()=>window.fixtureTorchReject=true);await page.locator('#scanTorch').click();
 await page.waitForFunction(()=>!document.getElementById('scanTorch').disabled);
 assert.equal(await page.locator('#scanTorch').getAttribute('aria-pressed'),'false');assert.equal(await page.locator('#scanCameraFrame').isVisible(),true);
 await page.evaluate(()=>window.fixtureTorchReject=false);
 await page.waitForTimeout(1000);assert.equal(await page.locator('#scanAddDialog').evaluate(element=>element.open),true);assert.equal(sharedScans.size,0);
 assert.deepEqual(await page.locator('#scanPreview').evaluate(canvas=>({width:canvas.width,height:canvas.height,centre:[...canvas.getContext('2d').getImageData(canvas.width/2,canvas.height/2,1,1).data]})),{width:1920,height:640,centre:[255,255,255,255]});
 const previewBounds=await page.locator('#scanPreview').boundingBox();assert.ok(Math.abs(previewBounds.width/previewBounds.height-3)<.02);
 await page.evaluate(()=>{const canvas=window.liveFixtureCanvas,context=canvas.getContext('2d');const label=document.createElement('canvas');label.width=1400;label.height=200;label.getContext('2d').drawImage(canvas,200,90,1400,200,0,0,1400,200);context.globalAlpha=1;context.fillStyle='white';context.fillRect(0,0,1920,1080);context.drawImage(label,200,440);});
 await page.waitForFunction(()=>!document.getElementById('scanAddDialog').open,{},{timeout:20000});
 assert.ok(sharedScans.has(42));
 assert.equal(await page.evaluate(()=>window.liveRequestedConstraints.video.width.ideal),1920);
 assert.equal(await page.evaluate(()=>window.liveFocusConstraints.advanced[0].focusMode),'continuous');
 assert.equal(await page.locator('#scanCameraFrame').isVisible(),false);
 assert.equal(await page.locator('#scanTorch').isVisible(),false);
 await page.evaluate(()=>{clearInterval(window.liveFixtureTimer);navigator.mediaDevices.getUserMedia=window.savedMedia;window.BarcodeDetector=window.savedDetector;});
 assert.deepEqual(await page.evaluate(()=>{const blank=document.createElement('canvas');blank.width=640;blank.height=480;const context=blank.getContext('2d');context.fillStyle='white';context.fillRect(0,0,640,480);return parcelCodeReader.decode(blank,new ZXingBrowser.BrowserMultiFormatReader());}),[]);
 for(const [width,height] of [[1920,1080],[1080,1920]])assert.deepEqual(await page.evaluate(({width,height})=>{
  const source=document.createElement('canvas');source.width=width;source.height=height;
  const context=source.getContext('2d');context.fillStyle='black';context.fillRect(0,0,width,height);
  context.fillStyle='white';context.fillRect(0,(height-width/3)/2,width,width/3);
  const crop=parcelCodeReader.cropFrame(source);
  return {width:crop.width,height:crop.height,codes:parcelCodeReader.decode(crop,new ZXingBrowser.BrowserMultiFormatReader())};
 },{width,height}),{width,height:width/3,codes:[]});
 const qr=await require('qrcode').toDataURL('00001234567890123456789');
 assert.equal(await page.evaluate(async url=>(await new ZXingBrowser.BrowserMultiFormatReader().decodeFromImageUrl(url)).getText(),qr),'00001234567890123456789');
 assert.deepEqual(uiErrors,[]);await browser.close();server.close();console.log('Scan search, saved shared list, cross-device polling/reload/clear, bulk snapshot preservation and escaping: EN/SK desktop/390px passed.');
})().catch(error=>{console.error(error);server.close();process.exit(1);});
