const assert=require('node:assert/strict');
const configFile=require.resolve('../src/config'),dbFile=require.resolve('../src/db');
require.cache[configFile]={loaded:true,exports:{config:{pollIntervalMinutes:15}}};require.cache[dbFile]={loaded:true,exports:{}};
const {summarize}=require('../src/services/diagnostics');
const now=Date.parse('2026-10-08T12:00:00Z'),recent='2026-10-08T11:45:00Z',old='2026-10-06T11:00:00Z';
let result=summarize([{channel:'etsy',enabled:true,last_success_at:recent,last_error:'customer secret'},{channel:'shopify',enabled:true,last_success_at:old},{channel:'amazon',enabled:false,last_error:'secret'},{channel:'sashe',enabled:true,last_success_at:recent}],old,recent,now);
assert.deepEqual(result.channels.map(c=>c.state),['connection_error','stale','disabled','healthy']);assert.equal(result.backup.state,'failed');assert(!JSON.stringify(result).includes('secret'));assert.equal(summarize([],recent,old,now).backup.state,'healthy');assert.equal(summarize([],null,null,now).backup.state,'stale');
const {channelFetch}=require('../src/channels/request');
(async()=>{let calls=0,cancelled=0;global.fetch=async(url,options)=>{assert(options.signal);calls++;return {status:calls<3?503:200,body:{cancel:async()=>cancelled++}};};assert.equal((await channelFetch('https://fixture')).status,200);assert.equal(calls,3);assert.equal(cancelled,2);calls=0;assert.equal((await channelFetch('https://fixture',{method:'POST'})).status,503);assert.equal(calls,1);global.fetch=async()=>{throw new Error('timeout');};await assert.rejects(()=>channelFetch('https://fixture'),/timeout/);console.log('PASS service diagnostics: stale/error/healthy, redacted report, backup recovery, read-only retries and write safety');})().catch(e=>{console.error(e);process.exitCode=1;});
