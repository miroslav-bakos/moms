const assert=require('assert/strict');
const {expandOrder,productionDemand}=require('../src/services/productionMath');
const products=[{id:'munari',name:'Munari',recipe:[{material_id:'paper',quantity:0.5},{material_id:'thread',quantity:1.2}]},{id:'holder',name:'Holder',recipe:[{material_id:'wood',quantity:1}]}];
const rules=[{sku:'5setorange',components:[{product_id:'munari',quantity:1}]},{sku:'holder',components:[{product_id:'holder',quantity:1}]}];
const order={workflow_status:'new',raw_skus:[{sku:'5setorange + holder',quantity:2}],skus:'5setorange + holder x2'};
assert.deepEqual(expandOrder(order,rules).totals,{munari:2,holder:2});
assert.deepEqual(productionDemand([order],products,rules).needs,{paper:1,thread:2.4,wood:2});
for(const status of ['crafted','ready_for_pickup','shipped'])assert.equal(productionDemand([{...order,workflow_status:status}],products,rules).products[0].required,0);
assert.deepEqual(expandOrder({...order,raw_skus:[{sku:'external-number',quantity:1}],skus:'5setorange x3',skus_locked:true},rules).totals,{munari:3});
assert.deepEqual(expandOrder({...order,skus:'5setorange x3',raw_skus:[{sku:'external-number',quantity:3}]},rules).totals,{munari:3});
assert(expandOrder({skus:'other'},rules).unmapped.includes('other'));
const wildcard=[{sku:'*set*',components:[{product_id:'holder',quantity:10}]},...rules];
assert.equal(expandOrder(order,wildcard).totals.munari,2);
const combined=[...rules,{sku:'5setorange + holder',components:[{product_id:'munari',quantity:5}]}];
assert.deepEqual(expandOrder(order,combined).totals,{munari:10});
assert.deepEqual(expandOrder({skus:'5setorange x2 + holder x3',skus_locked:true},rules).totals,{munari:2,holder:3});
assert.deepEqual(expandOrder({raw_skus:[{sku:'12345',quantity:2}],skus:'Mapped set'},rules,{'12345':'5setorange + holder'}).totals,{munari:2,holder:2});
assert.deepEqual(expandOrder({skus:''},rules).unmapped,['Unknown SKU']);
const stocked=productionDemand([order],products.map(product=>({...product,stock:product.id==='munari'?1:6})),rules);
assert.deepEqual(stocked.needs,{paper:0.5,thread:1.2,wood:0});
assert.equal(stocked.products[0].from_stock,1);assert.equal(stocked.products[0].to_produce,1);assert.equal(stocked.products[1].after_queue,4);
const {allocateUnitBatches}=require('../src/services/productionMath');
assert.deepEqual(allocateUnitBatches({munari:3},products,{munari:2},3),[
 {quantity:2,snapshot:[{product_id:'munari',quantity:1}]},
 {quantity:1,snapshot:[{material_id:'paper',quantity:0.5},{material_id:'thread',quantity:1.2}]}
]);
const combinedBatches=allocateUnitBatches({munari:4,holder:4},products,{munari:1,holder:3},4);
assert.deepEqual(combinedBatches.map(batch=>batch.quantity),[1,2,1]);
assert.equal(combinedBatches[1].snapshot.find(entry=>entry.product_id==='holder').quantity,1);
assert.equal(combinedBatches[1].snapshot.find(entry=>entry.material_id==='paper').quantity,0.5);
console.log('Production math: composite SKUs, quantities, exact precedence, mapped aliases, fractional recipes and completed exclusions passed');
const {queueReservations}=require('../src/services/productionMath');
const queue=[{id:2,external_order_id:'Late',skus:'A',ship_by_date:'2026-10-10'},{id:1,external_order_id:'Early',skus:'A',ship_by_date:'2026-10-09'},{id:3,skus:'A',shipped:true}];
const reserveProducts=[{id:'p',stock:1,recipe:[{material_id:'m',quantity:2}]}],reserveMaterials=[{id:'m',stock:1}],reserveRules=[{sku:'A',components:[{product_id:'p',quantity:1}]}];
const source=JSON.stringify(queue);const plan=queueReservations(queue,reserveProducts,reserveMaterials,reserveRules);
assert.equal(plan.allocations.length,2);assert.equal(plan.allocations[0].order_id,1);assert.equal(plan.allocations[0].products[0].reserved,1);assert.equal(plan.allocations[1].products[0].reserved,0);assert.equal(plan.allocations[1].materials[0].missing,1);assert.deepEqual(plan.products,[{product_id:'p',reserved:1,available:0,missing:1}]);assert.deepEqual(plan.materials,[{material_id:'m',reserved:1,available:0,missing:1}]);assert.equal(JSON.stringify(queue),source);
const ties=queueReservations([{id:5,skus:'A'},{id:4,skus:'A'}],reserveProducts,reserveMaterials,reserveRules);assert.equal(ties.allocations[0].order_id,4);
const combinedPlan=queueReservations([{id:6,skus:'A + A'}],reserveProducts,reserveMaterials,reserveRules);assert.equal(combinedPlan.allocations[0].products[0].to_produce,1);
console.log('PASS queue reservations: stable deadline/date/id priority, shared stock/material pool, combinations, archive exclusion, no mutations');

assert.equal(require('../src/services/productionMath').complete({workflow_status:'crafted',production_complete:false}),false);
assert.equal(require('../src/services/productionMath').complete({workflow_status:'custom',production_complete:true}),true);

for(const business_outcome of ['canceled','refunded','returned'])assert.equal(productionDemand([{...order,business_outcome}],products,rules).products[0].required,0,'Inactive business outcomes do not demand production');
