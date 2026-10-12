'use strict';
// Only the disposable, unprivileged managed-desktop container may run this check.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { request } = require('../src/desktop/runtime');
const { connection, withRuntime } = require('../src/desktop/postgres');
(async () => {
  const root = process.env.MOMS_DATA_DIR;
  assert.equal(root, '/tmp/moms-managed-desktop'); assert(!process.env.DATABASE_URL);
  assert.equal(process.env.MOMS_POSTGRES_DIR, '/usr/lib/postgresql/16');
  const record = JSON.parse(fs.readFileSync(path.join(root,'postgres','connection.json'),'utf8'));
  const env = withRuntime({ ...process.env, DATABASE_URL: connection(record) }, process.env.MOMS_POSTGRES_DIR);
  const { Pool } = require('pg'); const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    const settings = await pool.query("SELECT current_setting('listen_addresses') AS address, current_setting('data_directory') AS directory");
    assert.equal(settings.rows[0].address, '127.0.0.1'); assert.equal(settings.rows[0].directory, path.join(root,'postgres','data'));
    assert((await pool.query('SELECT count(*)::int AS count FROM schema_migrations')).rows[0].count > 0);
    assert.equal((await pool.query("SELECT 'ŠŤŽ' ILIKE 'šťž' AS supported")).rows[0].supported, true);
  } finally { await pool.end(); }
  const original = await request(root, 'status'); assert.equal(original.status,'running');
  const label = path.join(root,'labels','preserve-test.txt'); fs.writeFileSync(label,'label-fixture');
  fs.appendFileSync(path.join(root,'.env'),'\nAPP_BASIC_AUTH_USER=managed-fixture\nAPP_BASIC_AUTH_PASSWORD=managed-fixture-password12\n');
  const restarted = await request(root,'restart'); assert.notEqual(restarted.childPid,original.childPid);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'postgres','connection.json'),'utf8')),record);
  assert.equal(fs.readFileSync(label,'utf8'),'label-fixture');
  assert.equal((await fetch('http://127.0.0.1:3080/health')).status,200);
  assert.equal((await fetch('http://127.0.0.1:3080/api/backup/download')).status,401);
  const download=await fetch('http://127.0.0.1:3080/api/backup/download',{headers:{Authorization:'Basic '+Buffer.from('managed-fixture:managed-fixture-password12').toString('base64')}});assert.equal(download.status,200);
  const bytes=Buffer.from(await download.arrayBuffer());assert.equal(bytes[0],0x1f);assert.equal(bytes[1],0x8b);
  // The standard full DB suite creates its own scratch databases, roles and asset trees.
  const checks = spawnSync(process.execPath,[path.join(__dirname,'verify.js'),'--db'],{
    env:{...env,MOMS_TEST_DATABASE_URL:env.DATABASE_URL},encoding:'utf8',timeout:720000,maxBuffer:1024*1024
  });
  if(checks.status!==0)throw new Error('Managed PostgreSQL isolated database regression failed: '+checks.stdout+checks.stderr);
  console.log('PASS managed PostgreSQL bootstrap, migrations, authenticated loopback binding, restart/data preservation and full isolated database checks.');
})().catch(()=>{console.error('Managed desktop verification failed; inspect the disposable container logs.');process.exitCode=1;});
