const {query}=require('../db');
const channels=['etsy','shopify','amazon','sashe','manual','other'];
function validate(channel,body={}){
 body=body&&typeof body==='object'&&!Array.isArray(body)?body:{};
 const color=body.background_color,alpha=body.background_alpha;
 if(!channels.includes(channel)||(color!==null&&(typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color)))||typeof alpha!=='number'||!Number.isFinite(alpha)||alpha<0||alpha>0.5||Math.abs(alpha*100-Math.round(alpha*100))>1e-8){const error=new Error('Choose a valid marketplace color and intensity between 0 and 50%.');error.statusCode=400;throw error;}
 return {background_color:color?.toLowerCase()||null,background_alpha:alpha};
}
async function list(){return (await query('SELECT channel,background_color,background_alpha FROM marketplace_order_appearance ORDER BY channel')).rows;}
async function save(channel,body){const value=validate(channel,body);const result=await query('UPDATE marketplace_order_appearance SET background_color=$2,background_alpha=$3 WHERE channel=$1 RETURNING channel,background_color,background_alpha',[channel,value.background_color,value.background_alpha]);if(!result.rows.length){const error=new Error('Marketplace not found.');error.statusCode=404;throw error;}return result.rows[0];}
module.exports={list,save,validate};
