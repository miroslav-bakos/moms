'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { detectCountryCode } = require('../src/utils/countries');

// Exercise the actual parser and carrier payload without contacting the carrier.
const source = fs.readFileSync(path.join(__dirname, '../src/services/labels.js'), 'utf8');
const context = {
  require: (name) => {
    if (name === '../config') return { config: { shipping: { gls: { defaultCountryIso: 'SK' } } } };
    if (name === './labelOperations') return {};
    if (name === '../db') return { query: () => { throw new Error('Unexpected database call'); } };
    if (name === '../paths') return require('../src/paths');
    return require(name);
  },
  module: { exports: {} }
};
vm.createContext(context);
vm.runInContext(source + '\nmodule.exports = { parseRecipientAddress, postaRecipient };', context);
const { parseRecipientAddress, postaRecipient } = context.module.exports;
const address = `ฟารีดา ไทรงาม
ร้านชาโกใจ ลูกชิ้นปิ้ง
26
ถ.เจริญพงศ์ ต.บางนาค
เมืองนราธิวาส
Narathiwat 96000
Thailand
+66 95 439 2441`;
for (const country of ['Thailand', 'TH']) {
  const input = address.replace('Thailand', country);
  const recipient = postaRecipient(parseRecipientAddress(input));
  assert.equal(recipient.country, 'th');
  assert.equal(recipient.city, 'Narathiwat');
  assert.equal(recipient.zip, '96000');
  assert.equal(recipient.name, 'ฟารีดา ไทรงาม');
  assert.equal(recipient.phone, '+66 95 439 2441');
  for (const line of ['ร้านชาโกใจ ลูกชิ้นปิ้ง', '26', 'ถ.เจริญพงศ์ ต.บางนาค', 'เมืองนราธิวาส']) {
    assert.ok(recipient.street.includes(line), `Missing address line: ${line}`);
  }
  assert.equal(detectCountryCode(input), 'TH');
}
const domestic = postaRecipient(parseRecipientAddress('Test Recipient\nHlavna 26\n96000 Zvolen\nSlovakia'));
assert.equal(domestic.country, 'sk');
assert.equal(domestic.city, 'Zvolen');
assert.equal(domestic.zip, '96000');
console.log('Thailand address and domestic label regression checks passed.');

require('./check-label-retries')().catch(error=>{console.error(error);process.exitCode=1;});
