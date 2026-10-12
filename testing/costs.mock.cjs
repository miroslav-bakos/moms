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
 for(const language of ['en','sk'])for(const width of [1500,390]){
 const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'}),errors=[],writes=[];let discard=false,failed=false;
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>discard?dialog.accept():dialog.dismiss());
 await page.addInitScript(()=>localStorage.setItem('mobile-connect-seen','true'));
 const order={id:42,external_order_id:'Cost fixture',channel:'manual',vendor:'Manual',workflow_status:'crafted',business_outcome:'active',skus:'A',address:'Fixture',shipped:false,revenue_amount:'10',revenue_currency:'EUR'};
 const model={materials:[{id:mid,name:'Orders <img src=x onerror=alert(1)>',unit:'m',stock:0,required:0,after_queue:0,unit_cost:'0.1',cost_currency:'EUR'}],products:[{id:pid,name:'Orders <script>fixture</script>',stock:0,recipe:[{material_id:mid,quantity:3}],labour_cost:'0.2',packaging_cost:'0',reference_price:'1',cost_currency:'EUR'}],rules:[{id:'rule',sku:'A',components:[{product_id:pid,quantity:1}]}],manufacturers:[],shopping:[],movements:[],unmapped:[],aliases:{}};
 let entered={revision:0,currency:'EUR'},preferences={mode:'unreviewed',rate:null,costs_include_vat:true,revision:0};
 const snapshot=productionCost(order,model);
 const costModel=()=>({entered,estimate:orderCost(order,snapshot,entered,true)});
 await page.route('**/api/**',async route=>{
 const u=new URL(route.request().url());let data=[];
 if(u.pathname==='/api/vat-preferences'){if(route.request().method()==='PUT'){const body=route.request().postDataJSON();assert.equal(body.expected_revision,preferences.revision);preferences={...require('../src/services/vat').normalize(body),revision:preferences.revision+1};}return route.fulfill({json:preferences});}
 if(u.pathname==='/api/vat-calculate'){const b=route.request().postDataJSON();return route.fulfill({json:require('../src/services/vat').fromGross(b.amount,b.rate)});}
 if(u.pathname==='/api/orders/42/costs'){
  if(route.request().method()==='PUT'){
   const body=route.request().postDataJSON();writes.push(body);
   if(failed)return route.fulfill({status:409,json:{error:'Costs changed meanwhile. Reopen the order and try again.'}});
   assert.equal(body.expected_revision,Number(entered.revision));entered={currency:body.currency,revision:Number(entered.revision)+1};
   for(const name of ['production_cost','shipping_cost','marketplace_fee','payment_fee','other_cost'])entered[name]=costValue(body[name]);entered.vat=require('../src/services/vat').normalize(body.vat);
  }
  return route.fulfill({json:costModel()});
 }
 if(u.pathname==='/api/inventory/products/'+pid&&route.request().method()==='PATCH'){
  const body=route.request().postDataJSON();writes.push(body);Object.assign(model.products[0],body);for(const f of ['labour_cost','packaging_cost','reference_price'])model.products[0][f]=costValue(body[f]);return route.fulfill({json:{id:pid}});
 }
 if(u.pathname==='/api/orders')data=u.searchParams.get('status')==='archive'?{orders:[],total:0}:[order];
 else if(u.pathname==='/api/workflow-statuses')data=[['new','NEW'],['in_progress','IN PROGRESS'],['crafted','CRAFTED'],['ready_for_pickup','READY FOR PICKUP'],['shipped','SHIPPED']].map(([id,label],position)=>({id,label,position}));
 else if(u.pathname==='/api/inventory')data={...model,products:model.products.map(p=>({...p,estimated_cost:productCost(p,model.materials)}))};
 else if(u.pathname==='/api/orders/42/fulfillment')data={business_outcome:'active',produced:true,lines:[],shipments:[],returns:[]};
 else if(u.pathname==='/api/dashboard')data={openOrders:1,ordersThisMonth:1,ordersPreviousMonth:0,openByVendor:{Manual:1},thisMonthByVendor:{},thisMonthByCountry:{},allTimeByCountry:{},dashboardPins:[]};
 else if(u.pathname==='/api/config')data={channels:{},shipping:{}};
 else if(u.pathname==='/api/branding')data={name:'MOMS',logo:null};
 else if(['/api/tracking/statuses','/api/authorizations'].includes(u.pathname))data={};
 return route.fulfill({json:data});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/#inventory`);await page.waitForFunction(()=>state.openOrders.length===1);
 await page.evaluate(lang=>{window.i18n.setLanguage(lang);setView('inventory');selectInventoryTab('products');},language);
 assert((await page.locator('#inventoryProducts').textContent()).includes('50 %'));
 await page.evaluate(id=>openInventoryEditor('products',id),pid);
 await page.locator('#inventoryCost_labour_cost').fill('0,3');await page.locator('#inventoryCost_packaging_cost').fill('0');
 await page.locator('#inventoryForm button[type=submit]').click();await page.waitForFunction(()=>!document.getElementById('inventoryDialog').open);
 assert.equal(writes.at(-1).labour_cost,'0,3');assert.equal(writes.at(-1).reference_price,'1');
 await page.evaluate(()=>{setView('board');state.boardStage='crafted';renderOrderBoard();openBoardOrderDetails(42);});
 await page.locator('#orderCostForm').waitFor();assert.equal(await page.locator('#orderCosts img,#orderCosts script').count(),0);
 assert((await page.locator('#orderCosts').textContent()).includes('Orders <script>fixture</script>'));
 const form=page.locator('#orderCostForm');
 for(const [field,value] of Object.entries({shipping_cost:'1,5',marketplace_fee:'0.2',payment_fee:'0',other_cost:'0'}))await form.locator(`[name=${field}]`).fill(value);
 await page.locator('#closeOrderDetails').click();assert(await page.locator('#orderDetailsDialog').evaluate(el=>el.open),'Unsaved costs kept after declined discard');
 await form.locator('button[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#orderCostForm [name=shipping_cost]').value==='1.500000');
 assert.equal(entered.shipping_cost,'1.500000');assert.equal(costModel().estimate.profit,'7.800000');
 assert((await page.locator('#orderCosts').textContent()).includes('78 %'));
 failed=true;await form.locator('[name=other_cost]').fill('2');await form.locator('button[type=submit]').click();await page.locator('#orderCostMessage').filter({hasText:/changed|zmenili/}).waitFor();assert.equal(await form.locator('[name=other_cost]').inputValue(),'2');
 assert.equal(await form.locator('button[type=submit]').isEnabled(),true);assert.equal(entered.other_cost,'0.000000');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await page.locator('#orderDetailsDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 discard=true;await page.locator('#closeOrderDetails').click();assert.equal(await page.locator('#orderDetailsDialog').evaluate(el=>el.open),false);
 await page.evaluate(()=>openBoardOrderDetails(42));await page.locator('#orderCostForm').waitFor();failed=false;
 const taxForm=page.locator('#orderCostForm');await taxForm.locator('[name=vat_mode]').selectOption('payer');await taxForm.locator('[name=vat_rate]').fill('20');
 await taxForm.locator('[data-vat-calculate]').click();await page.waitForFunction(()=>document.querySelector('[name=vat_revenue]').value==='1.666667');
 await taxForm.locator('[name=vat_deductible]').fill('0.2');await taxForm.locator('button[type=submit]').click();await page.waitForFunction(()=>document.querySelector('[name=vat_deductible]').value==='0.200000');
 assert.equal(entered.vat.rate,20);assert.equal(costModel().estimate.profit,'6.333333');
 await page.locator('#orderCostForm [name=vat_mode]').selectOption('nonpayer');assert.equal(await page.locator('[name=vat_rate]').isDisabled(),true);
 await page.locator('#orderCostForm button[type=submit]').click();await page.waitForFunction(()=>document.querySelector('[name=vat_mode]').value==='nonpayer'&&document.querySelector('[name=vat_revenue]').value==='');
 assert.equal(costModel().estimate.profit,'7.800000');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await page.locator('#orderDetailsDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 await page.locator('#closeOrderDetails').click();await page.evaluate(()=>{setView('settings');setSettingsTab('logs');});
 await page.locator('#vatPreferencesForm').waitFor();const defaults=page.locator('#vatPreferencesForm');
 await defaults.locator('[name=vat_mode]').selectOption('payer');await defaults.locator('[name=vat_rate]').fill('21,5');await defaults.locator('[name=vat_cost_basis]').selectOption('net');
 await defaults.locator('button[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#vatPreferencesForm [role=status]').textContent.length>0);
 assert.equal(preferences.rate,21.5);assert.equal(preferences.costs_include_vat,false);assert.equal(entered.vat.mode,'nonpayer','Default changes do not rewrite saved orders');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS costs EN/SK desktop/390px: product price edits, saved estimate, comma decimals, missing/zero, margin, failed save/drafts, VAT calculator/payer/nonpayer, escaping and no errors/overflow');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
