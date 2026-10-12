const assert = require('assert/strict');
const ExcelJS = require('exceljs');
const { exportOrders, validateExport } = require('../src/services/orderExport');
(async () => {
  for (const body of [{}, {orderIds:[],format:'csv'}, {orderIds:['1'],format:'csv'}, {orderIds:[1],format:'pdf'}]) assert.throws(()=>validateExport(body));
  assert.deepEqual(validateExport({orderIds:[1,1],format:'xlsx',language:'sk'}).orderIds,[1]);
  const rows=[{id:1,external_order_id:'000123',vendor:'Etsy',workflow_label:'Custom state',shipped:false,address:'Žofia\n"Hlavná", 12',skus:'SKU x2',tracking_code:'001234567890123456789',note:'=HYPERLINK("bad")',ship_by_date:'2026-10-05'}];
  const csv=(await exportOrders(rows,'csv','sk')).toString();
  assert(csv.startsWith('\uFEFF'));assert(csv.includes('Číslo objednávky'));assert(csv.includes('"Žofia\n""Hlavná"", 12"'));assert(csv.includes('"\'=HYPERLINK'));assert(csv.includes('"000123"'));
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await exportOrders(rows,'xlsx','en'));
  const sheet=workbook.worksheets[0];
  assert.equal(sheet.getCell('A2').value,'000123');assert.equal(sheet.getCell('H2').value,rows[0].tracking_code);assert.equal(sheet.getCell('J2').value,rows[0].note);assert.equal(sheet.getCell('J2').type,ExcelJS.ValueType.String);assert.equal(sheet.getCell('E2').value,rows[0].address);assert.equal(sheet.getCell('D2').value,'No');
  assert(sheet.autoFilter);assert.equal(sheet.views[0].ySplit,1);
  console.log('Order exports: UTF-8, multiline quoting, formula safety, exact identifiers and XLSX round trip passed');
})().catch(error=>{console.error(error);process.exitCode=1});
