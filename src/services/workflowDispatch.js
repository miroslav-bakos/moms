const {withClient}=require('../db');
const orders=require('./orders'),fulfillment=require('./orderFulfillment'),marketplace=require('./marketplaceDispatch');
const supported=order=>['etsy','amazon','shopify'].includes(order.channel);
function fail(message,statusCode=409){const error=new Error(message);error.statusCode=statusCode;throw error;}
function validateConfirmation(rows,status,confirmed){
 if(status!=='shipped')return;
 const targets=rows.filter(supported);
 if(targets.length&&confirmed!==true)fail('Confirm sending the shipment and tracking to the marketplace.',400);
 if(targets.some(o=>!String(o.tracking_code||'').trim()||o.business_outcome!=='active'))fail('Add tracking and use active orders before confirming marketplace dispatch.',400);
}
async function restoreSourceIds(order){
 if(order.channel==='etsy'||!Array.isArray(order.raw_skus)||!order.raw_skus.length||order.raw_skus.every(i=>i.source_id))return;
 const adapter=require('../channels/'+order.channel),remote=await adapter.getDispatchOrder(order.external_order_id);
 const candidates=order.channel==='amazon'?(remote.orderItems||[]).map(i=>({id:i.orderItemId,sku:i.product?.sellerSku,quantity:i.quantityOrdered})):(remote.lineItems?.nodes||[]).map(i=>({id:String(i.id).split('/').pop(),sku:i.sku,quantity:i.quantity}));
 const key=sku=>String(sku||'').trim().toUpperCase();
 if(candidates.length!==order.raw_skus.length||new Set(candidates.map(i=>key(i.sku))).size!==candidates.length||candidates.some(i=>!i.id||!i.sku))fail('Original marketplace line IDs cannot be matched safely. Review the order.');
 const mapped=order.raw_skus.map(i=>{const matches=candidates.filter(c=>key(c.sku)===key(i.sku)&&Number(c.quantity)===Number(i.quantity||1));if(matches.length!==1)fail('Original marketplace line IDs cannot be matched safely. Review the order.');return {...i,source_id:String(matches[0].id)};});
 if(new Set(mapped.map(i=>i.source_id)).size!==mapped.length)fail('Original marketplace line IDs cannot be matched safely. Review the order.');
 await withClient(async client=>{await client.query('BEGIN');try{
  const current=(await client.query('SELECT raw_skus,skus_locked FROM orders WHERE id=$1 FOR UPDATE',[order.id])).rows[0];
  if(JSON.stringify(current.raw_skus)!==JSON.stringify(order.raw_skus)||current.skus_locked!==order.skus_locked)fail('Order changed. Refresh and try again.');
  if((await client.query("SELECT order_id FROM marketplace_dispatches WHERE order_id=$1 AND state IN ('confirmed','uncertain')",[order.id])).rowCount)fail('Review the existing marketplace dispatch before changing line IDs.');
  const lines=(await client.query('SELECT id,source_key,sku,quantity FROM order_lines WHERE order_id=$1 ORDER BY id',[order.id])).rows;
  if(lines.length&&lines.length!==mapped.length)fail('Original marketplace line IDs cannot be matched safely. Review the order.');
  const productMap=new Map((await client.query('SELECT sku,display_name FROM products')).rows.map(p=>[key(p.sku),key(p.display_name)]));
  // One locked local line and one verified original item have an unambiguous
  // identity when quantities agree, even if the local production SKU was edited.
  const matchesFor=line=>mapped.filter(i=>(key(i.sku)===key(line.sku)||productMap.get(key(i.sku))===key(line.sku)||(current.skus_locked&&lines.length===1&&mapped.length===1))&&Number(i.quantity||1)===Number(line.quantity));
  for(const line of lines){if(matchesFor(line).length!==1)fail('Original marketplace line IDs cannot be matched safely. Review the order.');}
  if(new Set(lines.map(line=>matchesFor(line)[0].source_id)).size!==lines.length)fail('Original marketplace line IDs cannot be matched safely. Review the order.');
  // Change identities only; keep quantities, line IDs and stock snapshots intact.
  for(const line of lines)await client.query('UPDATE order_lines SET source_key=$2 WHERE id=$1',[line.id,matchesFor(line)[0].source_id]);
  await client.query('UPDATE orders SET raw_skus=$2 WHERE id=$1',[order.id,JSON.stringify(mapped)]);await client.query('COMMIT');
 }catch(error){await client.query('ROLLBACK');throw error;}});
}
async function send(id){
 const [order]=await orders.listOrders({ids:[Number(id)]});
 if(!order||!supported(order)||order.workflow_status!=='shipped'||order.business_outcome!=='active')fail('Move an active marketplace order to Shipped before confirming dispatch.');
 if(!String(order.tracking_code||'').trim())fail('Add tracking before confirming marketplace dispatch.',400);
 await restoreSourceIds(order);
 const view=await fulfillment.get(Number(id));
 const live=view.shipments.filter(s=>!s.canceled_at);
 let shipment;
 if(live.length){
  if(live.length!==1)fail('Review existing shipments before confirming complete-order dispatch.');
  shipment=live[0];if(shipment.tracking_code!==order.tracking_code)fail('Order and shipment tracking differ. Review the shipment.');
 }else{
  if(!view.lines.length||view.lines.some(l=>l.remaining!==l.quantity))fail('Review remaining quantities before confirming dispatch.');
  // Stable identity makes concurrent confirmed workflow requests create one local shipment.
  const hex=require('crypto').createHash('sha256').update('workflow-dispatch:'+id+':'+order.tracking_code).digest('hex').slice(0,32);
  const requestKey=`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20)}`;
  shipment=await fulfillment.ship(Number(id),{request_key:requestKey,lines:view.lines.map(l=>({line_id:Number(l.id),quantity:l.quantity})),tracking_code:order.tracking_code,tracking_url:order.tracking_url||''});
 }
 const carrier=shipment.marketplace_carrier||(/gls-group\.eu/i.test(shipment.tracking_url)?'gls':['etsy','amazon'].includes(order.channel)&&/tandt\.posta\.sk/i.test(shipment.tracking_url)?'slovenska-posta':'other');
 return marketplace.dispatch(id,shipment.id,carrier);
}
async function withResult(order){
 if(!supported(order))return orders.updateOrderFlags(order.id,{shipped:true});
 let result;try{result=await send(order.id);}catch(error){result={state:'blocked',message:error.message};}
 const archived=await orders.updateOrderFlags(order.id,{shipped:true});
 return {...archived,marketplace_dispatch_state:result.state,dispatch_result:result};
}
async function change(id,patch){
 const [before]=await orders.listOrders({ids:[Number(id)]});if(!before)fail('Order not found',404);
 validateConfirmation([before],patch?.workflow_status,patch?.confirm_marketplace_dispatch);
 const updated=await orders.updateOrderFlags(id,patch||{});
 return patch?.workflow_status==='shipped'?withResult(updated):updated;
}
async function bulk(ids,status,confirmed){
 if(!Array.isArray(ids)||!ids.length||ids.length>500||ids.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(ids).size!==ids.length)fail('Select between 1 and 500 different orders.',400);
 const rows=await orders.listOrders({ids});if(rows.length!==ids.length)fail('Selected orders changed. Refresh and try again.');
 validateConfirmation(rows,status,confirmed);
 const updated=await orders.updateOrderWorkflow(ids,status);
 if(status!=='shipped')return updated;
 const results=[];for(const order of updated)results.push(await withResult(order));return results;
}
module.exports={change,bulk,send,validateConfirmation};
