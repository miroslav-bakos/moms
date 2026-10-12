'use strict';
const {withClient}=require('../db');
const {costValue,currency,productionCost,orderCost,EXTRA_FIELDS}=require('./costMath');
function fail(message,statusCode=400){const error=new Error(message);error.statusCode=statusCode;throw error;}
async function read(client,order){
 order={...order,production_complete:await require('./inventory').isComplete(client,order)};
 const record=(await client.query('SELECT * FROM order_inventory WHERE order_id=$1',[order.id])).rows[0];
 const entered=(await client.query('SELECT * FROM order_costs WHERE order_id=$1',[order.id])).rows[0];
 const snapshot=record?.consumed&&record.cost_snapshot;
 const production=snapshot || productionCost(order,await require('./inventory').config(client.query.bind(client)));
 const preferences=await require('./vat').get(client.query.bind(client));
 return {preferences,entered:entered || {revision:0,currency:order.revenue_currency || production.currency || 'EUR'},estimate:orderCost(order,production,entered,snapshot)};
}
async function transact(id,body){
 id=Number(id);
 if(body!==undefined && (!body || typeof body!=='object' || Array.isArray(body)))fail('Invalid costs request.');
 if(!Number.isSafeInteger(id)||id<=0)fail('Invalid order ID');
 return withClient(async client=>{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try {
   const order=(await client.query(`SELECT * FROM orders WHERE id=$1${body?' FOR UPDATE':''}`,[id])).rows[0];
   if(!order)fail('Order not found',404);
   if(body){
    const current=(await client.query('SELECT revision,vat FROM order_costs WHERE order_id=$1',[id])).rows[0];
    if(!Number.isSafeInteger(body.expected_revision)||body.expected_revision<0||body.expected_revision!==Number(current?.revision || 0))fail('Costs changed meanwhile. Reopen the order and try again.',409);
    const fields=['production_cost',...EXTRA_FIELDS];
    const values=fields.map(field=>costValue(body[field]));
    const vat=body.vat===undefined?current?.vat||null:require('./vat').normalize(body.vat);
    if(body.vat!==undefined&&vat?.mode==='payer')vat.revenue_basis=order.revenue_amount==null?null:String(order.revenue_amount);
    await client.query(`INSERT INTO order_costs(order_id,production_cost,shipping_cost,marketplace_fee,payment_fee,other_cost,currency) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(order_id) DO UPDATE SET production_cost=$2,shipping_cost=$3,marketplace_fee=$4,payment_fee=$5,other_cost=$6,currency=$7,revision=order_costs.revision+1,updated_at=now()`,[id,...values,currency(body.currency)]);
    await client.query('UPDATE order_costs SET vat=$2 WHERE order_id=$1',[id,vat]);
   }
   const result=await read(client,order);await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK');if(error.code==='40001')fail('Costs changed meanwhile. Reopen the order and try again.',409);throw error;}
 });
}
module.exports={get:id=>transact(id),save:(id,body)=>transact(id,body)};
