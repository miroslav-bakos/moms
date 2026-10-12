'use strict';
const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
let signedIn=true;
const server=http.createServer((req,res)=>{
 if(req.url==='/sw.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(__dirname,'../src/public/sw.js')));}
 if(req.url==='/api/orders'){res.setHeader('Content-Type','application/json');res.statusCode=signedIn?200:401;return res.end(JSON.stringify(signedIn?{orders:[{id:'fictional-private-order'}]}:{error:'Authentication required'}));}
 if(req.url==='/login/logout'){signedIn=false;return res.end('Signed out');}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Private cache regression fixture</title>');
});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,executablePath:process.env.MOMS_CHROMIUM_PATH});try{
 const context=await browser.newContext(),page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.evaluate(async()=>{const cache=await caches.open('jmoms-api-v1');await cache.put('/api/orders',new Response(JSON.stringify({orders:[{id:'old-account-order'}]})));await caches.open('unrelated-fixture');await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;});
 await page.waitForFunction(()=>navigator.serviceWorker.controller);assert(!(await page.evaluate(()=>caches.keys())).includes('jmoms-api-v1'));
 assert((await page.evaluate(async()=>await(await fetch('/api/orders')).text())).includes('fictional-private-order'));
 assert(!(await page.evaluate(()=>caches.keys())).includes('jmoms-api-v1'));
 await page.evaluate(()=>fetch('/login/logout',{method:'POST'}));assert.equal(await page.evaluate(async()=>(await fetch('/api/orders')).status),401);
 await context.setOffline(true);assert.equal(await page.evaluate(async()=>{try{await fetch('/api/orders');return 'cached';}catch{return 'unavailable';}}),'unavailable');
 await context.close();console.log('PASS browser private cache removal, authenticated fetch, logout refusal and no offline customer-data fallback.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
