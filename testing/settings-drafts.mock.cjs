const {chromium}=require(process.env.MOMS_PLAYWRIGHT_MODULE || '@playwright/test');
const fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const file=path.join(root,'src/public',req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,...(process.env.MOMS_CHROMIUM_PATH?{executablePath:process.env.MOMS_CHROMIUM_PATH}:{})}),page=await browser.newPage({viewport:{width:1500,height:950},serviceWorkers:'block'});
 await page.addInitScript(()=>localStorage.setItem('mobile-connect-seen','true'));
 const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',async dialog=>{errors.push(dialog.message());await dialog.dismiss();});
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
  }else if(url.pathname==='/api/orders')data=url.searchParams.get('status')==='archive'?{orders:[],total:0}:[];
  else if(url.pathname==='/api/inventory')data={materials:[],products:[],rules:[],shopping:[],manufacturers:[],unmapped:[],movements:[]};
  else if(url.pathname==='/api/workflow-statuses')data=[{id:'new',label:'NEW',position:0,order_count:0}];
  else if(url.pathname==='/api/branding')data={name:'MOMS',logo:null};
  else if(url.pathname==='/api/config')data={channels:{},shipping:{}};
  else if(url.pathname==='/api/authorizations')data={shopify:{authMode:'client_credentials',configured:true}};
  else if(['/api/authorizations','/api/tracking/statuses','/api/dashboard'].includes(url.pathname))data={};
  await route.fulfill({json:data});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/#settings/auth`,{waitUntil:'domcontentloaded'});
 await page.locator('[data-settings-group="etsy"]').waitFor({state:'attached'});
 const dirty=()=>page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;});
 for(const language of ['en','sk'])for(const width of [1500,390]){
  await page.setViewportSize({width,height:950});
  await page.evaluate(async language=>{window.i18n.setLanguage(language);await loadApplicationSettings(true);setView('settings');setSettingsTab('auth');document.querySelector('[data-settings-group="etsy"]').closest('details').open=true;document.querySelector('[data-settings-group="shopify"]').closest('details').open=true;},language);
  const etsy=page.locator('[data-settings-group="etsy"]'),shopify=page.locator('[data-settings-group="shopify"]');
  const retention=page.locator('#setting-LABEL_RETENTION_DAYS');assert.equal(await retention.inputValue(),'0');assert((await page.locator('label[for="setting-LABEL_RETENTION_DAYS"]').textContent()).includes(language==='sk'?'Retencia':'retention'));
  assert.equal(await page.locator('a[href="/auth/shopify/start"]').count(),0);assert.equal(await page.locator('[data-poll="shopify"]').count(),1);
  assert(!(await dirty()));assert.equal(await page.locator('#setting-ETSY_KEY').inputValue(),'');assert.equal(await page.locator('#setting-ETSY_KEY').getAttribute('type'),'password');
  await page.locator('#setting-ETSY_SHOP_ID').fill('Draft <shop>');await page.locator('#setting-ETSY_KEY').fill('fixture-replacement');
  assert(await dirty());assert(await etsy.locator('[data-settings-dirty]').isVisible());
  assert((await etsy.locator('[data-settings-dirty]').textContent()).includes(language==='sk'?'Neuložené zmeny':'Unsaved changes'));
  await page.evaluate(()=>{setView('board');setView('settings');setSettingsTab('auth');});assert.equal(await page.locator('#setting-ETSY_SHOP_ID').inputValue(),'Draft <shop>');
  failRead=true;await page.evaluate(()=>loadApplicationSettings(true));failRead=false;assert.equal(await page.locator('#setting-ETSY_KEY').inputValue(),'fixture-replacement');
  failSave=true;await etsy.locator('button[type="submit"]').click();await page.waitForFunction(()=>!settingsSaving);failSave=false;
  assert.equal(await page.locator('#setting-ETSY_KEY').inputValue(),'fixture-replacement');assert(await dirty());assert((await etsy.locator('[data-settings-message]').textContent()).includes('Fixture save failed'));
  let releaseSave;heldSave=new Promise(resolve=>releaseSave=resolve);await etsy.locator('button[type="submit"]').click();await page.waitForFunction(()=>settingsSaving);
  assert(await page.locator('#setting-ETSY_KEY').isDisabled());assert(await page.locator('#setting-ETSY_SHOP_ID').isDisabled());assert(await shopify.locator('button[type="submit"]').isDisabled());
  await page.locator('#setting-SHOPIFY_SHOP').fill('draft.myshopify.com');const count=saves.length;
  await page.evaluate(()=>document.querySelector('[data-settings-group="shopify"]').requestSubmit());assert.equal(saves.length,count,'Concurrent saves are blocked');
  releaseSave();await page.waitForFunction(()=>!settingsSaving);
  assert.equal(await page.locator('#setting-ETSY_KEY').inputValue(),'');assert.equal(await page.locator('#setting-ETSY_SHOP_ID').inputValue(),'Draft <shop>');
  assert.equal(await page.locator('#setting-SHOPIFY_SHOP').inputValue(),'draft.myshopify.com');assert(await dirty());
  assert(!(await etsy.locator('[data-settings-dirty]').isVisible()));assert(await shopify.locator('[data-settings-dirty]').isVisible());assert(await page.locator('#setting-ETSY_KEY').isEnabled());
  await shopify.locator('[data-reset-settings]').click();assert(!(await dirty()));
  await page.locator('#setting-ETSY_SHOP_ID').fill('Race safe');let releaseRead;heldRead=new Promise(resolve=>releaseRead=resolve);
  await page.evaluate(()=>{window.fixtureReadDone=false;void loadApplicationSettings(true).then(()=>window.fixtureReadDone=true);});await page.waitForFunction(()=>settingsLoading);
  await etsy.locator('button[type="submit"]').click();await page.waitForFunction(()=>!settingsSaving);releaseRead();await page.waitForFunction(()=>window.fixtureReadDone);
  assert.equal(await page.locator('#setting-ETSY_SHOP_ID').inputValue(),'Race safe','Stale refresh cannot undo a confirmed save');assert(!(await dirty()));
  await etsy.locator('[data-clear="ETSY_KEY"]').check();assert(await dirty());await etsy.locator('[data-reset-settings]').click();assert(!(await dirty()));assert(!(await etsy.locator('[data-clear="ETSY_KEY"]').isChecked()));
  await page.locator('#setting-ETSY_SHOP_ID').fill('Original shop');await etsy.locator('button[type="submit"]').click();await page.waitForFunction(()=>!settingsSaving);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(process.env.MOMS_UI_SCREENSHOTS && language==='sk')await page.screenshot({path:`${process.env.MOMS_UI_SCREENSHOTS}-settings-${width}.png`,fullPage:true});
 }
 assert.deepEqual(errors,[]);console.log('Settings drafts: EN/SK desktop/mobile, masked secrets, reload guard, failed reads/saves, concurrent-save lock, independent drafts and stale refresh passed.');
 await browser.close();server.close();
})().catch(error=>{console.error(error);server.close();process.exit(1)});
