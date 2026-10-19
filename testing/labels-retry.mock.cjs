const {chromium}=require(process.env.MOMS_PLAYWRIGHT_MODULE || '@playwright/test');
const fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const file=path.join(root,'src/public',req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,...(process.env.MOMS_CHROMIUM_PATH?{executablePath:process.env.MOMS_CHROMIUM_PATH}:{})}),page=await browser.newPage({viewport:{width:1500,height:950},serviceWorkers:'block'});
 await page.addInitScript(()=>localStorage.setItem('mobile-connect-seen','true'));
 let bulkSuccess=false;const bulkOrders=[1,2].map(id=>({id,external_order_id:`<Fixture-${id}>`,channel:"manual",vendor:"Manual",workflow_status:"new",skus:"Fixture",address:"Fixture",shipped:false}));
 let acceptConfirmation=true;const confirmations=[],requests=[];
 const errors=[],alerts=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',async dialog=>{if(dialog.type()==='confirm'){confirmations.push(dialog.message());if(acceptConfirmation)await dialog.accept();else await dialog.dismiss();}else{alerts.push(dialog.message());await dialog.dismiss();}});
 const fields=[{env:'LABEL_RETENTION_DAYS',label:'Unused label retention days (0 = keep all)',group:'application',type:'number',value:'0'},{env:'ETSY_ENABLED',label:'Enabled',group:'etsy',type:'bool',value:'true'},{env:'ETSY_SHOP_ID',label:'Shop ID',group:'etsy',type:'text',value:'Original shop'},{env:'ETSY_KEY',label:'API key',group:'etsy',type:'text',value:'',secret:true,configured:true},{env:'SHOPIFY_SHOP',label:'Shop domain',group:'shopify',type:'text',value:'original.myshopify.com'}];
 let failSave=false,failRead=false,heldSave=null,heldRead=null;const saves=[];
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());let data=[];
  if(url.pathname==='/api/application-settings'){
   if(route.request().method()==='PATCH'){
    const body=route.request().postDataJSON();saves.push(body);
    if(heldSave){const held=heldSave;heldSave=null;await held;}
    if(failSave)return route.fulfill({status:400,json:{error:'Fixture save failed'}});
    for(const field of fields)if(Object.hasOwn(body,field.env)){if(field.secret)field.configured=Boolean(body[field.env]);else field.value=body[field.env];}
    data=fields;
   }else{
    const snapshot=structuredClone(fields);
    if(heldRead){const held=heldRead;heldRead=null;await held;}
    if(failRead)return route.fulfill({status:503,json:{error:'Fixture read failed'}});
    data=snapshot;
   }
  }else if(url.pathname==='/api/labels/gls'){requests.push(route.request().postDataJSON());if(bulkSuccess)return route.fulfill({json:{downloads:[{fileName:'GLS_Labels_fixture.pdf',pdfBase64:Buffer.from('%PDF-fixture').toString('base64')}],results:bulkOrders.map(order=>({orderId:order.id,success:true}))}});data={downloads:[],results:[{success:false,externalOrderId:'<Fixture>',error:'A label request may already exist for this order. Check the carrier portal and contact support before creating another shipment.'}]};}
  else if(url.pathname==='/api/orders')data=url.searchParams.get('status')==='archive'?{orders:[],total:0}:(bulkSuccess?bulkOrders:[]);
  else if(url.pathname==='/api/inventory')data={materials:[],products:[],rules:[],shopping:[],manufacturers:[],unmapped:[],movements:[]};
  else if(url.pathname==='/api/workflow-statuses')data=[{id:'new',label:'NEW',position:0,order_count:0}];
  else if(url.pathname==='/api/branding')data={name:'MOMS',logo:null};
  else if(url.pathname==='/api/config')data={channels:{},shipping:{}};
  else if(url.pathname==='/api/authorizations')data={shopify:{authMode:'client_credentials',configured:true}};
  else if(['/api/authorizations','/api/tracking/statuses','/api/dashboard'].includes(url.pathname))data={};
  await route.fulfill({json:data});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/#settings/auth`,{waitUntil:'domcontentloaded'});await page.evaluate(()=>window.i18n.ready);
 for(const language of ['en','sk'])for(const width of [1440,390]){await page.setViewportSize({width,height:900});await page.evaluate(async language=>{window.i18n.setLanguage(language);const button=document.createElement('button');button.textContent='Fixture';await printLabels(button,'/api/labels/gls',{orderIds:[1]});if(button.disabled)throw new Error('Button remains disabled');},language);assert(alerts.at(-1).includes('<Fixture>'));assert(alerts.at(-1).includes(language==='sk'?'portál dopravcu':'carrier portal'));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 for(const language of ['en','sk'])for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  await page.evaluate(language=>{window.i18n.setLanguage(language);state.archiveOrders=[{id:1,label_created:true,label_url:'/labels/original.pdf',external_order_id:'<img src=x onerror=alert(1)>'}];},language);
  acceptConfirmation=false;let before=requests.length;
  await page.evaluate(()=>printLabels(document.createElement('button'),'/api/labels/gls',{orderIds:[1,2]}));
  assert.equal(requests.length,before,'Cancel must not contact carrier API');
  assert(confirmations.at(-1).includes(language==='sk'?'Prepísať':'Replace'));
  acceptConfirmation=true;
  await page.evaluate(()=>printLabels(document.createElement('button'),'/api/labels/gls',{orderIds:[1,2]}));
  assert.equal(requests.length,before+1);
  assert.deepEqual(requests.at(-1).replaceLabels,{'1':'/labels/original.pdf'});
  assert.deepEqual(requests.at(-1).orderIds,[1,2]);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }

 bulkSuccess=true;
 for(const language of ['en','sk'])for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  await page.evaluate(async language=>{window.i18n.setLanguage(language);state.selectedOrderIds.clear();state.archiveOrders=[];await loadOrders();setView('board');renderTables();},language);
  await page.locator('[data-board-select="1"]').check();
  await page.locator('[data-board-select="2"]').check();
  const before=requests.length,downloads=[];
  const capture=download=>downloads.push(download.suggestedFilename());page.on('download',capture);
  const disclosure=page.locator('#boardSelectionBar details');
  if(await disclosure.count())await disclosure.evaluate(element=>element.open=true);
  const downloaded=page.waitForEvent('download');
  await page.locator('[data-board-bulk="printGls"]').click();await downloaded;
  await page.waitForFunction(()=>!document.getElementById('printGls').disabled);
  page.off('download',capture);
  assert.equal(requests.length,before+1);assert.deepEqual(requests.at(-1).orderIds,[1,2]);
  assert.deepEqual(downloads,['GLS_Labels_fixture.pdf']);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 assert.deepEqual(errors,[]);console.log('PASS board bulk GLS single download and label failure guidance EN/SK desktop/390px, preserved identifiers and reusable controls.');await browser.close();server.close();
})().catch(error=>{console.error(error);server.close();process.exit(1)});
