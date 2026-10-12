(function(root){
const textKeys=['business_outcome','vendor','external_order_id','workflow_status','skus','address','processed','packed','shipped','shipping_weight','tracking_code','tracking_url','note','is_gift','gift_message'];
const dateKeys=['created_at','ship_by_date','delivered_at'];
const valueText=value=>String(value instanceof Date?value.toISOString():value || '');
function matches(order,filters,getValue){
 const search=String(filters.mobileSearch || '').trim().toLowerCase();
 if(search && ![order.vendor,order.external_order_id,order.order_name,order.source_payload?.order_number,order.skus,order.address,order.tracking_code,order.note].join(' ').toLowerCase().includes(search))return false;
 for(const key of dateKeys){
  const from=filters[key+'_from'],to=filters[key+'_to'];if(!from&&!to)continue;
  const date=valueText(getValue(order,key)).slice(0,10);
  if(!date || (from&&date<from) || (to&&date>to))return false;
 }
 if(filters.label_created && (filters.label_created==='y')!==Boolean(getValue(order,'label_created')))return false;
 return textKeys.every(key=>{const needle=String(filters[key] || '').trim().toLowerCase();return !needle || valueText(getValue(order,key)).toLowerCase().includes(needle);});
}
function compare(a,b,key,direction,getValue,language){
 const va=valueText(getValue(a,key)),vb=valueText(getValue(b,key));
 if(!va&&!vb)return 0;if(!va)return 1;if(!vb)return -1;
 return direction==='asc'?va.localeCompare(vb,language==='sk'?'sk':'en'):vb.localeCompare(va,language==='sk'?'sk':'en');
}
function boardMatches(order,search,stage=''){
 search=String(search || '').trim().toLowerCase();
 return (!stage || (order.workflow_status || 'new')===stage) && (!search || [order.external_order_id,order.order_name,order.vendor,order.address,order.skus,order.note,order.tracking_code,order.tracking_status].some(value=>String(value || '').toLowerCase().includes(search)));
}
function todayKey() {const now=new Date();return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;}
function workMatches(order, filters={}, unmapped=[], localDay='') {
 if(order.shipped)return false;
 if(filters.vendor && order.vendor!==filters.vendor)return false;
 if(filters.stage && (order.workflow_status || 'new')!==filters.stage)return false;
 if(filters.label && (filters.label==='y')!==Boolean(order.label_created))return false;
 const date=String(order.ship_by_date || '').slice(0,10);
 if(filters.from && (!date || date<filters.from))return false;
 if(filters.to && (!date || date>filters.to))return false;
 const today=localDay || todayKey();
 const paid=order.source_payload?.is_paid;
 const payment=typeof paid==='boolean'?(paid?'paid':'pending'):String(order.source_payload?.financial_status || order.source_payload?.payment_status || '').toLowerCase();
 switch(filters.attention){
  case 'today':return date===today;
  case 'overdue':return Boolean(date&&date<today);
  case 'address':return !String(order.address || '').trim();
  case 'label':return !order.label_created;
  case 'unmapped': {
   const normalized=value=>String(value||'').trim().replace(/\s+[x×]\s*\d+(?:\.\d+)?$/i,'').toUpperCase();
   const unknown=new Set(unmapped.map(normalized));
   return String(order.skus || '').split(/\s*\+\s*|\n|,/).some(part=>unknown.has(normalized(part))) || (Array.isArray(order.raw_skus)?order.raw_skus:[]).some(item=>unknown.has(normalized(typeof item==='string'?item:item.sku)));
  }
  case 'payment':return ['pending','unpaid','partially_paid','authorized'].includes(payment);
  case 'unknownPayment':return !payment;
  default:return true;
 }
}
const helpers={textKeys,dateKeys,matches,compare,boardMatches,workMatches,todayKey};
if(typeof module==='object'&&module.exports)module.exports=helpers;else root.orderFilterHelpers=helpers;
})(typeof window==='object'?window:globalThis);
