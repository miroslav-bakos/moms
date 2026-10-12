const {withClient}=require('../db');
const {orderCost,productionCost}=require('./costMath');
function options(body={}){
 for(const key of ['from','to'])if(typeof body[key]!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(body[key])||!Number.isFinite(Date.parse(body[key]))||new Date(body[key]).toISOString().slice(0,10)!==body[key]){const e=new Error('Choose valid accounting export dates.');e.statusCode=400;throw e;}
 if(body.to<body.from||Date.parse(body.to)-Date.parse(body.from)>366*86400000){const e=new Error('Choose an accounting period up to one year.');e.statusCode=400;throw e;}
 return {...body,language:body.language==='sk'?'sk':'en'};
}
const columns=[['vat_mode','VAT treatment','Režim DPH'],['recorded_revenue','Recorded order total','Evidovaná suma objednávky'],['recorded_cost','Costs before VAT adjustment','Náklady pred úpravou DPH'],['revenue_vat','Revenue VAT','DPH v tržbe'],['deductible_vat','Deductible input VAT','Odpočítateľná vstupná DPH'],['order','Order number','Číslo objednávky'],['date','Order date (UTC)','Dátum objednávky (UTC)'],['channel','Sales channel','Predajný kanál'],['outcome','Business outcome','Výsledok objednávky'],['currency','Currency','Mena'],['revenue_currency','Revenue currency','Mena obratu'],['revenue','Revenue','Obrat'],['production','Production cost','Výrobné náklady'],['shipping','Shipping cost','Doprava'],['marketplace','Marketplace fee','Poplatok marketplace'],['payment','Payment fee','Platobný poplatok'],['other','Other cost','Ostatné náklady'],['total','Total cost','Náklady spolu'],['profit','Contribution','Príspevok na zisk'],['basis','Cost basis','Podklad nákladov'],['missing','Missing cost fields','Chýbajúce náklady']];
function row(order,entered,snapshot,model){
 const production=snapshot||productionCost(order,model),cost=orderCost(order,production,entered,snapshot);
 return {vat_mode:cost.vat_mode,recorded_revenue:cost.recorded_revenue,recorded_cost:cost.recorded_total,revenue_vat:entered?.vat?.mode==='payer'?entered.vat.revenue_vat:null,deductible_vat:entered?.vat?.mode==='payer'?entered.vat.deductible_vat:null,order:String(order.external_order_id||order.id),date:new Date(order.created_at).toISOString().slice(0,10),channel:order.vendor||order.channel,outcome:order.business_outcome||'active',currency:cost.currency,revenue_currency:order.revenue_currency,revenue:cost.revenue,production:cost.production.amount,shipping:entered?.shipping_cost,marketplace:entered?.marketplace_fee,payment:entered?.payment_fee,other:entered?.other_cost,total:cost.total,profit:cost.profit,basis:cost.production.basis,missing:cost.missing.map(m=>m.reason+(m.name?': '+m.name:'')).join('; ')};
}
function csv(rows,language){const cell=value=>{let text=String(value??'');if(/^[\s]*[=+\-@\t\r]/.test(text)&&!/^-[0-9]+(?:\.[0-9]+)?$/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';};return Buffer.from('\uFEFF'+[columns.map(c=>c[language==='sk'?2:1]),...rows.map(r=>columns.map(c=>r[c[0]]))].map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n');}
async function exportAccounting(body){const selected=options(body);return withClient(async client=>{
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{
  const orders=(await client.query(`SELECT o.*,s.production_complete,c.production_cost,c.shipping_cost,c.marketplace_fee,c.payment_fee,c.other_cost,c.currency AS entered_currency,c.vat,i.consumed,i.cost_snapshot FROM orders o JOIN order_workflow_statuses s ON s.id=o.workflow_status LEFT JOIN order_costs c ON c.order_id=o.id LEFT JOIN order_inventory i ON i.order_id=o.id WHERE o.created_at >= ($1::date::timestamp AT TIME ZONE 'UTC') AND o.created_at < (($2::date + interval '1 day') AT TIME ZONE 'UTC') ORDER BY o.created_at,o.id LIMIT 10001`,[selected.from,selected.to])).rows;
  if(orders.length>10000){const e=new Error('Too many orders. Choose a shorter accounting period.');e.statusCode=400;throw e;}
  const model=await require('./inventory').config(client.query.bind(client));
  const rows=orders.map(o=>row(o,{vat:o.vat,currency:o.entered_currency,production_cost:o.production_cost,shipping_cost:o.shipping_cost,marketplace_fee:o.marketplace_fee,payment_fee:o.payment_fee,other_cost:o.other_cost},o.consumed?o.cost_snapshot:null,model));
  const bytes=csv(rows,selected.language);await client.query('COMMIT');return bytes;
 }catch(error){await client.query('ROLLBACK');throw error;}
 });}
module.exports={exportAccounting,options,row,csv};
