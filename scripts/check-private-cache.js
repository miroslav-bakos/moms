'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const handlers=new Map(),deleted=[],stored=new Map([['jmoms-api-v1',{orders:'private',backup:'secret'}],['unrelated-cache',{}]]);let claimed=false;
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../src/public/sw.js'),'utf8'),{
 self:{addEventListener:(name,handler)=>handlers.set(name,handler),skipWaiting:()=>{},clients:{claim:async()=>{claimed=true;}}},
 caches:{keys:async()=>[...stored.keys()],delete:async name=>{deleted.push(name);return stored.delete(name);}}
});
(async()=>{
 let completion;handlers.get('activate')({waitUntil:task=>{completion=task;}});await completion;
 assert.equal(stored.has('jmoms-api-v1'),false);assert.equal(stored.has('unrelated-cache'),true);assert(claimed);
 assert.equal(handlers.has('fetch'),false,'Authenticated network responses must not fall back to an earlier session cache');
 console.log('PASS service worker deletes legacy private API caches and never caches authenticated responses.');
})().catch(e=>{console.error(e);process.exitCode=1;});
