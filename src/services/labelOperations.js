'use strict';
const {query,withClient}=require('../db');
function uncertain(){const error=new Error('A label request may already exist for this order. Check the carrier portal and contact support before creating another shipment.');error.statusCode=409;return error;}
async function acquire(orderId,carrier){
 const inserted=await query("INSERT INTO label_operations(order_id,carrier,state) SELECT id,$2,'started' FROM orders WHERE id=$1 AND NOT label_created ON CONFLICT DO NOTHING RETURNING order_id",[orderId,carrier]);
 if(inserted.rowCount)return null;
 const row=(await query('SELECT * FROM label_operations WHERE order_id=$1',[orderId])).rows[0];
 if(row?.state==='prepared'&&row.carrier===carrier&&row.outcome){const details=row.provider_refs.completion||{};await complete(orderId,row.outcome,details.trackingNumber,details.trackingUrl,details.labelUrl);return row.outcome;}
 if(row?.state==='completed'&&row.carrier===carrier&&row.outcome)return row.outcome;
 if(row)throw uncertain();
 const error=new Error('This order already has a label. Download the saved label from the order instead of creating another shipment.');error.statusCode=409;throw error;
}
async function checkpoint(orderId,refs){await query('UPDATE label_operations SET provider_refs=provider_refs || $2::jsonb,updated_at=now() WHERE order_id=$1',[orderId,JSON.stringify(refs)]);}
async function failed(orderId){await query("UPDATE label_operations SET state='uncertain',updated_at=now() WHERE order_id=$1 AND state='started'",[orderId]);}
async function complete(orderId,outcome,trackingNumber,trackingUrl,labelUrl){
 await withClient(async client=>{await client.query('BEGIN');try{
  await client.query("UPDATE orders SET label_created=true,tracking_code=COALESCE(NULLIF($2,''),tracking_code),tracking_url=COALESCE(NULLIF($3,''),tracking_url),label_url=COALESCE(NULLIF($4,''),label_url),updated_at=now() WHERE id=$1",[orderId,trackingNumber||'',trackingUrl||'',labelUrl||'']);
  await client.query("UPDATE label_operations SET state='completed',outcome=$2::jsonb,updated_at=now() WHERE order_id=$1",[orderId,JSON.stringify(outcome)]);
  await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}});
}
async function prepare(orderId,outcome,trackingNumber,trackingUrl,labelUrl){
 await query("UPDATE label_operations SET state='prepared',outcome=$2::jsonb,provider_refs=provider_refs || $3::jsonb,updated_at=now() WHERE order_id=$1",[orderId,JSON.stringify(outcome),JSON.stringify({completion:{trackingNumber,trackingUrl,labelUrl}})]);
 await complete(orderId,outcome,trackingNumber,trackingUrl,labelUrl);
}
module.exports={acquire,checkpoint,failed,prepare,complete};
