'use strict';
// Offline drain contract; --http additionally exercises a real local HTTP connection.
const assert = require('node:assert/strict');
const http = require('node:http');
const { createShutdown } = require('../src/lifecycle');
const tick = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  let finishRequest, finishJob, poolClosed = 0, stops = 0;
  const exits = [];
  const jobs = new Promise(resolve => { finishJob = resolve; });
  let server, response;
  if (process.argv.includes('--http')) {
    server = http.createServer((req, res) => { finishRequest = () => res.end('saved'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    response = new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${server.address().port}`, res => {
        res.resume(); res.on('end', resolve);
      }).on('error', reject);
    });
    while (!finishRequest) await tick();
  } else {
    let completeResponse;
    response = new Promise(resolve => { completeResponse = resolve; });
    server = { close(callback) { finishRequest = () => { completeResponse(); callback(); }; }, closeIdleConnections() {} };
  }
  const lifecycle = createShutdown({ getServer: () => server, stopJobs: () => { stops++; return jobs; }, closeDatabase: async () => { poolClosed++; }, exit: code => exits.push(code) });
  const shutdown = lifecycle.shutdown();
  assert.equal(lifecycle.isStopping(), true);
  assert.equal(lifecycle.shutdown(), shutdown);
  await tick(); assert.equal(poolClosed, 0);
  finishJob(); await tick(); assert.equal(poolClosed, 0, 'In-flight HTTP write must finish first');
  finishRequest(); await response; await shutdown;
  assert.equal(poolClosed, 1); assert.equal(stops, 1); assert.deepEqual(exits, [0]);

  let finishStartup, startupComplete = false;
  const startup = new Promise(resolve => { finishStartup = () => { startupComplete = true; resolve(); }; });
  const bootExit = [];
  const bootShutdown = createShutdown({ getServer: () => undefined, stopJobs: async () => {}, ready: () => startup, closeDatabase: async () => { assert(startupComplete); }, exit: code => bootExit.push(code) });
  const boot = bootShutdown.shutdown(); await tick(); assert.deepEqual(bootExit, []);
  finishStartup(); await boot; assert.deepEqual(bootExit, [0]);
  const failureExit=[];let closedOnFailure=false;
  const originalError=console.error;const errors=[];console.error=message=>errors.push(message);
  try {
    await createShutdown({getServer:()=>undefined,stopJobs:async()=>{throw new Error('Fixture drain failure');},closeDatabase:async()=>{closedOnFailure=true;},exit:code=>failureExit.push(code)}).shutdown();
  } finally {console.error=originalError;}
  assert.deepEqual(failureExit,[1]);assert.equal(closedOnFailure,false);assert.deepEqual(errors,['Unable to complete application shutdown.']);
  const {spawnSync}=require('node:child_process');
  const forced=spawnSync(process.execPath,['-e',`
    setInterval(()=>{},1000);
    require(${JSON.stringify(require.resolve('../src/lifecycle'))}).createShutdown({getServer:()=>undefined,stopJobs:()=>new Promise(()=>{}),closeDatabase:()=>{throw new Error('Must not close an active database');},timeoutMs:20}).shutdown();
  `],{encoding:'utf8',timeout:5000});
  assert.equal(forced.status,1);assert.match(forced.stderr,/Shutdown timed out/);
  console.log('Lifecycle: active HTTP/jobs drain before pool close, repeated signals and shutdown during startup passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
