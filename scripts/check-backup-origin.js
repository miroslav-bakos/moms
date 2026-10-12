'use strict';
const assert = require('assert/strict');
const { sameOrigin } = require('../src/middleware/sameOrigin');
function allowed(headers, method = 'POST') {
  let passed = false;
  sameOrigin({ method, get: name => headers[name] }, { status: code => { assert.equal(code,403); return { json() {} }; } }, () => { passed = true; });
  return passed;
}
assert(allowed({Host:'192.168.1.100:3080',Origin:'http://192.168.1.100:3080','Sec-Fetch-Site':'same-origin'}));
assert(allowed({Host:'moms.local',Origin:'https://moms.local'}));
assert(allowed({Host:'192.168.1.100:3080'})); // authenticated CLI
assert(!allowed({Host:'192.168.1.100:3080',Origin:'https://attacker.example'}));
assert(!allowed({Host:'192.168.1.100:3080',Origin:'null'}));
assert(!allowed({Host:'192.168.1.100:3080','Sec-Fetch-Site':'cross-site'}));
assert(!allowed({Host:'moms.local',Origin:'https://moms.local.attacker.example'}));
assert(!allowed({Host:'moms.local:3080',Origin:'http://moms.local:3081'}));
assert(!allowed({Host:'moms.local','Sec-Fetch-Site':'cross-site'}, 'GET'));
console.log('Backup browser request checks passed: same host and CLI allowed; cross-site, opaque origins and wrong ports rejected');
