'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname,'..');
const preload = path.join(root,'scripts/harness/offline.cjs');
for (const expression of ["require('node:net').connect(1)", "require('node:dgram').createSocket('udp4').send('x',1,'127.0.0.1')", "fetch('https://example.com')"]) {
  const result = spawnSync(process.execPath,['--require',preload,'-e',expression],{cwd:root,encoding:'utf8',timeout:5000});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Offline check attempted network access/);
}
const invalid = spawnSync(process.execPath,[path.join(root,'scripts/verify.js'),'--not-a-mode'],{cwd:root,encoding:'utf8',timeout:5000});
assert.equal(invalid.status,2);assert.match(invalid.stderr,/Usage/);
console.log('Harness guards passed: TCP, UDP, fetch and invalid CLI mode.');
