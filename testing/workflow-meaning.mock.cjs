const {chromium}=require('@playwright/test');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const server=http.createServer((req,res)=>{const file=path.join(__dirname,'../src/public',req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));}catch(_){res.writeHead(404);res.end();}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,...(process.env.MOMS_CHROMIUM_PATH?{executablePath:process.env.MOMS_CHROMIUM_PATH}:{})});try{
 for(const lang of ['en','sk'])for(const width of [1500,390]){
 const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'}),errors=[],writes=[];let failed=false;
 page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{localStorage.setItem('mobile-connect-seen','true');localStorage.setItem('moms-local-setup-v1',JSON.stringify({done:true}));});
 await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url());let data=[];if(req.method()!=='GET')writes.push(url.pathname);
 if(url.pathname==='/api/workflow-statuses')data=[{id:'new',label:'NEW',order_count:0,position:0,production_complete:false},{id:'custom',label:'Custom <img src=x>',order_count:0,position:1,production_complete:false}];else if(url.pathname==='/api/workflow-statuses/custom/production'){assert.deepEqual(req.postDataJSON(),{production_complete:true});if(failed)return route.fulfill({status:409,json:{error:'Move orders out of this stage before changing its production meaning.'}});data={id:'custom',production_complete:true};}else if(url.pathname==='/api/setup-readiness')data={login:true,channels:[{channel:'etsy',enabled:true,last_success_at:'2026-10-08',has_error:false}],orders:0,mappings:1,phone_url:'http://localhost',last_backup:null};
 else if(url.pathname==='/api/setup-trial'){assert.equal(req.postDataJSON().sku,'A');if(failed)return route.fulfill({status:400,json:{error:'Map this SKU to a product before running the trial.'}});data={products:[{name:'Orders <img src=x onerror=alert(1)>',from_stock:1,to_produce:2}],materials:[{name:'Material <script>throw 1</script>',required:4,unit:'m',missing:3}]};}
 else if(url.pathname==='/api/orders')data=url.searchParams.get('status')==='archive'?{orders:[],total:0}:[];
 else if(url.pathname==='/api/dashboard')data={openOrders:0,ordersThisMonth:0,ordersPreviousMonth:0,openByVendor:{},thisMonthByVendor:{},thisMonthByCountry:{},allTimeByCountry:{},dashboardPins:[]};
 else if(url.pathname==='/api/config')data={channels:{},shipping:{}};
 else if(url.pathname==='/api/branding')data={name:'MOMS',logo:null};
 else if(['/api/tracking/statuses','/api/authorizations'].includes(url.pathname))data={};
 return route.fulfill({json:data});});
 await page.goto(`http://127.0.0.1:${server.address().port}/#settings/workflow`);await page.evaluate(async l=>{await window.i18n.ready;window.i18n.setLanguage(l);setView('settings');setSettingsTab('workflow');await loadWorkflowStatuses();renderWorkflowSettings();},lang);
 assert.equal(await page.locator('[data-workflow-id=new] [data-workflow-production]').isDisabled(),true);
 const row=page.locator('[data-workflow-id=custom]');assert.equal(await row.locator('img').count(),0);await row.locator('[data-workflow-production]').check();failed=true;
 await Promise.all([page.waitForResponse('**/api/workflow-statuses/custom/production'),row.locator('[data-save-production]').click()]);await page.waitForFunction(()=>!document.querySelector('[data-save-production]').disabled);assert((await page.locator('#workflowSettingsMessage').textContent()).length>0);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);assert(writes.every(p=>p==='/api/workflow-statuses/custom/production'));await page.close();
 }
 console.log('PASS workflow meaning EN/SK desktop/390px: custom setting, default protection, occupied-stage error, escaping, no errors/overflow');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
