const {chromium}=require(process.env.MOMS_PLAYWRIGHT_MODULE || '@playwright/test');
const fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const file=path.join(root,'src/public',req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,...(process.env.MOMS_CHROMIUM_PATH?{executablePath:process.env.MOMS_CHROMIUM_PATH}:{})}),page=await browser.newPage({viewport:{width:1500,height:950},serviceWorkers:'block'});
 await page.addInitScript(()=>localStorage.setItem('mobile-connect-seen','true'));
 const errors=[],alerts=[];let responseMode='expired';page.on('pageerror',error=>errors.push(error.message));page.on('dialog',async dialog=>{alerts.push(dialog.message());await dialog.dismiss();});
 const fields=[{env:'LABEL_RETENTION_DAYS',label:'Unused label retention days (0 = keep all)',group:'application',type:'number',value:'0'},{env:'ETSY_ENABLED',label:'Enabled',group:'etsy',type:'bool',value:'true'},{env:'ETSY_SHOP_ID',label:'Shop ID',group:'etsy',type:'text',value:'Original shop'},{env:'ETSY_KEY',label:'API key',group:'etsy',type:'text',value:'',secret:true,configured:true},{env:'SHOPIFY_SHOP',label:'Shop domain',group:'shopify',type:'text',value:'original.myshopify.com'}];
 let failSave=false,failRead=false,heldSave=null,heldRead=null;const saves=[];
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());let data=[];
  if(url.pathname==='/api/poll')return route.fulfill(responseMode==='expired'?{status:401,contentType:'text/plain',body:'Authentication required'}:responseMode==='proxy'?{status:502,contentType:'text/html',body:'<html>Bad gateway</html>'}:{status:429,json:{error:'SAShE connection cooldown. Please wait; automatic synchronization will retry later.'}});
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
  }else if(url.pathname==='/api/orders')data=url.searchParams.get('status')==='archive'?{orders:[],total:0}:[];
  else if(url.pathname==='/api/inventory')data={materials:[],products:[],rules:[],shopping:[],manufacturers:[],unmapped:[],movements:[]};
  else if(url.pathname==='/api/workflow-statuses')data=[{id:'new',label:'NEW',position:0,order_count:0}];
  else if(url.pathname==='/api/branding')data={name:'MOMS',logo:null};
  else if(url.pathname==='/api/config')data={channels:{},shipping:{}};
  else if(url.pathname==='/api/authorizations')data={shopify:{authMode:'client_credentials',configured:true}};
  else if(['/api/authorizations','/api/tracking/statuses','/api/dashboard'].includes(url.pathname))data={};
  await route.fulfill({json:data});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/#settings/auth`,{waitUntil:'domcontentloaded'});await page.evaluate(()=>window.i18n.ready);await page.locator('[data-settings-group="etsy"]').waitFor({state:'attached'});
 for(const language of ['en','sk'])for(const width of [1440,390]){
  await page.setViewportSize({width,height:950});await page.evaluate(language=>{window.i18n.setLanguage(language);document.querySelector('[data-settings-group="etsy"]').closest('details').open=true;},language);await page.locator('#setting-ETSY_SHOP_ID').fill('Unsaved fixture');
  for(const mode of ['expired','proxy','cooldown']){responseMode=mode;const before=alerts.length;await page.locator('#pollNow').click();await page.waitForFunction(()=>!document.getElementById('pollNow').disabled);assert.equal(alerts.length,before+1);const message=alerts.at(-1);assert(!/JSON|Unexpected token|<html>/.test(message));assert(message.includes(mode==='expired'?(language==='sk'?'prihlásenie vypršalo':'session expired'):mode==='proxy'?(language==='sk'?'neočakávanú':'unexpected response'):(language==='sk'?'SAShE':'SAShE')));assert.equal(await page.locator('#setting-ETSY_SHOP_ID').inputValue(),'Unsaved fixture');}
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 assert.deepEqual(errors,[]);console.log('PASS Sync expired-session/plain-text/proxy/cooldown errors, EN/SK desktop/390px, preserved drafts and reusable button.');await browser.close();server.close();
})().catch(error=>{console.error(error);server.close();process.exit(1)});
