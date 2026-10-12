'use strict';
const {productionCost,orderCost,scaled,decimal,margin}=require('./costMath');

// Aggregate only complete estimates. Never turn unknown costs into zero or
// distribute an order's revenue across products without item selling prices.
function summarize(orders,model) {
  const totals=new Map(),channels=new Map(),months=new Map(),products=new Map();
  function add(map,label,currency,cost,historicalMissing) {
    const key=JSON.stringify([label,currency,cost.vat_mode]);
    if(!map.has(key))map.set(key,{label,currency,vat_mode:cost.vat_mode,orders:0,complete:0,estimated:0,missing:0,revenue:0n,cost:0n});
    const group=map.get(key);group.orders++;
    if(cost.profit===null || historicalMissing){group.missing++;return;}
    group.complete++;group.estimated+=cost.production.basis==='Configured recipe estimate'?1:0;
    group.revenue+=scaled(cost.revenue);group.cost+=scaled(cost.total);
  }
  for(const order of orders) {
    const snapshot=order.consumed?order.cost_snapshot:null;
    const production=snapshot || productionCost(order,model);
    const entered={vat:order.vat,currency:order.entered_currency,production_cost:order.production_cost,
      shipping_cost:order.shipping_cost,marketplace_fee:order.marketplace_fee,payment_fee:order.payment_fee,other_cost:order.other_cost};
    const cost=orderCost(order,production,entered,snapshot);
    const historicalMissing=cost.production.basis==='Current estimate; historical cost missing';
    const currency=cost.currency;
    add(totals,'',currency,cost,historicalMissing);
    add(channels,order.channel,currency,cost,historicalMissing);
    add(months,order.profit_month,currency,cost,historicalMissing);
    // Snapshot composition is retained even if recipes or SKU mappings change.
    const names=[...new Set((production.products || []).map(p=>p.name))].sort();
    add(products,names.length===1?names[0]:null,currency,cost,historicalMissing);
  }
  function rows(map){return [...map.values()].map(g=>({...g,revenue:g.complete?decimal(g.revenue):null,cost:g.complete?decimal(g.cost):null,
    ...(g.complete?margin(decimal(g.revenue),decimal(g.cost)):{profit:null,margin_percent:null})}));}
  return {totals:rows(totals),channels:rows(channels),months:rows(months),products:rows(products)};
}
async function read(execute,from,to) {
  const orders=(await execute(`SELECT o.*,s.production_complete,c.production_cost,c.shipping_cost,c.marketplace_fee,c.payment_fee,c.other_cost,
    c.currency AS entered_currency,c.vat,i.consumed,i.cost_snapshot,
    TO_CHAR(COALESCE(o.created_at,o.imported_at),'YYYY-MM') AS profit_month
    FROM orders o LEFT JOIN order_workflow_statuses s ON s.id=o.workflow_status
    LEFT JOIN order_costs c ON c.order_id=o.id LEFT JOIN order_inventory i ON i.order_id=o.id
    WHERE COALESCE(o.created_at,o.imported_at)>=$1 AND COALESCE(o.created_at,o.imported_at)<$2
    ORDER BY COALESCE(o.created_at,o.imported_at),o.id`,[from,to])).rows;
  const model=await require('./inventory').config(execute);
  return summarize(orders,model);
}
module.exports={summarize,read};
