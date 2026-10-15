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
 // Explicit replacement keeps the old label until completion and permits only one caller.
 const replacements=await Promise.allSettled([service.acquire(second,'posta:parcel','/labels/fixture.pdf'),service.acquire(second,'gls','/labels/fixture.pdf')]);
 assert.equal(replacements.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(replacements.filter(r=>r.status==='rejected').length,1);
 assert.equal((await db.query('SELECT label_url FROM orders WHERE id=$1',[second])).rows[0].label_url,'/labels/fixture.pdf');
 let operation=(await db.query('SELECT * FROM label_operations WHERE order_id=$1',[second])).rows[0];
 assert.equal(operation.provider_refs.history[0].labelUrl,'/labels/fixture.pdf');
 await service.prepare(second,outcome,'new','https://example.invalid/new','/labels/new.pdf');
 await assert.rejects(service.acquire(second,'gls','/labels/fixture.pdf'),/has changed/);
 await service.acquire(second,'gls','/labels/new.pdf');await service.failed(second);
 await assert.rejects(service.acquire(second,'gls','/labels/new.pdf'),/carrier portal/);
 assert.equal((await db.query('SELECT label_url FROM orders WHERE id=$1',[second])).rows[0].label_url,'/labels/new.pdf');
 // Uploaded/legacy labels have no operation row and can also be replaced.
 const fourth=await create('LABEL-OP-4');await db.query("UPDATE orders SET label_created=true,label_url='/labels/upload.pdf' WHERE id=$1",[fourth]);
 await assert.rejects(service.acquire(fourth,'gls'),/already has a label/);
 assert.equal(await service.acquire(fourth,'gls','/labels/upload.pdf'),null);
 // A prepared result needs recovery before a new shipment may be created.
 await db.query("UPDATE label_operations SET state='prepared' WHERE order_id=$1",[fourth]);
 await assert.rejects(service.acquire(fourth,'gls','/labels/upload.pdf'),/carrier portal/);
 console.log('PASS isolated label concurrency, uncertain-outcome refusal, durable re-download and crash recovery without carrier writes.');
};
