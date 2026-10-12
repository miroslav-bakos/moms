'use strict';
const execute=require('node:util').promisify(require('node:child_process').execFile);
async function installedCommand(command,args,options){
 try{return await execute(command,args,options);}catch(error){
  if(error.code!=='ENOENT')throw error;
  const candidates=process.platform==='win32'?[require('node:path').join(process.env.ProgramFiles||'C:\\Program Files','Tailscale','tailscale.exe')]:process.platform==='darwin'?['/Applications/Tailscale.app/Contents/MacOS/Tailscale']:['/usr/bin/tailscale','/usr/local/bin/tailscale'];
  for(const file of candidates)if(require('node:fs').existsSync(file))return execute(file,args,options);
  throw error;
 }
}
async function configure({action,targetPort,run=installedCommand}) {
 if(!['status','enable','disable'].includes(action)||!Number.isInteger(targetPort)||targetPort<1||targetPort>65535)throw new Error('Invalid callback configuration.');
 const call=async args=>{try{return await run('tailscale',args,{encoding:'utf8',timeout:30000,maxBuffer:1024*1024,windowsHide:true});}catch(cause){const error=new Error('Open Tailscale on this computer, sign in and allow Funnel for this device, then try again. If Tailscale is not installed, use the download link in the guide.');const match=String(cause.stdout||'').concat(' ',String(cause.stderr||'')).match(/https:\/\/login\.tailscale\.com\/[A-Za-z0-9_/?=&%.-]+/);if(match)error.approvalUrl=match[0];throw error;}};
 const status=JSON.parse((await call(['status','--json'])).stdout);
 if(status.BackendState!=='Running')throw new Error('Open Tailscale on this computer and sign in, then try again.');
 const host=String(status.Self?.DNSName||'').replace(/\.$/,'');
 if(!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+\.ts\.net$/i.test(host))throw new Error('Tailscale has not assigned an HTTPS name to this computer.');
 const key=host+':10000',target='http://127.0.0.1:'+targetPort;
 const inspect=async()=>JSON.parse((await call(['serve','status','--json'])).stdout);
 const owned=value=>{const keys=Object.keys(value.Web||{}).filter(k=>k.endsWith(':10000'));const handlers=value.Web?.[key]?.Handlers||{};return keys.length===1&&keys[0]===key&&Object.keys(handlers).length===1&&handlers['/']?.Proxy===target;};
 let current=await inspect();
 const occupied=Object.keys(current.Web||{}).some(k=>k.endsWith(':10000'))||current.TCP?.['10000'];
 if(action!=='status'&&occupied&&!owned(current))throw new Error('The callback port is used by another Tailscale service. Contact support; MOMS will not overwrite it.');
 if(action==='enable'&&(!owned(current)||!current.AllowFunnel?.[key]))await call(['funnel','--bg','--https=10000',target]);
 if(action==='disable'&&owned(current))await call(['funnel','--https=10000','off']);
 current=await inspect();const enabled=Boolean(owned(current)&&current.AllowFunnel?.[key]);
 if(action==='enable'&&!enabled||action==='disable'&&owned(current))throw new Error('Tailscale did not confirm the change. Check the device permissions in Tailscale and try again.');
 return {url:`https://${host}:10000`,enabled};
}
module.exports={configure};
