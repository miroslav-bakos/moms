'use strict';
const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const server=http.createServer((req,res)=>{let pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/')pathname='/index.html';const file=path.join(__dirname,'../src/public',pathname);try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'})[path.extname(file)]||'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:process.env.MOMS_CHROMIUM_PATH});try{
for(const width of [1440,390])for(const lang of ['en','sk']){
 const page=await browser.newPage({viewport:{width,height:980},serviceWorkers:'block'}),errors=[],calls=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(lang=>{localStorage.setItem('local-orders-language',lang);localStorage.setItem('mobile-connect-seen','true');},lang);
 await page.route('**/api/**',async route=>{const u=new URL(route.request().url());calls.push(u.pathname);let data=[];
 if(u.pathname==='/api/application-settings')data=require('../src/settings/schema.json').map(f=>({...f,value:'',configured:false}));
 else if(u.pathname==='/api/config')data={channels:{},shipping:{}};
 else if(u.pathname==='/api/branding')data={name:'MOMS',logo:null};
 else if(u.pathname==='/api/dashboard')data={openOrders:0,ordersThisMonth:0,ordersPreviousMonth:0,openByVendor:{},thisMonthByVendor:{},thisMonthByCountry:{},allTimeByCountry:{}};
 else if(u.pathname==='/api/authorizations')data={};
 await route.fulfill({json:data});});
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.evaluate(()=>window.i18n.ready);
 assert.equal(await page.locator('[data-view="competition"],[data-view="seo"],#settingsCompetition').count(),0);
 for(const hash of ['#competition','#seo','#settings/competition']){await page.evaluate(hash=>{location.hash=hash;},hash);await page.waitForTimeout(50);}
 assert(!calls.some(url=>url.startsWith('/api/competition')||url.startsWith('/api/seo')));
 await page.evaluate(async()=>{setView('settings');setSettingsTab('auth');await loadApplicationSettings();});
 assert((await page.locator('[data-settings-group]').evaluateAll(elements=>elements.map(e=>e.dataset.settingsGroup))).every(group=>['application','etsy','shopify','amazon','sashe','gls','posta'].includes(group)));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);await page.close();
}console.log('PASS free edition navigation/settings EN/SK desktop/390px, no removed-section requests or browser errors.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
