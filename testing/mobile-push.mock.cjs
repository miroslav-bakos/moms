// Disposable local static server + mocked APIs only; never touches deployment.
const {chromium}=require('@playwright/test');
const fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'../src/public');
const server=http.createServer((req,res)=>{try{const file=path.join(root,req.url.split('?')[0]==='/'?'index.html':['/app-logo','/app-favicon','/apple-touch-icon.png','/favicon.ico'].includes(req.url.split('?')[0])?'icon-512.png':req.url.split('?')[0]);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.png')?'image/png':file.endsWith('.json')?'application/json':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,...(process.env.MOMS_CHROMIUM_PATH?{executablePath:process.env.MOMS_CHROMIUM_PATH}:{})});
 const page=await browser.newPage({serviceWorkers:'block'}),errors=[],writes=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error'&&!/status of 400/.test(message.text()))errors.push(message.text());});
 await page.addInitScript(()=>{
  localStorage.setItem('mobile-connect-seen','true');
  window.fixturePermission='granted';window.fixtureSubscription=null;window.fixturePrompts=0;
  Object.defineProperty(window,'Notification',{value:{requestPermission:async()=>{window.fixturePrompts++;return window.fixturePermission;}}});
  Object.defineProperty(window,'PushManager',{value:function(){}});
  const registration={active:true,pushManager:{getSubscription:async()=>window.fixtureSubscription,subscribe:async()=>window.fixtureSubscription={endpoint:'https://fcm.googleapis.com/fcm/send/fixture',toJSON(){return {endpoint:this.endpoint,keys:{p256dh:'fixture',auth:'fixture'}};},async unsubscribe(){window.fixtureSubscription=null;return true;}}}};
  Object.defineProperty(navigator,'serviceWorker',{value:{register:async()=>registration,getRegistration:async()=>registration}});
 });
 let paired=true,pushEnabled=true,failSave=false;
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());let data=[];
  if(url.pathname==='/api/mobile-connect')data={url:paired?'https://moms.fixture.ts.net:8443/pair#fixture-one-time-code':'http://192.168.1.20:3080',qr:'data:image/png;base64,iVBORw0KGgo=',paired,wifi:paired?{setupUrl:'http://192.168.1.100:3080/phone-setup',qr:'data:image/png;base64,iVBORw0KGgo='}:null};
  else if(url.pathname==='/api/mobile-devices'){writes.push('revoke');data={ok:true};}
  else if(url.pathname==='/api/push'){
   if(route.request().method()==='GET')data={enabled:pushEnabled,publicKey:'BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'};
   else {writes.push(route.request().method());if(failSave)return route.fulfill({status:400,json:{error:'Fixture subscription rejected'}});data={ok:true};}
  }
  else if(url.pathname==='/api/orders')data=url.searchParams.get('status')==='archive'?{orders:[],total:0}:[];
  else if(url.pathname==='/api/inventory')data={materials:[],products:[],rules:[],shopping:[],manufacturers:[],unmapped:[],movements:[]};
  else if(url.pathname==='/api/workflow-statuses')data=[{id:'new',label:'NEW',position:0,order_count:0}];
  else if(url.pathname==='/api/branding')data={name:'MOMS',logo:null};
  else if(url.pathname==='/api/config')data={channels:{},shipping:{}};
  else if(url.pathname==='/api/dashboard')data=null;
  else if(['/api/authorizations','/api/tracking/statuses'].includes(url.pathname))data={};
  await route.fulfill({json:data});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/#settings/auth`);await page.evaluate(()=>window.i18n.ready);
 assert.equal(await page.evaluate(()=>window.fixturePrompts),0,'Permission is only requested on an explicit click');
 for(const language of ['en','sk'])for(const width of [1500,390]){
  await page.setViewportSize({width,height:950});await page.evaluate(language=>{i18n.setLanguage(language);setView('settings');setSettingsTab('auth');},language);
  paired=true;await page.locator('#connectPhone').click();await page.locator('#mobileConnectDialog').waitFor({state:'visible'});
  assert.equal(await page.locator('#mobileWifiGuide').count(),0);
  assert((await page.locator('#mobilePairingHelp').textContent()).includes(language==='sk'?'5 minút':'5 minutes'));assert(!(await page.locator('#mobileHttpsNotice').isVisible()));
  assert.equal(await page.locator('#mobileConnectAddress').textContent(),'https://moms.fixture.ts.net:8443/pair#fixture-one-time-code');
  await page.locator('#revokeMobileDevices').click();await page.waitForFunction(()=>document.getElementById('mobileConnectMessage').textContent.length>0);
  assert.equal(await page.locator('#mobileConnectAddress').textContent(),'');assert.equal(await page.locator('#mobileConnectAddress').getAttribute('href'),null);await page.locator('#closeMobileConnect').click();
  paired=false;await page.locator('#connectPhone').click();await page.locator('#mobileConnectDialog').waitFor({state:'visible'});assert(await page.locator('#mobileHttpsNotice').isVisible());await page.locator('#closeMobileConnect').click();
  await page.locator('#enablePush').click();await page.waitForFunction(()=>!document.getElementById('enablePush').disabled);
  assert((await page.locator('#pushMessage').textContent()).includes(language==='sk'?'údaje zákazníkov':'customer details'));
  await page.locator('#disablePush').click();await page.waitForFunction(()=>!document.getElementById('disablePush').disabled);assert.equal(await page.evaluate(()=>window.fixtureSubscription),null);
  failSave=true;await page.locator('#enablePush').click();await page.waitForFunction(()=>!document.getElementById('enablePush').disabled);failSave=false;assert.equal(await page.evaluate(()=>window.fixtureSubscription),null);
  await page.evaluate(()=>window.fixturePermission='denied');const before=writes.length;await page.locator('#enablePush').click();await page.waitForFunction(()=>!document.getElementById('enablePush').disabled);assert.equal(writes.length,before);await page.evaluate(()=>window.fixturePermission='granted');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 assert.deepEqual(errors,[]);assert(writes.includes('revoke')&&writes.includes('POST')&&writes.includes('DELETE'));
 console.log('PASS mobile pairing/push EN/SK desktop/390px: QR modes, revocation, explicit permission, subscribe/unsubscribe, failed-save cleanup, denied permission and no overflow/errors.');
 await browser.close();server.close();
})().catch(error=>{console.error(error);server.close();process.exit(1);});
