'use strict';
// Fresh processes share only a disposable DB. Marketplace adapters are fixtures, never live accounts.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {Pool}=require('pg'),{config}=require('../src/config');
const channels=['etsy','shopify','amazon','sashe'];
const cursor1='2026-10-01T12:00:00.000Z',cursor2='2026-10-06T12:00:00.000Z';
async function worker(stage){
 const db=require('../src/db');
 for(const channel of channels){
  const filename=require.resolve('../src/channels/'+channel);
  require.cache[filename]={id:filename,filename,loaded:true,exports:{poll:async({since})=>{
   if(stage!=='initial')assert.equal(new Date(since).toISOString(),stage==='repeat'?'2026-10-06T11:30:00.000Z':'2026-10-01T11:30:00.000Z');
   const fixture=id=>({channel,externalOrderId:id,skus:'remote SKU',address:'remote address',createdAt:'2026-10-01T12:00:00.000Z'});
   return {orders:stage==='initial'?[fixture('before-outage')]:[fixture('before-outage'),fixture('during-outage')],nextCursor:stage==='initial'?cursor1:cursor2};
  }}};
 }
 if(stage==='partial'){
  const original=require('../src/services/orders'),upsert=original.upsertOrder;
  require.cache[require.resolve('../src/services/orders')].exports={...original,upsertOrder:async order=>{if(order.externalOrderId==='during-outage')throw new Error('Disposable interrupted import');return upsert(order);}};
 }
 const scheduler=require('../src/scheduler');
 try{for(const channel of channels){if(stage==='partial')await assert.rejects(scheduler.pollChannel(channel,{force:true}));else await scheduler.pollChannel(channel,{force:true});}}
 finally{await scheduler.stopScheduler();await db.closePool();}
}
async function parent(){
 const admin=new Pool({connectionString:config.databaseUrl}),name='moms_restart_test_'+crypto.randomBytes(8).toString('hex');let pool;
 try{
  await admin.query(`CREATE DATABASE ${name}`);const url=new URL(config.databaseUrl);url.pathname='/'+name;pool=new Pool({connectionString:url.toString()});
  for(const file of fs.readdirSync(path.join(__dirname,'../migrations')).filter(file=>file.endsWith('.sql')).sort())await pool.query(fs.readFileSync(path.join(__dirname,'../migrations',file),'utf8'));
  const run=stage=>{const result=require('node:child_process').spawnSync(process.execPath,[...process.execArgv,__filename,'--worker='+stage],{env:{...process.env,DATABASE_URL:url.toString(),WEB_PUSH_ENABLED:'false',POLL_ON_START:'false'},encoding:'utf8',timeout:30000});if(result.status!==0)throw new Error('Disposable restart worker failed at '+stage);};
  run('initial');
  // A fresh process must respect the persisted SAShE cooldown and leave its cursor intact.
  const beforeCooldown=(await pool.query("SELECT cursor,last_poll_started_at FROM channel_state WHERE channel='sashe'")).rows[0];
  run('partial');
  const afterCooldown=(await pool.query("SELECT cursor,last_poll_started_at FROM channel_state WHERE channel='sashe'")).rows[0];
  assert.deepEqual(afterCooldown,beforeCooldown);
  await pool.query("UPDATE orders SET skus='local SKU',skus_locked=true,address='local address',address_locked=true,shipped=true,note='local note'");
  // Simulate time passing between restart attempts; SAShE's persisted cooldown is tested separately.
  const elapseCooldown=()=>pool.query("UPDATE channel_state SET last_poll_started_at=now()-interval '61 minutes' WHERE channel='sashe'");
  await elapseCooldown();run('partial');
  const failed=(await pool.query('SELECT cursor,last_error FROM channel_state')).rows;assert.equal(failed.length,4);for(const row of failed){assert.equal(new Date(row.cursor).toISOString(),cursor1);assert(row.last_error);}
  await elapseCooldown();run('retry');await elapseCooldown();run('repeat');
  for(const channel of channels){
   const orders=(await pool.query('SELECT * FROM orders WHERE channel=$1',[channel])).rows;assert.equal(orders.length,2);
   const before=orders.find(row=>row.external_order_id==='before-outage');assert.equal(before.skus,'local SKU');assert.equal(before.address,'local address');assert.equal(before.note,'local note');assert.equal(before.shipped,true);
   const state=(await pool.query('SELECT cursor,last_error FROM channel_state WHERE channel=$1',[channel])).rows[0];assert.equal(new Date(state.cursor).toISOString(),cursor2);assert.equal(state.last_error,null);
  }
  console.log('PASS isolated fresh-process outage recovery for four fixture channels: failed import retains cursor; retry deduplicates and preserves local SKU/address locks and archived state.');
 }finally{if(pool)await pool.end();await admin.query(`DROP DATABASE IF EXISTS ${name}`);await admin.end();}
}
const stage=process.argv.find(arg=>arg.startsWith('--worker='))?.slice(9);
(stage?worker(stage):parent()).catch(()=>{console.error('Disposable restart regression failed; no account data logged.');process.exitCode=1;});
