const {chromium}=require('@playwright/test');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const server=http.createServer((req,res)=>{const file=path.join(__dirname,'../src/public',req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));}catch(_){res.writeHead(404);res.end();}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,...(process.env.MOMS_CHROMIUM_PATH?{executablePath:process.env.MOMS_CHROMIUM_PATH}:{})});try{
 for(const lang of ['en','sk'])for(const width of [1500,390]){
 const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'}),errors=[],writes=[];let failed=false;
 page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{localStorage.setItem('mobile-connect-seen','true');localStorage.setItem('moms-local-setup-v1',JSON.stringify({done:true}));});
 await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url());let data=[];if(req.method()!=='GET')writes.push(url.pathname);
 if(url.pathname==='/api/inventory')data={materials:[{id:'m',name:'Thread <script>test</script>',unit:'m',stock:1,required:2,after_queue:-1}],products:[{id:'p',name:'Product <img src=x>',stock:1,required:2,from_stock:1,to_produce:1,recipe:[]}],rules:[],manufacturers:[],shopping:[],movements:[],unmapped:[],reservations:{products:[{product_id:'p',reserved:1,available:0,missing:1}],materials:[{material_id:'m',reserved:1,available:0,missing:1}],allocations:[{priority:1,order_id:1,order_number:'Early <img src=x>',products:[{product_id:'p',reserved:1,to_produce:0}],materials:[],unmapped:[]},{priority:2,order_id:2,order_number:'Late',products:[{product_id:'p',reserved:0,to_produce:1}],materials:[{material_id:'m',reserved:1,missing:1}],unmapped:['Unmapped <script>test</script>']}]}};
 else if(url.pathname==='/api/setup-readiness')data={login:true,channels:[{channel:'etsy',enabled:true,last_success_at:'2026-10-08',has_error:false}],orders:0,mappings:1,phone_url:'http://localhost',last_backup:null};
 else if(url.pathname==='/api/setup-trial'){assert.equal(req.postDataJSON().sku,'A');if(failed)return route.fulfill({status:400,json:{error:'Map this SKU to a product before running the trial.'}});data={products:[{name:'Orders <img src=x onerror=alert(1)>',from_stock:1,to_produce:2}],materials:[{name:'Material <script>throw 1</script>',required:4,unit:'m',missing:3}]};}
 else if(url.pathname==='/api/orders')data=url.searchParams.get('status')==='archive'?{orders:[],total:0}:[];
 else if(url.pathname==='/api/dashboard')data={openOrders:0,ordersThisMonth:0,ordersPreviousMonth:0,openByVendor:{},thisMonthByVendor:{},thisMonthByCountry:{},allTimeByCountry:{},dashboardPins:[]};
 else if(url.pathname==='/api/config')data={channels:{},shipping:{}};
 else if(url.pathname==='/api/branding')data={name:'MOMS',logo:null};
 else if(['/api/tracking/statuses','/api/authorizations'].includes(url.pathname))data={};
 return route.fulfill({json:data});});
 await page.goto(`http://127.0.0.1:${server.address().port}/#inventory`);await page.evaluate(async l=>{await window.i18n.ready;window.i18n.setLanguage(l);setView('inventory');await loadInventory();},lang);
 await page.locator('#inventoryReservations summary').click();const panel=page.locator('#inventoryReservations');assert.equal(await panel.locator('img,script').count(),0);const text=await panel.textContent();assert(text.includes('Early <img src=x>'));assert(text.includes('Unmapped <script>test</script>'));assert(text.indexOf('Early')<text.indexOf('Late'));assert.equal(await panel.locator('table').count(),2);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);await page.close();
 }
 console.log('PASS reservations EN/SK desktop/390px: shared stock and order priority, shortages, escaping, no writes/errors/overflow');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
