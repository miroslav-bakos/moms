'use strict';
const assert=require('node:assert/strict'),express=require('express');
module.exports=async({listener=false}={})=>{
 const {configure}=require('../src/desktop/funnel');let state={},writes=0;
 const key='fixture.example.ts.net:10000';
 const run=async(_,args)=>{
  if(args[0]==='status')return {stdout:JSON.stringify({BackendState:'Running',Self:{DNSName:'fixture.example.ts.net.'}})};
  if(args[1]==='status')return {stdout:JSON.stringify(state)};
  writes++;if(args.includes('--bg'))state={Web:{[key]:{Handlers:{'/':{Proxy:'http://127.0.0.1:3081'}}}},AllowFunnel:{[key]:true}};else state={};return {stdout:''};
 };
 assert((await configure({action:'enable',targetPort:3081,run})).enabled);await configure({action:'enable',targetPort:3081,run});assert.equal(writes,1);
 await configure({action:'disable',targetPort:3081,run});assert.equal(writes,2);
 state={Web:{[key]:{Handlers:{'/':{Proxy:'http://127.0.0.1:3080'}}}}};await assert.rejects(configure({action:'enable',targetPort:3081,run}),/overwrite/);assert.equal(writes,2);
 if(!listener){console.log('PASS Funnel configuration, idempotence and ownership guard.');return;}
 const router=express.Router();router.get('/etsy/callback',(req,res)=>res.redirect('/'));router.get('/shopify/callback',(req,res,next)=>next(new Error('PRIVATE FIXTURE SECRET')));
 const callbacks=require('../src/desktop/marketplaceCallbacks');const server=callbacks.application(router).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{for(const path of ['/','/login','/api/orders','/api/application-settings','/auth/etsy/start','/labels/fixture.pdf','/health'])assert.equal((await fetch(base+path)).status,404);
 assert.equal((await fetch(base+'/auth/etsy/callback',{method:'POST'})).status,404);
 assert.equal((await fetch(base+'/auth/etsy/callback')).status,200);
 const error=await fetch(base+'/auth/shopify/callback');assert.equal(error.status,400);assert(!(await error.text()).includes('PRIVATE FIXTURE'));
 assert.equal((await(await fetch(base+'/moms-callback-health/'+callbacks.nonce)).json()).nonce,callbacks.nonce);
 }finally{await new Promise(resolve=>server.close(resolve));}
 console.log('PASS isolated Funnel configuration, ownership guard, callback-only listener and sanitized failure.');
};
