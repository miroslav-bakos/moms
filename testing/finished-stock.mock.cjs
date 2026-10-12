// Disposable static app + API fixtures; never connects to deployment or marketplace APIs.
const {chromium}=require(process.env.MOMS_PLAYWRIGHT_MODULE || '@playwright/test');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),productId='a0000000-0000-4000-8000-000000000001';
const server=http.createServer((req,res)=>{
 const name=path.join(root,'src/public',req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);
 try{res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(name));}catch(_){res.statusCode=404;res.end();}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,...(process.env.MOMS_CHROMIUM_PATH?{executablePath:process.env.MOMS_CHROMIUM_PATH}:{})});
 try {
  for(const language of ['en','sk'])for(const width of [1500,390]) {
   const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'}),errors=[],requests=[],receipts=new Map();
   page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(()=>localStorage.setItem('mobile-connect-seen','true'));
   const model={materials:[{id:'wood',name:'Wood',unit:'pcs',stock:20,required:0,after_queue:20}],products:[{id:productId,name:'Holder <safe>',recipe:[{material_id:'wood',quantity:2}],stock:0,required:8,from_stock:0,to_produce:8}],rules:[],movements:[],unmapped:[],shopping:[],manufacturers:[]};
   const returned={id:'b0000000-0000-4000-8000-000000000001',line_id:1,quantity:1,kind:'return',reason:'Fixture',received_at:null,restocked:false};
   const fulfillment={business_outcome:'active',produced:true,lines:[{id:1,sku:'Holder <safe>',quantity:1,shipped:1,remaining:0,remaining_to_produce:0,material_snapshot:null,inventory_snapshot:[{quantity:1,snapshot:[{product_id:productId,quantity:1}]}]}],shipments:[],returns:[returned]};
   let failAfterSave=true;
   await page.route('**/api/**',async route=>{
    const u=new URL(route.request().url());let data=[];
    if(u.pathname==='/api/orders/42/fulfillment')return route.fulfill({json:fulfillment});
    if(u.pathname===`/api/orders/42/returns/${returned.id}/receive`){assert.equal(route.request().postDataJSON().restock,true);returned.received_at=new Date().toISOString();returned.restocked=true;model.products[0].stock+=1;return route.fulfill({json:returned});}
    if(u.pathname===`/api/inventory/products/${productId}/stock`) {
     const body=route.request().postDataJSON();requests.push(body);
     if(!receipts.has(body.request_key)){
      assert.equal(body.expected_stock,model.products[0].stock);
      if(body.kind==='production'){model.products[0].stock+=Number(body.quantity);model.materials[0].stock-=Number(body.quantity)*2;}
      else model.products[0].stock=Number(body.quantity);
      const p=model.products[0];p.from_stock=Math.min(p.stock,p.required);p.to_produce=p.required-p.from_stock;
      receipts.set(body.request_key,{id:productId,stock:p.stock});
     }
     if(failAfterSave){failAfterSave=false;return route.fulfill({status:503,json:{error:'Fixture response lost'}});}
     return route.fulfill({json:receipts.get(body.request_key)});
    }
    if(u.pathname==='/api/inventory')data=model;
    else if(u.pathname==='/api/orders')data=u.searchParams.get('status')==='archive'?{orders:[],total:0}:[];
    else if(u.pathname==='/api/workflow-statuses')data=[['new','NEW'],['in_progress','IN PROGRESS'],['crafted','CRAFTED'],['ready_for_pickup','READY FOR PICKUP'],['shipped','SHIPPED']].map(([id,label],position)=>({id,label,position}));
    else if(u.pathname==='/api/dashboard')data={openOrders:0,ordersThisMonth:0,ordersPreviousMonth:0,openByVendor:{},thisMonthByVendor:{},thisMonthByCountry:{},allTimeByCountry:{},dashboardPins:[]};
    else if(u.pathname==='/api/config')data={channels:{},shipping:{}};
    else if(u.pathname==='/api/branding')data={name:'MOMS',logo:null};
    else if(['/api/tracking/statuses','/api/authorizations'].includes(u.pathname))data={};
    return route.fulfill({json:data});
   });
   await page.goto(`http://127.0.0.1:${server.address().port}/#inventory`);
   await page.waitForFunction(()=>window.inventoryState.products.length===1);
   await page.evaluate(lang=>window.i18n.setLanguage(lang),language);
   await page.locator('[data-inventory-tab="products"]').click();
   assert((await page.locator('#inventoryProducts').textContent()).includes('Holder <safe>'));
   assert.equal(await page.locator('#inventoryProducts script').count(),0);
   await page.locator('[data-stock-kind="production"]').click();
   assert.equal(await page.locator('#finishedStockTitle').textContent(),language==='sk'?'Zaznamenať výrobu':'Record production');
   await page.locator('#finishedStockQuantity').fill('6');
   await page.locator('#finishedStockForm [type=submit]').click();
   await page.waitForFunction(()=>document.getElementById('finishedStockMessage').textContent==='Fixture response lost');
   await page.locator('#finishedStockForm [type=submit]').click();
   await page.waitForFunction(()=>!document.getElementById('finishedStockDialog').open&&window.inventoryState.products[0].stock===6);
   assert.deepEqual(await page.locator('#inventoryProducts tbody tr td').allTextContents().then(cells=>cells.slice(2,6)),['6','8','6','2']);
   assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);assert.equal(model.materials[0].stock,8);
   await page.locator('[data-stock-kind="adjustment"]').click();
   assert.equal(await page.locator('#finishedStockTitle').textContent(),language==='sk'?'Upraviť hotovú zásobu':'Adjust finished stock');
   await page.locator('#finishedStockQuantity').fill('4');await page.locator('#finishedStockForm [type=submit]').click();
   await page.waitForFunction(()=>!document.getElementById('finishedStockDialog').open&&window.inventoryState.products[0].stock===4);
   assert.deepEqual(await page.locator('#inventoryProducts tbody tr td').allTextContents().then(cells=>cells.slice(2,6)),['4','8','4','4']);
   assert.equal(requests.at(-1).expected_stock,6);assert.equal(model.materials[0].stock,8);
   await page.evaluate(()=>{const dialog=document.getElementById('orderDetailsDialog');dialog.dataset.detailId='42';document.getElementById('orderDetailsContent').innerHTML='';dialog.showModal();return window.loadOrderFulfillment(42);});
   const restore=page.locator('[data-receive-return][data-restock="true"]');assert(await restore.isEnabled(),'Finished-only snapshot permits physical return receipt');
   page.once('dialog',dialog=>dialog.accept());await restore.click();
   await page.waitForFunction(()=>document.getElementById('orderDetailsContent').textContent.includes(window.i18n.t('Received; stock restored')),{},{timeout:5000}).catch(async error=>{console.error(language,width,returned,await page.locator('#orderDetailsContent').textContent(),errors);throw error;});
   assert.equal(model.products[0].stock,5);assert.equal(model.materials[0].stock,8);
   await page.evaluate(()=>document.getElementById('orderDetailsDialog').close());
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
   await page.close();
  }
  console.log('PASS finished stock EN/SK desktop/390px: production, lost-response retry, correction, queue counts, finished-product return receipt, escaping, no overflow/browser errors');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
