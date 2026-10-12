// Compare immutable source line identities, never display SKU aliases.
function sameItems(a,b){
 const canonical=items=>JSON.stringify(items.map(i=>[String(i.id),Number(i.quantity)]).sort((x,y)=>x[0].localeCompare(y[0])));
 return Array.isArray(a)&&Array.isArray(b)&&a.length>0&&a.length===b.length&&new Set(a.map(i=>String(i.id))).size===a.length&&new Set(b.map(i=>String(i.id))).size===b.length&&a.every(i=>Number.isSafeInteger(Number(i.quantity))&&Number(i.quantity)>0)&&canonical(a)===canonical(b);
}
function rejected(message){const error=new Error(message);error.httpStatus=409;return error;}
module.exports={sameItems,rejected};
