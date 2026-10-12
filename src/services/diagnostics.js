const {query}=require('../db');
const {config}=require('../config');
function summarize(channels,backup,failure,now=Date.now()) {
 const age=stamp=>{const parsed=Date.parse(stamp);return Number.isFinite(parsed)?Math.max(0,now-parsed):Infinity;};
 const staleMs=Math.max(60,Number(config.pollIntervalMinutes||15)*3)*60000;
 return {version:1,generated_at:new Date(now).toISOString(),channels:channels.filter(c=>['amazon','etsy','shopify','sashe'].includes(c.channel)).map(c=>({channel:c.channel,enabled:Boolean(c.enabled),last_success_at:c.last_success_at||null,state:!c.enabled?'disabled':c.last_error?'connection_error':age(c.last_success_at)>staleMs?'stale':'healthy'})),backup:{last_success_at:backup||null,state:failure&&(!backup||Date.parse(failure)>Date.parse(backup))?'failed':age(backup)>36*3600000?'stale':'healthy'}};
}
async function read(){
 const [channels,backups,failures]=await Promise.all([require('./channelState').listChannelState(),query('SELECT max(created_at) AS at FROM backups'),query("SELECT max(created_at) AS at FROM app_events WHERE source='backup' AND level='error'")]);
 const report=summarize(channels,backups.rows[0].at,failures.rows[0].at);
 if(config.backupCopyDir){const event=(await query("SELECT level,created_at FROM app_events WHERE source='backup-copy' ORDER BY created_at DESC,id DESC LIMIT 1")).rows[0];report.backup_copy={configured:true,state:!event?'pending':event.level==='error'?'failed':'healthy',last_attempt_at:event?.created_at||null};}
 return report;
}
module.exports={read,summarize};
