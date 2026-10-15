'use strict';
const {query,withClient}=require('../db');
function uncertain(){const error=new Error('A label request may already exist for this order. Check the carrier portal and contact support before creating another shipment.');error.statusCode=409;return error;}
function changed(){const error=new Error('The saved label has changed. Reload the orders and confirm replacement again.');error.statusCode=409;return error;}
async function replace(orderId,carrier,expectedLabelUrl){
 return withClient(async client=>{await client.query('BEGIN');try{
  const order=(await client.query('SELECT label_created,label_url,tracking_code,tracking_url FROM orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];
  const row=(await client.query('SELECT * FROM label_operations WHERE order_id=$1 FOR UPDATE',[orderId])).rows[0];
  // Never reset an in-flight, prepared or ambiguous carrier request.
  if(row && row.state!=='completed')throw uncertain();
  if(!order || !(order.label_created || order.label_url) || (order.label_url || '')!==expectedLabelUrl)throw changed();
  const {history=[],...refs}=row?.provider_refs || {};
  const previous={carrier:row?.carrier || null,labelUrl:order.label_url,trackingNumber:order.tracking_code,trackingUrl:order.tracking_url,providerRefs:refs};
  const providerRefs=JSON.stringify({history:[...history,previous]});
  await client.query("INSERT INTO label_operations(order_id,carrier,state,provider_refs) VALUES($1,$2,'started',$3::jsonb) ON CONFLICT(order_id) DO UPDATE SET carrier=$2,state='started',provider_refs=$3::jsonb,outcome=NULL,updated_at=now()",[orderId,carrier,providerRefs]);
  await client.query('COMMIT');return null;
 }catch(error){await client.query('ROLLBACK');throw error;}});
}
async function acquire(orderId,carrier,expectedLabelUrl){
 if(typeof expectedLabelUrl==='string')return replace(orderId,carrier,expectedLabelUrl);
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
