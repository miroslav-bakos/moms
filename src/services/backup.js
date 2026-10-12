'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');


const { query } = require('../db');
const { config } = require('../config');

const {backupDir: BACKUP_DIR, settingsDir: SETTINGS_DIR, labelsDir: LABELS_DIR} = require('../paths').getPaths();
const os = require('os');
const crypto = require('crypto');
const { Pool } = require('pg');
const bundle = require('./backupBundle');
const store = require('../settings/store');
let creating = false;
function emptyDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  for (const name of fs.readdirSync(directory)) fs.rmSync(path.join(directory, name), { recursive: true, force: true });
}
function activeConfiguration() {
  return Object.fromEntries(require('../settings/schema.json').map(field => {
    const value = field.path.reduce((obj, key) => obj[key], config);
    return [field.env, field.type === 'map' ? Object.entries(value).map(([k,v]) => `${k}:${v}`).join(',') : field.type === 'list' ? value.join(' ') : String(value)];
  }));
}
async function runInput(command, args, bytes) {
  const child = spawn(command, args, { env: { ...process.env, PGAPPNAME: 'moms-backup' } });
  child.stdout.resume();
  const completion = processCompletion(child, command);
  const input = new Promise((resolve, reject) => {
    child.stdin.on('error', err => { child.kill(); reject(err); });
    child.stdin.end(bytes, resolve);
  });
  await Promise.all([completion, input]);
}
async function createBundle() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moms-backup-'));
  fs.chmodSync(directory, 0o700);
  try {
    const dumpfile = path.join(directory, 'database.dump');
    const dump = spawn('pg_dump', ['--format=custom', '--no-owner', '--no-acl', config.databaseUrl]);
    const results = await Promise.allSettled([processCompletion(dump, 'pg_dump'), pipeline(dump.stdout, fs.createWriteStream(dumpfile, { mode: 0o600 })).catch(err => { dump.kill(); throw err; })]);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    const files = [bundle.entry('database.dump', fs.readFileSync(dumpfile)), bundle.entry('configuration.json', Buffer.from(JSON.stringify({ values: activeConfiguration() })))];
    files.push(...bundle.collect(LABELS_DIR, 'labels'));
    for (const name of ['settings.enc', 'settings.key']) {
      const filepath = path.join(SETTINGS_DIR, name);
      if (fs.existsSync(filepath)) files.push(bundle.entry('settings/' + name, fs.readFileSync(filepath)));
    }
    const bytes = await bundle.pack(files);
    await bundle.unpack(bytes);
    return bytes;
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
const MAX_AGE_DAYS = 30;

async function performBackup() {
 try {const result=await performBackupOperation();
  if(config.backupCopyDir){try{await require('./backupCopy').copy(path.join(BACKUP_DIR,result.filename),config.backupCopyDir);await require('./events').logEvent('info','backup-copy','Backup copy verified.');result.off_device_copy='verified';}catch(_){await require('./events').logEvent('error','backup-copy','Backup copy failed. Check the configured drive or network folder.').catch(()=>{});result.off_device_copy='failed';}}
  return result;
 }
 catch(error){
  if(!creating&&!require('../maintenance').isActive())await require('./events').logEvent('error','backup','Backup failed. Check free disk space and database availability.').catch(()=>{});
  throw error;
 }
}
async function performBackupOperation() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `moms-backup-${stamp}-${crypto.randomBytes(3).toString('hex')}.moms.gz`;
  const filepath = path.join(BACKUP_DIR, filename);

  const partial = `${filepath}.partial`;
  if (creating || require('../maintenance').isActive()) throw new Error('Backup or restore is already running');
  creating = true;
  try {
    await require('../maintenance').enter();
    writeDurable(partial, await createBundle());
    fs.renameSync(partial, filepath); syncDirectory(BACKUP_DIR);
    if (config.labelRetentionDays > 0) {
      try {
        const result = await query("SELECT label_url FROM orders WHERE label_url IS NOT NULL AND label_url <> '' UNION SELECT label_url FROM order_shipments WHERE label_url <> ''");
        const removed = require('./labelRetention').prune({directory:LABELS_DIR,references:result.rows.map(row => row.label_url),days:config.labelRetentionDays});
        if (removed) console.log(`[backup] Removed ${removed} unused old label(s) after complete backup.`);
      } catch (_) { console.error('[backup] Label cleanup failed; complete backup remains available.'); }
    }
  } catch (err) {
    try { fs.unlinkSync(partial); } catch (_) {}
    throw err;
  } finally { creating = false; require('../maintenance').leave(); }

  const size = fs.statSync(filepath).size;
  const result = await query(
    'INSERT INTO backups (filename, size_bytes, created_at) VALUES ($1, $2, $3) RETURNING *',
    [filename, size, now]
  );

  await pruneOldBackups();
  console.log(`[backup] Created ${filename} (${size} bytes)`);
  return result.rows[0];
}

async function pruneOldBackups() {
  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  const result = await query('DELETE FROM backups WHERE created_at < $1 RETURNING filename', [cutoff]);
  for (const row of result.rows) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, row.filename)); } catch (_) {}
  }
  if (result.rows.length) console.log(`[backup] Pruned ${result.rows.length} old backup(s)`);
}

async function listBackups() {
  const result = await query('SELECT id, filename, size_bytes, created_at FROM backups ORDER BY created_at DESC');
  return result.rows;
}

async function deleteBackup(id) {
  const result = await query('DELETE FROM backups WHERE id = $1 RETURNING filename', [id]);
  if (!result.rows.length) return false;
  try { fs.unlinkSync(path.join(BACKUP_DIR, result.rows[0].filename)); } catch (_) {}
  return true;
}

function processCompletion(child, name) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr.on('data', (data) => { stderr = (stderr + data.toString()).slice(-1000); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${name} exited with code ${code}: ${stderr}`));
    });
  });
}

async function restoreDatabase(backup, databaseUrl) {
  if (backup.legacy) {
    const guard = crypto.randomBytes(24).toString('hex');
    const sql = backup.sql.toString('utf8').replace(/^\\(?:un)?restrict [A-Za-z0-9]+\r?$/gm, '');
    return runInput('psql', ['--no-psqlrc', '--single-transaction', '-v', 'ON_ERROR_STOP=1', databaseUrl], Buffer.from(`\\restrict ${guard}\n${sql}\n\\unrestrict ${guard}\n`));
  }
  return runInput('pg_restore', ['--single-transaction', '--exit-on-error', '--no-owner', '--no-acl', '--clean', '--if-exists', '--dbname', databaseUrl], backup.files.get('database.dump'));
}
async function verifyParsed(backup) {
  const suffix = crypto.randomBytes(8).toString('hex');
  const name = 'moms_backup_test_' + suffix;
  const password = crypto.randomBytes(24).toString('hex');
  const admin = new Pool({ connectionString: config.databaseUrl });
  let roleCreated = false, dbCreated = false, isolated;
  try {
    // The restore connection is a dedicated non-superuser with no grants on
    // production tables. Verification never executes SQL on the live connection.
    await admin.query(`CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
    roleCreated = true;
    await admin.query(`CREATE DATABASE ${name} OWNER ${name}`); dbCreated = true;
    const url = new URL(config.databaseUrl); url.pathname = '/' + name; url.username = name; url.password = password;
    await restoreDatabase(backup, url.toString());
    isolated = new Pool({ connectionString: url.toString() });
    const tables = await isolated.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    const counts = {};
    for (const { tablename } of tables.rows) {
      const identifier = '"' + tablename.replaceAll('"', '""') + '"';
      counts[tablename] = Number((await isolated.query(`SELECT count(*) FROM public.${identifier}`)).rows[0].count);
    }
    return { ok: true, counts, complete: !backup.legacy, files: backup.legacy ? 0 : backup.files.size, labels: backup.legacy ? 0 : [...backup.files.keys()].filter(name => name.startsWith('labels/')).length };
  } finally {
    if (isolated) await isolated.end();
    try {
      if (dbCreated) await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      if (roleCreated) await admin.query(`DROP ROLE ${name}`);
    } finally { await admin.end(); }
  }
}
async function verifyFromBuffer(bytes) { return verifyParsed(await bundle.unpack(bytes)); }
const JOURNAL = path.join(BACKUP_DIR, 'restore-journal.json');
function syncDirectory(directory) {
  if (process.platform === 'win32') return; // Windows cannot fsync directory handles via this API.
  const fd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function writeJournal(recovery) {
  const fd = fs.openSync(JOURNAL + '.partial', 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify({ recovery, databaseUrl: config.databaseUrl, port: config.port })); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(JOURNAL + '.partial', JOURNAL); syncDirectory(BACKUP_DIR);
}
function clearJournal() { fs.rmSync(JOURNAL, { force: true }); syncDirectory(BACKUP_DIR); }
function writeDurable(filepath, bytes) {
  const fd = fs.openSync(filepath, 'w', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function restoreAssets(backup) {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true, mode: 0o700 });
  const saved = backup.files.has('settings/settings.enc') ? store.crypt(backup.files.get('settings/settings.enc').toString(), backup.files.get('settings/settings.key'), true) : { values: {} };
  saved.values = { ...backup.configuration.values, ...saved.values, DATABASE_URL: config.databaseUrl, PORT: String(config.port) };
  for (const name of ['settings.enc', 'settings.key']) fs.rmSync(path.join(SETTINGS_DIR, name), { force: true });
  if (backup.files.has('settings/settings.key')) writeDurable(path.join(SETTINGS_DIR, 'settings.key'), backup.files.get('settings/settings.key'));
  store.write(saved);
  emptyDirectory(LABELS_DIR);
  for (const [name, bytes] of backup.files) if (name.startsWith('labels/')) {
    const target = path.join(LABELS_DIR, name.slice(7));
    fs.mkdirSync(path.dirname(target), { recursive: true }); writeDurable(target, bytes);
    let directory = path.dirname(target);
    while (directory.startsWith(LABELS_DIR) && directory !== LABELS_DIR) { syncDirectory(directory); directory = path.dirname(directory); }
  }
  syncDirectory(LABELS_DIR); syncDirectory(SETTINGS_DIR);
}
async function recoverInterruptedRestore() {
  if (!fs.existsSync(JOURNAL)) return false;
  const { recovery } = JSON.parse(fs.readFileSync(JOURNAL, 'utf8'));
  if (path.dirname(path.resolve(recovery)) !== path.resolve(BACKUP_DIR) || !path.basename(recovery).startsWith('pre-restore-')) throw new Error('Invalid restore recovery journal');
  const backup = await bundle.unpack(fs.readFileSync(path.join(recovery, 'recovery.moms.gz')));
  if (backup.legacy) throw new Error('Incomplete emergency recovery package');
  await restoreDatabase(backup, config.databaseUrl);
  restoreAssets(backup);
  clearJournal();
  console.log('[backup] Recovered an interrupted restore; restarting with restored configuration');
  return true;
}
async function restoreFromBuffer(compressed) {
  const backup = await bundle.unpack(compressed);
  await verifyParsed(backup);
  const maintenance = require('../maintenance');
  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  const recovery = fs.mkdtempSync(path.join(BACKUP_DIR, 'pre-restore-'));
  fs.chmodSync(recovery, 0o700);
  let changed = false;
  await maintenance.enter();
  try {
    // Independent emergency bundle remains on disk, outside the rolling list.
    const emergencyFd = fs.openSync(path.join(recovery, 'recovery.moms.gz'), 'w', 0o600);
    try { fs.writeFileSync(emergencyFd, await createBundle()); fs.fsyncSync(emergencyFd); } finally { fs.closeSync(emergencyFd); }
    syncDirectory(recovery); syncDirectory(BACKUP_DIR);
    if (!backup.legacy) {
      fs.mkdirSync(SETTINGS_DIR, { recursive: true, mode: 0o700 });
      for (const name of ['settings.enc', 'settings.key']) {
        if (fs.existsSync(path.join(SETTINGS_DIR, name))) fs.copyFileSync(path.join(SETTINGS_DIR, name), path.join(recovery, name));
      }
      fs.mkdirSync(LABELS_DIR, { recursive: true });
      fs.cpSync(LABELS_DIR, path.join(recovery, 'labels'), { recursive: true });
    }
    writeJournal(recovery);
    if (!backup.legacy) { changed = true; restoreAssets(backup); }

    await restoreDatabase(backup, config.databaseUrl);
    clearJournal();
    // Keep the maintenance gate closed until the process restarts: old runtime
    // keys must never be used to write data restored with different credentials.
    return { complete: !backup.legacy, restartRequired: true };
  } catch (error) {
    if (changed) {
      for (const name of ['settings.enc', 'settings.key']) {
        fs.rmSync(path.join(SETTINGS_DIR, name), { force: true });
        if (fs.existsSync(path.join(recovery, name))) fs.copyFileSync(path.join(recovery, name), path.join(SETTINGS_DIR, name));
      }
      emptyDirectory(LABELS_DIR); fs.cpSync(path.join(recovery, 'labels'), LABELS_DIR, { recursive: true });
    }
    clearJournal();
    maintenance.leave();
    throw error;
  }
}

async function restoreFromFile(filepath) {
  return restoreFromBuffer(await fs.promises.readFile(filepath));
}

async function restoreBackup(id) {
  const result = await query('SELECT filename FROM backups WHERE id = $1', [id]);
  if (!result.rows.length) return false;
  const filepath = path.join(BACKUP_DIR, result.rows[0].filename);
  if (!fs.existsSync(filepath)) throw new Error('Backup file not found on disk');
  return restoreFromFile(filepath);
}

module.exports = { performBackup, listBackups, deleteBackup, restoreBackup, restoreFromBuffer, verifyFromBuffer, createBundle, restoreDatabase, recoverInterruptedRestore };
