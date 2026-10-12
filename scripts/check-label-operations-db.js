'use strict';
const assert=require('node:assert/strict');
module.exports=async db=>{
 const service=require('../src/services/labelOperations');
 const create=async id=>(await db.query("INSERT INTO orders(channel,vendor,external_order_id) VALUES('manual','Fixture',$1) RETURNING id",[id])).rows[0].id;
 const first=await create('LABEL-OP-1');const results=await Promise.allSettled([service.acquire(first,'gls'),service.acquire(first,'gls')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 await service.checkpoint(first,{trackingNumber:'fixture'});await service.failed(first);await assert.rejects(service.acquire(first,'gls'),/carrier portal/);
 const second=await create('LABEL-OP-2');await service.acquire(second,'gls');const outcome={downloads:[{fileName:'fixture.pdf',pdfBase64:'JVBERi1maXh0dXJl'}],results:[{orderId:second,success:true}]};await service.prepare(second,outcome,'fixture','https://example.invalid/track','/labels/fixture.pdf');assert.deepEqual(await service.acquire(second,'gls'),outcome);await assert.rejects(service.acquire(second,'posta:parcel'));
 // Simulate a crash after the durable PDF write but before the atomic order update.
 const third=await create('LABEL-OP-3');await service.acquire(third,'gls');await db.query("UPDATE label_operations SET state='prepared',outcome=$2,provider_refs=$3 WHERE order_id=$1",[third,outcome,{completion:{trackingNumber:'recovered',labelUrl:'/labels/recovered.pdf'}}]);assert.deepEqual(await service.acquire(third,'gls'),outcome);const order=(await db.query('SELECT label_created,tracking_code FROM orders WHERE id=$1',[third])).rows[0];assert(order.label_created);assert.equal(order.tracking_code,'recovered');
 console.log('PASS isolated label concurrency, uncertain-outcome refusal, durable re-download and crash recovery without carrier writes.');
};
