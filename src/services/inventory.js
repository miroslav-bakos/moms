const crypto = require('crypto');
const {costValue,currency,productCost,productionCost}=require('./costMath');
const { query, withClient } = require('../db');
const { round, complete, productionDemand, allocateProducts, expandOrder, queueReservations } = require('./productionMath');
function fail(message, statusCode = 400) { const error = new Error(message); error.statusCode = statusCode; throw error; }
function text(value, limit = 100) { if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\x00-\x1f]/.test(value)) fail('Enter a valid name or unit.'); return value.trim(); }
function validId(id) { if (id && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) fail('A selected material or product no longer exists.',404); }
function amount(value, positive = false) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') fail('Enter a valid quantity (up to six decimal places).');
  if (!/^-?(?:\d+(?:\.\d{1,6})?|\.\d{1,6})$/.test(String(value).trim())) fail('Enter a valid quantity (up to six decimal places).');
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > 1000000000 || (positive && number <= 0) || Math.abs(round(number) - number) > 1e-9) fail('Enter a valid quantity (up to six decimal places).');
  return round(number);
}
async function transact(fn) {
  return withClient(async client => {
    await client.query('BEGIN');
    try { await client.query('SELECT id FROM inventory_config_lock WHERE id = true FOR UPDATE'); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); if (error.code === '23505') fail('This SKU is already configured.'); if (error.code === '23503') fail('This item is used by a recipe, SKU or stock history. Remove its references first.',409); throw error; }
  });
}
async function config(execute = query) {
  const materials = await execute('SELECT m.*, f.name AS manufacturer_name FROM inventory_materials m LEFT JOIN inventory_manufacturers f ON f.id=m.manufacturer_id ORDER BY m.name, m.id');
  const products = await execute('SELECT * FROM manufacturing_products ORDER BY name, id');
  const rules = await execute('SELECT * FROM manufacturing_skus ORDER BY sku, id');
  const mapped = await execute('SELECT sku, display_name FROM products');
  const aliases = Object.fromEntries(mapped.rows.map(row=>[row.sku.trim().toUpperCase().replace(/\s*\+\s*/g,' + '),row.display_name]));
  return {materials:materials.rows,products:products.rows,rules:rules.rows,aliases};
}
async function isComplete(client,order) {
 if(order.shipped)return true;
 const status=(await client.query('SELECT production_complete FROM order_workflow_statuses WHERE id=$1',[order.workflow_status||'new'])).rows[0];
 return Boolean(status?.production_complete);
}
async function overview(orders) {
  const model = await config();
  if (!orders) orders = (await query("SELECT o.*,s.production_complete FROM orders o JOIN order_workflow_statuses s ON s.id=o.workflow_status WHERE o.shipped=false AND o.business_outcome='active' AND NOT s.production_complete")).rows;
  const meanings=(await query('SELECT id,production_complete FROM order_workflow_statuses')).rows;
  orders=orders.map(order=>({...order,production_complete:Boolean(meanings.find(s=>s.id===order.workflow_status)?.production_complete)}));
  const demand = productionDemand(orders, model.products, model.rules, model.aliases);
  const reservations=queueReservations(orders,model.products,model.materials,model.rules,model.aliases);
  const materials = model.materials.map(material => ({...material,stock:Number(material.stock),required:demand.needs[material.id] || 0,after_queue:round(Number(material.stock)-(demand.needs[material.id] || 0))}));
  const movements = (await query(`SELECT * FROM (
    SELECT m.id, m.quantity, m.reason, m.created_at, a.name AS material_name, a.unit, o.external_order_id, 'material' AS kind
    FROM inventory_movements m JOIN inventory_materials a ON a.id=m.material_id LEFT JOIN orders o ON o.id=m.order_id
    UNION ALL
    SELECT m.id, m.quantity, m.reason, m.created_at, p.name AS material_name, 'pcs' AS unit, o.external_order_id, 'product' AS kind
    FROM finished_product_movements m JOIN manufacturing_products p ON p.id=m.product_id LEFT JOIN orders o ON o.id=m.order_id
  ) movements ORDER BY created_at DESC, kind, id DESC LIMIT 100`)).rows;
  const manufacturers = (await query('SELECT * FROM inventory_manufacturers ORDER BY name, id')).rows;
  const shopping = (await query('SELECT * FROM inventory_shopping_list ORDER BY created_at, material_id')).rows;
  return {reservations,manufacturers,shopping,materials,products:demand.products.map(product=>({...product,estimated_cost:productCost(product,model.materials)})),rules:model.rules,unmapped:model.rules.length ? demand.unmapped : [],movements};
}
function inventoryImageValue(value) {
  try { return require('./branding').validateBranding({name:'Inventory image',logo:value}).logo; }
  catch (_) { fail('Choose a PNG, JPEG or WebP image up to 1 MB.'); }
}
async function saveMaterial(id, body) {
  validId(id); const existing = Boolean(id);
  const name = text(body.name); const unit = text(body.unit,30); const stock = amount(body.stock);
  return transact(async client => {
    id = id || crypto.randomUUID();
    const old = (await client.query('SELECT * FROM inventory_materials WHERE id=$1',[id])).rows[0];
    if (existing && !old) fail('A selected material or product no longer exists.',404);
    if (old && (body.expected_stock === undefined || amount(body.expected_stock) !== Number(old.stock))) fail('Stock changed meanwhile. Refresh and try again.',409);
    let manufacturerId = old?.manufacturer_id || null;
    if (body.manufacturer !== undefined) {
      if (typeof body.manufacturer !== 'string') fail('Enter a valid manufacturer.');
      manufacturerId = null;
      if (body.manufacturer.trim()) {
        const manufacturer = text(body.manufacturer, 100);
        const found = await client.query('INSERT INTO inventory_manufacturers(id,name) VALUES($1,$2) ON CONFLICT(lower(btrim(name))) DO UPDATE SET name=inventory_manufacturers.name RETURNING id',[crypto.randomUUID(),manufacturer]);
        manufacturerId = found.rows[0].id;
      }
    }
    const purchaseUrl = body.purchase_url === undefined ? (old?.purchase_url || '') : validatePurchaseUrl(body.purchase_url);
    const unitCost=costValue(body.unit_cost===undefined?old?.unit_cost:body.unit_cost);
    const costCurrency=currency(body.cost_currency===undefined?(old?.cost_currency || 'EUR'):body.cost_currency);
    await client.query('INSERT INTO inventory_materials(id,name,unit,stock,manufacturer_id,purchase_url,unit_cost,cost_currency) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET name=$2,unit=$3,stock=$4,manufacturer_id=$5,purchase_url=$6,unit_cost=$7,cost_currency=$8',[id,name,unit,stock,manufacturerId,purchaseUrl,unitCost,costCurrency]);
    if(Object.hasOwn(body,'image')) await client.query('UPDATE inventory_materials SET image=$2 WHERE id=$1',[id,inventoryImageValue(body.image)]);
    const delta = round(stock - Number(old?.stock || 0));
    if (delta) await client.query("INSERT INTO inventory_movements(material_id,quantity,reason) VALUES($1,$2,'Stock adjustment')",[id,delta]);
    return {id};
  });
}
async function recipeLines(lines, client, table, reference) {
  if (!Array.isArray(lines) || lines.length > 100 || (reference === 'product_id' && !lines.length)) fail('Add valid recipe components.');
  const seen = new Set(); const result = [];
  for (const line of lines) {
    const id = line?.[reference];
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id) || seen.has(id)) fail('Choose each material or product only once.');
    const found = await client.query(`SELECT id FROM ${table} WHERE id=$1`,[id]);
    if (!found.rowCount) fail('A selected material or product no longer exists.',409);
    seen.add(id);result.push({[reference]:id,quantity:amount(line.quantity,true)});
  }
  return result;
}
async function saveProduct(id, body) {
  validId(id); const existing = Boolean(id);
  return transact(async client => {
    const old=(await client.query('SELECT * FROM manufacturing_products WHERE id=$1',[id || null])).rows[0];
    if (existing && !old) fail('A selected material or product no longer exists.',404);
    id = id || crypto.randomUUID(); const name=text(body.name);
    const recipe=await recipeLines(body.recipe,client,'inventory_materials','material_id');
    const fields=['labour_cost','packaging_cost','reference_price'];
    const costs=fields.map(field=>costValue(body[field]===undefined?old?.[field]:body[field]));
    const costCurrency=currency(body.cost_currency===undefined?(old?.cost_currency || 'EUR'):body.cost_currency);
    await client.query('INSERT INTO manufacturing_products(id,name,recipe,labour_cost,packaging_cost,reference_price,cost_currency) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET name=$2,recipe=$3,labour_cost=$4,packaging_cost=$5,reference_price=$6,cost_currency=$7',[id,name,JSON.stringify(recipe),...costs,costCurrency]);
    if(Object.hasOwn(body,'image')) await client.query('UPDATE manufacturing_products SET image=$2 WHERE id=$1',[id,inventoryImageValue(body.image)]);
    return {id};
  });
}
async function saveRule(id, body) {
  validId(id); const existing = Boolean(id);
  return transact(async client => {
    if (existing && !(await client.query('SELECT id FROM manufacturing_skus WHERE id=$1',[id])).rowCount) fail('A selected material or product no longer exists.',404);
    id=id||crypto.randomUUID(); const sku=text(body.sku,160).replace(/\s*\+\s*/g,' + '); if (/^[*+\s]+$/.test(sku)) fail('Enter a valid SKU or pattern.');
    const components=await recipeLines(body.components,client,'manufacturing_products','product_id');
    await client.query('INSERT INTO manufacturing_skus(id,sku,components) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET sku=$2,components=$3',[id,sku,JSON.stringify(components)]);
    return {id};
  });
}
async function remove(kind,id) {
  validId(id);
  return transact(async client => {
    if (kind==='materials') {
      if ((await client.query("SELECT 1 FROM manufacturing_products WHERE recipe @> $1::jsonb LIMIT 1",[JSON.stringify([{material_id:id}])])).rowCount) fail('This material is used in a recipe.',409);
      await client.query('DELETE FROM inventory_materials WHERE id=$1',[id]);
    } else if (kind==='products') {
      if ((await client.query("SELECT 1 FROM manufacturing_skus WHERE components @> $1::jsonb LIMIT 1",[JSON.stringify([{product_id:id}])])).rowCount) fail('This product is used in an SKU.',409);
      await client.query('DELETE FROM manufacturing_products WHERE id=$1',[id]);
    } else await client.query('DELETE FROM manufacturing_skus WHERE id=$1',[id]);
  });
}
async function reconcile(client, before, after) {
  await client.query('SELECT id FROM inventory_config_lock WHERE id=true FOR UPDATE');
  const record = (await client.query('SELECT * FROM order_inventory WHERE order_id=$1',[after.id])).rows[0];
  const beforeComplete=await isComplete(client,before);
  const wasConsumed = record ? record.consumed : beforeComplete;
  if (beforeComplete && before.skus !== after.skus) fail('Reopen the order before changing its production SKUs.',409);
  const shouldConsume = await isComplete(client,after);
  if (wasConsumed === shouldConsume) return;
  let snapshot,costSnapshot=null;
  if (shouldConsume) {
    const model = await config(client.query.bind(client));
    costSnapshot={...productionCost(after,model),captured_at:new Date().toISOString()};
    // Missing definitions are allowed during gradual inventory setup. Record
    // only known consumption so later recipe changes cannot backfill it.
    snapshot = allocateProducts(expandOrder({...after,shipped:false,workflow_status:'new'},model.rules,model.aliases).totals,model.products,Object.fromEntries(model.products.map(product=>[product.id,Number(product.stock)])));
    // Invalid source line quantities must not turn optional allocation into a production block.
    await client.query('SAVEPOINT inventory_line_allocation');
    try { await require('./orderFulfillment').capture(client,after,model,snapshot); }
    catch (error) {
      if (error.statusCode !== 409) throw error;
      await client.query('ROLLBACK TO SAVEPOINT inventory_line_allocation');
    }
    await client.query('RELEASE SAVEPOINT inventory_line_allocation');
  } else {
    if ((await client.query('SELECT id FROM order_returns WHERE order_id=$1 AND received_at IS NOT NULL LIMIT 1',[after.id])).rowCount) fail('Received returns prevent reopening production. Review inventory manually.',409);
    if ((await client.query('SELECT id FROM order_shipments WHERE order_id=$1 AND canceled_at IS NULL LIMIT 1',[after.id])).rowCount) fail('Cancel active shipments before reopening production.',409);
    snapshot = record?.snapshot || [];
  }
  await applyInventorySnapshot(client,snapshot,shouldConsume?-1:1,after.id,shouldConsume?'Production completed':'Production reopened');
  await client.query('INSERT INTO order_inventory(order_id,consumed,snapshot,cost_snapshot) VALUES($1,$2,$3,$4) ON CONFLICT(order_id) DO UPDATE SET consumed=$2,snapshot=$3,cost_snapshot=$4',[after.id,shouldConsume,JSON.stringify(shouldConsume?snapshot:[]),costSnapshot?JSON.stringify(costSnapshot):null]);
}
module.exports={isComplete,overview,saveMaterial,saveProduct,saveRule,remove,reconcile,config,amount};

function validatePurchaseUrl(value) {
  if (typeof value !== 'string' || value.length > 2000 || /[\x00-\x1f]/.test(value)) fail('Enter a valid HTTP or HTTPS product link.');
  if (!value.trim()) return '';
  try { const url = new URL(value.trim()); if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error(); return url.href; }
  catch (_) { fail('Enter a valid HTTP or HTTPS product link.'); }
}
async function saveShopping(id, body) {
  validId(id); const quantity = amount(body.quantity, true);
  return transact(async client => {
    if (!(await client.query('SELECT id FROM inventory_materials WHERE id=$1',[id])).rowCount) fail('A selected material or product no longer exists.',404);
    await client.query('INSERT INTO inventory_shopping_list(material_id,quantity) VALUES($1,$2) ON CONFLICT(material_id) DO UPDATE SET quantity=$2',[id,quantity]);
    return {id};
  });
}
async function removeShopping(id) {
  validId(id);
  return transact(async client => { await client.query('DELETE FROM inventory_shopping_list WHERE material_id=$1',[id]); });
}
async function receiveShopping(id,body={}) {
  validId(id);
  const quantity=body.quantity===undefined?null:amount(body.quantity,true);
  const expected=body.expected_quantity===undefined?null:amount(body.expected_quantity,true);
  const key=body.request_key || null;
  if(body.request_key!==undefined && (typeof body.request_key!=='string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.request_key))) fail('Invalid receipt request.');
  if(quantity!==null && (expected===null || !key)) fail('Refresh the shopping list before receiving materials.');
  return transact(async client => {
    if(key) {
      const previous=(await client.query('SELECT material_id,quantity FROM inventory_movements WHERE receipt_key=$1',[key])).rows[0];
      if(previous) {
        if(previous.material_id!==id || (quantity!==null && Number(previous.quantity)!==quantity)) fail('This receipt request was already used.',409);
        return {id,received:Number(previous.quantity),repeated:true};
      }
    }
    const item=(await client.query('SELECT quantity FROM inventory_shopping_list WHERE material_id=$1 FOR UPDATE',[id])).rows[0];
    if(!item) fail('This shopping item no longer exists.',409);
    const remaining=Number(item.quantity);
    if(expected!==null && expected!==remaining) fail('Shopping quantity changed. Refresh and try again.',409);
    const received=quantity===null?remaining:quantity;
    if(received>remaining) fail('Received quantity cannot exceed the remaining shopping quantity.');
    const after=round(remaining-received);
    if(after) await client.query('UPDATE inventory_shopping_list SET quantity=$2 WHERE material_id=$1',[id,after]);
    else await client.query('DELETE FROM inventory_shopping_list WHERE material_id=$1',[id]);
    await client.query('UPDATE inventory_materials SET stock=stock+$2 WHERE id=$1',[id,received]);
    await client.query("INSERT INTO inventory_movements(material_id,quantity,reason,receipt_key) VALUES($1,$2,'Purchased supplies',$3)",[id,received,key]);
    return {id,received,remaining:after};
  });
}

module.exports.saveShopping = saveShopping;
module.exports.removeShopping = removeShopping;
module.exports.receiveShopping = receiveShopping;

async function addShoppingShortages() {
  return transact(async client => {
    const execute=client.query.bind(client);
    const model=await config(execute);
    const orders=(await execute("SELECT o.*,s.production_complete FROM orders o JOIN order_workflow_statuses s ON s.id=o.workflow_status WHERE o.shipped=false AND o.business_outcome='active' AND NOT s.production_complete")).rows;
    const demand=productionDemand(orders,model.products,model.rules,model.aliases);
    let added=0,existing=0;
    for(const material of model.materials) {
      const quantity=round((demand.needs[material.id] || 0)-Number(material.stock));
      if(quantity<=0) continue;
      amount(quantity,true);
      const result=await execute('INSERT INTO inventory_shopping_list(material_id,quantity) VALUES($1,$2) ON CONFLICT(material_id) DO NOTHING RETURNING material_id',[material.id,quantity]);
      if(result.rowCount) added++;else existing++;
    }
    return {added,existing,unmapped:model.rules.length?demand.unmapped.length:0};
  });
}
module.exports.addShoppingShortages=addShoppingShortages;

// All callers hold inventory_config_lock, keeping order/product/material updates atomic.
async function applyInventorySnapshot(client,snapshot,direction,orderId,reason) {
  for(const entry of [...snapshot].sort((a,b)=>(a.product_id || a.material_id).localeCompare(b.product_id || b.material_id))) {
    const delta=round(Number(entry.quantity)*direction);
    if(!delta)continue;
    if(entry.product_id) {
      const result=await client.query('UPDATE manufacturing_products SET stock=stock+$1 WHERE id=$2 AND stock+$1>=0 RETURNING id',[delta,entry.product_id]);
      if(!result.rowCount)fail('Finished stock changed meanwhile. Refresh and try again.',409);
      await client.query('INSERT INTO finished_product_movements(product_id,order_id,quantity,reason) VALUES($1,$2,$3,$4)',[entry.product_id,orderId,delta,reason]);
    } else {
      await client.query('UPDATE inventory_materials SET stock=stock+$1 WHERE id=$2',[delta,entry.material_id]);
      await client.query('INSERT INTO inventory_movements(material_id,order_id,quantity,reason) VALUES($1,$2,$3,$4)',[entry.material_id,orderId,delta,reason]);
    }
  }
}
async function changeFinishedStock(id,body={}) {
  validId(id);validId(body.request_key);
  if(!id || !body.request_key || !['production','adjustment'].includes(body.kind))fail('Choose a valid finished stock operation.');
  const value=amount(body.quantity,body.kind==='production');
  if(value<0)fail('Finished stock cannot be negative.');
  const expected=amount(body.expected_stock);
  const payload={kind:body.kind,quantity:value,expected_stock:expected};
  return transact(async client=>{
    const previous=(await client.query('SELECT * FROM finished_product_operations WHERE request_key=$1',[body.request_key])).rows[0];
    if(previous) {
      if(previous.product_id!==id || Object.keys(payload).some(key=>previous.payload[key]!==payload[key]))fail('Request key was already used for another operation.',409);
      return {id,stock:Number(previous.stock_after)};
    }
    const product=(await client.query('SELECT * FROM manufacturing_products WHERE id=$1',[id])).rows[0];
    if(!product)fail('A selected material or product no longer exists.',404);
    const before=Number(product.stock);
    if(before!==expected)fail('Stock changed meanwhile. Refresh and try again.',409);
    const after=body.kind==='production'?round(before+value):value;amount(after);
    const snapshot=body.kind==='production'?product.recipe.map(entry=>({material_id:entry.material_id,quantity:amount(round(Number(entry.quantity)*value),true)})):[];
    await client.query('INSERT INTO finished_product_operations(request_key,product_id,payload,material_snapshot,stock_before,stock_after) VALUES($1,$2,$3,$4,$5,$6)',[body.request_key,id,JSON.stringify(payload),JSON.stringify(snapshot),before,after]);
    await applyInventorySnapshot(client,snapshot,-1,null,'Production into finished stock');
    await client.query('UPDATE manufacturing_products SET stock=$1 WHERE id=$2',[after,id]);
    await client.query('INSERT INTO finished_product_movements(product_id,operation_id,quantity,reason) VALUES($1,$2,$3,$4)',[id,body.request_key,round(after-before),body.kind==='production'?'Production into finished stock':'Finished stock adjustment']);
    return {id,stock:after};
  });
}
module.exports.changeFinishedStock=changeFinishedStock;
module.exports.applyInventorySnapshot=applyInventorySnapshot;
