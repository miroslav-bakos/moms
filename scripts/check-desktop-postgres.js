'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { binary, connection, withRuntime, durable, start } = require('../src/desktop/postgres');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'moms-pg-runtime-'));
(async () => {
  try {
    assert.throws(() => connection({version:1,major:17,port:5432,password:'a'.repeat(64)}), /configuration/);
    assert.throws(() => connection({version:1,major:16,port:0,password:'a'.repeat(64)}), /configuration/);
    assert.equal(new URL(connection({version:1,major:16,port:5432,password:'a'.repeat(64)})).hostname, '127.0.0.1');
    assert.throws(() => binary(temp, '../psql'), /Invalid/);
    assert.equal(binary(temp,'psql','win32'), path.join(temp,'bin','psql.exe'));
    assert.equal(withRuntime({Path:'existing'},temp).Path, path.join(temp,'bin') + path.delimiter + 'existing');
    const file = path.join(temp,'connection.json'); durable(file, { version:1 });
    assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')), { version:1 }); assert(!fs.existsSync(file+'.partial'));
    await assert.rejects(start({dataRoot:temp,directory:temp}), /incomplete/);
    fs.mkdirSync(path.join(temp,'bin'));
    for (const name of ['postgres','initdb','pg_ctl','pg_dump','pg_restore','psql']) fs.writeFileSync(binary(temp,name),'fixture');
    await assert.rejects(start({dataRoot:temp,directory:temp,run:async()=>({stdout:'PostgreSQL 16.14'})}), /16.15/);
    // Preserve unidentified existing clusters; never initialize over their data.
    fs.mkdirSync(path.join(temp,'postgres','data'), {recursive:true}); fs.writeFileSync(path.join(temp,'postgres','data','sentinel'),'existing');
    await assert.rejects(start({dataRoot:temp,directory:temp,run:async()=>({stdout:'PostgreSQL 16.15'})}), /will not be replaced/);
    assert.equal(fs.readFileSync(path.join(temp,'postgres','data','sentinel'),'utf8'),'existing');
    console.log('Desktop PostgreSQL: runtime versions, private durable configuration, loopback connection and existing-cluster preservation passed.');
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
