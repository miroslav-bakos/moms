const {withClient,query}=require('../db');
const {config}=require('../config');
const etsy=require('../channels/etsy');
const adapters={amazon:require('../channels/amazon'),shopify:require('../channels/shopify')};
function identity(channel){return channel==='etsy'?String(config.etsy.shopId):channel==='shopify'?adapters.shopify.dispatchIdentity():config.amazon.regionGroup+':'+require('crypto').createHash('sha256').update(config.amazon.refreshToken||'').digest('hex');}
function fail(message,statusCode=409){const error=new Error(message);error.statusCode=statusCode;throw error;}
function found(receipt,tracking,carrier){const normalized=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[ _]+/g,'-');return Array.isArray(receipt?.shipments)&&receipt.shipments.some(s=>String(s.tracking_code||'')===tracking&&(!carrier||normalized(s.carrier_name)===carrier));}
async function dispatch(id,shipmentId,carrier='other'){
 if(!['gls','slovenska-posta','other'].includes(carrier))fail('Choose a valid shipping carrier.',400);
 if(!Number.isSafeInteger(Number(id))||Number(id)<=0||typeof shipmentId!=='string'||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(shipmentId))fail('Invalid shipment ID',400);
 const attempt=await withClient(async client=>{
  await client.query('BEGIN');try{
   const order=(await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!order||!['etsy','amazon','shopify'].includes(order.channel)||!(order.channel==='amazon'?/^\d{3}-\d{7}-\d{7}$/:/^\d+$/).test(String(order.external_order_id))||order.business_outcome!=='active')fail('Only active Etsy, Amazon and Shopify orders support marketplace dispatch.');
   const shop=identity(order.channel);
   const shipment=(await client.query('SELECT * FROM order_shipments WHERE order_id=$1 AND id=$2',[id,shipmentId])).rows[0];
   if(!shipment||shipment.canceled_at||!shipment.tracking_code.trim())fail('Add a shipment with tracking before sending to the marketplace.');
   const previous=(await client.query('SELECT * FROM marketplace_dispatches WHERE order_id=$1',[id])).rows[0];
   if(order.channel==='amazon'){
    const labelMatches=order.tracking_code===shipment.tracking_code;
    const gls=/gls-group\.eu/i.test(shipment.tracking_url||'')||(labelMatches&&/GLS/i.test(order.label_url||''));
    carrier=previous&&previous.state!=='rejected'&&carrier==='other'?previous.carrier_name:gls?'gls':carrier==='gls'?'gls':'slovenska-posta';
   }
   if(previous&&(previous.shipment_id!==shipmentId||previous.tracking_code!==shipment.tracking_code||previous.shop_id!==shop||previous.channel!==order.channel||previous.receipt_id!==String(order.external_order_id)))fail('The marketplace dispatch identity changed. Review it on the marketplace.');
   if(previous&&previous.carrier_name!==carrier&&previous.state!=='rejected')fail('The marketplace dispatch identity changed. Review it on the marketplace.');
   if(previous?.state==='confirmed'){await client.query('COMMIT');return {...previous,write:false};}
   const lines=(await client.query('SELECT l.source_key,l.quantity,sl.quantity AS shipped_quantity FROM order_lines l LEFT JOIN order_shipment_lines sl ON sl.line_id=l.id AND sl.shipment_id=$2 WHERE l.order_id=$1',[id,shipmentId])).rows;
   if(!lines.length||lines.some(l=>Number(l.quantity)!==Number(l.shipped_quantity)))fail('Marketplace dispatch requires one shipment covering the complete order.');
   if(!(await require('./inventory').isComplete(client,order)))fail('Complete production before sending to the marketplace.');
   const write=!previous||previous.state==='rejected';
   if(order.channel!=='etsy'&&lines.some(l=>!/^\d+$/.test(l.source_key)))fail('Original marketplace line IDs are missing. Review the order before dispatch.');
   const payload={items:lines.map(l=>({id:l.source_key,quantity:Number(l.quantity)})),ship_date:shipment.created_at,tracking_url:shipment.tracking_url};
   const record=(await client.query("INSERT INTO marketplace_dispatches(order_id,shipment_id,channel,shop_id,receipt_id,tracking_code,carrier_name,state,request_payload) VALUES($1,$2,$3,$4,$5,$6,$7,'uncertain',$8) ON CONFLICT(order_id) DO UPDATE SET carrier_name=CASE WHEN marketplace_dispatches.state='rejected' THEN EXCLUDED.carrier_name ELSE marketplace_dispatches.carrier_name END,request_payload=CASE WHEN marketplace_dispatches.state='rejected' THEN EXCLUDED.request_payload ELSE marketplace_dispatches.request_payload END,state=CASE WHEN marketplace_dispatches.state='rejected' THEN 'uncertain' ELSE marketplace_dispatches.state END,updated_at=now() RETURNING *",[id,shipmentId,order.channel,shop,String(order.external_order_id),shipment.tracking_code,carrier,JSON.stringify(payload)])).rows[0];
   await client.query('COMMIT');return {...record,write};
  }catch(error){await client.query('ROLLBACK');throw error;}
 });
 if(attempt.state==='confirmed')return {state:'confirmed'};
 if(attempt.channel!=='etsy')return dispatchOther(attempt);
 const update=state=>query('UPDATE marketplace_dispatches SET state=$2,updated_at=now() WHERE order_id=$1 AND state<>\'confirmed\'',[id,state]);
 let receipt;
 try{receipt=await etsy.getReceiptShipment(attempt.receipt_id);}
 catch(_){if(attempt.write)await update('rejected');return {state:attempt.write?'rejected':'uncertain'};}
 if(found(receipt,attempt.tracking_code,attempt.carrier_name)){await update('confirmed');return {state:'confirmed'};}
 if(found(receipt,attempt.tracking_code)||!attempt.write)return {state:'uncertain'};
 try{await etsy.sendReceiptShipment(attempt.receipt_id,attempt.tracking_code,attempt.carrier_name);}
 catch(error){if(error.httpStatus>=400&&error.httpStatus<500){await update('rejected');return {state:'rejected',...(error.dispatchMessage?{message:error.dispatchMessage}:{})};}return {state:'uncertain'};}
 await update('confirmed');return {state:'confirmed'};
}
async function dispatchOther(attempt){
 const adapter=adapters[attempt.channel];
 const update=state=>query('UPDATE marketplace_dispatches SET state=$2,updated_at=now() WHERE order_id=$1 AND state<>\'confirmed\'',[attempt.order_id,state]);
 let remote;
 try{remote=await adapter.getDispatchOrder(attempt.receipt_id);}
 catch(_){if(attempt.write)await update('rejected');return {state:attempt.write?'rejected':'uncertain'};}
 if(adapter.dispatchFound(attempt,remote)){await update('confirmed');return {state:'confirmed'};}
 if(!attempt.write)return {state:'uncertain'};
 if(attempt.channel==='amazon'){const existing=adapter.existingDispatchPackage(attempt,remote);if(existing){await query("UPDATE marketplace_dispatches SET package_reference_id=$2,state='confirmed',updated_at=now() WHERE order_id=$1",[attempt.order_id,String(existing.packageReferenceId)]);return {state:'confirmed'};}}
 try{
  const payload={...attempt.request_payload,remote:adapter.prepareDispatch(attempt,remote)};
  await query('UPDATE marketplace_dispatches SET request_payload=$2,updated_at=now() WHERE order_id=$1',[attempt.order_id,JSON.stringify(payload)]);
  attempt.request_payload=payload;
 }catch(_){await update('rejected');return {state:'rejected'};}
 try{await adapter.sendDispatch(attempt);}
 catch(error){if(error.httpStatus>=400&&error.httpStatus<500&&error.httpStatus!==408){await update('rejected');return {state:'rejected'};}return {state:'uncertain'};}
 await update('confirmed');return {state:'confirmed'};
}
module.exports={dispatch,found};
