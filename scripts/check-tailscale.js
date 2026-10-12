'use strict';
const assert=require('node:assert/strict');
const {configure}=require('../src/desktop/tailscale');
(async()=>{
 let serve={},calls=[];
 const key='fixture.example.ts.net:8443';
 const run=async(executable,args)=>{
  assert.equal(executable,'tailscale');calls.push(args);
  if(args[0]==='status')return {stdout:JSON.stringify({BackendState:'Running',Self:{DNSName:'fixture.example.ts.net.'}})};
  if(args[1]==='status')return {stdout:JSON.stringify(serve)};
  if(args.includes('--bg'))serve={Web:{[key]:{Handlers:{'/':{Proxy:'http://127.0.0.1:3080'}}}}};
  else delete serve.Web[key];
  return {stdout:''};
 };
 assert.equal((await configure({action:'enable',run})).enabled,true);
 await configure({action:'enable',run});assert.equal(calls.filter(args=>args.includes('--bg')).length,1);
 await configure({action:'disable',run});assert.equal(Object.keys(serve.Web).length,0);
 serve={Web:{[key]:{Handlers:{'/':{Proxy:'http://localhost:9999'}}}}};
 await assert.rejects(configure({action:'enable',run}),/another configuration/);
 await assert.rejects(configure({action:'disable',run}),/another configuration/);
 serve={AllowFunnel:{[key]:true}};await assert.rejects(configure({action:'enable',run}),/Public Funnel/);
 assert(!calls.some(args=>args.includes('reset')));
 await require('./check-marketplace-callbacks')();
 console.log('PASS private optional Tailscale Serve: explicit enable/disable, idempotence, reserved-port conflict and public Funnel refusal.');
})().catch(error=>{console.error(error);process.exitCode=1;});
