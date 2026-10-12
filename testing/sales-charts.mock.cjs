const {chromium}=require(process.env.MOMS_PLAYWRIGHT_MODULE || '@playwright/test');
const fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const file=path.join(root,'src/public',req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,...(process.env.MOMS_CHROMIUM_PATH?{executablePath:process.env.MOMS_CHROMIUM_PATH}:{})}),page=await browser.newPage({viewport:{width:1500,height:950},serviceWorkers:'block'});
 await page.addInitScript(()=>localStorage.setItem('mobile-connect-seen','true'));
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const hostile='<img src=x onerror=alert(1)>';
 const fixture={orderCount:5,openOrderCount:2,missingAmountCount:1,currencies:[{currency:'EUR',total:80,average:40},{currency:'USD',total:30,average:30}],channels:[{channel:hostile,currency:'EUR',totalRevenue:100,orderCount:1,avgOrderValue:100},{channel:'etsy',currency:'EUR',totalRevenue:-20,orderCount:1,avgOrderValue:-20},{channel:'shopify',currency:'USD',totalRevenue:30,orderCount:1,avgOrderValue:30}],timeline:[{periodLabel:'2026-01',channel:hostile,currency:'EUR',totalRevenue:100,orderCount:1},{periodLabel:'2026-03',channel:'etsy',currency:'EUR',totalRevenue:-20,orderCount:1},{periodLabel:'2026-03',channel:'shopify',currency:'USD',totalRevenue:30,orderCount:1}]};
 fixture.profitability=require('../src/services/profitability').summarize([{channel:hostile,profit_month:'2026-03',consumed:true,cost_snapshot:{amount:'12',currency:'EUR',missing:[],products:[{name:hostile}]},revenue_amount:'40',revenue_currency:'EUR',entered_currency:'EUR',shipping_cost:'3',marketplace_fee:'2',payment_fee:'0',other_cost:'0'}],{});
 let empty=false;const requests=[];
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());let data=[];
  if(url.pathname==='/api/analytics/sales-overview'){requests.push(url.search);data=empty?{orderCount:0,currencies:[],channels:[],timeline:[]}:fixture;}
  else if(url.pathname==='/api/orders')data=url.searchParams.get('status')==='archive'?{orders:[],total:0}:[];
  else if(url.pathname==='/api/inventory')data={materials:[],products:[],rules:[],shopping:[],manufacturers:[],unmapped:[],movements:[]};
  else if(url.pathname==='/api/workflow-statuses')data=[{id:'new',label:'NEW',position:0,order_count:0}];
  else if(url.pathname==='/api/branding')data={name:'MOMS',logo:null};
  else if(url.pathname==='/api/config')data={channels:{},shipping:{}};
  else if(['/api/authorizations','/api/tracking/statuses','/api/dashboard'].includes(url.pathname))data={};
  await route.fulfill({json:data});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/#marketing`,{waitUntil:'domcontentloaded'});await page.evaluate(()=>window.i18n.ready);
 for(const language of ['en','sk'])for(const width of [1440,390]){
  await page.setViewportSize({width,height:950});await page.evaluate(language=>window.i18n.setLanguage(language),language);
  empty=false;await page.locator('#refreshMarketing').click();await page.waitForFunction(()=>document.querySelectorAll('.sales-chart').length===4);
  assert.equal(await page.locator('.sales-chart').first().locator('li').count(),3);
  assert((await page.locator('.sales-chart').first().innerText()).includes('2026-02'));
  assert((await page.locator('.sales-chart h3').first().innerText()).includes(language==='sk'?'Mesačný predaj':'Monthly sales'));
  assert.equal(await page.locator('#marketingContent img').count(),0);
  assert((await page.locator('.profitability').innerText()).includes(hostile));
  assert((await page.locator('.profitability h2').innerText()).includes(language==='sk'?'Zisk po evidovaných':'Profit after recorded'));
  assert((await page.locator('.profitability').innerText()).includes('57.5%'));
  assert((await page.locator('.sales-chart').nth(1).innerText()).includes(hostile));
  assert(await page.locator('.sales-chart').first().locator('rect').last().evaluate(el=>Number(el.getAttribute('height'))>0));
  const before=requests.length;await page.locator('[data-period="week"]').click();await page.waitForFunction(()=>document.querySelectorAll('.sales-chart').length===4);assert.equal(requests.length,before+1);assert(requests.at(-1).includes('from='));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`/tmp/moms-sales-${language}-${width}.png`,fullPage:true});
  empty=true;await page.locator('#refreshMarketing').click();await page.waitForFunction(()=>document.getElementById('marketingContent').textContent.includes(window.i18n.t('No orders in this period.')));assert.equal(await page.locator('.sales-chart').count(),0);
 }
 assert.deepEqual(errors,[]);console.log('PASS sales charts: currencies, negative values, missing months, escaped labels, filters, empty data, EN/SK desktop/mobile.');await browser.close();server.close();
})().catch(error=>{console.error(error);server.close();process.exit(1)});
