'use strict';
const {withClient}=require('../db');
const {listOrders}=require('./orders');
const {exportOrders}=require('./orderExport');
function fail(message) { const error=new Error(message);error.statusCode=400;throw error; }
function archiveExportOptions(body) {
  if (!['csv','xlsx'].includes(body?.format))fail('Choose CSV or Excel for export.');
  const filters=body.filters || {};
  if(typeof filters!=='object' || Array.isArray(filters))fail('Invalid export filters.');
  const options={status:'archive',paginate:true,export:true,limit:5001,offset:0,sortKey:body.sortKey,sortDir:body.sortDir};
  for(const key of ['vendor','external_order_id','skus','address','tracking_code','note','shipping_weight','business_outcome','mobileSearch','label_created','created_at_from','created_at_to','ship_by_date_from','ship_by_date_to','delivered_at_from','delivered_at_to']) {
    if(filters[key]===undefined || filters[key]==='')continue;
    if(typeof filters[key]!=='string' || filters[key].length>2000)fail('Invalid export filters.');
    if(/_(from|to)$/.test(key)) {
      const value=filters[key];
      if(!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value)fail('Invalid export date.');
    }
    if(key==='label_created'&&!['y','n'].includes(filters[key]))fail('Invalid export filters.');
    options[key==='mobileSearch'?'search':key]=filters[key];
  }
  return {options,format:body.format,language:body.language==='sk'?'sk':'en'};
}
async function exportArchive(body) {
  const {options,format,language}=archiveExportOptions(body);
  const rows=await withClient(async client=>{
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      const result=await listOrders(options,client.query.bind(client));
      if(result.total>5000)fail('More than 5000 orders match. Narrow your filters before exporting.');
      if(!result.total)fail('No orders match these filters.');
      const labels=(await client.query('SELECT id,label FROM order_workflow_statuses')).rows;
      const byId=new Map(labels.map(row=>[row.id,row.label]));
      await client.query('COMMIT');
      return result.orders.map(order=>({...order,workflow_label:byId.get(order.workflow_status)}));
    }catch(error){await client.query('ROLLBACK');throw error;}
  });
  return {bytes:await exportOrders(rows,format,language),format};
}
module.exports={archiveExportOptions,exportArchive};
