'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { dataDirectory, readOwner, request, run } = require('../src/desktop/runtime');

function options(args) {
  const command = args.shift();
  if (!['run', 'start', 'open', 'stop', 'restart', 'status', 'autostart'].includes(command)) throw new Error('Usage: npm run desktop -- <start|open|stop|restart|status|run|autostart enable|autostart disable> [--data-dir <absolute-path>]');
  const enabled = command === 'autostart' ? args.shift() : undefined;
  if (command === 'autostart' && !['enable','disable'].includes(enabled)) throw new Error('Use autostart enable or autostart disable.');
  let dataRoot;
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--data-dir') throw new Error('Only --data-dir <absolute-path> is supported.');
    dataRoot = args[1];
  }
  return { command, enabled, dataRoot: dataDirectory(dataRoot) };
}
async function waitForStartup(dataRoot, child) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (child && (child.launchFailed || child.exitCode !== null || child.signalCode)) throw new Error('Desktop launcher exited before startup. Check the private desktop log.');
    let status;
    try { status = await request(dataRoot, 'status', 2000); } catch (_) { /* Lock may precede the pipe while starting. */ }
    if (status?.status === 'running') return status;
    if (status?.status === 'failed') throw new Error('MOMS failed to start. Check the private desktop log.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Startup timed out; the launcher may still be starting. Use status or stop.');
}
async function main(args = process.argv.slice(2)) {
  const { command, enabled, dataRoot } = options([...args]);
  if(command==='open'){
    await main(['start','--data-dir',dataRoot]);
    const status=await request(dataRoot,'status');
    if(!/^https?:\/\/localhost:\d+$/.test(status.url||''))throw new Error('MOMS did not report a local application URL.');
    const browser=spawn(process.platform==='win32'?'explorer.exe':process.platform==='darwin'?'open':'xdg-open',[status.url],{detached:true,stdio:'ignore',windowsHide:true});
    browser.on('error',()=>{console.error('Open the local MOMS address in your browser.');});browser.unref();return;
  }
  if (command === 'run') return run({ dataRoot });
  if (command === 'autostart') {
    const file = require('../src/desktop/autostart').configure(enabled === 'enable', { dataRoot, script: __filename });
    console.log(`MOMS autostart ${enabled === 'enable' ? 'enabled for next login' : 'disabled for future logins'}: ${file}`);
    return;
  }
  if (command !== 'start') {
    const result = await request(dataRoot, command);
    if (command === 'restart' && result.status === 'stopped') throw new Error('MOMS is stopped. Use start first.');
    console.log(`MOMS: ${result.status}`); return;
  }
  // An already running launcher is reused; never inspect an unrelated HTTP listener.
  const existing = readOwner(dataRoot);
  if (existing) {
    const status = await request(dataRoot, 'status', 2000);
    if (status.status === 'stopping') throw new Error('MOMS is stopping. Retry after it stops.');
    if (status.status !== 'stopped') {
      const ready = status.status === 'running' ? status : await waitForStartup(dataRoot);
      console.log(`MOMS: ${ready.status}`); return;
    }
  }
  fs.mkdirSync(path.join(dataRoot, '.desktop'), { recursive: true, mode: 0o700 });
  const log = fs.openSync(path.join(dataRoot, '.desktop', 'app.log'), 'a', 0o600);
  let child;
  try {
    child = spawn(process.execPath, [__filename, 'run', '--data-dir', dataRoot], {
      cwd: dataRoot, detached: true, windowsHide: true, stdio: ['ignore', log, log]
    });
    child.on('error', () => { child.launchFailed = true; });
  } finally { fs.closeSync(log); }
  child.unref();
  const status = await waitForStartup(dataRoot, child);
  console.log(`MOMS: ${status.status}`);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { options, main };
