'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const { inventory } = require('../../scripts/build-desktop');
const { durable } = require('./postgres');
const { dataDirectory, request } = require('./runtime');
function verify(bundle) {
  const manifest = JSON.parse(fs.readFileSync(path.join(bundle,'desktop-manifest.json'),'utf8'));
  if(manifest.format!==1||manifest.platform!==process.platform||manifest.arch!==process.arch||manifest.nodeMajor!==22||manifest.postgresMajor!==16||!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(manifest.version)||!Array.isArray(manifest.files))throw new Error('Desktop bundle does not match this platform or runtime.');
  if(manifest.minimumGlibc){
    const current=process.report.getReport().header.glibcVersionRuntime;
    const score=value=>{if(!/^\d+\.\d+$/.test(value||''))throw new Error('Unsupported Linux C library.');const[a,b]=value.split('.').map(Number);return a*10000+b;};
    if(score(current)<score(manifest.minimumGlibc))throw new Error('This bundle requires a newer Linux C library; install a bundle built for your distribution.');
  }
  const files=inventory(bundle);
  if(JSON.stringify(files)!==JSON.stringify(manifest.files))throw new Error('Desktop bundle integrity verification failed.');
  for(const required of ['scripts/desktop.js','scripts/desktop-snapshot.js','runtime/node'+(process.platform==='win32'?'.exe':''),'runtime/postgresql/bin/pg_ctl'+(process.platform==='win32'?'.exe':'')])if(!files.some(item=>item.path===required))throw new Error('Desktop bundle is incomplete.');
  const digest=crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  return {manifest,id:manifest.version+'-'+digest.slice(0,12)};
}
function state(root) {
  const file=path.join(root,'installed.json');
  if(!fs.existsSync(file))return null;
  const value=JSON.parse(fs.readFileSync(file,'utf8'));
  if(value.format!==1||!path.isAbsolute(value.dataRoot)||![value.current,...(value.previous?[value.previous]:[])].every(id=>/^[a-z0-9.-]+-[a-f0-9]{12}$/i.test(id)))throw new Error('Invalid desktop installation state.');
  return value;
}
function entry(release){return path.join(release,'runtime','node'+(process.platform==='win32'?'.exe':''));}
async function invoke(release,args,dataRoot,run=execute){
  return run(entry(release),[path.join(release,'scripts','desktop.js'),...args,'--data-dir',dataRoot],{cwd:dataRoot,env:{...process.env,MOMS_POSTGRES_DIR:path.join(release,'runtime','postgresql')},windowsHide:true,timeout:150000,maxBuffer:1024*1024});
}
async function privateSnapshot(release,dataRoot,file,restore,run){
  for(let attempt=0;attempt<2;attempt++){
    try{await run(entry(release),[path.join(release,'scripts','desktop-snapshot.js'),restore?'restore':'create',dataRoot,file],{cwd:dataRoot,env:{...process.env,MOMS_POSTGRES_DIR:path.join(release,'runtime','postgresql')},windowsHide:true,timeout:240000,maxBuffer:1024*1024});return;}
    catch(error){if(error.code!==3||attempt)throw new Error('Update snapshot failed; the existing application and recovery files are preserved.');}
  }
}
function writeLaunchers(root,release){
  fs.copyFileSync(path.join(__dirname,'installed-loader.js'),path.join(root,'start.js'));
  if(process.platform==='win32'){
    fs.writeFileSync(path.join(root,'MOMS.ps1'),`$ErrorActionPreference = 'Stop'\n$s = Get-Content (Join-Path $PSScriptRoot 'installed.json') -Raw | ConvertFrom-Json\n$r = Join-Path (Join-Path $PSScriptRoot 'releases') $s.current\n& (Join-Path $r 'runtime/node.exe') (Join-Path $PSScriptRoot 'start.js') @args\nexit $LASTEXITCODE\n`);
    fs.writeFileSync(path.join(root,'MOMS.cmd'),'@echo off\r\nset "MOMS_INSTALL_ROOT=%~dp0"\r\npowershell.exe -NoProfile -NonInteractive -Command "$s = Get-Content -LiteralPath (Join-Path $env:MOMS_INSTALL_ROOT \'installed.json\') -Raw | ConvertFrom-Json; $r = Join-Path (Join-Path $env:MOMS_INSTALL_ROOT \'releases\') $s.current; & (Join-Path $r \'runtime/node.exe\') (Join-Path $env:MOMS_INSTALL_ROOT \'start.js\')"\r\n');
  }else{
    const temporary=path.join(root,'node.partial');fs.copyFileSync(entry(release),temporary);fs.chmodSync(temporary,0o755);fs.renameSync(temporary,path.join(root,'node'));
    fs.writeFileSync(path.join(root,process.platform==='darwin'?'MOMS.command':'MOMS.sh'),'#!/bin/sh\nroot=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$root/node" "$root/start.js" "$@"\n',{mode:0o755});
  }
}
async function install({bundle,root,dataRoot,rollback=false,start=true,run=execute}){
  if(!path.isAbsolute(root||''))throw new Error('Installation root must be absolute.');
  root=path.resolve(root);fs.mkdirSync(root,{recursive:true,mode:0o700});
  const old=state(root);dataRoot=dataDirectory(dataRoot||old?.dataRoot);
  if(dataRoot===root||dataRoot.startsWith(root+path.sep)||root.startsWith(dataRoot+path.sep))throw new Error('Application releases and customer data must be in separate directories.');
  if(old&&dataRoot!==old.dataRoot)throw new Error('An update cannot switch customer data directories.');
  const lock=path.join(root,'install.lock');fs.mkdirSync(lock,{mode:0o700});
  let staging,switched=false,wasRunning=false,snapshot;
  const oldRelease=old?path.join(root,'releases',old.current):null;
  const autostart=old&&require('./autostart').enabled({dataRoot,script:path.join(oldRelease,'scripts','desktop.js')});
  try{
    if(old&&verify(oldRelease).id!==old.current)throw new Error('Installed release identity differs from its manifest.');
    fs.mkdirSync(path.join(root,'releases'),{recursive:true});
    let selected;
    if(rollback){
      if(!old?.previous)throw new Error('No previous release is available.');
      selected=verify(path.join(root,'releases',old.previous));
      if(selected.id!==old.previous)throw new Error('Previous release identity differs from its manifest.');
      const current=verify(oldRelease).manifest.files.filter(file=>file.path.startsWith('migrations/'));
      const prior=selected.manifest.files.filter(file=>file.path.startsWith('migrations/'));
      if(JSON.stringify(current)!==JSON.stringify(prior))throw new Error('Rollback crosses a database migration boundary. Use the verified pre-update backup to recover; no customer data has been changed.');
    }else{
      bundle=path.resolve(bundle);selected=verify(bundle);
      if(old?.current===selected.id)return {version:selected.manifest.version,unchanged:true};
      staging=path.join(root,'.staging-'+crypto.randomBytes(8).toString('hex'));
      fs.cpSync(bundle,staging,{recursive:true});verify(staging);
      const destination=path.join(root,'releases',selected.id);
      if(fs.existsSync(destination)){verify(destination);fs.rmSync(staging,{recursive:true});}else fs.renameSync(staging,destination);
      staging=undefined;
    }
    const release=path.join(root,'releases',selected.id);
    const previousStatus=await request(dataRoot,'status');wasRunning=previousStatus.status!=='stopped';
    if(wasRunning)await request(dataRoot,'stop');
    fs.mkdirSync(dataRoot,{recursive:true,mode:0o700});
    if(old){
      snapshot=path.join(dataRoot,'backups','pre-update-'+Date.now()+'-'+crypto.randomBytes(4).toString('hex')+'.moms.gz');
      await privateSnapshot(oldRelease,dataRoot,snapshot,false,run);
    }
    durable(path.join(root,'installed.json'),{format:1,dataRoot,current:selected.id,previous:old?.current||null,snapshot:snapshot?path.basename(snapshot):null});switched=true;
    writeLaunchers(root,release);
    if(autostart)await invoke(release,['autostart','enable'],dataRoot,run);
    if(start)await invoke(release,['start'],dataRoot,run);
    return {version:selected.manifest.version,snapshot:!!snapshot};
  }catch(error){
    if(switched&&old){
      await request(dataRoot,'stop'); // Never restore a database while a worker may still be running.
      // A failed first boot has not accepted new orders; restore its complete pre-update snapshot.
      if(snapshot)await privateSnapshot(oldRelease,dataRoot,snapshot,true,run);
      durable(path.join(root,'installed.json'),old);writeLaunchers(root,oldRelease);
      if(autostart)await invoke(oldRelease,['autostart','enable'],dataRoot,run);
    }
    if(wasRunning&&old)await invoke(oldRelease,['start'],dataRoot,run);
    throw error;
  }finally{if(staging)fs.rmSync(staging,{recursive:true,force:true});fs.rmdirSync(lock);}
}
module.exports={verify,state,install};
