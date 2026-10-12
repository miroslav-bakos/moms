'use strict';
(() => {
  const dialog=document.createElement('dialog');dialog.id='orderImportDialog';dialog.className='order-import-dialog';
  dialog.innerHTML=`<div class="dialog-heading"><h2>Import orders</h2><button type="button" class="secondary" id="closeOrderImport">Close</button></div><p>Review column mapping and rows before importing. Existing orders are never overwritten.</p><p class="muted">Sales channel and either Order number or Source order ID are required.</p><p class="muted">For integrated channels, map the Source order ID. New Shopify rows require it.</p><p class="muted">Completed historical orders do not deduct materials from stock.</p><p id="orderImportFileName" data-no-translate></p><div class="import-options"><label>Worksheet<select id="orderImportSheet"></select></label><label><input type="checkbox" id="orderImportHeader" checked> First row contains column names</label><label><input type="checkbox" id="orderImportArchive" checked> Import into Archive when the Archived column is not mapped</label><label>Duplicates<select id="orderImportDuplicates"><option value="skip">Skip duplicates</option><option value="reject">Stop if duplicates exist</option></select></label></div><p class="muted">Dates: YYYY-MM-DD or DD.MM.YYYY. Excel identifiers with more than 15 digits must be text.</p><div id="orderImportMapping" class="import-mapping"></div><button type="button" id="refreshOrderImport" class="secondary">Refresh preview</button><p id="orderImportMessage" aria-live="polite"></p><p id="orderImportSummary"></p><div id="orderImportErrors" class="danger-text"></div><div id="orderImportPreview" class="import-preview"></div><p class="muted">Preview shows the first 50 rows. Every row is validated before import.</p><div class="dialog-actions"><button type="button" id="confirmOrderImport" disabled>Confirm import</button></div>`;
  document.body.appendChild(dialog);
  const get=id=>document.getElementById(id),t=value=>window.i18n?.t(value)||value;
  let fileData=null,mapping=null,busy=false,preview=null,revision=0,reviewedRevision=-1;
  const request=path=>api(path,{method:'POST',body:JSON.stringify({...fileData,mapping:mapping||undefined,sheet:get('orderImportSheet').value||undefined,hasHeader:get('orderImportHeader').checked,defaultArchived:get('orderImportArchive').checked,duplicatePolicy:get('orderImportDuplicates').value,confirmed:path.endsWith('/commit')})});
  function dirty(){revision++;preview=null;get('confirmOrderImport').disabled=true;get('orderImportMessage').textContent='Refresh the preview after changing options.';}
  function canConfirm(){return !busy&&preview&&reviewedRevision===revision&&!preview.invalid&&preview.valid>0&&(get('orderImportDuplicates').value==='skip'||!preview.duplicates);}
  function setBusy(value){busy=value;get('confirmOrderImport').disabled=!canConfirm();get('refreshOrderImport').disabled=value;get('closeOrderImport').disabled=value;dialog.querySelectorAll('input,select').forEach(element=>element.disabled=value);}
  function render(data){
    preview=data;reviewedRevision=revision;mapping=data.mapping;
    const sheet=get('orderImportSheet');sheet.innerHTML=data.sheets.map(name=>`<option data-no-translate value="${escapeHtml(name)}"${name===data.sheet?' selected':''}>${escapeHtml(name)}</option>`).join('');sheet.closest('label').hidden=!data.sheets.length;
    get('orderImportMapping').innerHTML=data.fields.map(field=>`<label><span>${escapeHtml(t(field.label))}${field.id==='vendor'?' *':''}</span><select data-import-field="${field.id}"><option value="-1">Not mapped</option>${data.columns.map((name,index)=>`<option data-no-translate value="${index}"${mapping[field.id]===index?' selected':''}>${index+1}: ${escapeHtml(name)}</option>`).join('')}</select></label>`).join('');
    get('orderImportMapping').querySelectorAll('select').forEach(element=>element.addEventListener('change',()=>{mapping[element.dataset.importField]=Number(element.value);dirty();}));
    get('orderImportSummary').textContent=`${t('Rows')}: ${data.total} · ${t('Ready to import')}: ${data.valid} · ${t('Duplicates')}: ${data.duplicates} · ${t('Invalid rows')}: ${data.invalid}`;
    get('orderImportErrors').innerHTML=data.errors.map(row=>`<p>${t('Row')} ${row.row}: ${row.errors.map(error=>escapeHtml(t(error))).join('; ')}</p>`).join('');
    get('orderImportPreview').innerHTML=`<table><thead><tr>${['Row','Sales channel','Order number','Products / SKUs','Shipping address','Archived','Board status','Result'].map(label=>`<th>${escapeHtml(t(label))}</th>`).join('')}</tr></thead><tbody>${data.preview.map(row=>`<tr><td>${row.row}</td><td data-no-translate>${escapeHtml(row.vendor)}</td><td data-no-translate>${escapeHtml(row.external_order_id)}</td><td data-no-translate>${escapeHtml(row.skus)}</td><td data-no-translate>${escapeHtml(row.address)}</td><td>${t(row.shipped?'Yes':'No')}</td><td data-no-translate>${escapeHtml(workflowStatusLabel({workflow_status:row.workflow_status}))}</td><td>${row.errors.length?t('Invalid row'):row.duplicate?t('Duplicate'):t('Ready')}</td></tr>`).join('')}</tbody></table>`;
    get('orderImportMessage').textContent='';window.i18n?.apply();get('confirmOrderImport').disabled=!canConfirm();
  }
  async function refresh(){if(!fileData||busy)return;setBusy(true);get('orderImportMessage').textContent='Preparing preview…';try{render(await request('/api/import/orders/preview'));}catch(error){preview=null;get('orderImportMessage').textContent=error.message;}finally{setBusy(false);}}
  get('importCsv').addEventListener('click',()=>get('importCsvFile').click());
  get('importCsvFile').addEventListener('change',async event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;
    if(file.size>5*1024*1024){alert(t('Choose a CSV or XLSX file up to 5 MB.'));return;}
    const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
    fileData={filename:file.name,base64:btoa(binary)};mapping=null;preview=null;revision=0;reviewedRevision=-1;
    get('orderImportSheet').innerHTML='';get('orderImportHeader').checked=true;get('orderImportArchive').checked=true;get('orderImportDuplicates').value='skip';
    for(const id of ['orderImportMapping','orderImportPreview','orderImportErrors','orderImportSummary','orderImportMessage'])get(id).textContent='';
    get('orderImportFileName').textContent=file.name;dialog.showModal();window.i18n?.apply();await refresh();
  });
  get('orderImportHeader').addEventListener('change',()=>{mapping=null;dirty();});
  get('orderImportSheet').addEventListener('change',()=>{mapping=null;dirty();});
  get('orderImportArchive').addEventListener('change',dirty);get('orderImportDuplicates').addEventListener('change',dirty);
  get('refreshOrderImport').addEventListener('click',refresh);
  get('closeOrderImport').addEventListener('click',()=>dialog.close());dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  dialog.addEventListener('close',()=>{fileData=null;mapping=null;preview=null;});
  get('confirmOrderImport').addEventListener('click',async()=>{
    if(!canConfirm())return;setBusy(true);get('orderImportMessage').textContent='Importing…';
    let saved=false;
    try{const result=await request('/api/import/orders/commit');saved=true;get('orderImportMessage').textContent=`${t('Imported')}: ${result.imported} · ${t('Skipped duplicates')}: ${result.skipped}`;fileData=null;preview=null;await loadOrders();renderTables();await loadDashboard();renderDashboard();}
    catch(error){get('orderImportMessage').textContent=(saved?t('Import saved. Refresh failed: '):'')+error.message;}
    finally{setBusy(false);}
  });
})();
