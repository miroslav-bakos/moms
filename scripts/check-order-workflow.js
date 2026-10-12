'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
let lastQuery;
const context = {
  module: { exports: {} },
  require(name) {
    if (name === './inventory') return { reconcile: async () => {} };
    if (name === '../db') { const query = async (sql, values) => {
      if (['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return { rows: [] };
      if (sql.startsWith('SELECT * FROM orders')) return { rows: [{ id: 42, workflow_status: 'new', shipped: false }] };
      if (sql.startsWith('SELECT id FROM order_workflow_statuses')) return { rows: ['new', 'in_progress', 'crafted', 'ready_for_pickup', 'shipped', 'custom_test'].includes(values[0]) ? [{ id: values[0] }] : [] };
      lastQuery = { sql, values };
      return { rows: [{ id: 42, workflow_status: values[0], shipped: false }] };
    }; return { query, withClient: async fn => fn({query}) }; }
    if (name === '../utils/dates') return {};
    if (name === './products') return {};
    return require(name);
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/services/orders.js'), 'utf8'), context);
(async () => {
  for (const status of ['new', 'in_progress', 'crafted', 'ready_for_pickup', 'shipped', 'custom_test']) {
    const order = await context.module.exports.updateOrderFlags(42, { workflow_status: status });
    assert.equal(order.workflow_status, status);
    assert.equal(order.shipped, false);
    assert.ok(lastQuery.sql.includes('workflow_status = $1'));
    assert.ok(!/\b(?:shipped|packed|processed)\s*=/.test(lastQuery.sql));
    assert.deepEqual(Array.from(lastQuery.values), [status, 42]);
  }
  await assert.rejects(context.module.exports.updateOrderFlags(42, { workflow_status: 'invalid' }), (error) => error.statusCode === 400);
  await context.module.exports.updateOrderFlags(42, { shipped: true });
  assert.ok(lastQuery.sql.includes('shipped = $1'));
  assert.ok(!lastQuery.sql.includes('workflow_status ='));
  let snapshotSql;
  const fixture = Array.from({length:1001}, (_, i)=>({id:i+1,created_at:'2026-10-01'}));
  const all = await context.module.exports.listOrders({status:'open',complete:true}, async (sql, values)=>{snapshotSql=sql;assert.equal(values.length,0);return {rows:fixture};});
  assert.equal(all.length,1001);assert.ok(!snapshotSql.includes('LIMIT'));assert.ok(snapshotSql.includes('id DESC'));
  console.log('Workflow status validation and independent archiving checks passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
