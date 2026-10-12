// Disposable fixtures; never contacts the deployed API.
const {chromium}=require('@playwright/test');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const server=http.createServer((req,res)=>{const file=path.join(__dirname,'../src/public',req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));}catch(_){res.writeHead(404);res.end();}});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,...(process.env.MOMS_CHROMIUM_PATH?{executablePath:process.env.MOMS_CHROMIUM_PATH}:{})});try{
 for(const lang of ['en','sk'])for(const width of [1500,390]){
 const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'}),errors=[];let failed=false;
 const saved={etsy:{channel:'etsy',background_color:null,background_alpha:0.15},amazon:{channel:'amazon',background_color:'#112233',background_alpha:0.3}};
 page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{localStorage.setItem('mobile-connect-seen','true');localStorage.setItem('moms-local-setup-v1','{"done":true}');});
 await page.route('**/api/**',async route=>{const req=route.request(),url=new URL(req.url());let data=[];
 if(url.pathname==='/api/marketplace-appearance')data=Object.values(saved);
 else if(url.pathname.startsWith('/api/marketplace-appearance/')){if(failed)return route.fulfill({status:500,json:{error:'Fixture unavailable'}});const name=url.pathname.split('/').pop();saved[name]={channel:name,...req.postDataJSON()};data=saved[name];}
 else if(url.pathname==='/api/orders')data=url.searchParams.get('status')==='archive'?{orders:[],total:0}:[{id:42,external_order_id:'Color <img src=x onerror=alert(1)>',channel:'etsy',vendor:'Etsy',workflow_status:'new',business_outcome:'active',skus:'A',address:'Fixture',shipped:false}];
 else if(url.pathname==='/api/inventory')data={materials:[],products:[],rules:[],manufacturers:[],shopping:[],movements:[],unmapped:[],aliases:{}};
 else if(url.pathname==='/api/workflow-statuses')data=[{id:'new',label:'New',position:0},{id:'in_progress',label:'In progress',position:1},{id:'crafted',label:'Crafted',position:2},{id:'ready_for_pickup',label:'Ready for pickup',position:3},{id:'shipped',label:'Shipped',position:4}];
 else if(url.pathname==='/api/dashboard')data={openOrders:1,ordersThisMonth:1,ordersPreviousMonth:0,openByVendor:{Etsy:1},thisMonthByVendor:{},thisMonthByCountry:{},allTimeByCountry:{},dashboardPins:[]};
 else if(url.pathname==='/api/config')data={channels:{},shipping:{}};
 else if(url.pathname==='/api/branding')data={name:'MOMS',logo:null};
 else if(['/api/tracking/statuses','/api/authorizations'].includes(url.pathname))data={};
 return route.fulfill({json:data});});
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>state.openOrders.length===1);
 const settings=async()=>page.evaluate(async l=>{await window.i18n.ready;await loadInventory();window.i18n.setLanguage(l);setView('settings');setSettingsTab('appearance');},lang);await settings();
 const etsy=page.locator('[data-marketplace-form="etsy"]'),amazon=page.locator('[data-marketplace-form="amazon"]');
 await amazon.locator('[name=color]').fill('#987654');await etsy.locator('[name=color]').fill('#abcdef');await etsy.locator('[name=alpha]').fill('25');
 assert((await etsy.locator('.marketplace-color-preview').getAttribute('style')).includes('#abcdef'));
 await etsy.locator('[type=submit]').click();await page.waitForFunction(()=>!document.querySelector('[data-marketplace-form="etsy"] button').disabled);
 assert.equal(saved.etsy.background_color,'#abcdef');assert.equal(saved.etsy.background_alpha,0.25);assert.equal(await amazon.locator('[name=color]').inputValue(),'#987654');assert.equal(saved.amazon.background_color,'#112233');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 if(lang==='sk')await page.locator('.marketplace-appearance-card').screenshot({path:'/tmp/moms-marketplace-colors-'+width+'.png'});
 await page.evaluate(()=>{setView('board');state.boardStage='new';renderOrderBoard();});assert((await page.locator('.board-card[data-marketplace="etsy"]').first().getAttribute('style')).includes('#abcdef'));
 assert.equal(await page.locator('.board-card img[src=x]').count(),0);
 for(const theme of ['light','dark']){const bg=await page.evaluate(t=>{applyTheme(t);state.selectedOrderIds.add(42);updateSelectionBar();const card=document.querySelector('.board-card[data-marketplace=etsy]');return {background:getComputedStyle(card).backgroundColor,outline:getComputedStyle(card).outlineWidth};},theme);assert.notEqual(bg.background,'rgba(0, 0, 0, 0)');assert.notEqual(bg.outline,'0px');}
 await page.evaluate(()=>{applyTheme('light');state.selectedOrderIds.clear();updateSelectionBar();});
 await page.evaluate(()=>{setView('open');renderTables();});assert(await page.locator('[data-marketplace="etsy"][data-marketplace-colored]').count()>0);
 await page.reload();await page.waitForFunction(()=>state.openOrders.length===1);await settings();assert.equal(await etsy.locator('[name=color]').inputValue(),'#abcdef');
 failed=true;await etsy.locator('[name=color]').fill('#aabbcc');await etsy.locator('[type=submit]').click();await page.waitForFunction(()=>document.querySelector('[data-marketplace-form="etsy"] [role=status]').textContent.includes('Fixture'));
 assert.equal(await etsy.locator('[name=color]').inputValue(),'#aabbcc');assert.equal(saved.etsy.background_color,'#abcdef');failed=false;
 await etsy.locator('[data-reset-marketplace]').click();await page.waitForFunction(()=>!document.querySelector('[data-marketplace-form="etsy"] button').disabled);assert.equal(saved.etsy.background_color,null);assert.equal(await page.locator('[data-marketplace="etsy"][data-marketplace-colored]').count(),0);
 assert.equal(await page.evaluate(()=>window.marketplaceAppearance.style({background_color:'#123456;bad',background_alpha:0.2})), '');
 assert.equal(await page.evaluate(()=>window.marketplaceAppearance.channel({channel:'etsy',vendor:'Amazon'})), 'etsy');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS marketplace colors EN/SK desktop/390px: preview, per-channel persistence, reload, cards/tables, failure draft, reset, escaping and no errors/overflow');
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
