'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {getPaths,defaultDataDirectory}=require('../src/paths');
const root=path.resolve(__dirname,'..');
assert.equal(getPaths({}).labelsDir,path.join(root,'labels'));
assert.equal(getPaths({}).settingsDir,path.join(root,'settings'));
assert.equal(getPaths({}).backupDir,path.resolve('/backup'));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'moms-paths-'));
const previous=Object.fromEntries(['MOMS_DATA_DIR','SETTINGS_DIR','BACKUP_DIR'].map(key=>[key,process.env[key]]));
try {
 const data=path.join(temp,'User Data');
 const paths=getPaths({MOMS_DATA_DIR:data});
 assert.deepEqual(paths,{labelsDir:path.join(data,'labels'),settingsDir:path.join(data,'settings'),backupDir:path.join(data,'backups')});
 assert.equal(getPaths({MOMS_DATA_DIR:data,SETTINGS_DIR:path.join(temp,'custom-settings')}).settingsDir,path.join(temp,'custom-settings'));
 assert.equal(getPaths({MOMS_DATA_DIR:data,BACKUP_DIR:path.join(temp,'custom-backups')}).backupDir,path.join(temp,'custom-backups'));
 assert.throws(()=>getPaths({MOMS_DATA_DIR:'relative'}),/absolute/);
 assert.equal(defaultDataDirectory('win32',{LOCALAPPDATA:'C:\\Users\\Jane\\AppData\\Local'},'C:\\Users\\Jane'),'C:\\Users\\Jane\\AppData\\Local\\MOMS');
 assert.equal(defaultDataDirectory('darwin',{},'/Users/jane'),'/Users/jane/Library/Application Support/MOMS');
 assert.equal(defaultDataDirectory('linux',{XDG_DATA_HOME:'/custom/data'},'/home/jane'),'/custom/data/MOMS');
 process.env.MOMS_DATA_DIR=data;delete process.env.SETTINGS_DIR;delete process.env.BACKUP_DIR;
 const store=require('../src/settings/store');
 store.write({values:{ETSY_CLIENT_SECRET:'fixture'}});
 assert.equal(store.read().values.ETSY_CLIENT_SECRET,'fixture');
 assert(fs.existsSync(path.join(paths.settingsDir,'settings.key')));
 assert(!fs.existsSync(path.join(temp,'settings')));
 console.log('Data paths: legacy compatibility, external storage, overrides, platform defaults, spaces, relative-path rejection and encrypted settings passed.');
}finally {
 for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;
 fs.rmSync(temp,{recursive:true,force:true});
}
