'use strict';
const assert=require('assert/strict');const fs=require('fs');const path=require('path');const crypto=require('crypto');const {Pool}=require('pg');const ExcelJS=require('exceljs');const {config}=require('../src/config');const original=require('../src/db');
const admin=new Pool({connectionString:config.databaseUrl});const name='moms_import_test_'+crypto.randomBytes(8).toString('hex');let pool;
(async()=>{
 await admin.query(`CREATE DATABASE ${name}`);const url=new URL(config.databaseUrl);url.pathname='/'+name;pool=new Pool({connectionString:url.toString()});
 for(const filename of fs.readdirSync(path.join(__dirname,'../migrations')).filter(n=>n.endsWith('.sql')).sort())await pool.query(fs.readFileSync(path.join(__dirname,'../migrations',filename),'utf8'));
 let race=null;
 require.cache[require.resolve('../src/db')].exports={query:pool.query.bind(pool),withClient:async fn=>{const client=await pool.connect();try{return await fn({query:async(text,args)=>{if(race&&text.startsWith('INSERT INTO orders')&&args[2]===race){const id=race;race=null;await pool.query('INSERT INTO orders(channel,vendor,external_order_id,skus) VALUES(\'manual\',\'Manual\',$1,\'raced\')',[id]);}return client.query(text,args);}});}finally{client.release();}}};
 const service=require('../src/services/orderImport');
 const file=csv=>({filename:'orders.csv',base64:Buffer.from(csv).toString('base64')});
 await pool.query("INSERT INTO orders(channel,vendor,external_order_id,skus,note) VALUES('manual','Manual','existing','protected','keep')");
 const csv='Sales channel;Order number;Products / SKUs;Shipping address;Ship by;Archived;Board status;Tracking number\r\nManual;000123;Munari x2;"Žofia\nHlavná 12";05.10.2026;No;NEW;00009876543210987654321\r\nManual;existing;overwrite;X;2026-10-05;Yes;SHIPPED;\r\nManual;000123;duplicate;X;2026-10-05;No;NEW;';
 const input={...file(csv),defaultArchived:true,duplicatePolicy:'skip',confirmed:true};
 const preview=await service.previewImport(input);assert.equal(preview.valid,1);assert.equal(preview.duplicates,2);assert.equal(preview.invalid,0);assert.equal((await pool.query('SELECT count(*) FROM orders')).rows[0].count,'1');
 const saved=await service.commitImport(input);assert.equal(saved.imported,1);assert.equal(saved.skipped,2);
 const row=(await pool.query("SELECT * FROM orders WHERE external_order_id='000123'")).rows[0];assert.equal(row.address,'Žofia\nHlavná 12');assert.equal(row.tracking_code,'00009876543210987654321');assert.equal(row.shipped,false);assert.equal(row.skus_locked,true);
 assert.equal((await pool.query("SELECT skus FROM orders WHERE external_order_id='existing'")).rows[0].skus,'protected');
 assert.equal((await service.commitImport(input)).imported,0);
 const bad={...file('Sales channel,Order number,Ship by\nManual,bad,31.02.2026'),confirmed:true,duplicatePolicy:'skip'};assert.equal((await service.previewImport(bad)).invalid,1);await assert.rejects(service.commitImport(bad));assert.equal((await pool.query("SELECT count(*) FROM orders WHERE external_order_id='bad'")).rows[0].count,'0');
 await assert.rejects(service.commitImport({...input,duplicatePolicy:'reject'}),/Duplicates/);
 assert.throws(()=>service.parseCsv('Vendor,ID\n"Manual"oops,1'),/quoting/);
 assert.equal(service.strictDate('29.02.2024').slice(0,10),'2024-02-29');assert.throws(()=>service.strictDate('29.02.2023'));
 await assert.rejects(service.previewImport(file('Vendor,Order ID\n"Unclosed,123')),/Unclosed/);
 const workbook=new ExcelJS.Workbook();workbook.addWorksheet('Empty');const sheet=workbook.addWorksheet('Completed');sheet.addRows([['Predajný kanál','Číslo objednávky','Produkty / SKU','Archivovaná','Stav na boarde','Sledovacie číslo','Odoslať do'],['Manual','history-1','Munari x1','Áno','VYROBENÉ','00001234567890123456789',new Date('2026-10-06T12:00:00Z')]]);sheet.getCell('G2').numFmt='yyyy-mm-dd';
 const xlsx={filename:'orders.xlsx',base64:Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64'),sheet:'Completed',confirmed:true,duplicatePolicy:'skip'};
 assert.equal((await service.previewImport({...xlsx,sheet:undefined})).sheet,'Completed');
 const xpreview=await service.previewImport(xlsx);assert.deepEqual(xpreview.sheets,['Empty','Completed']);assert.equal(xpreview.valid,1);assert.equal(xpreview.preview[0].shipped,true);
 const material=crypto.randomUUID();await pool.query('INSERT INTO inventory_materials(id,name,unit,stock) VALUES($1,\'Paper\',\'A4\',10)',[material]);await service.commitImport(xlsx);
 assert.equal(Number((await pool.query('SELECT stock FROM inventory_materials WHERE id=$1',[material])).rows[0].stock),10);
 const baseline=await pool.query("SELECT i.consumed,i.snapshot FROM order_inventory i JOIN orders o ON o.id=i.order_id WHERE o.external_order_id='history-1'");assert.equal(baseline.rows[0].consumed,true);assert.deepEqual(baseline.rows[0].snapshot,[]);
 sheet.getCell('B2').value=1234567890123456;xlsx.base64=Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');assert.equal((await service.previewImport(xlsx)).invalid,1);
 sheet.getCell('B2').value='formula-order';sheet.getCell('C2').value={formula:'1+1',result:2};xlsx.base64=Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');assert.equal((await service.previewImport(xlsx)).invalid,1);
 await pool.query("INSERT INTO orders(channel,vendor,external_order_id,source_payload) VALUES('shopify','Shopify','source-991','{\"order_number\":1371}')");
 const oldShopify=await service.previewImport(file('Sales channel,Order number\nShopify,1371'));assert.equal(oldShopify.duplicates,1);assert.equal(oldShopify.invalid,0);
 const newShopify=await service.previewImport(file('Sales channel,Order number\nShopify,1372'));assert.equal(newShopify.invalid,1);
 const stable={...file('Sales channel,Order number,Source order ID\nShopify,1372,source-992'),confirmed:true,duplicatePolicy:'skip'};assert.equal((await service.commitImport(stable)).imported,1);assert.equal((await pool.query("SELECT order_name FROM orders WHERE external_order_id='source-992'")).rows[0].order_name,'1372');
 const exportedRows=(await pool.query('SELECT o.*,s.label AS workflow_label FROM orders o LEFT JOIN order_workflow_statuses s ON s.id=o.workflow_status')).rows;
 for(const format of ['csv','xlsx']) {const bytes=await require('../src/services/orderExport').exportOrders(exportedRows,format,'sk');const checked=await service.previewImport({filename:'roundtrip.'+format,base64:bytes.toString('base64')});assert.equal(checked.invalid,0);assert.equal(checked.duplicates,exportedRows.length);}
 const raced={...file('Sales channel,Order number\nManual,race-first\nManual,race-second'),confirmed:true,duplicatePolicy:'reject'};race='race-second';await assert.rejects(service.commitImport(raced),/Duplicates/);assert.equal((await pool.query("SELECT count(*) FROM orders WHERE external_order_id='race-first'")).rows[0].count,'0');
 const archiveExport=require('../src/services/archiveExport');
 await pool.query("INSERT INTO orders(channel,vendor,external_order_id,skus,note,shipped,workflow_status) SELECT 'manual','Manual','filtered-'||n,'Paper','filtered-fixture',true,'crafted' FROM generate_series(1,25) n");
 await pool.query("INSERT INTO orders(channel,vendor,external_order_id,note,shipped,pinned) VALUES('manual','Manual','not-matching-pinned','outside-fixture',true,true),('manual','Manual','matching-open','filtered-fixture',false,false)");
 const countBefore=(await pool.query('SELECT count(*) FROM orders')).rows[0].count;
 for(const format of ['csv','xlsx']) {
   const filtered=await archiveExport.exportArchive({format,language:'sk',filters:{note:'filtered-fixture'},sortKey:'external_order_id',sortDir:'asc'});
   if(format==='csv'){const records=service.parseCsv(filtered.bytes.toString());assert.equal(records.length,26);assert(records.slice(1).every(row=>row[0].value.startsWith('filtered-')));}
   else {const book=new ExcelJS.Workbook();await book.xlsx.load(filtered.bytes);assert.equal(book.worksheets[0].rowCount,26);}
 }
 assert.equal((await pool.query('SELECT count(*) FROM orders')).rows[0].count,countBefore,'Export is read-only');
 await assert.rejects(archiveExport.exportArchive({format:'csv',filters:{note:'no-match'}}),/No orders match/);
 assert.throws(()=>archiveExport.archiveExportOptions({format:'csv',filters:{created_at_from:'2026-02-31'}}),/date/);
 assert.throws(()=>archiveExport.archiveExportOptions({format:'exe'}),/CSV/);
 await pool.query("INSERT INTO orders(channel,vendor,external_order_id,note,shipped) SELECT 'manual','Manual','large-'||n,'large-export-fixture',true FROM generate_series(1,5001) n");
 await assert.rejects(archiveExport.exportArchive({format:'csv',filters:{note:'large-export-fixture'}}),/More than 5000/);
 const openExport=require('../src/services/openExport');
 await pool.query("INSERT INTO orders(channel,vendor,external_order_id,skus,note,shipped,workflow_status) SELECT 'manual','Manual','open-filtered-'||n,'Paper_%','open-fixture',false,'crafted' FROM generate_series(1,1105) n");
 await pool.query("INSERT INTO orders(channel,vendor,external_order_id,skus,note,shipped) VALUES('manual','Manual','open-archived','Paper_%','open-fixture',true)");
 const countOpenBefore=(await pool.query('SELECT count(*) FROM orders')).rows[0].count;
 for(const format of ['csv','xlsx']) {
  const result=await openExport.exportOpen({format,language:'sk',filters:{note:'open-fixture',workflow_status:'vyrobené',skus:'_%'},sortKey:'external_order_id',sortDir:'asc'});
  if(format==='csv'){const records=service.parseCsv(result.bytes.toString());assert.equal(records.length,1106);assert(records.slice(1).every(row=>row[0].value.startsWith('open-filtered-')));}
  else {const book=new ExcelJS.Workbook();await book.xlsx.load(result.bytes);assert.equal(book.worksheets[0].rowCount,1106);}
 }
 const boardResult=await openExport.exportOpen({format:'csv',view:'board',boardSearch:'open-fixture',boardStage:'crafted'});
 assert.equal(service.parseCsv(boardResult.bytes.toString()).length,1106);
 await assert.rejects(openExport.exportOpen({format:'csv',view:'board',boardSearch:'open-fixture',boardStage:'new'}),/No orders match/);
 assert.equal((await pool.query('SELECT count(*) FROM orders')).rows[0].count,countOpenBefore);
 await pool.query("INSERT INTO orders(channel,vendor,external_order_id,note) SELECT 'manual','Manual','large-open-'||n,'large-open-fixture' FROM generate_series(1,5001) n");
 await assert.rejects(openExport.exportOpen({format:'csv',filters:{note:'large-open-fixture'}}),/More than 5000/);
 await assert.rejects(openExport.exportOpen({format:'csv',filters:{note:'nonmatching'}}),/No orders match/);
 console.log('Filtered archive export passed: every page, CSV/XLSX, pinned/open exclusions, no writes, empty/invalid filters and explicit size limit.');
 console.log('Import checks passed: CSV/XLSX, SK headers, sheets, no preview writes, exact identifiers, dates/formulas, duplicates/idempotency/race rollback, Shopify source IDs, historical stock baseline');
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(async()=>{if(pool)await pool.end();await original.closePool();try{await admin.query(`DROP DATABASE IF EXISTS ${name}`);}finally{await admin.end();}});
