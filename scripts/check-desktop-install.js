'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {inventory}=require('./build-desktop');
const {install,verify,state}=require('../src/desktop/install');
const {request}=require('../src/desktop/runtime');
const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'moms-installer-')));
let verificationStage='offline';
function manifest(directory,version){
  const value={format:1,platform:process.platform,arch:process.arch,version,nodeMajor:22,postgresMajor:16,files:inventory(directory)};
  fs.writeFileSync(path.join(directory,'desktop-manifest.json'),JSON.stringify(value));return value;
}
function fixture(directory,version){
  for(const file of ['scripts/desktop.js','scripts/desktop-snapshot.js','runtime/node'+(process.platform==='win32'?'.exe':''),'runtime/postgresql/bin/pg_ctl'+(process.platform==='win32'?'.exe':'')]){
    fs.mkdirSync(path.dirname(path.join(directory,file)),{recursive:true});fs.writeFileSync(path.join(directory,file),'fixture');
  }
  manifest(directory,version);
}
async function offline(){
  const bundle=path.join(temp,'bundle'),root=path.join(temp,'Application'),dataRoot=path.join(temp,'Customer Data');
  fixture(bundle,'1.0.0');verify(bundle);
  fs.writeFileSync(path.join(bundle,'scripts/desktop.js'),'corrupt');assert.throws(()=>verify(bundle),/integrity/);fixture(bundle,'1.0.0');
  await install({bundle,root,dataRoot,start:false});const old=state(root);
  assert.equal((await install({bundle,root,dataRoot,start:false})).unchanged,true);
  fs.writeFileSync(path.join(dataRoot,'preserved.txt'),'customer-fixture');
  manifest(bundle,'1.0.1');const operations=[];
  await assert.rejects(install({bundle,root,dataRoot,run:async(exe,args)=>{
    operations.push(args);
    if(args[0].endsWith('desktop.js'))throw new Error('Fixture startup failure');
    return {stdout:''};
  }}),/startup failure/);
  assert.equal(state(root).current,old.current);
  assert(operations.some(args=>args[1]==='create'));assert(operations.some(args=>args[1]==='restore'));
  assert.equal(fs.readFileSync(path.join(dataRoot,'preserved.txt'),'utf8'),'customer-fixture');
  await assert.rejects(install({bundle,root,dataRoot:path.join(root,'data'),start:false}),/separate/);
  // An older paid/trial installation can move to a free release without an entitlement file.
  const legacy=path.join(temp,'Legacy Bundle'),legacyRoot=path.join(temp,'Legacy App'),legacyData=path.join(temp,'Legacy Data');
  fixture(legacy,'2.0.0');
  const legacyManifest=manifest(legacy,'2.0.0');legacyManifest.licensePublicKey='legacy-publisher';legacyManifest.releasedAt='2000-01-01';
  fs.writeFileSync(path.join(legacy,'desktop-manifest.json'),JSON.stringify(legacyManifest));
  await install({bundle:legacy,root:legacyRoot,dataRoot:legacyData,start:false});
  assert(!fs.existsSync(path.join(legacyRoot,'license.json')));
  manifest(legacy,'2.0.1');
  await install({bundle:legacy,root:legacyRoot,dataRoot:legacyData,start:false,run:async()=>({stdout:''})});
  assert.equal(verify(path.join(legacyRoot,'releases',state(legacyRoot).current)).manifest.version,'2.0.1');
  assert(!fs.readFileSync(path.join(legacyRoot,'start.js'),'utf8').includes('license.json'));
  console.log('Installer: platform/integrity rejection, repeat install, private pre-update snapshot, failed-boot restoration and data separation passed.');
}
async function actual(bundle){
  const fields=[...require('../src/settings/schema.json').map(field=>field.env),'MOMS_DATA_DIR','MOMS_POSTGRES_DIR','SETTINGS_DIR','BACKUP_DIR'];
  const previous=Object.fromEntries(fields.map(field=>[field,process.env[field]]));
  fields.forEach(field=>delete process.env[field]);
  const root=path.join(temp,'Actual App'),dataRoot=path.join(temp,'Actual Data');
  const net=require('node:net');const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  fs.mkdirSync(dataRoot);fs.writeFileSync(path.join(dataRoot,'.env'),`PORT=${port}\nPOLL_ON_START=false\n`,{mode:0o600});
  try{
    verificationStage='first boot';
    await install({bundle,root,dataRoot});assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status,200);
    const record=JSON.parse(fs.readFileSync(path.join(dataRoot,'postgres','connection.json'),'utf8'));
    const {Pool}=require('pg'),{connection}=require('../src/desktop/postgres');
    const database=new Pool({connectionString:connection(record)});
    try{assert.equal((await database.query("SELECT 'ŠŤŽ' ILIKE 'šťž' AS supported")).rows[0].supported,true);await database.query("INSERT INTO orders(channel,vendor,external_order_id,order_name,note) VALUES('manual','manual','installer-fixture','Fixture','preserved-order')");}finally{await database.end();}
    const label=path.join(dataRoot,'labels','installer-fixture.txt');fs.writeFileSync(label,'preserved-label');
    process.env.MOMS_DATA_DIR=dataRoot;
    const store=require('../src/settings/store');store.write({values:{APP_SECRET:'desktop-fixture-secret-with-32-characters'}});
    const key=fs.readFileSync(path.join(dataRoot,'settings','settings.key'));
    const update=path.join(temp,'Actual Update');fs.cpSync(bundle,update,{recursive:true});manifest(update,'0.1.1');
    verificationStage='update';
    await install({bundle:update,root,dataRoot});assert.equal(state(root).current,verify(update).id);
    assert.equal(fs.readFileSync(label,'utf8'),'preserved-label');assert.deepEqual(fs.readFileSync(path.join(dataRoot,'settings','settings.key')),key);
    verificationStage='rollback';await install({root,dataRoot,rollback:true});assert.equal(state(root).current,verify(bundle).id);
    const broken=path.join(temp,'Actual Failed Boot');fs.cpSync(bundle,broken,{recursive:true});
    fs.writeFileSync(path.join(broken,'src','desktop','worker.js'),"console.error('Disposable failed boot');process.exit(1);\n");manifest(broken,'0.1.2');
    verificationStage='failed-boot restoration';await assert.rejects(install({bundle:broken,root,dataRoot}));
    assert.equal(state(root).current,verify(bundle).id);
    assert.equal((await request(dataRoot,'status')).status,'running');
    assert.equal(fs.readFileSync(label,'utf8'),'preserved-label');assert.deepEqual(fs.readFileSync(path.join(dataRoot,'settings','settings.key')),key);
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status,200);
    const restored=new Pool({connectionString:connection(record)});
    try{const result=await restored.query("SELECT note FROM orders WHERE channel='manual' AND external_order_id='installer-fixture'");assert.equal(result.rows.length,1);assert.equal(result.rows[0].note,'preserved-order');}finally{await restored.end();}
    console.log('PASS actual native bundle installation, managed DB boot, update, rollback, failed-boot full restore and preserved labels/key.');
  }finally{await request(dataRoot,'stop');for(const[field,value]of Object.entries(previous))if(value===undefined)delete process.env[field];else process.env[field]=value;}
}
(async()=>{
  try{const index=process.argv.indexOf('--bundle');if(index>=0)await actual(path.resolve(process.argv[index+1]));else await offline();}
  finally{fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error('Installer verification failed at '+verificationStage+'. Private fixture secrets are not logged.');if(verificationStage==='offline')console.error(error.stack);process.exitCode=1;});
