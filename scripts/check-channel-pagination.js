'use strict';
// Mock both marketplaces; no credentials, database or external requests.
const assert=require('node:assert/strict');
const stub=(file,exports)=>{const filename=require.resolve('../src/'+file);require.cache[filename]={id:filename,filename,loaded:true,exports};};
stub('config',{config:{shopify:{shopDomain:'test.myshopify.com',accessToken:'test',apiVersion:'test'},etsy:{clientId:'test',shopId:'test',apiBaseUrl:'https://etsy.test'}}});
stub('services/tokenStore',{getToken:async()=>({access_token:'test',expires_at:'2099-01-01T00:00:00Z'}),setToken:async()=>{}});
const shopify=require('../src/channels/shopify');const etsy=require('../src/channels/etsy');
const since='2026-09-01T00:00:00.000Z';
const response=(data,next=null)=>({ok:true,status:200,headers:{get:()=>next?`<${next}>; rel="next"`:null},text:async()=>JSON.stringify(data)});
const receipt=(id,updated=1791158400)=>({receipt_id:id,created_timestamp:1791072000,updated_timestamp:updated,transactions:[{sku:'Paper',quantity:1}]});
(async()=>{
 let calls=0;
 global.fetch=async(url)=>{
  calls++;const page=Number(new URL(url).searchParams.get('page_info')||1);
  if(page===1)assert.equal(new URL(url).searchParams.get('updated_at_min'),since);
  return response({orders:[{id:page,updated_at:'2026-10-05T00:00:00Z',created_at:since}]},page<101?`https://test.myshopify.com/orders?page_info=${page+1}`:null);
 };
 let result=await shopify.poll({since});assert.equal(calls,101);assert.equal(result.orders.length,101);
 global.fetch=async()=>response({orders:[{id:1,updated_at:since}]},'https://test.myshopify.com/repeat');
 await assert.rejects(shopify.poll({since}),/repeated/);
 calls=0;global.fetch=async()=>{calls++;if(calls===2)throw new Error('Page failed');return response({orders:[{id:1,updated_at:since}]},'https://test.myshopify.com/second');};
 await assert.rejects(shopify.poll({since}),/Page failed/);
 calls=0;global.fetch=async()=>response({orders:[{id:1,updated_at:since}]},++calls===1?'https://test.myshopify.com/second':null);
 result=await shopify.poll({since});assert.equal(result.orders.length,1);

 calls=0;global.fetch=async(url)=>{
  const params=new URL(url).searchParams;calls++;
  if(params.has('was_shipped'))return response({count:1,results:[{...receipt(1),message_from_buyer:'Updated open order'}]});
  assert.equal(params.get('min_last_modified'),String(Date.parse(since)/1000));
  const offset=Number(params.get('offset'));
  return response({count:10001,results:Array.from({length:offset===10000?1:100},(_,i)=>receipt(offset+i+1))});
 };
 result=await etsy.poll({since});assert.equal(result.orders.length,10001);assert.equal(calls,102);assert.equal(result.orders[0].note,'Updated open order');
 global.fetch=async()=>response({count:10000,results:Array.from({length:100},(_,i)=>receipt(i+1))});
 await assert.rejects(etsy.poll({since}),/repeated/);
 calls=0;global.fetch=async()=>{if(++calls===2)throw new Error('Page failed');return response({count:200,results:Array.from({length:100},(_,i)=>receipt(i+1))});};
 await assert.rejects(etsy.poll({since}),/Page failed/);
 global.fetch=async()=>response({count:1,results:[{...receipt(9),status:'Completed',shipments:[{shipment_notification_timestamp:1791158400,tracking_code:'TRACK'}]}]});
 result=await etsy.poll({since});assert.equal(result.orders[0].shipped,true);
 global.fetch=async()=>response({count:0,results:[]});result=await etsy.poll({since});assert.equal(result.orders.length,0);assert.equal(result.nextCursor,since);
 await require('./check-shopify-owned-app')();
 console.log('Pagination checks passed: Shopify/Etsy over 100 pages, overlapping order deduplication, open receipt refresh, repeated-page rejection, failed-page rejection and empty cursor preservation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
