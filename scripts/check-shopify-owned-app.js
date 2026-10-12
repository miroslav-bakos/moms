'use strict';
const assert=require('node:assert/strict');
module.exports=async()=>{
 const {config}=require('../src/config');Object.assign(config.shopify,{authMode:'client_credentials',accessToken:'',clientId:'fixture-id',clientSecret:'fixture-secret'});
 let stored=null,tokenCalls=0,pages=0,fail=false,repeat=false;
 const store=require('../src/services/tokenStore');store.getToken=async()=>stored;store.setToken=async(_,token)=>{stored={...token,expires_at:new Date(Date.now()+token.expires_in*1000).toISOString()};};
 delete require.cache[require.resolve('../src/channels/shopify')];const shopify=require('../src/channels/shopify');
 global.fetch=async(url,options)=>{
  if(url.endsWith('/access_token')){tokenCalls++;assert.equal(new URLSearchParams(options.body).get('grant_type'),'client_credentials');return {ok:true,json:async()=>({access_token:'fixture-token',expires_in:86400})};}
  const {query,variables}=JSON.parse(options.body);assert.equal(options.headers['X-Shopify-Access-Token'],'fixture-token');
  if(query.includes('MomsOrders')){
   pages++;if(fail)throw new Error('Fixture interrupted page');
   const id=variables.after?'9007199254740994':'9007199254740993';
   return {ok:true,json:async()=>({data:{orders:{nodes:[{id:'gid://shopify/Order/'+id,name:'#Fixture',createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-05T00:00:00Z',displayFinancialStatus:'PAID',displayFulfillmentStatus:'UNFULFILLED',currentTotalPriceSet:{shopMoney:{amount:'12.34',currencyCode:'EUR'}},shippingAddress:{name:'Fixture',city:'Fixture',countryCodeV2:'SK'}}],pageInfo:{hasNextPage:repeat||!variables.after,endCursor:'next'}}}})};
  }
  assert(query.includes('MomsOrderLines'));
  return {ok:true,json:async()=>({data:{order:{lineItems:{nodes:[{id:'gid://shopify/LineItem/'+(variables.after?'12':'11'),sku:'Fixture',quantity:2}],pageInfo:{hasNextPage:!variables.after,endCursor:'line-next'}}}}})};
 };
 const since='2026-09-01T00:00:00Z';let result=await shopify.poll({since});assert.equal(result.orders.length,2);assert.equal(result.orders[0].externalOrderId,'9007199254740993');assert.equal(result.orders[0].rawSkus.length,2);assert.equal(result.orders[0].revenueAmount,12.34);assert.equal(tokenCalls,1);
 await shopify.poll({since});assert.equal(tokenCalls,1,'Unexpired token reused');stored.expires_at='2000-01-01';await shopify.poll({since});assert.equal(tokenCalls,2,'Expired token refreshed automatically');
 fail=true;await assert.rejects(shopify.poll({since}),/interrupted/);fail=false;repeat=true;await assert.rejects(shopify.poll({since}),/repeated/);
 console.log('PASS Shopify own-app automatic tokens, refresh, GraphQL order/line pagination, exact IDs and failure guards.');
};
