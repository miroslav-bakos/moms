'use strict';
function fail(message){const e=new Error(message);e.statusCode=400;throw e;}
function rate(value){
 if(value===null||value===undefined||value==='')return null;
 const text=String(value).trim().replace(',','.');
 if(!/^\d{1,3}(?:\.\d{1,2})?$/.test(text)||Number(text)>100)fail('Enter a VAT rate between 0 and 100 with up to two decimal places.');
 return Number(text);
}
function normalize(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||!['unreviewed','nonpayer','payer'].includes(value.mode)||typeof value.costs_include_vat!=='boolean')fail('Choose a valid VAT treatment.');
 const selected=rate(value.rate);
 const {costValue}=require('./costMath');
 const result={mode:value.mode,rate:selected,costs_include_vat:value.costs_include_vat};
 if(value.mode==='payer'){
  if(selected===null)fail('Set your VAT rate.');
  result.revenue_vat=costValue(value.revenue_vat);
  result.deductible_vat=value.costs_include_vat?costValue(value.deductible_vat):'0.000000';
 }
 return result;
}
function adjust(revenue,total,vat){
 const {scaled,decimal}=require('./costMath');
 const base={revenue,total,vat_mode:vat?.mode||'unreviewed',missing:[]};
 if(vat?.mode!=='payer')return base;
 const missing=[];
 if(Object.hasOwn(vat,'revenue_basis')&&(vat.revenue_basis==null||revenue==null||!Number.isFinite(Number(revenue))||Number(vat.revenue_basis)!==Number(revenue)))missing.push({reason:'Order revenue changed. Review VAT.',name:''});
 if(vat.revenue_vat==null)missing.push({reason:'Revenue VAT amount missing',name:''});
 if(vat.deductible_vat==null)missing.push({reason:'Deductible input VAT amount missing',name:''});
 if(missing.length)return {...base,revenue:null,total:null,missing};
 if(revenue==null||total==null||!/^[-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(String(revenue)))return {...base,revenue:null,total:null};
 const output=scaled(vat.revenue_vat),input=scaled(vat.deductible_vat);
 if(output>scaled(revenue)||input>scaled(total))return {...base,revenue:null,total:null,missing:[{reason:'VAT exceeds the recorded amount',name:''}]};
 return {...base,revenue:decimal(scaled(revenue)-output),total:decimal(scaled(total)-input)};
}
// This is an explicit helper for one gross amount at one rate, not a tax rule.
function fromGross(amount,selectedRate){
 const {costValue,scaled,decimal}=require('./costMath');const value=costValue(amount),r=rate(selectedRate);
 if(value===null||r===null)fail('Enter a gross amount and VAT rate.');
 const gross=scaled(value),basis=BigInt(Math.round(r*100)),denominator=10000n+basis;
 const tax=(gross*basis+denominator/2n)/denominator;
 return {net:decimal(gross-tax),vat:decimal(tax)};
}
async function get(execute=require('../db').query){return (await execute('SELECT mode,rate,costs_include_vat,revision FROM seller_vat_preferences WHERE id=true')).rows[0];}
async function save(body){
 const normalized=normalize(body);
 if(!Number.isSafeInteger(body.expected_revision)||body.expected_revision<0)fail('Invalid VAT settings revision.');
 const result=await require('../db').query(`UPDATE seller_vat_preferences SET mode=$1,rate=$2,costs_include_vat=$3,revision=revision+1 WHERE id=true AND revision=$4 RETURNING mode,rate,costs_include_vat,revision`,[normalized.mode,normalized.rate,normalized.costs_include_vat,body.expected_revision]);
 if(!result.rowCount){const e=new Error('VAT settings changed. Reload and try again.');e.statusCode=409;throw e;}return result.rows[0];
}
module.exports={rate,normalize,adjust,fromGross,get,save};
