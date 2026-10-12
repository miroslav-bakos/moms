'use strict';
const assert=require('node:assert/strict');
const {summarize}=require('../src/services/profitability');
const model={products:[],materials:[],rules:[],aliases:{}};
const snapshot={amount:'2.000000',currency:'EUR',missing:[],products:[{name:'Cup',quantity:1}]};
const order={channel:'sashe',profit_month:'2026-10',revenue_amount:'10.10',revenue_currency:'EUR',consumed:true,cost_snapshot:snapshot,entered_currency:'EUR',shipping_cost:'1',marketplace_fee:'0.10',payment_fee:'0',other_cost:'0'};
let result=summarize([order,{...order,revenue_amount:'0.20'}],model);
assert.equal(result.totals[0].profit,'4.100000');assert.equal(result.totals[0].revenue,'10.300000');
assert.equal(result.products[0].label,'Cup');assert.equal(result.products[0].complete,2);
result=summarize([order,{...order,shipping_cost:null},{...order,business_outcome:'refunded'},{...order,revenue_currency:'USD'},
 {...order,consumed:false,production_complete:true},{...order,cost_snapshot:{...snapshot,products:[{name:'Cup'},{name:'Plate'}]}}],model);
assert.equal(result.totals[0].orders,6);assert.equal(result.totals[0].complete,2);assert.equal(result.totals[0].missing,4);
assert.equal(result.totals[0].profit,'14.000000');assert.equal(result.products.find(p=>p.label===null).complete,1);
result=summarize([{...order,shipping_cost:null}],model);assert.equal(result.totals[0].profit,null);
result=summarize([order,{...order,entered_currency:'USD',revenue_currency:'USD',cost_snapshot:{...snapshot,currency:'USD'}}],model);
assert.equal(result.totals.length,2);assert.deepEqual(result.totals.map(r=>r.profit),['7.000000','7.000000']);
result=summarize([{...order,revenue_amount:'0'}],model);assert.equal(result.totals[0].profit,'-3.100000');assert.equal(result.totals[0].margin_percent,null);
assert.deepEqual(summarize([],model),{totals:[],channels:[],months:[],products:[]});
console.log('PASS profitability: exact sums, losses, missing/historical costs, refunds, currencies and unallocated mixed products');
