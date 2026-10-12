const {config}=require('./inventory');
const {expandOrder,productionDemand,round}=require('./productionMath');
function error(message){const e=new Error(message);e.statusCode=400;throw e;}
async function preview(body={}) {
 const sku=body.sku;
 if(typeof sku!=='string'||!sku.trim()||sku.length>200||/[\x00-\x1f,]/.test(sku))error('Choose one SKU for the trial.');
 const model=await config();
 const order={skus:sku.trim(),workflow_status:'new',shipped:false};
 const expanded=expandOrder(order,model.rules,model.aliases);
 if(expanded.unmapped.length||!Object.keys(expanded.totals).length)error('Map this SKU to a product before running the trial.');
 const demand=productionDemand([order],model.products,model.rules,model.aliases);
 return {sku:sku.trim(),products:demand.products.filter(p=>p.required>0).map(p=>({name:p.name,required:p.required,from_stock:p.from_stock,to_produce:p.to_produce})),materials:model.materials.filter(m=>demand.needs[m.id]>0).map(m=>({name:m.name,unit:m.unit,required:demand.needs[m.id],missing:round(Math.max(0,demand.needs[m.id]-Number(m.stock)))}))};
}
module.exports={preview};
