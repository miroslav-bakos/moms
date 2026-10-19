'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
module.exports=async()=>{
 const records=new Map();let calls=0,mode='gls',failWrite=false;const acquisitions=[],files=[],parcels=[];let failCarrier=false,failPrepareId=null;
 const operations={acquire:async(id,carrier,replacement)=>{acquisitions.push({id,carrier,replacement});if(typeof replacement==='string'&&records.get(id)?.outcome)records.delete(id);const r=records.get(id);if(r){if(r.outcome&&r.carrier===carrier)return r.outcome;throw new Error('Uncertain label');}records.set(id,{carrier});return null;},checkpoint:async()=>{},failed:async()=>{},prepare:async(id,outcome)=>{if(id===failPrepareId)throw new Error('Fixture DB failure');records.get(id).outcome=outcome;}};
 const config={shipping:{gls:{apiUrl:'https://carrier.invalid',password:'fixture',pickupAddress:{},defaultCountryIso:'SK'},posta:{baseUrl:'https://posta.invalid',sender:{}}}};
 const context={module:{exports:{}},Buffer,AbortSignal,fetch:async(url,options)=>{calls++;if(mode==='gls'){const list=JSON.parse(options.body).ParcelList;parcels.push(list);if(failCarrier)throw new Error('Fixture carrier timeout');return {ok:true,text:async()=>JSON.stringify({Labels:Buffer.from('%PDF-fixture').toString('base64'),PrintLabelsInfoList:list.map((_,i)=>({ParcelNumber:String(123+i)}))})};}if(url.endsWith('/sheets'))return {ok:true,text:async()=>JSON.stringify({sheet:{id:'fixture-sheet'}})};throw new Error('Fixture timeout after sheet creation');},require:name=>{
  if(name==='../config')return {config};if(name==='../db')return {};if(name==='./labelOperations')return operations;if(name==='../paths')return {getPaths:()=>({labelsDir:'/fixture'})};if(name==='fs')return {promises:{mkdir:async()=>{},writeFile:async(file)=>{if(failWrite)throw new Error('Fixture disk failure');files.push(file);}}};return require(name);
 }};
 const load=()=>{const fresh={...context,module:{exports:{}}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/services/labels.js'),'utf8'),fresh);return fresh.module.exports;};
 let labels=load();const order={id:1,external_order_id:'../unsafe',address:'Fixture Name\nHlavna 12\n81101 Bratislava\nSlovakia',skus:'Fixture'};
 let result=await labels.printGlsLabels([order],{});assert(result.results[0].success);assert.equal(calls,1);assert(!result.downloads[0].fileName.includes('..'));
 labels=load();result=await labels.printGlsLabels([order],{});assert(result.results[0].success);assert.equal(calls,1,'Fresh service reuses persisted result');
 const oldFile=files.at(-1);result=await labels.printGlsLabels([order],{}, {1:'/labels/original.pdf'});assert(result.results[0].success);assert.equal(calls,2);assert.equal(acquisitions.at(-1).replacement,'/labels/original.pdf');assert.notEqual(files.at(-1),oldFile,'Replacement uses a new file even within the same second');
 failWrite=true;result=await labels.printGlsLabels([{...order,id:3}],{});assert(!result.results[0].success);assert(!records.get(3).outcome,'Failed file persistence must not mark a label completed');failWrite=false;

 const batch=[10,11,12].map(id=>({...order,id,external_order_id:`Batch-${id}`}));
 let baseline=calls;
 result=await labels.printGlsLabels(batch,{});
 assert.equal(calls,baseline+1,'Bulk selection makes one GLS request');
 assert.equal(parcels.at(-1).length,3);
 assert.equal(result.downloads.length,1,'Bulk labels download as one carrier PDF');
 assert.equal(result.results.length,3);
 assert.deepEqual(Array.from(result.results,r=>r.trackingNumber),['123','124','125']);
 for(const item of batch){assert.equal(records.get(item.id).outcome.downloads[0].fileName,result.downloads[0].fileName);assert.equal(records.get(item.id).outcome.results[0].orderId,item.id);}
 labels=load();result=await labels.printGlsLabels(batch,{});
 assert.equal(calls,baseline+1,'Batch retry never creates duplicate shipments');assert.equal(result.downloads.length,1,'Shared PDF is deduplicated on retry');assert.equal(result.results.length,3);
 result=await labels.printGlsLabels([batch[1]],{});assert.equal(result.results.length,1);assert.equal(result.results[0].orderId,11);
 baseline=calls;
 result=await labels.printGlsLabels(batch,{},Object.fromEntries(batch.map(item=>[item.id,'/labels/previous-batch.pdf'])));
 assert.equal(calls,baseline+1);assert.equal(parcels.at(-1).length,3);assert.equal(result.downloads.length,1);
 assert(acquisitions.slice(-3).every(item=>item.replacement==='/labels/previous-batch.pdf'));
 baseline=calls;
 result=await labels.printGlsLabels([{...order,id:20,address:''},{...order,id:21},{...order,id:3}],{});
 assert.equal(calls,baseline+1);assert.equal(parcels.at(-1).length,1);assert.equal(result.results.filter(r=>r.success).length,1);assert.equal(result.results.filter(r=>!r.success).length,2);
 failCarrier=true;baseline=calls;const uncertain=[30,31].map(id=>({...order,id}));
 result=await labels.printGlsLabels(uncertain,{});assert(result.results.every(r=>!r.success));assert.equal(result.downloads.length,0);
 failCarrier=false;result=await load().printGlsLabels(uncertain,{});assert(result.results.every(r=>!r.success));assert.equal(calls,baseline+1,'Every order in an ambiguous batch blocks resubmission');
 failPrepareId=40;const partial=[40,41].map(id=>({...order,id}));baseline=calls;
 result=await labels.printGlsLabels(partial,{});assert.equal(result.downloads.length,1);assert.equal(result.results.filter(r=>r.success).length,1);
 failPrepareId=null;result=await load().printGlsLabels(partial,{});assert.equal(calls,baseline+1);assert.equal(result.results.filter(r=>r.success).length,1);
 failWrite=true;const diskFailure=[50,51].map(id=>({...order,id}));baseline=calls;
 result=await labels.printGlsLabels(diskFailure,{});assert(result.results.every(r=>!r.success));failWrite=false;
 result=await load().printGlsLabels(diskFailure,{});assert.equal(calls,baseline+1);assert(result.results.every(r=>!r.success));
 mode='posta';const posta={...order,id:2};result=await labels.printPostaLabels([posta],{},'parcel',{2:'/labels/upload.pdf'});assert.equal(acquisitions.at(-1).replacement,'/labels/upload.pdf');assert(!result.results[0].success);const before=calls;result=await labels.printPostaLabels([posta],{},'parcel');assert(!result.results[0].success);assert.equal(calls,before,'Unknown Posta outcome cannot create another sheet');
 console.log('PASS combined GLS batch, replacement, retry, partial failure and uncertain Posta refusal; no network or filesystem writes.');
};
