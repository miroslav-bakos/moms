// Disposable static app + API fixtures; never connects to deployment or marketplace APIs.
const {chromium}=require(process.env.MOMS_PLAYWRIGHT_MODULE || '@playwright/test');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
 const name=path.join(root,'src/public',req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);
 try{res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(name));}catch(_){res.statusCode=404;res.end();}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,...(process.env.MOMS_CHROMIUM_PATH?{executablePath:process.env.MOMS_CHROMIUM_PATH}:{})});
 try {
 for(const language of ['en','sk'])for(const width of [1500,390]){
 const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'}),errors=[],patches=[],labels=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await page.addInitScript(()=>localStorage.setItem('mobile-connect-seen','true'));
 let order={id:42,external_order_id:'Fixture',channel:'manual',vendor:'Manual',workflow_status:'crafted',skus:'Holder',address:'Fixture\nSlovakia',shipped:false,shipping_weight:''},held=null,release=null,failSave=false;
 await page.route('**/api/**',async route=>{
 const u=new URL(route.request().url());let data=[];
 if(u.pathname==='/api/orders/42'&&route.request().method()==='PATCH'){
 const body=route.request().postDataJSON();patches.push(body);if(held)await held;
 if(failSave)return route.fulfill({status:409,json:{error:'Fixture weight save failed'}});
 order={...order,...body};return route.fulfill({json:order});
 }
 if(u.pathname==='/api/labels/posta'){labels.push(order.shipping_weight);return route.fulfill({json:{downloads:[],results:[]}});}
 if(u.pathname==='/api/orders')data=u.searchParams.get('status')==='archive'?{orders:[],total:0}:[order];
 else if(u.pathname==='/api/workflow-statuses')data=[['new','NEW'],['in_progress','IN PROGRESS'],['crafted','CRAFTED'],['ready_for_pickup','READY FOR PICKUP'],['shipped','SHIPPED']].map(([id,label],position)=>({id,label,position}));
 else if(u.pathname==='/api/inventory')data={materials:[],products:[],rules:[],movements:[],unmapped:[],shopping:[],manufacturers:[]};
 else if(u.pathname==='/api/dashboard')data={openOrders:1,ordersThisMonth:1,ordersPreviousMonth:0,openByVendor:{Manual:1},thisMonthByVendor:{},thisMonthByCountry:{},allTimeByCountry:{},dashboardPins:[]};
 else if(u.pathname==='/api/config')data={channels:{},shipping:{}};
 else if(u.pathname==='/api/branding')data={name:'MOMS',logo:null};
 else if(['/api/tracking/statuses','/api/authorizations'].includes(u.pathname))data={};
 return route.fulfill({json:data});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/#board`);await page.waitForFunction(()=>state.openOrders.length===1);
 await page.evaluate(lang=>{window.i18n.setLanguage(lang);state.boardStage='crafted';renderOrderBoard();},language);
 const input=page.locator('#orderBoard [data-weight-id="42"]');
 held=new Promise(resolve=>release=resolve);await input.fill('0,75');await input.blur();
 await page.waitForFunction(()=>document.querySelector('#orderBoard input.weight-input').value==='0,75');
 const printing=page.evaluate(()=>{const button=document.createElement('button');button.id='fixturePrint';button.textContent='Print';document.body.append(button);return printLabels(button,'/api/labels/posta',{orderIds:[42],type:'parcel'});});
 await new Promise(resolve=>setTimeout(resolve,80));assert.equal(labels.length,0,'Print waits for persisted weight');
 release();held=null;await printing;assert.deepEqual(labels,['0,75']);assert.equal(patches.at(-1).shipping_weight,'0,75');
 await page.evaluate(()=>renderOrderBoard());assert.equal(await input.inputValue(),'0,75');
 await input.fill('-1');await input.blur();assert.equal(await input.getAttribute('aria-invalid'),'true');
 await page.evaluate(()=>printLabels(document.getElementById('fixturePrint'),'/api/labels/posta',{orderIds:[42]}));assert.equal(labels.length,1);
 failSave=true;await input.fill('0.8');await input.blur();await page.evaluate(()=>pendingWeightSave);
 await page.evaluate(()=>printLabels(document.getElementById('fixturePrint'),'/api/labels/posta',{orderIds:[42]}));assert.equal(labels.length,1,'Failed save blocks label generation');
 failSave=false;await input.fill('');await input.blur();await page.evaluate(()=>pendingWeightSave);assert.equal(order.shipping_weight,'');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS board weight EN/SK desktop/390px: comma decimal, persistence, print waits, invalid/failed save blocks labels, empty defaults, no errors/overflow');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
