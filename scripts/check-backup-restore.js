'use strict';
// Run only from a temporary staged application tree: never writes live labels/settings.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const root = path.resolve(__dirname, '..');
if (!root.startsWith('/tmp/moms-backup-check-')) throw new Error('Stage this test in /tmp/moms-backup-check-* first');
const dataRoot = path.join(root, 'user-data');
for (const name of ['test-settings', 'test-backups', 'labels', 'user-data']) fs.rmSync(path.join(root, name), { recursive: true, force: true });
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
const name = 'moms_backup_check_' + crypto.randomBytes(8).toString('hex');
let pool, originalDb;
(async () => {
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(process.env.DATABASE_URL); url.pathname = '/' + name;
  process.env.DATABASE_URL = url.toString();
  process.env.MOMS_DATA_DIR = dataRoot;
  delete process.env.SETTINGS_DIR; delete process.env.BACKUP_DIR;
  const paths = require('../src/paths').getPaths();
  process.env.SETTINGS_DIR = paths.settingsDir;
  process.env.BACKUP_DIR = paths.backupDir;
  originalDb = require('../src/db');
  pool = new Pool({ connectionString: url.toString() });
  await pool.query('CREATE TABLE backup_probe(id int primary key, value text); INSERT INTO backup_probe VALUES(1,\'original\')');
  const store = require('../src/settings/store');
  store.write({ values: { ETSY_CLIENT_SECRET: 'fixture-secret' }, keyHistory: ['fixture-history'] });
  fs.mkdirSync(path.join(dataRoot, 'labels'), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, 'labels', 'probe.pdf'), '%PDF original bytes');
  const child = require('child_process');
  const spawn = child.spawn;
  let restores = 0, failActual = false;
  child.spawn = (command, args, options) => {
    if (command === 'pg_restore') { restores++; if (failActual && restores === 2) return spawn('sh', ['-c', 'cat >/dev/null; exit 17'], options); }
    return spawn(command, args, options);
  };
  const service = require('../src/services/backup');
  const bytes = await service.createBundle();
  const legacySql = require('child_process').execFileSync('pg_dump', ['--no-owner', '--no-acl', '--clean', '--if-exists', url.toString()]);
  const legacy = await service.verifyFromBuffer(require('zlib').gzipSync(legacySql));
  assert.equal(legacy.complete, false); assert.equal(legacy.counts.backup_probe, 1);
  const checked = await service.verifyFromBuffer(bytes);
  assert.equal(checked.counts.backup_probe, 1); assert.equal(checked.labels, 1); assert.equal(checked.complete, true);
  await pool.query("UPDATE backup_probe SET value='changed'");
  store.write({ values: { ETSY_CLIENT_SECRET: 'changed' } });
  fs.writeFileSync(path.join(dataRoot, 'labels', 'probe.pdf'), 'changed');
  restores = 0; failActual = true;
  await assert.rejects(service.restoreFromBuffer(bytes), /code 17/);
  assert.equal(store.read().values.ETSY_CLIENT_SECRET, 'changed');
  assert.equal(fs.readFileSync(path.join(dataRoot, 'labels', 'probe.pdf'), 'utf8'), 'changed');
  assert.equal((await pool.query('SELECT value FROM backup_probe')).rows[0].value, 'changed');
  restores = 0; failActual = false;
  await service.restoreFromBuffer(bytes);
  assert.equal((await pool.query('SELECT value FROM backup_probe')).rows[0].value, 'original');
  assert.equal(store.read().values.ETSY_CLIENT_SECRET, 'fixture-secret');
  assert.deepEqual(store.read().keyHistory, ['fixture-history']);
  assert.equal(fs.readFileSync(path.join(dataRoot, 'labels', 'probe.pdf'), 'utf8'), '%PDF original bytes');
  require('../src/maintenance').leave();
  const recovery = fs.mkdtempSync(path.join(process.env.BACKUP_DIR, 'pre-restore-'));
  fs.writeFileSync(path.join(recovery, 'recovery.moms.gz'), bytes);
  fs.writeFileSync(path.join(process.env.BACKUP_DIR, 'restore-journal.json'), JSON.stringify({ recovery, databaseUrl: url.toString(), port: 3080 }));
  await pool.query("UPDATE backup_probe SET value='interrupted'");
  fs.writeFileSync(path.join(dataRoot, 'labels', 'probe.pdf'), 'interrupted');
  fs.rmSync(path.join(process.env.SETTINGS_DIR, 'settings.key'));
  store.apply(); // must boot even when settings.enc has temporarily lost its key
  assert.equal(await service.recoverInterruptedRestore(), true);
  assert.equal((await pool.query('SELECT value FROM backup_probe')).rows[0].value, 'original');
  assert.equal(store.read().values.ETSY_CLIENT_SECRET, 'fixture-secret');
  assert.equal(fs.readFileSync(path.join(dataRoot, 'labels', 'probe.pdf'), 'utf8'), '%PDF original bytes');
  assert.equal(fs.existsSync(path.join(process.env.BACKUP_DIR, 'restore-journal.json')), false);
  const leftovers = await admin.query("SELECT datname FROM pg_database WHERE datname LIKE 'moms_backup_test_%'");
  assert.equal(leftovers.rows.length, 0);
  console.log('Isolated restore checks passed: database, label bytes, credentials/key history, failed restore rollback, scratch cleanup');
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  if (pool) await pool.end();
  if (originalDb) await originalDb.closePool();
  try { await admin.query(`DROP DATABASE IF EXISTS ${name}`); } finally { await admin.end(); }
});
