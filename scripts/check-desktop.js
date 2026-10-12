'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Supervisor } = require('../src/desktop/supervisor');
const { definition, configure } = require('../src/desktop/autostart');
const { dataDirectory, desktopEnvironment, acquire, release, readOwner, request } = require('../src/desktop/runtime');
const { options } = require('./desktop');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'moms-desktop-'));
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

async function offline() {
  const actualParent = path.join(temp, 'Real Data Parent');
  const aliasParent = path.join(temp, 'Data Parent Alias');
  fs.mkdirSync(actualParent);
  fs.symlinkSync(actualParent, aliasParent, process.platform === 'win32' ? 'junction' : 'dir');
  const aliasedData = path.join(aliasParent, 'New Data');
  const beforeCreation = dataDirectory(aliasedData);
  fs.mkdirSync(aliasedData);
  assert.equal(dataDirectory(aliasedData), beforeCreation, 'Data identity remains stable through a symlinked parent after first install');
  assert.equal(beforeCreation, fs.realpathSync(aliasedData));
  const children = [];
  const supervisor = new Supervisor({ retryDelay: 1, stopTimeout: 1000, spawn: () => {
    const child = new EventEmitter(); child.pid = children.length + 1; child.connected = true;
    child.sent = []; child.send = value => child.sent.push(value); child.kill = () => { throw new Error('Must drain before killing.'); };
    children.push(child); return child;
  } });
  supervisor.launch(); children[0].emit('message', { type: 'moms-ready' }); await supervisor.ready();
  supervisor.restart(); supervisor.restart();
  assert.equal(children.length, 1, 'Restart must not overlap workers');
  assert.deepEqual(children[0].sent, [{ type: 'moms-shutdown' }]);
  children[0].emit('close', 0); assert.equal(children.length, 2);
  children[0].emit('message', { type: 'moms-ready' }); assert.equal(supervisor.phase, 'starting', 'Stale readiness ignored');
  children[1].emit('message', { type: 'moms-ready' }); await supervisor.ready();
  children[1].emit('close', 0); await tick(); assert.equal(children.length, 3, 'Restore exit 0 restarts worker');
  children[2].emit('message', { type: 'moms-ready' });
  const stopping = supervisor.stop(); assert.equal(supervisor.stop(), stopping);
  let stopped = false; stopping.then(() => { stopped = true; }); await tick(); assert.equal(stopped, false);
  children[2].emit('close', 0); await stopping; assert.equal(supervisor.phase, 'stopped');
  await tick(); assert.equal(children.length, 3, 'Intentional stop must not restart');
  const failure = new Supervisor({ spawn: () => { throw new Error('fixture'); }, retryDelay: 1, maxFailures: 2 });
  failure.launch(); await assert.rejects(failure.ready(), /did not start/); await failure.stop();
  const stuckChild = new EventEmitter(); stuckChild.connected = true; stuckChild.send = () => {};
  stuckChild.kill = signal => { assert.equal(signal, 'SIGKILL'); stuckChild.emit('close', null, signal); };
  const stuck = new Supervisor({ spawn: () => stuckChild, stopTimeout: 10 });
  stuck.launch(); assert.deepEqual(await stuck.stop(), { clean: false }, 'Forced termination must not count as a clean drain');

  assert.throws(() => dataDirectory('relative'), /absolute/);
  assert.throws(() => options(['start','--unknown']), /Only/);
  assert.throws(() => options(['autostart','yes']), /enable/);
  const dataRoot = path.join(temp, 'User Data & percent%');
  fs.mkdirSync(dataRoot);
  assert.throws(() => desktopEnvironment(dataRoot, {}), /Configure DATABASE_URL/);
  fs.writeFileSync(path.join(dataRoot, '.env'), 'DATABASE_URL=postgres://fixture@localhost/disposable\nMOMS_DATA_DIR=/must-not-override\n');
  assert.equal(desktopEnvironment(dataRoot, {}).MOMS_DATA_DIR, dataRoot);
  assert.equal(desktopEnvironment(dataRoot, { DATABASE_URL: 'postgresql://override@localhost/disposable' }).DATABASE_URL, 'postgresql://override@localhost/disposable');
  const owner = acquire(dataRoot);
  try { assert.throws(() => acquire(dataRoot), /already running/); assert.equal(readOwner(dataRoot).pid, process.pid); }
  finally { release(owner); }
  assert.equal(readOwner(dataRoot), null);
  // Dead lock recovery removes the unique owner's file; preserves application files.
  fs.mkdirSync(path.join(dataRoot, '.desktop', 'lock'));
  const token = 'a'.repeat(32), deadPid = 2147483647;
  const preserve = path.join(dataRoot, 'preserve.txt'); fs.writeFileSync(preserve, 'customer-data');
  fs.writeFileSync(path.join(dataRoot, '.desktop', 'lock', `${deadPid}-${token}.json`), JSON.stringify({ pid: deadPid, token, endpoint: preserve }));
  const recovered = acquire(dataRoot); release(recovered);
  assert.equal(fs.readFileSync(preserve, 'utf8'), 'customer-data', 'Stale endpoint metadata cannot delete unrelated files');
  fs.mkdirSync(path.join(dataRoot, '.desktop', 'lock'));
  const invalid = path.join(dataRoot, '.desktop', 'lock', `${deadPid}-${token}.json`);
  fs.writeFileSync(invalid, '{"token":"sensitive-fixture" invalid');
  assert.throws(() => readOwner(dataRoot), error => !error.message.includes('sensitive-fixture') && /private desktop lock/.test(error.message));
  fs.unlinkSync(invalid); fs.rmdirSync(path.dirname(invalid));
  const base = { dataRoot, executable: '/opt/Node & MOMS/node', script: '/opt/MOMS $ "%/desktop.js', home: temp.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/'), env: { XDG_CONFIG_HOME: path.join(temp, 'Config').replace(/^[A-Za-z]:/, '').replace(/\\/g, '/') } };
  const linux = definition({ ...base, platform: 'linux' });
  assert.match(linux.content, /Terminal=false/); assert.match(linux.content, /%%/); assert.match(linux.content, /\\\\\$/);
  const enabledFile = configure(true, { ...base, platform: 'linux' }); assert(fs.existsSync(enabledFile));
  configure(false, { ...base, platform: 'linux' }); assert(!fs.existsSync(enabledFile));
  const mac = definition({ ...base, platform: 'darwin' });
  assert.match(mac.content, /&amp;/); assert.match(mac.content, /&quot;/); assert.match(mac.content, /ExitTimeOut<\/key><integer>70/);
  const windows = definition({ dataRoot: 'C:\\Users\\Jane\\User Data', executable: 'C:\\Program Files\\Node\\node.exe', script: 'C:\\Program Files\\MOMS\\desktop.js', platform: 'win32', sid: 'S-1-5-21-1000' });
  assert.match(windows.content, /InteractiveToken/); assert.match(windows.content, /LeastPrivilege/); assert.match(windows.content, /PT0S/); assert.match(windows.content, /&quot;C:\\Program Files/);
  assert.throws(() => definition({ ...base, platform: 'linux', script: 'bad\nExec=evil' }), /control characters/);
  assert.equal(fs.readFileSync(path.join(dataRoot, 'preserve.txt'), 'utf8'), 'customer-data');
}

// Explicit IPC mode uses private temporary pipes and a fixture, never the app/DB or deployment.
async function ipc() {
  const { spawn } = require('node:child_process');
  const net = require('node:net');
  const dataRoot = path.join(temp, 'Actual User Data');
  const marker = path.join(temp, 'events.txt');
  const fixture = path.join(temp, 'worker.cjs');
  fs.writeFileSync(fixture, `
    const fs = require('node:fs');
    const file = ${JSON.stringify(marker)};
    fs.appendFileSync(file, 'start:' + process.pid + ':' + process.cwd() + ':' + process.env.MOMS_DATA_DIR + '\\n');
    let draining = false;
    const drain = () => { if (!draining) { draining = true; setTimeout(() => { fs.appendFileSync(file, 'drained:' + process.pid + '\\n'); process.exit(0); }, 80); } };
    process.on('message', message => {
      if (message.type === 'fixture-crash') process.exit(0);
      if (message.type === 'moms-shutdown') drain();
    });
    process.on('disconnect', drain);
    setTimeout(() => process.send({type:'moms-ready'}), 30);
  `);
  const driver = path.join(temp, 'driver.cjs');
  fs.writeFileSync(driver, `require(${JSON.stringify(require.resolve('../src/desktop/runtime'))}).run({dataRoot:${JSON.stringify(dataRoot)},serverFile:${JSON.stringify(fixture)},retryDelay:10}).catch(()=>process.exit(1));`);
  const child = spawn(process.execPath, [driver], { stdio: ['ignore','pipe','pipe'], env: { ...process.env, DATABASE_URL: 'postgres://fixture@localhost/unused' } });
  let output = ''; child.stdout.on('data', bytes => { output += bytes; }); child.stderr.on('data', bytes => { output += bytes; });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const wait = async predicate => {
    const until = Date.now() + 5000;
    while (Date.now() < until) { if (await predicate()) return; await tick(); }
    throw new Error('Fixture timed out: ' + output);
  };
  try {
    await wait(async () => { try { return (await request(dataRoot, 'status', 500)).status === 'running'; } catch (_) { return false; } });
    const initial = await request(dataRoot, 'status');
    assert(initial.childPid); const owner = readOwner(dataRoot);
    // A random local connection cannot stop the app without the private token.
    await new Promise((resolve, reject) => {
      const socket = net.createConnection(owner.endpoint); socket.on('error', reject); socket.on('close', resolve);
      socket.on('connect', () => socket.end(JSON.stringify({ token: 'wrong', command: 'stop' }) + '\n'));
    });
    assert.equal((await request(dataRoot, 'status')).childPid, initial.childPid);
    const restart = await request(dataRoot, 'restart');
    assert.equal(restart.status, 'running'); assert.notEqual(restart.childPid, initial.childPid);
    const events = fs.readFileSync(marker, 'utf8').trim().split('\n');
    assert(events[1].startsWith('drained:' + initial.childPid)); assert(events[2].startsWith('start:' + restart.childPid));
    assert(events[0].endsWith(':' + dataRoot + ':' + dataRoot));
    const sentinel = path.join(dataRoot, 'labels', 'saved-label.txt'); fs.writeFileSync(sentinel, 'preserved');
    assert.equal((await request(dataRoot, 'stop')).status, 'stopped');
    assert.deepEqual(await exited, { code: 0, signal: null });
    assert.equal(readOwner(dataRoot), null); assert.equal(fs.readFileSync(sentinel,'utf8'), 'preserved');
    assert.equal((await request(dataRoot, 'status')).status, 'stopped');
    if (process.platform !== 'win32') {
      // Killing only the agent must disconnect/drain its worker, then permit dead-lock recovery.
      const crashed = spawn(process.execPath, [driver], { stdio: 'ignore', env: { ...process.env, DATABASE_URL: 'postgres://fixture@localhost/unused' } });
      const crashExit = new Promise(resolve => crashed.once('exit', resolve));
      let crashWorker;
      try {
        await wait(async () => { try { const current = await request(dataRoot, 'status', 500); crashWorker = current.childPid; return current.status === 'running'; } catch (_) { return false; } });
        crashed.kill('SIGKILL'); await crashExit;
        await wait(() => fs.readFileSync(marker, 'utf8').includes('drained:' + crashWorker));
      } finally { if (crashed.exitCode === null && !crashed.signalCode) { crashed.kill('SIGTERM'); await crashExit; } }
      const replacement = spawn(process.execPath, [driver], { stdio: 'ignore', env: { ...process.env, DATABASE_URL: 'postgres://fixture@localhost/unused' } });
      const replacedExit = new Promise(resolve => replacement.once('exit', resolve));
      try {
        await wait(async () => { try { return (await request(dataRoot, 'status', 500)).status === 'running'; } catch (_) { return false; } });
        await request(dataRoot, 'stop'); assert.equal(await replacedExit, 0);
        assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserved');
      } finally { if (replacement.exitCode === null && !replacement.signalCode) { replacement.kill('SIGTERM'); await replacedExit; } }
    }
  } finally { if (child.exitCode === null && !child.signalCode) { child.kill('SIGTERM'); await exited; } }
}
async function app() {
  const { spawnSync } = require('node:child_process');
  const dataRoot = process.env.MOMS_DATA_DIR;
  assert.equal(dataRoot, '/tmp/moms-desktop-data');
  assert.equal(new URL(process.env.DATABASE_URL).hostname, 'test-db', 'Requires the isolated compose test service');
  const health = async () => assert.equal((await fetch('http://127.0.0.1:3080/health')).status, 200);
  await health();
  const initial = await request(dataRoot, 'status'); assert.equal(initial.status, 'running');
  const keyFile = path.join(dataRoot, 'settings', 'settings.key');
  // Only this explicitly disposable service receives fixture settings.
  if (!fs.existsSync(keyFile)) require('../src/settings/store').write({ values: {} });
  const key = fs.readFileSync(keyFile);
  const sentinel = path.join(dataRoot, 'labels', 'desktop-test.txt'); fs.writeFileSync(sentinel, 'disposable-fixture');
  const duplicate = spawnSync(process.execPath, [path.join(__dirname, 'desktop.js'), 'start'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(duplicate.status, 0); assert.match(duplicate.stdout, /running/);
  assert.equal((await request(dataRoot, 'status')).childPid, initial.childPid);
  const refused = spawnSync(process.execPath, [path.join(__dirname, 'desktop.js'), 'run'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(refused.status, 1); assert.match(refused.stderr, /already running/);
  const restarted = await request(dataRoot, 'restart');
  assert.equal(restarted.status, 'running'); assert.notEqual(restarted.childPid, initial.childPid); await health();
  assert.deepEqual(fs.readFileSync(keyFile), key); assert.equal(fs.readFileSync(sentinel, 'utf8'), 'disposable-fixture');
  process.kill(restarted.childPid, 'SIGTERM');
  const deadline = Date.now() + 10000;
  let recovered;
  do { await tick(); recovered = await request(dataRoot, 'status'); }
  while (Date.now() < deadline && (recovered.status !== 'running' || recovered.childPid === restarted.childPid));
  assert.equal(recovered.status, 'running'); assert.notEqual(recovered.childPid, restarted.childPid); await health();
  assert.deepEqual(fs.readFileSync(keyFile), key);
}
(async () => {
  try {
    if (process.argv.includes('--app')) await app();
    else { await offline(); if (process.argv.includes('--ipc')) await ipc(); }
    console.log('Desktop: supervision, drain/restart, lock recovery, data preservation and platform autostart passed' + (process.argv.includes('--ipc') ? '; real private IPC verified.' : process.argv.includes('--app') ? '; isolated app verified.' : '.'));
  }
  finally { fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
