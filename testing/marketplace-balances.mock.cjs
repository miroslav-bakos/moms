'use strict';
// Disposable loopback UI with intercepted APIs; never run against deployment.
const {chromium}=require('@playwright/test');
const {summarizeBalances}=require('../src/services/marketplaceBalances');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
  const file=path.join(root,'src/public',req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);
  try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,...(process.env.MOMS_CHROMIUM_PATH?{executablePath:process.env.MOMS_CHROMIUM_PATH}:{})});
  try {
    for(const language of ['en','sk']) for(const width of [1440,390]) {
      const page=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block'}),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('Failed to load resource'))errors.push(message.text());});
      await page.addInitScript(language=>{localStorage.setItem('mobile-connect-seen','true');localStorage.setItem('moms-local-setup-v1',JSON.stringify({done:true}));localStorage.setItem('local-orders-language',language);},language);
      let fail=false,refreshes=0,hold=null;
      const stamp='2026-10-07T08:00:00Z';
      const marketplaces=[{channel:'amazon',name:'Amazon',status:'ok',checkedAt:stamp,rows:[{account:'DE · <img src=x onerror=alert(1)>',currency:'EUR',available:'0',total:'123.45',updatedAt:stamp},{account:'Zero account',currency:'GBP',available:'0.00',total:'0.00'},{account:'US · Standard Orders',currency:'USD',available:'15',total:'27'}]},
        {channel:'etsy',name:'Etsy',status:'unsupported',checkedAt:stamp,rows:[]},
        {channel:'shopify',name:'Shopify',status:'ok',checkedAt:stamp,rows:[{account:'Shopify Payments',currency:'EUR',available:null,total:'99.95'}]},
        {channel:'sashe',name:'SAShE',status:'unsupported',checkedAt:stamp,rows:[]}];
      await page.route('**/api/**',async route=>{
        const u=new URL(route.request().url());let data=[];
        if(u.pathname==='/api/marketplace-balances') {
          if(u.searchParams.has('refresh'))refreshes++;
          if(hold)await hold;
          return route.fulfill({status:fail?503:200,json:fail?{error:'Fixture unavailable'}:{marketplaces,summary:summarizeBalances(marketplaces)}});
        }
        if(u.pathname==='/api/dashboard')data={openOrders:0,openByVendor:{},thisMonthByVendor:{},thisMonthByCountry:{},allTimeByCountry:{},ordersThisMonth:0,ordersPreviousMonth:0,dashboardPins:[],openOrderValue:{currencies:[{currency:'EUR',total:'350.00'}],missingAmountCount:0}};
        else if(u.pathname==='/api/orders'&&u.searchParams.get('status')==='archive')data={orders:[],total:0};
        else if(u.pathname==='/api/config')data={channels:{},shipping:{}};
        else if(u.pathname==='/api/branding')data={name:'MOMS',logo:null};
        else if(u.pathname==='/api/workflow-statuses')data=[{id:'new',label:'NEW',position:0,order_count:0}];
        else if(u.pathname==='/api/inventory')data={materials:[],products:[],rules:[],shopping:[],manufacturers:[],unmapped:[],movements:[]};
        else if(['/api/authorizations','/api/tracking/statuses'].includes(u.pathname))data={};
        await route.fulfill({json:data});
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/#dashboard`);
      await page.locator('.marketplace-balance[data-marketplace="amazon"] dd').first().waitFor({state:'attached'});
      await page.waitForFunction(()=>document.querySelector('#refreshBalances')&&!document.querySelector('#refreshBalances').disabled&&document.querySelector('[data-marketplace="amazon"] .balance-account-name'));
      const panel=page.locator('#marketplaceBalances');
      assert.equal(await panel.locator('details').evaluate(el=>el.open),false,'Balance details start collapsed');
      assert(await panel.locator('.marketplace-balances-grid').isHidden());
      assert(await page.locator('#marketplaceBalanceSummary').isVisible(),'Compact funds summary stays visible');
      assert.deepEqual(await page.locator('#desktopSidebar .nav-link:not([hidden])').evaluateAll(buttons=>buttons.slice(0,3).map(button=>button.dataset.view)),['dashboard','board','marketing']);
      if(process.env.MOMS_UI_SCREENSHOTS){fs.mkdirSync(process.env.MOMS_UI_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.MOMS_UI_SCREENSHOTS,`collapsed-${language}-${width}.png`),fullPage:true});}
      await panel.locator('summary').focus();await page.keyboard.press('Enter');
      assert(await panel.locator('.marketplace-balances-grid').isVisible(),'Keyboard opens the balances');
      await page.evaluate(()=>renderDashboard());
      assert(await panel.locator('.marketplace-balances-grid').isVisible(),'Dashboard refresh preserves expanded state');

      assert.equal(await panel.locator('article').count(),4);
      const summary=page.locator('#marketplaceBalanceSummary');
      assert.equal(await page.locator('.open-order-value #marketplaceBalanceSummary').count(),1,'Summary is below open order value in its card');
      assert.equal(await summary.locator('.dash-value').count(),2,'Currencies stay separate');
      const totalText=await summary.innerText();
      assert(totalText.includes(language==='sk'?'223,40':'223.40'),'Total adds Amazon total plus Shopify total exactly');
      assert(totalText.includes('27'),'USD total includes held funds once');
      assert(totalText.includes(language==='sk'?'Čiastkový súčet':'Partial total'));assert(totalText.includes('Etsy')&&totalText.includes('SAShE'));

      assert.equal(await panel.locator('[data-marketplace="amazon"] .balance-account').count(),2);
      assert.equal(await panel.locator('img').count(),0,'Account strings are escaped');
      assert((await panel.locator('[data-marketplace="amazon"] dd').first().innerText()).includes(language==='sk'?'123,45':'123.45'));
      assert(!(await panel.innerText()).includes('Zero account'));
      assert.equal(await panel.locator('[data-marketplace="amazon"] .balance-account').first().locator('dd').count(),1,'Zero payout hidden while held funds remain');
      assert((await panel.locator('[data-marketplace="etsy"]').innerText()).includes(language==='sk'?'Nedostupné':'Unavailable'));
      assert((await panel.locator('h3').innerText()).includes(language==='sk'?'Zostatky':'Marketplace'));
      assert((await panel.locator('[data-marketplace="shopify"] dd').last().innerText()).includes(language==='sk'?'99,95':'99.95'));
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'No page overflow');
      let release;hold=new Promise(resolve=>{release=resolve;});
      await panel.locator('#refreshBalances').click();
      assert(await panel.locator('#refreshBalances').isDisabled());fail=true;release();hold=null;
      await page.waitForFunction(()=>!document.querySelector('#refreshBalances').disabled);
      assert.equal(refreshes,1);
      assert.equal(await summary.locator('.balance-warning').count(),1,'Aggregate warns when last balances are stale');
      assert.equal(await panel.locator('.balance-warning').count(),2,'Failed refresh labels previously successful amounts');
      assert((await panel.locator('[data-marketplace="amazon"]').innerText()).includes(language==='sk'?'123,45':'123.45'));
      fail=false;await panel.locator('#refreshBalances').click();
      await page.waitForFunction(()=>!document.querySelector('#refreshBalances').disabled);
      assert.equal(await panel.locator('.balance-warning').count(),0);assert.equal(await summary.locator('.balance-warning').count(),0);
      await page.evaluate(()=>window.i18n.setLanguage(window.i18n.language==='en'?'sk':'en'));
      assert((await panel.locator('h3').innerText()).includes(language==='en'?'Zostatky':'Marketplace'));
      await page.evaluate(language=>{window.i18n.setLanguage(language);document.documentElement.dataset.theme='dark';},language);
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
      if(process.env.MOMS_UI_SCREENSHOTS){fs.mkdirSync(process.env.MOMS_UI_SCREENSHOTS,{recursive:true});await panel.screenshot({path:path.join(process.env.MOMS_UI_SCREENSHOTS,`balances-${language}-${width}.png`)});await page.locator('.open-order-value').screenshot({path:path.join(process.env.MOMS_UI_SCREENSHOTS,`funds-summary-${language}-${width}.png`)});}
      await panel.locator('summary').click();
      assert(await panel.locator('.marketplace-balances-grid').isHidden());
      await page.evaluate(()=>window.marketplaceBalances.render());
      assert(await panel.locator('.marketplace-balances-grid').isHidden(),'Rerender preserves collapsed choice');
      await panel.locator('summary').click();
      await page.reload();
      await page.waitForFunction(()=>document.querySelector('[data-marketplace="amazon"] .balance-account-name'));
      assert.equal(await panel.locator('details').evaluate(el=>el.open),false,'New page loads default to collapsed');
      assert.deepEqual(errors,[]);await page.close();
    }
    console.log('Marketplace aggregate/UI passed: exact provider totals, partial/stale totals, EN/SK, desktop/390px, refresh/loading/failure recovery, zero/unavailable, currency separation, escaping, dark theme and overflow.');
  } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
