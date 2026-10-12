'use strict';
// Copied into the stable per-user installation directory by the installer.
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
try{
  const state=JSON.parse(fs.readFileSync(path.join(__dirname,'installed.json'),'utf8'));
  if(!/^[a-z0-9.-]+-[a-f0-9]{12}$/i.test(state.current)||!path.isAbsolute(state.dataRoot))throw new Error();
  const release=path.join(__dirname,'releases',state.current),args=process.argv.slice(2);
  const child=spawn(path.join(release,'runtime','node'+(process.platform==='win32'?'.exe':'')),[path.join(release,'scripts','desktop.js'),...(args.length?args:['open']),'--data-dir',state.dataRoot],{stdio:'inherit',windowsHide:true});
  child.on('error',()=>{console.error('Unable to launch the installed MOMS release.');process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=code||0;});
}catch(_){console.error('MOMS could not start. Check your installation or reinstall the application. Your customer data is preserved.');process.exitCode=1;}
