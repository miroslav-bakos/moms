const ExcelJS = require('exceljs');
const {query}=require('../db');
const columns=[['name','Material','Materiál',32],['quantity','Quantity','Množstvo',14],['unit','Unit','Jednotka',12],['manufacturer_name','Manufacturer','Výrobca',24],['purchase_url','Shop / product','Obchod / produkt',48]];
function fail(message) {const error=new Error(message);error.statusCode=400;throw error;}
function options(body) {
  if(!body || !['csv','xlsx','html'].includes(body.format)) fail('Choose a valid export format.');
  return {format:body.format,language:body.language==='sk'?'sk':'en'};
}
const escape=value=>String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function csv(value) {
  const text=String(value ?? '');
  const safe=/^[\s]*[=+\-@\t\r]/.test(text)?"'"+text:text;
  return '"'+safe.replace(/"/g,'""')+'"';
}
async function renderShopping(rows,format,language) {
  const headers=columns.map(column=>column[language==='sk'?2:1]);
  const values=rows.map(row=>columns.map(([key])=>key==='quantity'?Number(row[key]):String(row[key] || '')));
  if(format==='csv') return Buffer.from('\uFEFF'+[headers,...values].map(row=>row.map(csv).join(',')).join('\r\n')+'\r\n');
  if(format==='html') {
    const title=language==='sk'?'Nákupný zoznam':'Shopping list';
    return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>@page{size:A4 portrait;margin:12mm}body{font:12px system-ui,sans-serif;color:#111;margin:20px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{text-align:left;vertical-align:top;padding:8px;border-bottom:1px solid #ccc;overflow-wrap:anywhere}th{background:#eee}th:nth-child(2),th:nth-child(3){width:12%}thead{display:table-header-group}tr{break-inside:avoid}a{color:inherit}h1{font-size:22px}@media print{body{margin:0}}</style></head><body><h1>${title}</h1><table><thead><tr>${headers.map(header=>`<th>${escape(header)}</th>`).join('')}</tr></thead><tbody>${values.map(row=>`<tr>${row.map(value=>`<td>${escape(typeof value==='number'?value.toLocaleString(language==='sk'?'sk-SK':'en-GB',{maximumFractionDigits:6}):value)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
  }
  const workbook=new ExcelJS.Workbook();
  const sheet=workbook.addWorksheet(language==='sk'?'Nákupný zoznam':'Shopping list',{views:[{state:'frozen',ySplit:1}]});
  sheet.columns=columns.map((column,index)=>({header:headers[index],key:column[0],width:column[3]}));
  values.forEach(row=>sheet.addRow(row));sheet.getRow(1).font={bold:true};sheet.getColumn('quantity').numFmt='0.######';
  sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:columns.length}};
  sheet.eachRow(row=>row.alignment={vertical:'top',wrapText:true});
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
async function exportShopping(body,execute=query) {
  const {format,language}=options(body);
  const result=await execute(`SELECT m.name,m.unit,m.purchase_url,f.name AS manufacturer_name,s.quantity FROM inventory_shopping_list s JOIN inventory_materials m ON m.id=s.material_id LEFT JOIN inventory_manufacturers f ON f.id=m.manufacturer_id ORDER BY m.name,m.id LIMIT 5001`);
  if(!result.rows.length) fail('The shopping list is empty.');
  if(result.rows.length>5000) fail('Export up to 5000 shopping items at once.');
  return {format,body:await renderShopping(result.rows,format,language)};
}
module.exports={options,renderShopping,exportShopping};
