'use strict';
const {maxDate}=require('../utils/dates');
const shortId=value=>{const id=String(value||'').split('/').pop();if(!/^\d+$/.test(id))throw new Error('Shopify returned an invalid ID.');return id;};
function next(connection,seen) {
 if(!connection||!Array.isArray(connection.nodes)||typeof connection.pageInfo?.hasNextPage!=='boolean')throw new Error('Shopify returned an incomplete page.');
 if(!connection.pageInfo.hasNextPage)return null;
 const cursor=connection.pageInfo.endCursor;if(!cursor||seen.has(cursor))throw new Error('Shopify pagination repeated or omitted a cursor.');seen.add(cursor);return cursor;
}
async function poll({since,graphql,normalize}) {
 const imported=new Map(),seen=new Set();let after=null;
 do {
  const {orders}=await graphql(`query MomsOrders($after:String,$filter:String!){orders(first:20,after:$after,sortKey:UPDATED_AT,query:$filter){nodes{id name createdAt updatedAt cancelledAt displayFinancialStatus displayFulfillmentStatus note currentTotalPriceSet{shopMoney{amount currencyCode}} shippingAddress{name company address1 address2 city province zip countryCodeV2 phone} fulfillments(first:10){trackingInfo{number url}}} pageInfo{hasNextPage endCursor}}}`,{after,filter:`updated_at:>='${new Date(since).toISOString()}'`});
  const following=next(orders,seen);
  for(const order of orders.nodes){
   const id=shortId(order.id),lines=[],lineSeen=new Set();let lineAfter=null;
   do {
    const data=await graphql(`query MomsOrderLines($id:ID!,$after:String){order(id:$id){lineItems(first:250,after:$after){nodes{id sku title variantTitle quantity} pageInfo{hasNextPage endCursor}}}}`,{id:order.id,after:lineAfter});
    const connection=data.order?.lineItems;lineAfter=next(connection,lineSeen);lines.push(...connection.nodes);
   }while(lineAfter);
   const address=order.shippingAddress;
   const legacy={id,name:order.name,created_at:order.createdAt,updated_at:order.updatedAt,cancelled_at:order.cancelledAt,financial_status:String(order.displayFinancialStatus||'').toLowerCase(),fulfillment_status:String(order.displayFulfillmentStatus||'').toLowerCase(),note:order.note,current_total_price:order.currentTotalPriceSet?.shopMoney?.amount,currency:order.currentTotalPriceSet?.shopMoney?.currencyCode,shipping_address:address?{...address,country_code:address.countryCodeV2}:null,line_items:lines.map(line=>({id:shortId(line.id),sku:line.sku,title:line.title,variant_title:line.variantTitle,quantity:line.quantity})),fulfillments:(order.fulfillments||[]).flatMap(f=>(f.trackingInfo||[]).map(t=>({tracking_number:t.number,tracking_url:t.url})))};
   imported.set(id,normalize(legacy));
  }
  after=following;
 }while(after);
 const orders=[...imported.values()];return {orders,nextCursor:maxDate(orders.map(order=>order.updatedAtSource||order.createdAt))||since};
}
module.exports={poll};
