'use strict';
// Disposable HTTP server; no app database, settings or credentials are loaded.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),{chromium}=require('@playwright/test');
const express=require('express');
const config={port:3080,basicAuthUser:'',basicAuthPassword:'',appSecret:'fixture-only',etsy:{clientId:'fixture',redirectUri:'https://fixture.ts.net/auth/etsy/callback',scopes:['transactions_r'],authorizationUrl:'https://www.etsy.com/oauth/connect',tokenUrl:'https://etsy.invalid/token',apiBaseUrl:'https://etsy.invalid/api'},shopify:{},amazon:{}};
function stub(file,value){const path=require.resolve(file);require.cache[path]={id:path,filename:path,loaded:true,exports:value};}
let saved={values:{}},tokens=new Map(),states=new Map();
stub('../src/config',{config});stub('../src/settings/store',{read:()=>saved,write:value=>{saved=value;}});
stub('../src/services/tokenStore',{setToken:async(channel,token)=>{assert.equal(channel,'etsy');assert.equal(token.access_token,'123.fixture');}});
stub('../src/channels/etsy',{apiKeyHeader:()=>''});
stub('../src/db',{query:async(sql,args=[])=>{
 if(sql.startsWith('DELETE FROM mobile_devices WHERE expires_at'))return {rowCount:0};
 if(sql.startsWith('INSERT INTO mobile_devices')){tokens.set(args[0],args[1]);return {rowCount:1};}
 if(sql.startsWith('SELECT 1 FROM mobile_devices'))return {rowCount:Number(tokens.get(args[0])===args[1])};
 if(sql.startsWith('DELETE FROM mobile_devices WHERE token_hash'))return {rowCount:Number(tokens.delete(args[0]))};
 if(sql.includes('INSERT INTO oauth_states')){states.set(args[0],{owner:args[4],session:args[5]});return {rowCount:1};}
 if(sql.includes('DELETE FROM oauth_states')){const state=states.get(args[0]);if(!state||state.owner!==args[2]||!tokens.has(state.session))return {rows:[]};states.delete(args[0]);return {rows:[state]};}
 throw new Error('Unexpected fixture query');
}});
const app=express();app.use(express.json());app.use('/login',require('../src/routes/login'));app.use('/auth',require('../src/routes/oauth'));app.use(require('../src/middleware/basicAuth').basicAuth);app.get('/',(req,res)=>res.send('<h1>Private app</h1>'));app.get('/api/orders',(req,res)=>res.json([]));app.use((error,req,res,next)=>res.status(error.statusCode||400).json({error:error.message}));
(async()=>{
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
 const originalFetch=global.fetch;global.fetch=async(url,options)=>{if(String(url)==='https://etsy.invalid/token')return {ok:true,text:async()=>JSON.stringify({access_token:'123.fixture',expires_in:3600})};if(String(url)==='https://etsy.invalid/api/users/123/shops')return {ok:true,json:async()=>({shop_id:456})};return originalFetch(url,options);};
 const browser=await chromium.launch({headless:true,executablePath:process.env.MOMS_CHROMIUM_PATH||undefined});
 try{
  const first=await fetch(base+'/api/orders');assert.equal(first.status,403);
  const denied=await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Host:'attacker.invalid','X-Forwarded-Host':'attacker.invalid'},body:'username=owner&password=fixture-password&confirm=fixture-password'});assert.equal(denied.status,403);assert.equal(config.basicAuthUser,'');
  for(const width of [1440,390])for(const lang of ['en','sk']){
   config.basicAuthUser='';config.basicAuthPassword='';tokens.clear();saved={values:{}};
   const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'/login?lang='+lang);await page.locator('[name=username]').fill('owner');await page.locator('[name=password]').fill('fixture-password');await page.locator('[name=confirm]').fill('fixture-password');await page.locator('button').click();await page.waitForLoadState();if(!(await page.locator('h1').filter({hasText:'Private app'}).count()))throw new Error('Fixture login failed: '+await page.locator('body').innerText());
   assert(saved.values.APP_BASIC_AUTH_PASSWORD.startsWith('scrypt:'));assert(!saved.values.APP_BASIC_AUTH_PASSWORD.includes('fixture-password'));
   const cookie=(await context.cookies()).find(c=>c.name==='loa_session');assert(cookie.httpOnly);assert(cookie.expires*1000-Date.now()<13*3600000);
   const csrf=await context.request.post(base+'/login/logout',{headers:{Origin:'https://attacker.invalid'}});assert.equal(csrf.status(),403);assert.equal((await context.request.get(base+'/api/orders')).status(),200);
   const start=await context.request.get(base+'/auth/etsy/start',{maxRedirects:0});assert.equal(start.status(),302);assert(states.size>0);const state=[...states.values()].at(-1);assert(state.owner&&tokens.has(state.session));
   await context.request.post(base+'/login/logout');const rejected=await context.request.get(base+'/api/orders');assert.equal(rejected.status(),401);assert.equal((await rejected.json()).error,'Authentication required');assert(!tokens.has(state.session));
   const basic='Basic '+Buffer.from('owner:fixture-password').toString('base64');assert.equal((await context.request.get(base+'/api/orders',{headers:{Authorization:basic}})).status(),401,'Logout defeats cached Basic authentication');
   await page.goto(base+'/login?lang='+lang);await page.locator('[name=username]').fill('owner');await page.locator('[name=password]').fill('fixture-password');await page.locator('button').click();await page.locator('h1').filter({hasText:'Private app'}).waitFor();assert.deepEqual(errors,[]);
   config.etsy.shopId='';const connect=await context.request.get(base+'/auth/etsy/start',{maxRedirects:0});const newState=new URL(connect.headers().location).searchParams.get('state');const callback=await context.request.get(base+'/auth/etsy/callback?state='+newState+'&code=fixture',{maxRedirects:0});assert.equal(callback.status(),302);assert.equal(config.etsy.shopId,'456');assert.equal(saved.values.ETSY_SHOP_ID,'456');
   await page.goto(base+'/login?lang='+lang);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await context.close();
  }
  assert.equal((await fetch(base+'/auth/etsy/start',{redirect:'manual'})).status,401);
  assert.equal((await fetch(base+'/auth/amazon/login?amazon_callback_uri=https://sellercentral.evil.invalid/apps/authorize/confirm/1',{redirect:'manual'})).status,401);
  console.log('PASS owner bootstrap, EN/SK desktop/mobile login, hashing, finite sessions, logout, cached Basic refusal, CSRF and authenticated OAuth initiation.');
 }finally{global.fetch=originalFetch;await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
