const round = value => Math.round((value + Number.EPSILON) * 1e6) / 1e6;
const key = value => String(value || '').trim().toUpperCase().replace(/\s*\+\s*/g, ' + ');
const complete = order => Boolean(order.shipped) || (typeof order.production_complete==='boolean'?order.production_complete:['crafted', 'ready_for_pickup', 'shipped'].includes(order.workflow_status));
function matchRule(sku, rules) {
  const exact = rules.find(rule => key(rule.sku) === key(sku));
  if (exact) return [exact];
  return rules.filter(rule => rule.sku.includes('*') && new RegExp('^' + rule.sku.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i').test(String(sku).trim()));
}
function resolveLines(lines, rules) {
  const totals = {}; const unmapped = new Set();
  const add = (sku, quantity, split = true) => {
    let matching = matchRule(sku, rules);
    const exact = rules.some(rule => key(rule.sku) === key(sku));
    if (!exact && split && String(sku).includes('+') && !matching.some(rule => rule.sku.includes('+'))) {
      String(sku).split('+').map(part => part.trim()).filter(Boolean).forEach(part => add(part, quantity, false)); return;
    }
    if (!exact) {
      const suffix = String(sku || '').trim().match(/^(.*?)\s+[x×]\s*(\d+(?:\.\d+)?)$/i);
      if (suffix) { sku = suffix[1]; quantity *= Number(suffix[2]); matching = matchRule(sku,rules); }
    }
    if (matching.length === 1) {
      for (const component of matching[0].components) totals[component.product_id] = round((totals[component.product_id] || 0) + Number(component.quantity) * quantity);
    } else unmapped.add(String(sku).trim() || 'Unknown SKU');
  };
  for (const line of lines) {
    const sku = typeof line === 'string' ? line : line?.sku;
    let quantity = typeof line === 'string' ? 1 : Number(line?.quantity || 1);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000) { unmapped.add(String(sku || 'Unknown SKU')); continue; }
    add(sku,quantity);
  }
  return { totals, unmapped: [...unmapped] };
}
function expandOrder(order, rules, aliases = {}) {
  const display = String(order.skus || '').split(/\n|,/).map(sku => ({ sku: sku.trim(), quantity: 1 })).filter(line => line.sku);
  const displayed = display.length ? resolveLines(display, rules) : {totals:{},unmapped:['Unknown SKU']};
  if (order.skus_locked || !Array.isArray(order.raw_skus) || !order.raw_skus.length) return displayed;
  const rawLines = order.raw_skus.map(line => {
    const sku = typeof line === 'string' ? line : line?.sku;
    const alias = aliases[key(sku)];
    return alias && !matchRule(sku,rules).length ? { ...(typeof line === 'object' ? line : {quantity:1}), sku:alias } : line;
  });
  const raw = resolveLines(rawLines, rules);
  return raw.unmapped.length && !displayed.unmapped.length && display.length ? displayed : raw;
}
function productionDemand(orders, products, rules, aliases = {}) {
  const totals = {}; const needs = {}; const unmapped = new Set();
  for (const order of orders) {
    if (complete(order) || (order.business_outcome && order.business_outcome !== 'active')) continue;
    const expanded = expandOrder(order, rules, aliases);
    expanded.unmapped.forEach(sku => unmapped.add(sku));
    for (const [id, quantity] of Object.entries(expanded.totals)) totals[id] = round((totals[id] || 0) + quantity);
  }
  const projected = products.map(product => {
    const required = totals[product.id] || 0;
    const stock = Number(product.stock || 0);
    const from_stock = round(Math.min(stock,required));
    const to_produce = round(required-from_stock);
    for (const ingredient of product.recipe) needs[ingredient.material_id] = round((needs[ingredient.material_id] || 0) + to_produce * Number(ingredient.quantity));
    return {...product,stock,required,from_stock,to_produce,after_queue:round(stock-from_stock)};
  });
  return { products: projected, needs, unmapped: [...unmapped] };
}
// Allocate against a mutable stock pool shared across the complete order.
function allocateProducts(totals, products, available) {
  const materials = {}, finished = [];
  for (const product of products) {
    const required = Number(totals[product.id] || 0);
    const take = round(Math.min(required,available[product.id] || 0));
    available[product.id] = round((available[product.id] || 0)-take);
    if(take>0) finished.push({product_id:product.id,quantity:take});
    for(const ingredient of product.recipe) materials[ingredient.material_id] = round((materials[ingredient.material_id] || 0)+round(required-take)*Number(ingredient.quantity));
  }
  return [...finished,...Object.entries(materials).filter(([,quantity])=>quantity>0).map(([material_id,quantity])=>({material_id,quantity}))];
}
// Compact exact unit ranges for returns; never average stocked and made units.
function allocateUnitBatches(totals, products, available, quantity) {
  const perUnit = Object.fromEntries(Object.entries(totals).map(([id,total])=>[id,round(total/quantity)]));
  const boundaries = new Set([0,quantity]);
  for(const [id,required] of Object.entries(perUnit)) {
    if(required<=0) continue;
    const covered = Math.min(quantity,(available[id] || 0)/required);
    boundaries.add(Math.floor(covered));boundaries.add(Math.min(quantity,Math.ceil(covered)));
  }
  const points = [...boundaries].sort((a,b)=>a-b), batches=[];
  for(let i=1;i<points.length;i++) {
    const count=points[i]-points[i-1];if(!count)continue;
    const snapshot=allocateProducts(Object.fromEntries(Object.entries(perUnit).map(([id,needed])=>[id,round(needed*count)])),products,available).map(entry=>({...entry,quantity:entry.quantity/count}));
    batches.push({quantity:count,snapshot});
  }
  return batches;
}
module.exports = { round, complete, expandOrder, productionDemand, allocateProducts, allocateUnitBatches };

// Advisory reservations, recalculated from the queue; never write stock.
function queueReservations(orders, products, materials, rules, aliases={}) {
 const date=value=>{const n=Date.parse(value);return Number.isFinite(n)?n:Infinity;};
 const pending=orders.filter(order=>!complete(order)&&(!order.business_outcome||order.business_outcome==='active')).sort((a,b)=>date(a.ship_by_date)-date(b.ship_by_date)||date(a.created_at)-date(b.created_at)||Number(a.id)-Number(b.id));
 const finished=Object.fromEntries(products.map(p=>[p.id,Math.max(0,Number(p.stock||0))]));
 const materialPool=Object.fromEntries(materials.map(m=>[m.id,Math.max(0,Number(m.stock||0))]));
 const allocations=pending.map((order,index)=>{
  const expanded=expandOrder(order,rules,aliases);
  const snapshot=allocateProducts(expanded.totals,products,finished);
  const productLines=Object.entries(expanded.totals).map(([id,required])=>({product_id:id,required,reserved:snapshot.find(e=>e.product_id===id)?.quantity||0,to_produce:round(required-(snapshot.find(e=>e.product_id===id)?.quantity||0))}));
  const materialLines=snapshot.filter(e=>e.material_id).map(e=>{
   const reserved=round(Math.min(e.quantity,materialPool[e.material_id]||0));materialPool[e.material_id]=round((materialPool[e.material_id]||0)-reserved);
   return {...e,reserved,missing:round(e.quantity-reserved)};
  });
  return {order_id:order.id,order_number:order.external_order_id,priority:index+1,products:productLines,materials:materialLines,unmapped:expanded.unmapped};
 });
 return {allocations,products:products.map(p=>({product_id:p.id,reserved:round(Math.max(0,Number(p.stock||0))-(finished[p.id]||0)),available:finished[p.id]||0,missing:round(allocations.reduce((sum,a)=>sum+(a.products.find(e=>e.product_id===p.id)?.to_produce||0),0))})),materials:materials.map(m=>({material_id:m.id,reserved:round(Math.max(0,Number(m.stock||0))-(materialPool[m.id]||0)),available:materialPool[m.id]||0,missing:round(allocations.reduce((sum,a)=>sum+(a.materials.find(e=>e.material_id===m.id)?.missing||0),0))}))};
}
module.exports.queueReservations=queueReservations;
