'use strict';
const {expandOrder,complete}=require('./productionMath');
const SCALE=1000000n;
function fail(message){const error=new Error(message);error.statusCode=400;throw error;}
function costValue(value) {
 if(value===null || value===undefined || value==='')return null;
 const s=String(value).trim().replace(',','.');
 if(!/^(?:\d+(?:\.\d{1,6})?|\.\d{1,6})$/.test(s)||Number(s)>1000000000)fail('Enter a non-negative cost with up to six decimal places.');
 const [whole,part='']=s.split('.');return `${BigInt(whole || '0')}.${part.padEnd(6,'0')}`;
}
function currency(value){if(typeof value!=='string'||!/^[A-Z]{3}$/.test(value.trim().toUpperCase()))fail('Enter a three-letter currency code.');return value.trim().toUpperCase();}
function scaled(value){const s=String(value),negative=s.startsWith('-');const [whole,part='']=(negative?s.slice(1):s).split('.');const fraction=part.slice(0,6).padEnd(6,'0');return (negative?-1n:1n)*(BigInt(whole || '0')*SCALE+BigInt(fraction)+(part.length>6&&Number(part[6])>=5?1n:0n));}
function decimal(value){const sign=value<0n?'-':'';value=value<0n?-value:value;return `${sign}${value/SCALE}.${String(value%SCALE).padStart(6,'0')}`;}
function multiply(value,quantity){return (scaled(value)*scaled(Number(quantity).toFixed(6))+SCALE/2n)/SCALE;}
function margin(revenue,cost){
 const received=scaled(revenue),profit=received-scaled(cost);
 let percent=null;
 if(received!==0n){const numerator=profit*10000n,negative=(numerator<0n)!==(received<0n),absolute=numerator<0n?-numerator:numerator,denominator=received<0n?-received:received;percent=Number((negative?-1n:1n)*((absolute+denominator/2n)/denominator))/100;}
 return {profit:decimal(profit),margin_percent:percent};
}
function productCost(product,materials){
 const missing=[],lines=[];let sum=0n;
 for(const ingredient of product.recipe){
  const material=materials.find(m=>m.id===ingredient.material_id);
  if(!material || material.unit_cost==null)missing.push({reason:'Material unit cost missing',name:material?.name || ingredient.material_id});
  else if(material.cost_currency!==product.cost_currency)missing.push({reason:'Currencies do not match',name:material.name});
  else {const amount=decimal(multiply(material.unit_cost,ingredient.quantity));sum+=scaled(amount);lines.push({name:material.name,quantity:ingredient.quantity,unit_cost:material.unit_cost,amount});}
 }
 for(const field of ['labour_cost','packaging_cost']){if(product[field]==null)missing.push({reason:field==='labour_cost'?'Labour cost missing':'Packaging cost missing',name:product.name});else sum+=scaled(product[field]);}
 const amount=missing.length?null:decimal(sum);
 return {currency:product.cost_currency,amount,missing,lines,labour_cost:product.labour_cost,packaging_cost:product.packaging_cost,reference_price:product.reference_price,...(amount!==null&&product.reference_price!=null?margin(product.reference_price,amount):{profit:null,margin_percent:null})};
}
function productionCost(order,model){
 const expanded=expandOrder(order,model.rules,model.aliases),missing=expanded.unmapped.map(name=>({reason:'SKU composition missing',name})),products=[];
 let sum=0n,code=null;
 for(const [id,quantity] of Object.entries(expanded.totals)){
  const product=model.products.find(p=>p.id===id);
  if(!product){missing.push({reason:'Product recipe missing',name:id});continue;}
  const estimate=productCost(product,model.materials);
  missing.push(...estimate.missing);
  if(code&&estimate.currency!==code)missing.push({reason:'Currencies do not match',name:product.name});
  code=code || estimate.currency;
  const amount=estimate.amount===null?null:decimal(multiply(estimate.amount,quantity));
  if(amount!==null)sum+=scaled(amount);
  products.push({name:product.name,quantity,amount,unit:estimate});
 }
 return {basis:'Configured recipe estimate',currency:code,amount:missing.length?null:decimal(sum),missing,products};
}
const EXTRA_FIELDS=['shipping_cost','marketplace_fee','payment_fee','other_cost'];
function orderCost(order,production,entered,snapshot){
 const missing=[];const moneyCurrency=entered?.currency || order.revenue_currency || production.currency || 'EUR';
 let productionAmount=entered?.production_cost ?? production.amount;
 if(entered?.production_cost==null && production.currency!==moneyCurrency){missing.push({reason:'Currencies do not match',name:'production_cost'});productionAmount=null;}
 if(productionAmount==null)missing.push(...production.missing);
 const revenue=order.revenue_amount;
 if(revenue==null||!/^[-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(String(revenue))||!order.revenue_currency)missing.push({reason:'Order revenue missing',name:''});
 else if(order.revenue_currency!==moneyCurrency)missing.push({reason:'Currencies do not match',name:'revenue_amount'});
 for(const field of EXTRA_FIELDS)if(entered?.[field]==null)missing.push({reason:'Order cost missing',name:field});
 if(order.business_outcome&&order.business_outcome!=='active')missing.push({reason:'Refund or cancellation requires revenue review',name:''});
 const total=productionAmount===null||EXTRA_FIELDS.some(f=>entered?.[f]==null)?null:decimal(EXTRA_FIELDS.reduce((sum,f)=>sum+scaled(entered[f]),scaled(productionAmount)));
 const tax=require('./vat').adjust(revenue,total,entered?.vat);
 missing.push(...tax.missing);
 const result=!missing.length&&tax.total!==null?margin(tax.revenue,tax.total):{profit:null,margin_percent:null};
 return {currency:moneyCurrency,revenue:tax.revenue,recorded_revenue:revenue,recorded_total:total,vat_mode:tax.vat_mode,production:{...production,amount:productionAmount,basis:entered?.production_cost!=null?'Manual production cost':snapshot?'Saved at production completion':complete(order)?'Current estimate; historical cost missing':'Configured recipe estimate'},total:tax.total,missing,...result};
}
module.exports={costValue,currency,productCost,productionCost,orderCost,EXTRA_FIELDS,scaled,decimal,margin};
