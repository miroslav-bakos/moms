const assert=require('assert/strict');
const ExcelJS=require('exceljs');
const {exportShopping}=require('../src/services/shoppingExport');
(async()=>{
 const rows=[{name:'=HYPERLINK("bad")',quantity:'0.5',unit:'A4',manufacturer_name:'Maker <script>',purchase_url:'https://example.com/?a=1&b=2'},{name:'<img src=x onerror=alert(1)>',quantity:'2',unit:'m',manufacturer_name:'',purchase_url:''}];
 let queries=0;
 const execute=async sql=>{queries++;assert(/^SELECT\b/.test(sql));return {rows};};
 for(const language of ['en','sk']) {
  const csv=(await exportShopping({format:'csv',language},execute)).body.toString();
  assert(csv.startsWith('\uFEFF'));assert(csv.includes('"\'=HYPERLINK(""bad"")"'));assert(csv.includes('"0.5"'));
  assert(csv.includes(language==='sk'?'Množstvo':'Quantity'));
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load((await exportShopping({format:'xlsx',language},execute)).body);
  const sheet=workbook.worksheets[0];assert.equal(sheet.getCell('A2').value,rows[0].name);assert.equal(sheet.getCell('B2').value,0.5);assert.equal(sheet.rowCount,3);assert.equal(sheet.getCell('E2').value,rows[0].purchase_url);
  const html=(await exportShopping({format:'html',language},execute)).body;
  assert(html.includes(language==='sk'?'0,5':'0.5'));assert(html.includes('&lt;img'));assert(!html.includes('<script>'));assert(html.includes('a=1&amp;b=2'));assert(html.includes(`lang="${language}"`));assert(html.includes('display:table-header-group'));
 }
 assert.equal(queries,6,'One consistent read per export');
 await assert.rejects(exportShopping({format:'csv'},async()=>({rows:[]})),/empty/);
 await assert.rejects(exportShopping({format:'xlsx'},async()=>({rows:Array(5001).fill(rows[0])})),/5000/);
 await assert.rejects(exportShopping({format:'bad'},()=>{throw Error('Should not query');}),/format/);
 console.log('PASS shopping exports: EN/SK CSV/XLSX/HTML, numeric fractions, formula safety, escaping, one read, limits, empty/invalid requests.');
})().catch(error=>{console.error(error);process.exitCode=1;});
