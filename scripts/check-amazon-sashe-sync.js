'use strict';
// Marketplace responses are mocked. Never contacts production APIs or the DB.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const amazonConfig={lwaClientId:'test',lwaClientSecret:'test',refreshToken:'test',marketplaceIds:{de:'test-de'},ordersApiVersion:'v0',fetchAddress:false};
const config={amazon:amazonConfig,sashe:{userId:'test',apiKey:'test-key'}};
const stub=(file,exports)=>{const filename=require.resolve('../src/'+file);require.cache[filename]={id:filename,filename,loaded:true,exports};};
stub('config',{config});stub('services/tokenStore',{getToken:async()=>({access_token:'test',expires_at:'2099-01-01T00:00:00Z'}),setToken:async()=>{}});
const amazon=require('../src/channels/amazon');const sashe=require('../src/channels/sashe');
const since='2026-09-01T00:00:00.000Z';
const response=data=>({ok:true,status:200,text:async()=>JSON.stringify(data)});
const legacy=id=>({AmazonOrderId:id,PurchaseDate:since,LastUpdateDate:'2026-10-05T00:00:00.000Z'});
(async()=>{
 let calls=0;
 global.fetch=async(url)=>{
  const u=new URL(url);calls++;
  if(u.pathname.endsWith('/orderItems'))return response({payload:{OrderItems:[{SellerSKU:'paper',QuantityOrdered:2}]}});
  const page=Number(u.searchParams.get('NextToken')||1);
  if(page===1)assert.equal(u.searchParams.get('LastUpdatedAfter'),since);
  return response({payload:{Orders:[legacy('order-'+page)],NextToken:page<101?String(page+1):undefined}});
 };
 let result=await amazon.poll({since});assert.equal(result.orders.length,101);assert.equal(calls,202);assert.equal(result.orders[0].rawSkus[0].quantity,2);
 let itemPage=0;
 global.fetch=async(url)=>{
  const u=new URL(url);
  if(!u.pathname.endsWith('/orderItems'))return response({payload:{Orders:[legacy('items')]}});
  itemPage++;return response({payload:{OrderItems:[{SellerSKU:'part-'+itemPage}],NextToken:itemPage===1?'second':undefined}});
 };
 result=await amazon.poll({since});assert.equal(result.orders[0].rawSkus.length,2);
 global.fetch=async(url)=>new URL(url).pathname.endsWith('/orderItems')?response({payload:{OrderItems:[],NextToken:'repeat'}}):response({payload:{Orders:[legacy('repeat-items')]}});
 await assert.rejects(amazon.poll({since}),/repeated a token/);
 global.fetch=async(url)=>new URL(url).pathname.endsWith('/orderItems')?response({payload:{OrderItems:[]}}):response({payload:{Orders:[legacy('repeat-orders')],NextToken:'repeat'}});
 await assert.rejects(amazon.poll({since}),/repeated a token/);
 global.fetch=async(url)=>{const u=new URL(url);if(u.pathname.endsWith('/orderItems'))return response({payload:{OrderItems:[]}});if(u.searchParams.has('NextToken'))throw new Error('Second page failed');return response({payload:{Orders:[legacy('first')],NextToken:'second'}});};
 await assert.rejects(amazon.poll({since}),/Second page failed/);
 amazonConfig.ordersApiVersion='2026-test';calls=0;
 global.fetch=async(url)=>{const u=new URL(url);calls++;if(calls===1)assert.equal(u.searchParams.get('lastUpdatedAfter'),since);return response({orders:[{amazonOrderId:'current',purchaseDate:since,lastUpdatedDate:'2026-10-05T00:00:00Z',orderItems:[{sellerSku:'thread',quantity:3}]}],nextToken:calls===1?'second':undefined});};
 result=await amazon.poll({since});assert.equal(result.orders.length,1);assert.equal(result.orders[0].rawSkus[0].quantity,3);
 global.fetch=async()=>response({orders:[],nextToken:'repeat'});await assert.rejects(amazon.poll({since}),/repeated a token/);
 global.fetch=async()=>response({orders:[{}]});await assert.rejects(amazon.poll({since}),/without an ID/);
 global.fetch=async()=>response({orders:[]});result=await amazon.poll({since});assert.equal(result.nextCursor,since);

 global.fetch=async(url)=>{
  const u=new URL(url);const from=u.searchParams.get('dateTimeFrom');const to=u.searchParams.get('dateTimeTo');
  assert.equal(from,'2026-09-01T00:00:00');assert.equal(u.searchParams.get('hash'),crypto.createHmac('sha256','test-key').update('test'+from+to).digest('hex').toUpperCase());
  return response({packages:[{vs:'000123',creation_date:since,products:[{idRemote:'paper',quantity:1}]},{vs:'000123',creation_date:since,products:[{idRemote:'paper',quantity:2}],tracking_code:'CA123456789SK'}]});
 };
 result=await sashe.poll({since});assert.equal(result.orders.length,1);assert.equal(result.orders[0].externalOrderId,'000123');assert.equal(result.orders[0].rawSkus[0].quantity,2);assert.equal(result.orders[0].trackingCode,'CA123456789SK');
 for(const data of [{},{packages:[{}]},{error_no:1,error_message:'Mock API error'}]) {global.fetch=async()=>response(data);await assert.rejects(sashe.poll({since}));}
 let limitedCalls=0;global.fetch=async()=>{limitedCalls++;return {ok:false,status:429,text:async()=> 'Connection limit reached'};};await assert.rejects(sashe.poll({since}),/429/);assert.equal(limitedCalls,1,'SAShE rate limits must not trigger rapid retries');
 global.fetch=async()=>{throw new Error('Offline');};await assert.rejects(sashe.poll({since}),/Offline/);
 global.fetch=async()=>response({packages:[]});result=await sashe.poll({since});assert.equal(result.nextCursor,since);
 console.log('Amazon/SAShE sync checks passed: 101 order pages, item pages, repeated tokens, deduplication, failures, exact IDs, signed catch-up interval and empty cursor preservation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
