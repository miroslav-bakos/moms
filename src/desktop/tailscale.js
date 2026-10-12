'use strict';
const {execFile}=require('node:child_process');
const execute=require('node:util').promisify(execFile);
function binding(value,port) {
  return Object.entries(value.Web||{}).filter(([key])=>key.endsWith(':'+port));
}
async function configure({action,port=8443,targetPort=3080,run=execute}) {
  if(!['status','enable','disable'].includes(action)||![port,targetPort].every(value=>Number.isInteger(value)&&value>0&&value<=65535))throw new Error('Invalid Tailscale operation or port.');
  const call=async args=>{
    try{return await run('tailscale',args,{encoding:'utf8',timeout:30000,maxBuffer:1024*1024,windowsHide:true});}
    catch(_){throw new Error('Tailscale is unavailable or requires login/Serve permission. Install and authorize it separately.');}
  };
  let status,serve;
  try {status=JSON.parse((await call(['status','--json'])).stdout);serve=JSON.parse((await call(['serve','status','--json'])).stdout);}catch(_){throw new Error('Unable to inspect Tailscale configuration.');}
  if(status.BackendState!=='Running'||!status.Self?.DNSName)throw new Error('Tailscale must be signed in and running.');
  const hostname=status.Self.DNSName.replace(/\.$/,'');
  if(!/^[a-z0-9.-]+\.ts\.net$/i.test(hostname))throw new Error('A Tailscale HTTPS hostname is required.');
  const target=`http://127.0.0.1:${targetPort}`;
  const bindings=binding(serve,port),key=hostname+':'+port;
  const owned=bindings.length===1&&bindings[0][0]===key&&Object.keys(bindings[0][1].Handlers||{}).length===1&&bindings[0][1].Handlers['/']?.Proxy===target;
  if(serve.AllowFunnel?.[key])throw new Error('Public Funnel is enabled on this port. Choose a private Serve port.');
  if(action==='enable'){
    if(bindings.length&&!owned || (serve.TCP?.[port]&&!owned))throw new Error('This Serve port belongs to another configuration; it will not be overwritten.');
    if(!owned)await call(['serve','--bg','--https='+port,target]);
    const after=JSON.parse((await call(['serve','status','--json'])).stdout);
    if(binding(after,port).length!==1||after.Web?.[key]?.Handlers?.['/']?.Proxy!==target||after.AllowFunnel?.[key])throw new Error('Private HTTPS Serve verification failed. Inspect Tailscale status.');
  }else if(action==='disable'){
    if(bindings.length&&!owned)throw new Error('This Serve port belongs to another configuration; it will not be modified.');
    if(owned)await call(['serve','--https='+port,'off']);
    const after=JSON.parse((await call(['serve','status','--json'])).stdout);
    if(binding(after,port).length)throw new Error('Serve disable verification failed. Inspect Tailscale status.');
  }
  return {url:`https://${hostname}:${port}`,enabled:action==='enable'||action==='status'&&owned};
}
module.exports={configure};
