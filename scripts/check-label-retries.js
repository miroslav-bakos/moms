'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
module.exports=async()=>{
 const records=new Map();let calls=0,mode='gls',failWrite=false;const acquisitions=[],files=[];
 const operations={acquire:async(id,carrier,replacement)=>{acquisitions.push({id,carrier,replacement});if(typeof replacement==='string'&&records.get(id)?.outcome)records.delete(id);const r=records.get(id);if(r){if(r.outcome&&r.carrier===carrier)return r.outcome;throw new Error('Uncertain label');}records.set(id,{carrier});return null;},checkpoint:async()=>{},failed:async()=>{},prepare:async(id,outcome)=>{records.get(id).outcome=outcome;}};
 const config={shipping:{gls:{apiUrl:'https://carrier.invalid',password:'fixture',pickupAddress:{},defaultCountryIso:'SK'},posta:{baseUrl:'https://posta.invalid',sender:{}}}};
 const context={module:{exports:{}},Buffer,AbortSignal,fetch:async(url)=>{calls++;if(mode==='gls')return {ok:true,text:async()=>JSON.stringify({Labels:Buffer.from('%PDF-fixture').toString('base64'),PrintLabelsInfoList:[{ParcelNumber:'123'}]})};if(url.endsWith('/sheets'))return {ok:true,text:async()=>JSON.stringify({sheet:{id:'fixture-sheet'}})};throw new Error('Fixture timeout after sheet creation');},require:name=>{
  if(name==='../config')return {config};if(name==='../db')return {};if(name==='./labelOperations')return operations;if(name==='../paths')return {getPaths:()=>({labelsDir:'/fixture'})};if(name==='fs')return {promises:{mkdir:async()=>{},writeFile:async(file)=>{if(failWrite)throw new Error('Fixture disk failure');files.push(file);}}};return require(name);
 }};
 const load=()=>{const fresh={...context,module:{exports:{}}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/services/labels.js'),'utf8'),fresh);return fresh.module.exports;};
 let labels=load();const order={id:1,external_order_id:'../unsafe',address:'Fixture Name\nHlavna 12\n81101 Bratislava\nSlovakia',skus:'Fixture'};
 let result=await labels.printGlsLabels([order],{});assert(result.results[0].success);assert.equal(calls,1);assert(!result.downloads[0].fileName.includes('..'));
 labels=load();result=await labels.printGlsLabels([order],{});assert(result.results[0].success);assert.equal(calls,1,'Fresh service reuses persisted result');
 const oldFile=files.at(-1);result=await labels.printGlsLabels([order],{}, {1:'/labels/original.pdf'});assert(result.results[0].success);assert.equal(calls,2);assert.equal(acquisitions.at(-1).replacement,'/labels/original.pdf');assert.notEqual(files.at(-1),oldFile,'Replacement uses a new file even within the same second');
 failWrite=true;result=await labels.printGlsLabels([{...order,id:3}],{});assert(!result.results[0].success);assert(!records.get(3).outcome,'Failed file persistence must not mark a label completed');failWrite=false;
 mode='posta';const posta={...order,id:2};result=await labels.printPostaLabels([posta],{},'parcel',{2:'/labels/upload.pdf'});assert.equal(acquisitions.at(-1).replacement,'/labels/upload.pdf');assert(!result.results[0].success);const before=calls;result=await labels.printPostaLabels([posta],{},'parcel');assert(!result.results[0].success);assert.equal(calls,before,'Unknown Posta outcome cannot create another sheet');
 console.log('PASS mocked carrier retry/re-download and uncertain Posta refusal; no network or filesystem writes.');
};
