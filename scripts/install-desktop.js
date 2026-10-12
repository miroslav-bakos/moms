'use strict';
const path=require('node:path');
const {defaultDataDirectory}=require('../src/paths');
const args=process.argv.slice(2),options={root:defaultDataDirectory()+'-App'};
for(let i=0;i<args.length;i++){
  if(args[i]==='--rollback'){options.rollback=true;continue;}
  if(args[i]==='--no-start'){options.start=false;continue;}
  if(!['--bundle','--root','--data-dir'].includes(args[i])||!args[i+1]){console.error('Usage: install-desktop.js --bundle <local-bundle> [--root <absolute-install-dir>] [--data-dir <absolute-data-dir>] [--no-start] | --rollback');process.exit(2);}
  const key=args[i]==='--data-dir'?'dataRoot':args[i].slice(2);options[key]=args[++i];
}
if(!options.rollback&&!options.bundle)options.bundle=path.resolve(__dirname,'..');
require('../src/desktop/install').install(options).then(result=>console.log(`MOMS ${result.version}: ${result.unchanged?'already installed':'installed'}. Customer data and previous releases preserved.`)).catch(error=>{console.error(error.message.includes('Rollback')?error.message:'Desktop installation failed. Existing customer data, releases and emergency backups are preserved.');process.exitCode=1;});
