'use strict';
const assert = require('assert/strict');
const { validatePrint, printOrders } = require('../src/services/orderPrint');
for (const body of [{}, { orderIds:[1],view:'bad' }, {orderIds:[1],view:'cards',timezone:'Invalid/Zone'}]) assert.throws(() => validatePrint(body));
const options = validatePrint({ orderIds:[1,1,2],view:'cards',language:'sk',timezone:'Europe/Bratislava' });
assert.deepEqual(options.orderIds,[1,2]);
const rows = [{id:1,external_order_id:'000123',channel:'shopify',source_payload:{order_number:54321},vendor:'Shopify',workflow_status:'new',workflow_label:'NEW',ship_by_date:'2026-10-06',skus:'Munari x2',address:'Žofia\n<script>alert(1)</script>',tracking_code:'000987654321',note:'"<&'}, { id:2,external_order_id:'2',ship_by_date:'2026-10-05',workflow_status:'crafted',workflow_label:'CRAFTED',shipped:true }];
for (const view of ['cards','table']) {
  const html = printOrders(rows, {...options,view}, {name:'MOMS <Studio>',logo:null}, new Date('2026-10-05T22:30:00Z'));
  assert(!html.includes('<script>')); assert(html.includes('&lt;script&gt;')); assert(html.includes('MOMS &lt;Studio&gt;'));
  assert(html.includes('000987654321')); assert(html.includes('54321')); assert(html.includes('NOVÉ')); assert(html.includes('Archivovaná'));
  assert(html.includes('class="today">2026-10-06')); assert(html.includes('class="">2026-10-05')); assert(!html.includes('class="overdue">2026-10-05'));
  assert(html.includes('Uložiť ako PDF')); assert(html.includes(view === 'cards' ? 'class="cards"' : '<thead>'));
}
console.log('Print checks: selection validation, escaping, exact tracking, Shopify IDs, EN/SK, archive state and local deadlines passed');
