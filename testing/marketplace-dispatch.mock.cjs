// Disposable static app with financial fixtures; no deployment/customer API writes.
const {chromium}=require(process.env.MOMS_PLAYWRIGHT_MODULE || '@playwright/test');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {costValue,productCost,productionCost,orderCost}=require('../src/services/costMath');
const root=path.resolve(__dirname,'..'),mid='a0000000-0000-4000-8000-000000000001',pid='b0000000-0000-4000-8000-000000000001';
const server=http.createServer((req,res)=>{
 const name=path.join(root,'src/public',req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);
 try{res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(name));}catch(_){res.statusCode=404;res.end();}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,...(process.env.MOMS_CHROMIUM_PATH?{executablePath:process.env.MOMS_CHROMIUM_PATH}:{})});
 try {
 for(const channel of ['etsy','amazon','shopify'])for(const language of ['en','sk'])for(const width of [1500,390]){
 const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'}),errors=[],writes=[];let discard=false,failed=false;
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.addInitScript(()=>localStorage.setItem('mobile-connect-seen','true'));
 const order={id:42,external_order_id:'Cost fixture',channel,vendor:channel,workflow_status:'crafted',business_outcome:'active',skus:'A',address:'Fixture',shipped:false,revenue_amount:'10',revenue_currency:'EUR'};
 const model={materials:[{id:mid,name:'Orders <img src=x onerror=alert(1)>',unit:'m',stock:0,required:0,after_queue:0,unit_cost:'0.1',cost_currency:'EUR'}],products:[{id:pid,name:'Orders <script>fixture</script>',stock:0,recipe:[{material_id:mid,quantity:3}],labour_cost:'0.2',packaging_cost:'0',reference_price:'1',cost_currency:'EUR'}],rules:[{id:'rule',sku:'A',components:[{product_id:pid,quantity:1}]}],manufacturers:[],shopping:[],movements:[],unmapped:[],aliases:{}};
 let entered={revision:0,currency:'EUR'},dispatchState='local',dispatchCalls=0,selectedCarrier='other';const shipmentId='a0000000-0000-4000-8000-000000000001';
 const snapshot=productionCost(order,model);
 const costModel=()=>({entered,estimate:orderCost(order,snapshot,entered,true)});
 await page.route('**/api/**',async route=>{
 const u=new URL(route.request().url());let data=[];
 if(u.pathname==='/api/orders/42/shipments/'+shipmentId+'/marketplace'){dispatchCalls++;selectedCarrier=route.request().postDataJSON().carrier_name;assert.equal(selectedCarrier,channel==='etsy'?'slovenska-posta':['shopify','amazon'].includes(channel)&&width===1500?'gls':'other');dispatchState=channel!=='etsy'&&dispatchCalls===1?'rejected':dispatchCalls===(channel==='etsy'?1:2)?'uncertain':'confirmed';return route.fulfill({json:{state:dispatchState}});}
 if(u.pathname==='/api/orders/42/costs'){
  if(route.request().method()==='PUT'){
   const body=route.request().postDataJSON();writes.push(body);
   if(failed)return route.fulfill({status:409,json:{error:'Costs changed meanwhile. Reopen the order and try again.'}});
   assert.equal(body.expected_revision,Number(entered.revision));entered={currency:body.currency,revision:Number(entered.revision)+1};
   for(const name of ['production_cost','shipping_cost','marketplace_fee','payment_fee','other_cost'])entered[name]=costValue(body[name]);
  }
  return route.fulfill({json:costModel()});
 }
 if(u.pathname==='/api/inventory/products/'+pid&&route.request().method()==='PATCH'){
  const body=route.request().postDataJSON();writes.push(body);Object.assign(model.products[0],body);for(const f of ['labour_cost','packaging_cost','reference_price'])model.products[0][f]=costValue(body[f]);return route.fulfill({json:{id:pid}});
 }
 if(u.pathname==='/api/orders')data=u.searchParams.get('status')==='archive'?{orders:[],total:0}:[order];
 else if(u.pathname==='/api/workflow-statuses')data=[['new','NEW'],['in_progress','IN PROGRESS'],['crafted','CRAFTED'],['ready_for_pickup','READY FOR PICKUP'],['shipped','SHIPPED']].map(([id,label],position)=>({id,label,position}));
 else if(u.pathname==='/api/inventory')data={...model,products:model.products.map(p=>({...p,estimated_cost:productCost(p,model.materials)}))};
 else if(u.pathname==='/api/orders/42/fulfillment')data={channel,business_outcome:'active',produced:true,lines:[{id:1,sku:'Orders <script>fixture</script>',quantity:1,shipped:1,remaining:0,remaining_to_produce:0}],shipments:[{id:shipmentId,tracking_code:'TRACK<fixture>',tracking_url:channel==='amazon'?(width===1500?'https://gls-group.eu/track/fixture':'http://tandt.posta.sk/en/items/fixture'):'',lines:[{line_id:1,quantity:1}],marketplace_dispatch:dispatchState,marketplace_carrier:dispatchCalls?selectedCarrier:''}],returns:[]};
 else if(u.pathname==='/api/dashboard')data={openOrders:1,ordersThisMonth:1,ordersPreviousMonth:0,openByVendor:{Manual:1},thisMonthByVendor:{},thisMonthByCountry:{},allTimeByCountry:{},dashboardPins:[]};
 else if(u.pathname==='/api/config')data={channels:{},shipping:{}};
 else if(u.pathname==='/api/branding')data={name:'MOMS',logo:null};
 else if(['/api/tracking/statuses','/api/authorizations'].includes(u.pathname))data={};
 return route.fulfill({json:data});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/#board`);await page.waitForFunction(()=>state.openOrders.length===1);await page.evaluate(async lang=>{await window.i18n.ready;window.i18n.setLanguage(lang);setView('board');state.boardStage='crafted';renderOrderBoard();openBoardOrderDetails(42);},language);
 await page.locator('[data-marketplace-shipment]').waitFor();if(channel!=='amazon')await page.locator('[data-marketplace-carrier]').selectOption(channel==='etsy'?'slovenska-posta':width===1500?'gls':'other');else assert((await page.locator('.order-fulfillment').textContent()).includes(width===1500?'GLS · Business Parcel':'Other · Slovak Post · Parcel'));assert.equal(await page.locator('.order-fulfillment script').count(),0);await page.locator('[data-marketplace-shipment]').click();if(channel!=='etsy'){await page.waitForFunction(()=>document.querySelector('.order-fulfillment')?.textContent.match(/rejected the dispatch|odmietol expedíciu/));assert.equal(await page.locator('[data-cancel-shipment]').count(),1);if(channel!=='amazon')assert(!await page.locator('[data-marketplace-carrier]').isDisabled());await page.locator('[data-marketplace-shipment]').click();}await page.waitForFunction(()=>document.querySelector('.order-fulfillment')?.textContent.match(/Outcome unclear|Výsledok je nejasný/));assert.equal(await page.locator('[data-cancel-shipment]').count(),0);if(channel!=='amazon')assert(await page.locator('[data-marketplace-carrier]').isDisabled());assert.equal(await page.locator('[data-marketplace-carrier]').inputValue(),selectedCarrier);
 await page.locator('[data-marketplace-shipment]').click();await page.waitForFunction(()=>document.querySelector('.order-fulfillment')?.textContent.match(/Confirmed on|Potvrdené na/));assert.equal(await page.locator('[data-marketplace-shipment]').count(),0);assert.equal(dispatchCalls,channel==='etsy'?2:3);assert.equal(await page.locator('[data-cancel-shipment]').count(),0);if(channel!=='amazon')assert(await page.locator('[data-marketplace-carrier]').isDisabled());assert.equal(await page.locator('[data-marketplace-carrier]').inputValue(),selectedCarrier);assert((await page.locator('.order-fulfillment').textContent()).includes('TRACK<fixture>'));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS Etsy/Amazon/Shopify dispatch EN/SK desktop/390px: local/uncertain/confirmed status, reconciliation action, cancellation guard, escaping, no errors/overflow');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
