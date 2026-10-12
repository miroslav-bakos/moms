'use strict';
const {query}=require('../db');
function fail(message,statusCode=400){const error=new Error(message);error.statusCode=statusCode;throw error;}
async function list(){
  const entries=(await query('SELECT s.order_id FROM scan_list s JOIN orders o ON o.id=s.order_id ORDER BY s.added_at,s.order_id')).rows;
  if(!entries.length)return [];
  const orders=[];
  for(let offset=0;offset<entries.length;offset+=1000)orders.push(...await require('./orders').listOrders({ids:entries.slice(offset,offset+1000).map(row=>Number(row.order_id)),limit:1000,activeOnly:false}));
  const byId=new Map(orders.map(order=>[Number(order.id),order]));
  return entries.map(row=>byId.get(Number(row.order_id))).filter(Boolean);
}
async function add(code){
  const order=await require('./orderScan').match(code);
  // Scanning selects an order; archived returns are eligible without reopening.
  const result=await query(`WITH eligible AS (SELECT id FROM orders WHERE id=$1 FOR UPDATE)
    INSERT INTO scan_list(order_id) SELECT id FROM eligible
    ON CONFLICT(order_id) DO UPDATE SET order_id=EXCLUDED.order_id RETURNING order_id`,[order.id]);
  if(!result.rows.length)fail('No matching order.',409);
  return list();
}
async function remove(ids){
  if(!Array.isArray(ids)||ids.length>5000||ids.some(id=>!Number.isSafeInteger(id)||id<=0))fail('Select valid orders.');
  // Remove only the client's snapshot; another device's later scans survive.
  if(ids.length)await query('DELETE FROM scan_list WHERE order_id=ANY($1::bigint[])',[ids]);
  return list();
}
module.exports={list,add,remove};
