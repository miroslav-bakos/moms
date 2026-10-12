const {withClient}=require('../db');
const helpers=require('../public/order-filters');
const {exportOrders,cellValue}=require('./orderExport');
const sortKeys=['vendor','external_order_id','workflow_status','skus','created_at','ship_by_date','address','note','tracking_code'];
function fail(message){const error=new Error(message);error.statusCode=400;throw error;}
function openExportOptions(body){
 if(!['csv','xlsx'].includes(body?.format))fail('Choose CSV or Excel for export.');
 const filters=body.filters || {};if(typeof filters!=='object'||Array.isArray(filters))fail('Invalid export filters.');
 const allowed=[...helpers.textKeys,...helpers.dateKeys.flatMap(key=>[key+'_from',key+'_to']),'mobileSearch','label_created'];
 for(const [key,value] of Object.entries(filters)){
  if(!allowed.includes(key)||typeof value!=='string'||value.length>2000)fail('Invalid export filters.');
  if(value&&/_(from|to)$/.test(key)&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))fail('Invalid export date.');
 }
 if(filters.label_created&&!['y','n'].includes(filters.label_created))fail('Invalid export filters.');
 if(body.view!==undefined&&!['open','board'].includes(body.view))fail('Invalid export filters.');
 if(body.boardSearch!==undefined&&(typeof body.boardSearch!=='string'||body.boardSearch.length>2000))fail('Invalid export filters.');
 if(body.boardStage!==undefined&&(typeof body.boardStage!=='string'||body.boardStage.length>80))fail('Invalid export filters.');
 if(body.boardToday!==undefined&&(!/^\d{4}-\d{2}-\d{2}$/.test(body.boardToday)||!Number.isFinite(Date.parse(body.boardToday))||new Date(body.boardToday).toISOString().slice(0,10)!==body.boardToday))fail('Invalid export date.');
 const boardFilters=body.boardFilters || {};
 if(typeof boardFilters!=='object'||Array.isArray(boardFilters)||Object.entries(boardFilters).some(([key,value])=>!['vendor','stage','label','from','to','attention'].includes(key)||typeof value!=='string'||value.length>200))fail('Invalid export filters.');
 return {...body,boardFilters,filters,language:body.language==='sk'?'sk':'en',sortKey:sortKeys.includes(body.sortKey)?body.sortKey:'created_at',sortDir:body.sortDir==='asc'?'asc':'desc'};
}
function columnValue(order,key,language){
 if(key==='external_order_id'){
  if(String(order.channel || '').toLowerCase()!=='shopify')return order.external_order_id || '';
  const number=order.source_payload?.order_number;return number!=null&&number!==''?String(number):String(order.order_name || order.external_order_id || '').replace(/^#/,'');
 }
 if(key==='workflow_status')return cellValue({...order,workflow_label:order.workflow_label || 'NEW'},'workflow_label',language);
 if(['processed','packed','shipped','is_gift'].includes(key))return order[key]?'TRUE':'FALSE';
 return order[key] || '';
}
async function exportOpen(body){
 const options=openExportOptions(body),unmapped=options.boardFilters.attention==='unmapped'?(await require('./inventory').overview()).unmapped:[],getValue=(order,key)=>columnValue(order,key,options.language);
 const orders=await withClient(async client=>{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try{
   await client.query(`DECLARE open_export_cursor NO SCROLL CURSOR FOR SELECT o.*,s.label AS workflow_label FROM orders o LEFT JOIN order_workflow_statuses s ON s.id=o.workflow_status WHERE o.shipped=false ORDER BY o.id`);
   const selected=[];
   for(;;){
    const batch=(await client.query('FETCH FORWARD 500 FROM open_export_cursor')).rows;
    for(const order of batch){
     const match=options.view==='board'?(helpers.boardMatches(order,options.boardSearch,options.boardStage)&&helpers.workMatches(order,options.boardFilters,unmapped,options.boardToday)):helpers.matches(order,options.filters,getValue);
     if(match){selected.push(order);if(selected.length>5000)fail('More than 5000 orders match. Narrow your filters before exporting.');}
    }
    if(batch.length<500)break;
   }
   if(!selected.length)fail('No orders match these filters.');
   await client.query('CLOSE open_export_cursor');await client.query('COMMIT');return selected;
  }catch(error){await client.query('ROLLBACK');throw error;}
 });
 orders.sort((a,b)=>helpers.compare(a,b,options.sortKey,options.sortDir,getValue,options.language));
 return {format:options.format,bytes:await exportOrders(orders,options.format,options.language)};
}
module.exports={openExportOptions,columnValue,exportOpen};
