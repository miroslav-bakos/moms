'use strict';
const crypto=require('node:crypto'),webpush=require('web-push');
const {config}=require('../config'),{query,withClient}=require('../db');
const store=require('../settings/store'),{owner}=require('./mobilePairing');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function subjectValid(value) {
  if(typeof value!=='string'||value.length>2048)return false;
  try{const url=new URL(value);return url.protocol==='mailto:'?/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(url.pathname):url.protocol==='https:'&&!url.username&&!url.password&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname);}catch(_){return false;}
}
function enabled(){return Boolean(config.webPushEnabled&&config.basicAuthUser&&config.basicAuthPassword&&subjectValid(config.webPushSubject));}
function keys() {
  const saved=store.read();
  if(!saved.webPushKeys){saved.webPushKeys=webpush.generateVAPIDKeys();store.write(saved);}
  return saved.webPushKeys;
}
function validate(subscription) {
  const fail=()=>{const error=new Error('Invalid or unsupported push subscription.');error.statusCode=400;throw error;};
  if(!subscription||typeof subscription.endpoint!=='string'||subscription.endpoint.length>4096)fail();
  let url;try{url=new URL(subscription.endpoint);}catch(_){fail();}
  const host=url.hostname;
  const trusted=host==='fcm.googleapis.com'||host.endsWith('.push.services.mozilla.com')||host==='web.push.apple.com'||/^[a-z0-9-]+\.notify\.windows\.com$/.test(host);
  if(url.protocol!=='https:'||!trusted||url.username||url.password||url.hash||url.port&&url.port!=='443')fail();
  const p256dh=subscription.keys?.p256dh,auth=subscription.keys?.auth;
  if(typeof p256dh!=='string'||typeof auth!=='string'||!/^[A-Za-z0-9_-]{87}=?$/.test(p256dh)||!/^[A-Za-z0-9_-]{22}={0,2}$/.test(auth))fail();
  try{crypto.ECDH.convertKey(Buffer.from(p256dh,'base64url'),'prime256v1');}catch(_){fail();}
  return {endpoint:subscription.endpoint,keys:{p256dh,auth}};
}
async function subscribe(input) {
  if(!enabled()){const error=new Error('Push notifications are disabled or need a contact address.');error.statusCode=400;throw error;}
  const subscription=validate(input),id=hash(subscription.endpoint);
  keys();
  await withClient(async client=>{
    await client.query('BEGIN');
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('moms-web-push-subscribe'))");
      await client.query('DELETE FROM web_push_subscriptions WHERE expires_at<=now() OR owner_hash<>$1',[owner()]);
      const existing=await client.query('SELECT 1 FROM web_push_subscriptions WHERE endpoint_hash=$1',[id]);
      if(!existing.rowCount && Number((await client.query('SELECT count(*) FROM web_push_subscriptions')).rows[0].count)>=20)throw new Error('At most 20 notification devices are supported.');
      await client.query("INSERT INTO web_push_subscriptions(endpoint_hash,owner_hash,subscription,expires_at) VALUES($1,$2,$3,now()+interval '90 days') ON CONFLICT(endpoint_hash) DO UPDATE SET owner_hash=excluded.owner_hash,subscription=excluded.subscription,expires_at=excluded.expires_at",[id,owner(),subscription]);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}
  });
}
async function unsubscribe(endpoint) {
  if(typeof endpoint!=='string'||endpoint.length>4096)return;
  await query('DELETE FROM web_push_subscriptions WHERE endpoint_hash=$1 AND owner_hash=$2',[hash(endpoint),owner()]);
}
async function notify({send=webpush.sendNotification}={}) {
  if(!enabled())return;
  const vapid=keys();
  const rows=(await query("UPDATE web_push_subscriptions SET last_notified_at=now() WHERE owner_hash=$1 AND expires_at>now() AND (last_notified_at IS NULL OR last_notified_at<now()-interval '15 minutes') RETURNING endpoint_hash,subscription",[owner()])).rows;
  // Fixed generic content. Never pass order/channel/customer objects into this function.
  const payload=JSON.stringify({type:'sync-complete'});
  for(let start=0;start<rows.length;start+=5)await Promise.all(rows.slice(start,start+5).map(async row=>{
    try {await send(validate(row.subscription),payload,{vapidDetails:{subject:config.webPushSubject,...vapid},TTL:300,timeout:5000,topic:'moms-sync',urgency:'normal'});}
    catch(error){if([404,410].includes(error.statusCode))await query('DELETE FROM web_push_subscriptions WHERE endpoint_hash=$1',[row.endpoint_hash]);else console.error('[push] Notification delivery failed; subscription details are private.');}
  }));
}
function settings(){return enabled()?{enabled:true,publicKey:keys().publicKey}:{enabled:false};}
module.exports={subjectValid,validate,subscribe,unsubscribe,notify,settings};
