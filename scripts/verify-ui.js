'use strict';
// Reviewed mock servers only: no live-target Playwright configuration is loaded.
const path=require('node:path'),fs=require('node:fs'),os=require('node:os'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const tests=['accounting','archive-cards','board-weight','costs','diagnostics','finished-stock','free-edition','inventory-editor','labels-retry','login','marketplace-appearance','marketplace-balances','marketplace-dispatch','marketplace-setup','mobile-navigation','mobile-push','order-loading','order-workspace','private-cache','reservations','sales-charts','scan','settings-drafts','setup','support','sync-errors','workflow-dispatch','workflow-meaning'];
const browser=require(path.join(root,'testing/node_modules/@playwright/test'));
const env={...process.env,MOMS_CHROMIUM_PATH:process.env.MOMS_CHROMIUM_PATH||browser.chromium.executablePath()};
for(const field of require('../src/settings/schema.json'))delete env[field.env];
delete env.MOMS_DATA_DIR;
const staging=fs.mkdtempSync(path.join(os.tmpdir(),'moms-ui-'));
const preload=path.join(staging,'fixture-config.cjs');
fs.writeFileSync(preload,`require(${JSON.stringify(require.resolve('dotenv'))}).config=()=>({parsed:{}});\n`,{mode:0o600});
const started=Date.now();let failed=0;
try{for(const name of tests){
 const settings=path.join(staging,name,'settings'),backups=path.join(staging,name,'backups');
 const result=spawnSync(process.execPath,['--require',preload,path.join(root,'testing',name+'.mock.cjs')],{cwd:root,env:{...env,SETTINGS_DIR:settings,BACKUP_DIR:backups},encoding:'utf8',timeout:180000,maxBuffer:1024*1024});
 if(result.status!==0){failed++;console.error('FAIL UI '+name+'\n'+(result.stdout||'')+(result.stderr||'')+(result.error?.message||''));}
}}finally{fs.rmSync(staging,{recursive:true,force:true});}
if(failed)process.exitCode=1;else console.log(`PASS ${tests.length} mocked browser suites (${((Date.now()-started)/1000).toFixed(1)}s), no live shop instance.`);
