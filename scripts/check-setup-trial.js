const assert=require('node:assert/strict');
const inventoryPath=require.resolve('../src/services/inventory');
const model={materials:[{id:'m',name:'Thread',unit:'m',stock:1}],products:[{id:'p',name:'Product',stock:1,recipe:[{material_id:'m',quantity:2}]}],rules:[{sku:'A',components:[{product_id:'p',quantity:2}]}],aliases:{}};
require.cache[inventoryPath]={id:inventoryPath,filename:inventoryPath,loaded:true,exports:{config:async()=>structuredClone(model)}};
const {preview}=require('../src/services/setupTrial');
(async()=>{
 const original=JSON.stringify(model);const result=await preview({sku:'A'});
 assert.deepEqual(result.products,[{name:'Product',required:2,from_stock:1,to_produce:1}]);assert.deepEqual(result.materials,[{name:'Thread',unit:'m',required:2,missing:1}]);assert.equal(JSON.stringify(model),original);
 for(const sku of ['',null,'A,B','A\nB','unknown','x'.repeat(201)])await assert.rejects(()=>preview({sku}),e=>e.statusCode===400);
 model.products[0].stock=0;model.materials[0].stock=-1;assert.equal((await preview({sku:'A'})).materials[0].missing,5);
 console.log('PASS read-only setup trial: finished allocation, shortage, validation and no writes');
})().catch(e=>{console.error(e);process.exitCode=1;});
