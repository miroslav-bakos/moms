'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {prune}=require('../src/services/labelRetention');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'moms-retention-'));
try {
  const files=['active.pdf','archived.pdf','unused.pdf','new.pdf','nested/a b.pdf'];
  fs.mkdirSync(path.join(root,'nested'));
  for(const file of files)fs.writeFileSync(path.join(root,file),'fixture');
  const now=Date.now()+40*86400000;
  fs.utimesSync(path.join(root,'new.pdf'),new Date(now),new Date(now));
  const refs=['/labels/active.pdf','/labels/archived.pdf','/labels/nested/a%20b.pdf'];
  assert.equal(prune({directory:root,references:refs,days:0,now}),0);
  assert.equal(prune({directory:root,references:['/labels/%zz'],days:30,now}),0);
  assert.equal(prune({directory:root,references:['/labels/../unused.pdf'],days:30,now}),0);
  assert.equal(prune({directory:root,references:refs,days:30,now}),1);
  assert(!fs.existsSync(path.join(root,'unused.pdf')));
  for(const file of files.filter(file=>file!=='unused.pdf'))assert.equal(fs.readFileSync(path.join(root,file),'utf8'),'fixture');
  const source=fs.readFileSync(path.join(__dirname,'../src/services/backup.js'),'utf8');
  assert(source.indexOf('syncDirectory(BACKUP_DIR);')<source.indexOf("require('./labelRetention').prune"));
  assert(source.includes("SELECT label_url FROM orders WHERE label_url IS NOT NULL AND label_url <> ''"));
  console.log('PASS optional label retention: active/archive references, encoded paths, fresh files and malformed-reference preservation after durable full backup.');
}finally{fs.rmSync(root,{recursive:true,force:true});}
