'use strict';
const args=process.argv.slice(2),action=args.shift()||'status';
const options={action};
for(let i=0;i<args.length;i+=2){
  if(!['--port','--target-port'].includes(args[i])||!args[i+1]){console.error('Usage: node scripts/tailscale.js status|enable|disable [--port 8443] [--target-port 3080]');process.exit(2);}
  options[args[i]==='--port'?'port':'targetPort']=Number(args[i+1]);
}
require('../src/desktop/tailscale').configure(options).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
