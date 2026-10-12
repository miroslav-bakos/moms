'use strict';
// Isolated scheduler checks: no database, credentials, timers or network.
const assert = require('node:assert/strict');
const path = require('node:path');
const stub = (file, exports) => {
  const filename = require.resolve(path.join('..', 'src', file));
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
let maintenance = false;
let adapterCalls = 0;
let release;
let failImport = false;
let successes = 0;
let failures = 0;
let imported = [];
const since = '2026-09-01T00:00:00.000Z';
const testConfig={pollIntervalMinutes:1,pollOnStart:true};
stub('config', { config: testConfig });
stub('maintenance', { isActive: () => maintenance });
for (const channel of ['etsy', 'shopify', 'amazon', 'sashe']) {
  stub(`channels/${channel}`, { poll: async (args) => {
    assert.equal(args.since, since);
    adapterCalls++;
    await new Promise(resolve => { release = resolve; });
    return { orders: [{ id: 1 }, { id: 2 }], nextCursor: '2026-10-05T00:00:00.000Z' };
  } });
}
stub('services/orders', { upsertOrder: async order => {
  imported.push(order.id);
  if (failImport && order.id === 2) throw new Error('Interrupted write');
} });
stub('services/events', { logEvent: async () => {} });
let finishBackup;
stub('services/backup', { performBackup: async () => { await new Promise(resolve=>{finishBackup=resolve;}); } });
stub('services/channelState', {
  getChannelState: async () => ({}), effectiveChannelEnabled: () => false,
  effectiveSince: () => since, markPollStarted: async () => {},
  markPollSuccess: async () => { successes++; }, markPollError: async () => { failures++; }
});
const scheduler = require('../src/scheduler');
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  const first = scheduler.pollChannel('etsy', { force: true });
  const second = scheduler.pollChannel('etsy', { force: true });
  assert.equal(first, second);
  assert.equal(scheduler.isBusy(), true);
  await tick();
  assert.equal(adapterCalls, 1);
  maintenance = true;
  await assert.rejects(scheduler.pollChannel('etsy', { force: true }), /Restore/);
  maintenance = false;
  release();
  await first;
  assert.deepEqual(imported, [1, 2]);
  assert.equal(successes, 1);
  assert.equal(scheduler.isBusy(), false);

  failImport = true;
  const failed = scheduler.pollChannel('etsy', { force: true });
  await tick(); release();
  await assert.rejects(failed, /Interrupted write/);
  assert.equal(successes, 1, 'Cursor cannot advance after a partial import');
  assert.equal(failures, 1);
  assert.equal(scheduler.isBusy(), false, 'Failure releases the lock');

  failImport = false;
  const retry = scheduler.pollChannel('etsy', { force: true });
  await tick(); release(); await retry;
  assert.equal(successes, 2, 'A failed run can be retried');
  const all = scheduler.pollAll({ force: true });
  await tick();
  assert.deepEqual(await scheduler.pollAll({ force: true }), { skipped: true, reason: 'poll already running' });
  for (let i = 0; i < 4; i++) { release(); await tick(); }
  await all;
  assert.equal(scheduler.isBusy(), false);
  const draining = scheduler.pollChannel('etsy',{force:true});await tick();
  let stopped=false;const stop=scheduler.stopScheduler().then(()=>{stopped=true;});
  await tick();assert.equal(stopped,false);
  await assert.rejects(scheduler.pollChannel('shopify',{force:true}),/shutting down/);
  assert.equal((await scheduler.pollAll()).skipped,true);
  release();await draining;await stop;assert.equal(stopped,true);

  const realTimers={setTimeout,clearTimeout,setInterval,clearInterval};
  const timers=new Map();let timerId=0;
  global.setTimeout=(callback,ms)=>{const id=++timerId;timers.set(id,{callback,ms,interval:false});return id;};
  global.setInterval=(callback,ms)=>{const id=++timerId;timers.set(id,{callback,ms,interval:true});return id;};
  global.clearTimeout=global.clearInterval=id=>timers.delete(id);
  try {
    scheduler.startScheduler();assert.equal(timers.size,3);
    scheduler.startScheduler();assert.equal(timers.size,3,'Starting twice cancels the old startup callback');
    const [backupId,backupTimer]=[...timers].find(([,timer])=>!timer.interval && timer.ms!==5000);
    timers.delete(backupId);backupTimer.callback();await tick();
    assert.equal(timers.size,3,'Daily backup re-arms one tracked timeout');
    assert.equal(scheduler.isBusy(),false,'Backup must not wait on itself through maintenance.enter');
    let backupStopped=false;const backupStop=scheduler.stopScheduler().then(()=>{backupStopped=true;});
    assert.equal(timers.size,0,'All periodic and startup timers are cancelled');
    await tick();assert.equal(backupStopped,false,'Shutdown waits for the scheduled backup');
    finishBackup();await backupStop;assert.equal(backupStopped,true);
  } finally {Object.assign(global,realTimers);}
  console.log('Scheduler: shared channel runs, forced overlap, maintenance protection, failed-import cursor, retry, draining jobs, tracked daily backups and cancelled startup timers passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
