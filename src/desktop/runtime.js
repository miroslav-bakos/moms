'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const { defaultDataDirectory, getPaths } = require('../paths');
const { Supervisor } = require('./supervisor');

function dataDirectory(value = process.env.MOMS_DATA_DIR || defaultDataDirectory()) {
  if (!path.isAbsolute(value)) throw new Error('Desktop data directory must be absolute.');
  return fs.existsSync(value) ? fs.realpathSync(value) : path.resolve(value);
}
function desktopEnvironment(dataRoot, env) {
  const file = path.join(dataRoot, '.env');
  const parsed = fs.existsSync(file) ? require('dotenv').parse(fs.readFileSync(file)) : {};
  const result = { ...parsed, ...env, MOMS_DATA_DIR: dataRoot };
  let database;
  try { if (result.DATABASE_URL) database = new URL(result.DATABASE_URL); } catch (_) { /* Report no credentials. */ }
  if (result.DATABASE_URL && (!database || !['postgres:', 'postgresql:'].includes(database.protocol))) throw new Error('Configure a valid PostgreSQL DATABASE_URL before starting MOMS.');
  if (!result.MOMS_POSTGRES_DIR) {
    const bundled = path.resolve(__dirname, '../../runtime/postgresql');
    if (fs.existsSync(bundled)) result.MOMS_POSTGRES_DIR = bundled;
    else if (!result.DATABASE_URL) throw new Error('Configure DATABASE_URL or provide the bundled MOMS_POSTGRES_DIR before starting MOMS.');
  }
  return result;
}
function controlEndpoint(dataRoot, token) {
  const name = 'moms-' + crypto.createHash('sha256').update(dataRoot).digest('hex').slice(0, 12) + '-' + token;
  return process.platform === 'win32' ? '\\\\.\\pipe\\' + name : path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), name + '.sock');
}
function readOwner(dataRoot) {
  dataRoot = dataDirectory(dataRoot);
  const lock = path.join(dataRoot, '.desktop', 'lock');
  let names;
  try { names = fs.readdirSync(lock); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (names.length !== 1 || !/^\d+-[a-f0-9]{32}\.json$/.test(names[0])) throw new Error('Desktop launcher is starting or its lock is incomplete. Retry shortly; check for a running launcher before repairing the lock.');
  let owner;
  try { owner = JSON.parse(fs.readFileSync(path.join(lock, names[0]), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return null; // A completed stop may remove the lock during status.
    throw new Error('Unable to read the private desktop lock. Check ownership and running launchers.');
  }
  if (!Number.isSafeInteger(owner.pid) || owner.pid < 1 || !/^[a-f0-9]{32}$/.test(owner.token) || names[0] !== `${owner.pid}-${owner.token}.json`) throw new Error('Invalid desktop lock.');
  // Recompute the endpoint; corrupted metadata must never redirect control or cleanup to another file.
  return { pid: owner.pid, token: owner.token, endpoint: controlEndpoint(dataRoot, owner.token), file: path.join(lock, names[0]), lock };
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
function acquire(dataRoot) {
  const directory = path.join(dataRoot, '.desktop'), lock = path.join(directory, 'lock');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
  for (let attempt = 0; attempt < 3; attempt++) {
    try { fs.mkdirSync(lock, { mode: 0o700 }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const old = readOwner(dataRoot);
      if (!old) continue;
      if (alive(old.pid)) throw new Error('MOMS launcher is already running for this data directory.');
      // Remove only the dead owner's unique file; a competing owner cannot be deleted.
      try { fs.unlinkSync(old.file); fs.rmdirSync(lock); }
      catch (failure) { if (['ENOENT','ENOTEMPTY'].includes(failure.code)) continue; throw failure; }
      if (process.platform !== 'win32' && old.endpoint) fs.rmSync(old.endpoint, { force: true });
      continue;
    }
    const token = crypto.randomBytes(16).toString('hex');
    const endpoint = controlEndpoint(dataRoot, token);
    const owner = { pid: process.pid, token, endpoint, file: path.join(lock, `${process.pid}-${token}.json`), lock };
    fs.writeFileSync(owner.file, JSON.stringify({ pid: owner.pid, token, endpoint }), { mode: 0o600, flag: 'wx' });
    return owner;
  }
  throw new Error('Desktop launcher is starting concurrently. Retry shortly.');
}
function release(owner) {
  try { fs.unlinkSync(owner.file); fs.rmdirSync(owner.lock); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
function request(dataRoot, command, timeout = 130000) {
  const owner = readOwner(dataRoot);
  if (!owner || !alive(owner.pid)) return Promise.resolve({ status: 'stopped', childPid: null });
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(owner.endpoint);
    let buffer = '';
    const fail = () => { socket.destroy(); reject(new Error('Unable to contact the desktop launcher. Retry or inspect the private desktop log.')); };
    socket.setTimeout(timeout, fail); socket.on('error', fail);
    socket.on('connect', () => socket.write(JSON.stringify({ token: owner.token, command }) + '\n'));
    socket.on('data', bytes => {
      buffer += bytes;
      if (buffer.length > 4096) return fail();
      if (!buffer.includes('\n')) return;
      socket.destroy();
      try { const response = JSON.parse(buffer.split('\n')[0]); response.error ? reject(new Error(response.error)) : resolve(response); }
      catch (_) { reject(new Error('Invalid desktop launcher response.')); }
    });
    socket.on('end', () => { if (!buffer.includes('\n')) fail(); });
  });
}
async function run({ dataRoot, serverFile = path.resolve(__dirname, 'worker.js'), env = process.env, retryDelay, stopTimeout } = {}) {
  dataRoot = dataDirectory(dataRoot);
  desktopEnvironment(dataRoot, env); // Fail before acquiring a lock; never use the repository .env/default DB.
  const owner = acquire(dataRoot);
  let log, server, finishing, database;
  const sockets = new Set();
  try {
    for (const directory of Object.values(getPaths({ MOMS_DATA_DIR: dataRoot }))) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const logFile = path.join(dataRoot, '.desktop', 'app.log');
    // Keep the previous session log without accumulating unbounded files between launches.
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5 * 1024 * 1024) fs.renameSync(logFile, logFile + '.previous');
    log = fs.openSync(logFile, 'a', 0o600);
    const environment = desktopEnvironment(dataRoot, env);
    if (!environment.DATABASE_URL) database = await require('./postgres').start({ dataRoot, directory: environment.MOMS_POSTGRES_DIR, env: environment });
    const workerEnvironment = () => {
      const current = desktopEnvironment(dataRoot, env);
      if (database) return require('./postgres').withRuntime({ ...current, DATABASE_URL: database.env.DATABASE_URL, MOMS_MANAGED_DATABASE: '1' }, environment.MOMS_POSTGRES_DIR);
      return current.MOMS_POSTGRES_DIR ? require('./postgres').withRuntime(current, current.MOMS_POSTGRES_DIR) : current;
    };
    const supervisor = new Supervisor({ retryDelay, stopTimeout, spawn: () => fork(serverFile, [], {
      cwd: dataRoot, env: workerEnvironment(), execArgv: [], windowsHide: true,
      stdio: ['ignore', log, log, 'ipc']
    }) });
    let finish;
    const completed = new Promise(resolve => { finish = resolve; });
    const stop = () => finishing || (finishing = (async () => {
      const outcome = await supervisor.stop();
      let databaseStopped = true;
      try { await database?.stop(); } catch (_) { databaseStopped = false; }
      database = undefined;
      outcome.clean = outcome.clean && databaseStopped;
      const response = outcome.clean ? { status: 'stopped', childPid: null } : { status: 'stopped', error: 'MOMS stopped, but shutdown did not complete cleanly. Check the private desktop log before restarting.' };
      if (!outcome.clean) process.exitCode = 1;
      release(owner); // The worker is gone; an acknowledged stop must allow an immediate new start.
      for (const socket of sockets) {
        socket.end(JSON.stringify(response) + '\n');
        const timer = setTimeout(() => socket.destroy(), 1000); timer.unref();
      }
      await new Promise(resolve => server.close(resolve));
      finish();
    })());
    server = net.createServer(socket => {
      sockets.add(socket); socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => {}); socket.setTimeout(135000, () => socket.destroy());
      let buffer = '', handled = false;
      socket.on('data', async bytes => {
        if (handled) return;
        buffer += bytes;
        if (buffer.length > 4096) { handled = true; socket.destroy(); return; }
        if (!buffer.includes('\n')) return;
        handled = true;
        try {
          const message = JSON.parse(buffer.split('\n')[0]);
          if (message.token !== owner.token) { socket.destroy(); return; }
          if (message.command === 'stop') { await stop(); return; }
          if (message.command === 'restart') { supervisor.restart(); await supervisor.ready(); }
          else if (message.command !== 'status') throw new Error('Unknown desktop command.');
          socket.end(JSON.stringify(supervisor.snapshot()) + '\n');
        } catch (error) { socket.end(JSON.stringify({ error: error.message }) + '\n'); }
      });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(owner.endpoint, resolve); });
    if (process.platform !== 'win32') fs.chmodSync(owner.endpoint, 0o600);
    const onSignal = () => { stop().catch(() => { process.exitCode = 1; finish(); }); };
    process.on('SIGTERM', onSignal); process.on('SIGINT', onSignal);
    supervisor.once('failed', () => { process.exitCode = 1; onSignal(); });
    supervisor.launch();
    try { await completed; }
    finally { process.removeListener('SIGTERM', onSignal); process.removeListener('SIGINT', onSignal); }
  } finally {
    for (const socket of sockets) socket.destroy();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    if (log !== undefined) fs.closeSync(log);
    try { await database?.stop(); } finally { release(owner); }
  }
}
module.exports = { dataDirectory, desktopEnvironment, readOwner, acquire, release, request, run };
