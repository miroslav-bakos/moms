'use strict';
const assert = require('assert/strict');
const zlib = require('zlib');
const bundle = require('../src/services/backupBundle');
(async () => {
  const files = [bundle.entry('database.dump', Buffer.from('PGDMP fixture')), bundle.entry('configuration.json', Buffer.from('{"values":{}}')), bundle.entry('labels/order/example.pdf', Buffer.from('%PDF-test'))];
  const bytes = await bundle.pack(files);
  const parsed = await bundle.unpack(bytes);
  assert.equal(parsed.files.get('labels/order/example.pdf').toString(), '%PDF-test');
  await assert.rejects(bundle.unpack(bytes.subarray(0, bytes.length - 10)));
  for (const change of [obj => obj.files[2].name = 'labels/../../outside', obj => obj.files[2].data = Buffer.from('changed').toString('base64'), obj => obj.files.push(obj.files[0]), obj => obj.files.splice(0,1)]) {
    const obj = JSON.parse(zlib.gunzipSync(bytes)); change(obj);
    await assert.rejects(bundle.unpack(zlib.gzipSync(JSON.stringify(obj))));
  }
  const crypto=require('node:crypto'),store=require('../src/settings/store'),key=crypto.randomBytes(32);
  const oldSettings={values:{ETSY_CLIENT_ID:'fixture-client',RETIRED_OPTION:'private-old-value'},previousAppSecret:'previous-fixture'};
  const oldFiles=[bundle.entry('database.dump',Buffer.from('PGDMP fixture')),bundle.entry('configuration.json',Buffer.from(JSON.stringify({values:oldSettings.values}))),bundle.entry('settings/settings.key',key),bundle.entry('settings/settings.enc',Buffer.from(store.crypt(oldSettings,key)))];
  const restored=await bundle.unpack(await bundle.pack(oldFiles));
  assert.deepEqual(restored.configuration.values,{ETSY_CLIENT_ID:'fixture-client'});
  const restoredSettings=store.crypt(restored.files.get('settings/settings.enc').toString(),key,true);
  assert.deepEqual(restoredSettings.values,{ETSY_CLIENT_ID:'fixture-client'});assert.equal(restoredSettings.previousAppSecret,'previous-fixture');
  for(const values of [{PORT:3000},JSON.parse('{"__proto__":"invalid"}'),{'bad-key':'x'}]){
    if(!Object.keys(values).length)continue;
    await assert.rejects(bundle.unpack(await bundle.pack([oldFiles[0],bundle.entry('configuration.json',Buffer.from(JSON.stringify({values})))])));
  }
  assert.equal((await bundle.unpack(zlib.gzipSync('SELECT 1;'))).legacy, true);
  console.log('Bundle checks: truncation, checksum, traversal, duplicate and missing files, legacy compatibility passed');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
