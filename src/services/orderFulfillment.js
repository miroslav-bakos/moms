const {withClient}=require('../db');
const {expandOrder,allocateUnitBatches,round,complete}=require('./productionMath');
function fail(message,code=400){const error=new Error(message);error.statusCode=code;throw error;}
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const quantity=value=>Number.isSafeInteger(value)&&value>0&&value<=1000000;
function text(value,max=2000){if(value==null)return '';if(typeof value!=='string'||value.length>max||/[\x00-\x1f]/.test(value))fail('Invalid fulfillment field.');return value.trim();}
function publicUrl(value){const raw=text(value);if(!raw)return '';try{const url=new URL(raw);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw 0;return url.href;}catch(_){fail('Enter a valid HTTP or HTTPS link.');}}
async function transaction(id,fn){
 if(!Number.isSafeInteger(Number(id))||Number(id)<=0)fail('Invalid order ID');
 return withClient(async client=>{await client.query('BEGIN');try{
  const order=(await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!order)fail('Order not found',404);
  const result=await fn(client,order);await client.query('COMMIT');return result;
 }catch(error){await client.query('ROLLBACK');throw error;}});
}
async function ensureLines(client,order){
 let lines=(await client.query('SELECT * FROM order_lines WHERE order_id=$1 ORDER BY id',[order.id])).rows;
 const frozen=await client.query('SELECT order_id FROM order_inventory WHERE order_id=$1 AND consumed=true UNION SELECT order_id FROM order_shipments WHERE order_id=$1 UNION SELECT order_id FROM order_returns WHERE order_id=$1',[order.id]);
 if(lines.length&&frozen.rowCount)return lines;
 const raw=!order.skus_locked&&Array.isArray(order.raw_skus)&&order.raw_skus.length?order.raw_skus:String(order.skus||'').split(/\n|,/).filter(value=>value.trim()).map(sku=>({sku,quantity:1}));
 const sourceKeys=[];
 for(const [index,item]of raw.entries()){
  let sku=typeof item==='string'?item:String(item.sku||''),qty=typeof item==='string'?1:Number(item.quantity||1);
  const suffix=sku.match(/^(.*?)\s+[x×]\s*(\d+)$/i);if(suffix){sku=suffix[1];qty*=Number(suffix[2]);}
  if(!sku.trim()||!quantity(qty))fail('Review order line quantities before fulfillment.',409);
  const sourceKey=String(item.source_id||item.id||index);sourceKeys.push(sourceKey);
  await client.query('INSERT INTO order_lines(order_id,source_key,sku,quantity) VALUES($1,$2,$3,$4) ON CONFLICT(order_id,source_key) DO UPDATE SET sku=EXCLUDED.sku,quantity=EXCLUDED.quantity,material_snapshot=NULL,inventory_snapshot=NULL',[order.id,sourceKey,sku.trim(),qty]);
 }
 if(!frozen.rowCount)await client.query('DELETE FROM order_lines WHERE order_id=$1 AND NOT(source_key=ANY($2::text[]))',[order.id,sourceKeys]);
 return (await client.query('SELECT * FROM order_lines WHERE order_id=$1 ORDER BY id',[order.id])).rows;
}
async function capture(client,order,model,snapshot){
 const lines=await ensureLines(client,order),allocations=[],totals={};
 const available=Object.fromEntries(model.products.map(product=>[product.id,Number(product.stock || 0)]));
 const entryKey=entry=>entry.product_id?'p:'+entry.product_id:'m:'+entry.material_id;
 for(const line of lines){
  const expanded=expandOrder({...order,skus:line.sku,raw_skus:[{sku:line.sku,quantity:line.quantity}],skus_locked:false},model.rules,model.aliases);
  const batches=allocateUnitBatches(expanded.totals,model.products,available,line.quantity);
  allocations.push([line.id,batches]);
  for(const batch of batches)for(const entry of batch.snapshot){const key=entryKey(entry);totals[key]=round((totals[key] || 0)+entry.quantity*batch.quantity);}
 }
 const expected=Object.fromEntries(snapshot.map(entry=>[entryKey(entry),round(Number(entry.quantity))]));
 if([...new Set([...Object.keys(totals),...Object.keys(expected)])].some(key=>round(totals[key] || 0)!==round(expected[key] || 0)))return;
 for(const [id,batches]of allocations){
  // Legacy readers retain their exact material snapshot for homogeneous material-only lines.
  const materials=batches.length===1&&!batches[0].snapshot.some(entry=>entry.product_id)?batches[0].snapshot:null;
  await client.query('UPDATE order_lines SET material_snapshot=$1,inventory_snapshot=$2 WHERE id=$3',[JSON.stringify(materials),JSON.stringify(batches),id]);
 }
}
// Restore the next returned units from the frozen allocation, including mixed stock/material lines.
function returnedSnapshot(batches,start,quantity){
 const totals=new Map();let offset=0;
 for(const batch of batches){
  const from=Math.max(0,Math.min(batch.quantity,start-offset));
  const to=Math.max(from,Math.min(batch.quantity,start+quantity-offset));
  for(const entry of batch.snapshot){const key=entry.product_id?'p:'+entry.product_id:'m:'+entry.material_id;const previous=totals.get(key)||{...entry,quantity:0};const delta=round(round(Number(entry.quantity)*to)-round(Number(entry.quantity)*from));previous.quantity=round(previous.quantity+delta);totals.set(key,previous);}
  offset+=batch.quantity;
 }
 if(start+quantity>offset)fail('Return exceeds recorded inventory allocation.',409);
 return [...totals.values()].filter(entry=>entry.quantity>0);
}
async function model(client,order){
 const lines=await ensureLines(client,order);
 const shipments=(await client.query('SELECT * FROM order_shipments WHERE order_id=$1 ORDER BY created_at,id',[order.id])).rows;
 const allocations=(await client.query('SELECT sl.* FROM order_shipment_lines sl JOIN order_shipments s ON s.id=sl.shipment_id WHERE s.order_id=$1',[order.id])).rows;
 const returns=(await client.query('SELECT * FROM order_returns WHERE order_id=$1 ORDER BY created_at,id',[order.id])).rows;
 const record=(await client.query('SELECT consumed FROM order_inventory WHERE order_id=$1',[order.id])).rows[0];
 const dispatches=(await client.query('SELECT shipment_id,state,carrier_name FROM marketplace_dispatches WHERE order_id=$1',[order.id])).rows;
 const consumed=record?Boolean(record.consumed):await require('./inventory').isComplete(client,order);
 return {channel:order.channel,business_outcome:order.business_outcome,produced:consumed,lines:lines.map(line=>{const shipped=allocations.filter(a=>Number(a.line_id)===Number(line.id)&&!shipments.find(s=>s.id===a.shipment_id)?.canceled_at).reduce((sum,a)=>sum+a.quantity,0);return {...line,shipped,remaining:line.quantity-shipped,remaining_to_produce:consumed?0:line.quantity};}),shipments:shipments.map(s=>({...s,marketplace_carrier:dispatches.find(d=>d.shipment_id===s.id)?.carrier_name||'',marketplace_dispatch:dispatches.find(d=>d.shipment_id===s.id)?.state||'local',lines:allocations.filter(a=>a.shipment_id===s.id)})),returns};
}
async function get(id){return transaction(id,model);}
async function ship(id,body){
 if(!uuid(body?.request_key)||!Array.isArray(body.lines)||!body.lines.length||body.lines.length>500||body.lines.some(line=>!Number.isSafeInteger(Number(line.line_id))||!quantity(line.quantity))||new Set(body.lines.map(line=>Number(line.line_id))).size!==body.lines.length)fail('Choose valid shipment quantities.');
 const tracking=text(body.tracking_code,200),url=publicUrl(body.tracking_url);
 return transaction(id,async(client,order)=>{
  const existing=(await client.query('SELECT * FROM order_shipments WHERE request_key=$1',[body.request_key])).rows[0];
  if(existing){const allocations=(await client.query('SELECT line_id,quantity FROM order_shipment_lines WHERE shipment_id=$1 ORDER BY line_id',[existing.id])).rows;const canonical=lines=>JSON.stringify(lines.map(l=>({line_id:Number(l.line_id),quantity:l.quantity})).sort((a,b)=>a.line_id-b.line_id));if(Number(existing.order_id)!==Number(id)||existing.tracking_code!==tracking||existing.tracking_url!==url||canonical(allocations)!==canonical(body.lines))fail('Request key was already used for another operation.',409);return existing;}
  const view=await model(client,order);if(!view.produced||order.business_outcome!=='active')fail('Complete production and use an active order before shipping.',409);
  for(const allocation of body.lines){const line=view.lines.find(line=>Number(line.id)===Number(allocation.line_id));if(!line||allocation.quantity>line.remaining)fail('Shipment exceeds remaining quantity.',409);}
  const shipment=(await client.query('INSERT INTO order_shipments(order_id,request_key,tracking_code,tracking_url) VALUES($1,$2,$3,$4) RETURNING *',[id,body.request_key,tracking,url])).rows[0];
  for(const line of body.lines)await client.query('INSERT INTO order_shipment_lines(shipment_id,line_id,quantity) VALUES($1,$2,$3)',[shipment.id,line.line_id,line.quantity]);
  return shipment;
 });
}
async function cancel(id,shipmentId){if(!uuid(shipmentId))fail('Invalid shipment ID');return transaction(id,async(client)=>{
 if((await client.query("SELECT order_id FROM marketplace_dispatches WHERE order_id=$1 AND shipment_id=$2 AND state IN ('confirmed','uncertain')",[id,shipmentId])).rowCount)fail('Review the marketplace dispatch before canceling this shipment.',409);
 const returns=(await client.query("SELECT id FROM order_returns WHERE order_id=$1 AND kind='return' LIMIT 1",[id])).rows;
 if(returns.length)fail('Recorded returns prevent shipment cancellation.',409);
 const shipment=(await client.query('UPDATE order_shipments SET canceled_at=COALESCE(canceled_at,now()) WHERE id=$1 AND order_id=$2 RETURNING *',[shipmentId,id])).rows[0];if(!shipment)fail('Shipment not found',404);return shipment;
});}
async function returnLine(id,body){
 if(!uuid(body?.request_key)||!Number.isSafeInteger(Number(body.line_id))||!quantity(body.quantity)||!['refund','return'].includes(body.kind))fail('Choose valid return quantities.');const reason=text(body.reason);
 return transaction(id,async(client,order)=>{
 const existing=(await client.query('SELECT * FROM order_returns WHERE request_key=$1',[body.request_key])).rows[0];if(existing){if(Number(existing.order_id)!==Number(id)||Number(existing.line_id)!==Number(body.line_id)||existing.quantity!==body.quantity||existing.kind!==body.kind||existing.reason!==reason)fail('Request key was already used for another operation.',409);return existing;}
 const lines=await ensureLines(client,order),line=lines.find(l=>Number(l.id)===Number(body.line_id));if(!line)fail('Order line not found',404);
 const total=Number((await client.query('SELECT COALESCE(sum(quantity),0) AS total FROM order_returns WHERE line_id=$1 AND kind=$2',[body.line_id,body.kind])).rows[0].total);if(total+body.quantity>line.quantity)fail('Return exceeds order quantity.',409);
 if(body.kind==='return'){const view=await model(client,order);if(total+body.quantity>view.lines.find(l=>Number(l.id)===Number(body.line_id)).shipped)fail('Return exceeds shipped quantity.',409);}
 const returned=(await client.query('INSERT INTO order_returns(order_id,line_id,quantity,kind,reason,request_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[id,body.line_id,body.quantity,body.kind,reason,body.request_key])).rows[0];
 const totals=(await client.query('SELECT line_id,sum(quantity) AS quantity FROM order_returns WHERE order_id=$1 AND kind=$2 GROUP BY line_id',[id,body.kind])).rows;
 const wholeOrder=lines.every(line=>Number(totals.find(row=>Number(row.line_id)===Number(line.id))?.quantity||0)>=Number(line.quantity));
 if(wholeOrder && order.business_outcome==='active')await client.query('UPDATE orders SET business_outcome=$1,business_outcome_locked=true,updated_at=now() WHERE id=$2',[body.kind==='refund'?'refunded':'returned',id]);
 return returned;
 });
}
async function receive(id,returnId,body){if(!uuid(returnId)||typeof body?.restock!=='boolean')fail('Choose whether received materials should be restored.');return transaction(id,async(client)=>{
 const returned=(await client.query('SELECT * FROM order_returns WHERE id=$1 AND order_id=$2 FOR UPDATE',[returnId,id])).rows[0];if(!returned||returned.kind!=='return')fail('Return not found',404);
 if(returned.received_at){if(returned.restocked!==body.restock)fail('Return was already received with a different stock decision.',409);return returned;}
 const line=(await client.query('SELECT * FROM order_lines WHERE id=$1',[returned.line_id])).rows[0];
 if(body.restock){
  if(!Array.isArray(line.inventory_snapshot)&&!Array.isArray(line.material_snapshot))fail('No recorded material allocation. Receive without restocking and review inventory manually.',409);
  if(!(await client.query('SELECT consumed FROM order_inventory WHERE order_id=$1',[id])).rows[0]?.consumed)fail('Production is reopened. Materials cannot be restored twice.',409);
  await client.query('SELECT id FROM inventory_config_lock WHERE id=true FOR UPDATE');
  const previous=Number((await client.query('SELECT COALESCE(sum(quantity),0) AS quantity FROM order_returns WHERE line_id=$1 AND received_at IS NOT NULL AND restocked=true',[line.id])).rows[0].quantity);
  const snapshot=Array.isArray(line.inventory_snapshot)?returnedSnapshot(line.inventory_snapshot,previous,returned.quantity):line.material_snapshot.map(entry=>({...entry,quantity:round(round(Number(entry.quantity)*(previous+returned.quantity))-round(Number(entry.quantity)*previous))}));
  await require('./inventory').applyInventorySnapshot(client,snapshot,1,id,'Received return');
 }
 return (await client.query('UPDATE order_returns SET received_at=now(),restocked=$1 WHERE id=$2 RETURNING *',[body.restock,returnId])).rows[0];
});}
async function label(id,shipmentId,save){if(!uuid(shipmentId))fail('Invalid shipment ID');return transaction(id,async(client)=>{
 const shipment=(await client.query('SELECT id FROM order_shipments WHERE id=$1 AND order_id=$2',[shipmentId,id])).rows[0];if(!shipment)fail('Shipment not found',404);
 const url=await save();return (await client.query('UPDATE order_shipments SET label_url=$1 WHERE id=$2 RETURNING *',[url,shipmentId])).rows[0];
});}
module.exports={get,ship,cancel,returnLine,receive,capture,ensureLines,publicUrl,label,returnedSnapshot};
