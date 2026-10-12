'use strict';
const ExcelJS = require('exceljs');
const unzipper = require('unzipper');
const { query, withClient } = require('../db');
const { complete } = require('./productionMath');
const FIELDS = [
 ['vendor','Sales channel',['vendor','sales channel','predajny kanal']],
 ['external_order_id','Order number',['order number','cislo objednavky']],
 ['source_order_id','Source order ID',['source order id','zdrojove id objednavky','external_order_id','source_order_id','order id','id']],
 ['skus','Products / SKUs',['products / skus','produkty / sku','sku','skus','products']],
 ['created_at','Order date',['created_at','order date','datum objednavky','created']],
 ['ship_by_date','Ship by',['ship by','odoslat do','ship_by_date']],
 ['address','Shipping address',['shipping address','dodacia adresa','address']],
 ['tracking_code','Tracking number',['tracking number','sledovacie cislo','tracking_code','tracking']],
 ['tracking_url','Tracking URL',['tracking url','odkaz na sledovanie','tracking_url']],
 ['order_url','Order URL',['order url','order_url']],
 ['note','Note',['note','poznamka']],
 ['shipped','Archived',['archived','archivovana','shipped']],
 ['workflow_status','Board status',['board status','stav na boarde','workflow_status','workflow']],
 ['processed','Processed',['processed']], ['packed','Packed',['packed']],
 ['label_created','Label created',['label created','label_created']],
 ['is_gift','Gift order',['gift order','is_gift']], ['gift_message','Gift message',['gift message','gift_message']]
];
const key = value => String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
function invalid(message) { const error = new Error(message); error.statusCode = 400; return error; }
function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/,1)[0];
  const count = delimiter => { let quoted=false,n=0; for(let i=0;i<first.length;i++){if(first[i]==='"'){if(quoted&&first[i+1]==='"')i++;else quoted=!quoted;}else if(!quoted&&first[i]===delimiter)n++;}return n; };
  const delimiter = [',',';','\t'].sort((a,b)=>count(b)-count(a))[0];
  const rows=[]; let row=[],cell='',quoted=false,closed=false;
  function push() { row.push({value:cell,kind:'text'}); cell=''; closed=false; }
  function end() { push(); if(row.some(c=>c.value.trim()))rows.push(row); row=[]; if(rows.length>5001)throw invalid('Import up to 5000 rows.'); }
  for(let i=0;i<text.length;i++) {
    const ch=text[i];
    if(closed&&ch!==delimiter&&ch!=='\n'&&ch!=='\r'){if(ch===' '||ch==='\t')continue;throw invalid('Invalid CSV quoting.');}
    if(ch==='"' && quoted && text[i+1]==='"'){cell+='"';i++;}
    else if(ch==='"'){ if(!quoted && cell)throw invalid('Invalid CSV quoting.');quoted=!quoted;if(!quoted)closed=true; }
    else if(!quoted&&ch===delimiter)push();
    else if(!quoted&&(ch==='\n'||ch==='\r')){if(ch==='\r'&&text[i+1]==='\n')i++;end();}
    else cell+=ch;
    if(row.length>100||cell.length>20000)throw invalid('Import cells or columns are too large.');
  }
  if(quoted)throw invalid('Unclosed CSV quote.');
  if(cell||row.length)end();
  return rows;
}
function excelCell(cell) {
  const raw=cell.value;
  if(raw == null)return {value:'',kind:'text'};
  if(raw instanceof Date)return {value:raw.toISOString().slice(0,10),kind:'text'};
  if(typeof raw==='number')return {value:String(raw),kind:Math.abs(raw)>=1e15?'unsafeNumber':'number'};
  if(typeof raw==='object') {
    if(raw.formula || raw.sharedFormula)return {value:String(raw.result ?? ''),kind:'formula'};
    if(raw.richText)return {value:raw.richText.map(part=>part.text).join(''),kind:'text'};
    if(raw.hyperlink)return {value:String(raw.text||raw.hyperlink),hyperlink:raw.hyperlink,kind:'text'};
    if(raw.error)return {value:raw.error,kind:'formula'};
    return {value:'',kind:'text'};
  }
  return {value:String(raw),kind:'text'};
}
async function readFile(body) {
  if(typeof body?.filename!=='string'||body.filename.length>200||typeof body.base64!=='string'||body.base64.length>7*1024*1024)throw invalid('Choose a CSV or XLSX file up to 5 MB.');
  const bytes=Buffer.from(body.base64,'base64');
  if(!bytes.length||bytes.length>5*1024*1024||bytes.toString('base64')!==body.base64)throw invalid('Choose a CSV or XLSX file up to 5 MB.');
  if(/\.csv$/i.test(body.filename))return {rows:parseCsv(bytes.toString('utf8')),sheets:[],sheet:''};
  if(!/\.xlsx$/i.test(body.filename))throw invalid('Choose a CSV or XLSX file up to 5 MB.');
  const archive=await unzipper.Open.buffer(bytes);
  if(archive.files.length>1500||archive.files.some(f=>!Number.isFinite(f.uncompressedSize))||archive.files.reduce((n,f)=>n+f.uncompressedSize,0)>32*1024*1024)throw invalid('Excel file is too large after decompression.');
  let expanded=0;
  for(const entry of archive.files) {
    if(entry.type==='Directory')continue;
    for await (const chunk of entry.stream()) { expanded+=chunk.length;if(expanded>32*1024*1024)throw invalid('Excel file is too large after decompression.'); }
  }
  const workbook=new ExcelJS.Workbook(); await workbook.xlsx.load(bytes);
  const sheets=workbook.worksheets.map(sheet=>sheet.name);
  const sheet=body.sheet ? workbook.getWorksheet(body.sheet) : workbook.worksheets.find(sheet=>sheet.actualRowCount>0)||workbook.worksheets[0];
  if(!sheet||sheet.rowCount>5001||sheet.columnCount>100)throw invalid('Import up to 5000 rows and 100 columns.');
  const rows=[];
  for(let i=1;i<=sheet.rowCount;i++) {
    const row=sheet.getRow(i); const cells=Array.from({length:sheet.columnCount},(_,j)=>excelCell(row.getCell(j+1)));
    if(cells.some(c=>c.value.length>20000))throw invalid('Import cells or columns are too large.');
    rows.push(cells);
  }
  return {rows,sheets,sheet:sheet.name};
}
function strictDate(value) {
  if(!value.trim())return null;
  let match=value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/);
  if(!match){const sk=value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);if(sk)match=[null,sk[3],sk[2],sk[1]];}
  if(!match)throw new Error('Use YYYY-MM-DD or DD.MM.YYYY for dates.');
  const date=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]),12));
  if(date.getUTCFullYear()!==Number(match[1])||date.getUTCMonth()+1!==Number(match[2])||date.getUTCDate()!==Number(match[3]))throw new Error('Invalid calendar date.');
  return date.toISOString();
}
function bool(value, fallback=false) {
  if(!value.trim())return fallback;
  const normalized=key(value);
  if(['true','yes','ano','y','1'].includes(normalized))return true;
  if(['false','no','nie','n','0'].includes(normalized))return false;
  throw new Error('Use Yes/No or True/False for boolean fields.');
}
function url(value) {
  if(!value.trim())return '';
  // Legacy CSV HYPERLINK is treated as text only; never evaluated.
  const match=value.match(/^=?HYPERLINK\("([^"]+)"(?:[,;].*)?\)$/i); if(match)value=match[1];
  try { const parsed=new URL(value);if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error();return parsed.toString(); }
  catch(_){throw new Error('Use an HTTP or HTTPS URL.');}
}
function channel(vendor) { const name=key(vendor);return ['etsy','shopify','amazon','sashe','ebay','manual'].find(c=>name.includes(c))||'other'; }
async function prepare(body) {
  for(const option of ['hasHeader','defaultArchived']) if(body?.[option]!==undefined&&typeof body[option]!=='boolean')throw invalid('Invalid import options.');
  const file=await readFile(body);
  if(!file.rows.length)throw invalid('The file contains no rows.');
  const hasHeader=body.hasHeader!==false;
  const width=Math.max(...file.rows.map(row=>row.length));
  const columns=Array.from({length:width},(_,i)=>hasHeader ? (file.rows[0][i]?.value||`Column ${i+1}`) : `Column ${i+1}`);
  if(width>100)throw invalid('Import up to 5000 rows and 100 columns.');
  const suggested=Object.fromEntries(FIELDS.map(([field,,aliases])=>[field,aliases.map(alias=>columns.findIndex(name=>key(name)===alias)).find(index=>index>=0)??-1]));
  const mapping=body.mapping||suggested;
  if(typeof mapping!=='object'||Array.isArray(mapping)||Object.keys(mapping).some(name=>!FIELDS.some(f=>f[0]===name))||Object.values(mapping).some(n=>!Number.isInteger(n)||n< -1||n>=width))throw invalid('Invalid column mapping.');
  const selected=Object.values(mapping).filter(n=>n>=0);
  if(new Set(selected).size!==selected.length)throw invalid('Map each column to only one field.');
  const source=file.rows.slice(hasHeader?1:0).map((cells,i)=>({cells,row:i+(hasHeader?2:1)})).filter(r=>r.cells.some(c=>c.value.trim()));
  if(!source.length||source.length>5000)throw invalid('Import 1–5000 non-empty rows.');
  const stages=(await query('SELECT id,label FROM order_workflow_statuses ORDER BY position')).rows;
  const labels={new:['NEW','NOVÉ'],in_progress:['IN PROGRESS','VO VÝROBE'],crafted:['CRAFTED','VYROBENÉ'],ready_for_pickup:['READY FOR PICKUP','PRIPRAVENÉ NA VYZDVIHNUTIE'],shipped:['SHIPPED','ODOSLANÉ']};
  const records=[];const seen=new Set();
  for(const row of source) {
    const record={row:row.row,errors:[],duplicate:false};
    try {
      const values={};
      for(const [field] of FIELDS) {
        const cell=mapping[field]>=0 ? row.cells[mapping[field]] : null;
        if(cell?.kind==='formula')throw new Error('Formula cells must be converted to values before importing.');
        if(['external_order_id','source_order_id','tracking_code'].includes(field)&&cell?.kind==='unsafeNumber')throw new Error('Long order or tracking numbers must be stored as text in Excel.');
        values[field]=String((field.endsWith('_url') ? cell?.hyperlink||cell?.value : cell?.value)||'').trim();record[field]=values[field];
      }
      if(!values.vendor||(!values.external_order_id&&!values.source_order_id))throw new Error('Sales channel and order number are required.');
      if(values.vendor.length>200||values.external_order_id.length>200||values.tracking_code.length>200)throw new Error('Order identifiers are too long.');
      Object.assign(record,values,{channel:channel(values.vendor),skus:values.skus||'Unknown SKU',created_at:strictDate(values.created_at),ship_by_date:strictDate(values.ship_by_date)});
      for(const field of ['shipped','processed','packed','label_created','is_gift'])record[field]=bool(values[field],field==='shipped' ? body.defaultArchived!==false : false);
      record.tracking_url=url(values.tracking_url);record.order_url=url(values.order_url);
      const stage=values.workflow_status ? stages.find(s=>[s.id,s.label,...(labels[s.id]||[])].some(label=>key(label)===key(values.workflow_status))) : stages.find(s=>s.id===(record.shipped?'shipped':'new'))||stages[0];
      if(!stage)throw new Error('Unknown board status.');record.workflow_status=stage.id;
      record.order_name=values.external_order_id||values.source_order_id;
      record.external_order_id=values.source_order_id||values.external_order_id;
      if(record.external_order_id.length>200)throw new Error('Order identifiers are too long.');
      const identity=JSON.stringify([record.channel,record.external_order_id]);
      record.duplicate=seen.has(identity);seen.add(identity);
    }catch(error){record.errors.push(error.message);}
    records.push(record);
  }
  const valid=records.filter(r=>!r.errors.length);
  const existing=await query(`SELECT channel,external_order_id,source_payload->>'order_number' AS display_id FROM orders
    WHERE (channel,external_order_id) IN (SELECT * FROM unnest($1::text[],$2::text[]))
      OR (channel='shopify' AND source_payload->>'order_number'=ANY($3::text[]))`,[valid.map(r=>r.channel),valid.map(r=>r.external_order_id),valid.filter(r=>r.channel==='shopify'&&!r.source_order_id).map(r=>r.order_name)]);
  const identities=new Set(existing.rows.flatMap(r=>[JSON.stringify([r.channel,r.external_order_id]),...(r.channel==='shopify'&&r.display_id?[JSON.stringify([r.channel,r.display_id])]:[])]));
  for(const r of valid) {
    if(identities.has(JSON.stringify([r.channel,r.external_order_id])))r.duplicate=true;
    if(r.channel==='shopify'&&!r.source_order_id&&!r.duplicate)r.errors.push('New Shopify imports require a Source order ID.');
  }
  return {file,columns,mapping,records};
}
function summary(prepared) {
  const {file,columns,mapping,records}=prepared;
  return {sheets:file.sheets,sheet:file.sheet,columns,mapping,fields:FIELDS.map(([id,label])=>({id,label})),total:records.length,valid:records.filter(r=>!r.errors.length&&!r.duplicate).length,invalid:records.filter(r=>r.errors.length).length,duplicates:records.filter(r=>r.duplicate).length,preview:records.slice(0,50).map(r=>({row:r.row,vendor:r.vendor||'',external_order_id:r.external_order_id||'',skus:r.skus||'',address:r.address||'',shipped:r.shipped,workflow_status:r.workflow_status||'',duplicate:r.duplicate,errors:r.errors})),errors:records.filter(r=>r.errors.length).slice(0,100).map(r=>({row:r.row,errors:r.errors}))};
}
async function previewImport(body){return summary(await prepare(body));}
async function commitImport(body) {
  if(body?.confirmed!==true||!['skip','reject'].includes(body.duplicatePolicy))throw invalid('Review and confirm the import first.');
  const prepared=await prepare(body);
  if(prepared.records.some(r=>r.errors.length))throw invalid('Fix all invalid rows before importing.');
  if(body.duplicatePolicy==='reject'&&prepared.records.some(r=>r.duplicate))throw invalid('Duplicates found. Nothing was imported.');
  return withClient(async client=>{
    await client.query('BEGIN');
    let imported=0,skipped=0;
    try {
      for(const row of prepared.records) {
        if(row.duplicate){skipped++;continue;}
        const result=await client.query(`INSERT INTO orders(channel,vendor,external_order_id,order_name,skus,created_at,ship_by_date,address,note,tracking_code,tracking_url,order_url,is_gift,gift_message,processed,packed,label_created,shipped,workflow_status,source_payload,skus_locked,address_locked)
          VALUES($1,$2,$3,$20,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,true,true)
          ON CONFLICT(channel,external_order_id) DO NOTHING RETURNING id`,[row.channel,row.vendor,row.external_order_id,row.skus,row.created_at,row.ship_by_date,row.address,row.note,row.tracking_code,row.tracking_url,row.order_url,row.is_gift,row.gift_message,row.processed,row.packed,row.label_created,row.shipped,row.workflow_status,JSON.stringify({importedFromSpreadsheet:true,filename:body.filename,...(row.channel==='shopify'?{order_number:row.order_name}:{})}),row.order_name]);
        if(!result.rows.length){if(body.duplicatePolicy==='reject')throw invalid('Duplicates found. Nothing was imported.');skipped++;continue;}
        await client.query('INSERT INTO order_inventory(order_id,consumed,snapshot) VALUES($1,$2,\'[]\')',[result.rows[0].id,await require('./inventory').isComplete(client,row)]);
        imported++;
      }
      await client.query('COMMIT');return {ok:true,imported,skipped};
    }catch(error){await client.query('ROLLBACK');throw error;}
  });
}
module.exports={previewImport,commitImport,parseCsv,strictDate};
