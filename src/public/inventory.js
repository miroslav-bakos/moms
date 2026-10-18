window.inventoryState = {materials:[],products:[],rules:[],unmapped:[],movements:[]};
function inventoryImage(item) {
  return item?.image && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(item.image) ? `<img class="inventory-item-image" src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name || '')}" loading="lazy">` : '';
}
function setInventoryImagesVisible(visible) {
  document.body.classList.toggle('hide-inventory-images',!visible);
  localStorage.setItem('moms-inventory-images',String(visible));
}
const inventoryImageToggle=document.getElementById('inventoryShowImages');
inventoryImageToggle.checked=localStorage.getItem('moms-inventory-images')!=='false';
setInventoryImagesVisible(inventoryImageToggle.checked);
inventoryImageToggle.addEventListener('change',()=>setInventoryImagesVisible(inventoryImageToggle.checked));
const inventoryQuantity = value => Number(value || 0).toLocaleString(window.i18n?.locale || 'en-GB',{maximumFractionDigits:6});
function renderProductionNeeds(model) {
  if (!model || !model.materials?.length) return '';
  const cards = model.materials.map(material => `<article class="batch-material-card material-needs-card${material.after_queue < 0 ? ' inventory-shortage' : ''}">
    ${inventoryImage(material)}<h4 class="material-needs-name" data-no-translate>${escapeHtml(material.name)}</h4>
    <div class="material-needs-required"><span class="card-meta-label">Needed for queue</span><strong>${inventoryQuantity(material.required)} <small data-no-translate>${escapeHtml(material.unit)}</small></strong></div>
    <dl class="material-needs-stock"><div><dt>In stock</dt><dd>${inventoryQuantity(material.stock)}</dd></div><div><dt>After queue</dt><dd class="${material.after_queue < 0 ? 'inventory-shortage' : ''}">${inventoryQuantity(material.after_queue)}</dd></div></dl>
  </article>`).join('');
  return `<div class="materials-needs-heading"><h3>Materials needed</h3><button type="button" class="secondary" data-open-shopping-list>Open shopping list</button></div><div class="batch-material-grid material-needs-grid">${cards}</div>${model.unmapped?.length ? `<details class="inventory-unmapped"><summary><span>Unmapped or ambiguous SKUs</span> <span data-no-translate>(${model.unmapped.length})</span></summary><p>Configure SKU compositions in Inventory.</p><ul>${model.unmapped.map(sku=>`<li data-no-translate>${escapeHtml(sku)}</li>`).join('')}</ul></details>` : ''}`;
}
async function loadInventory() {
  window.inventoryState = await api('/api/inventory');
  renderInventory();
}
function inventoryTable(headers, rows) {
  return `<div class="inventory-table-wrap"><table class="inventory-table"><thead><tr>${headers.map(header=>`<th>${header}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}">${window.i18n.t('No items configured.')}</td></tr>`}</tbody></table></div>`;
}
function renderQueueReservations(model) {
 const plan=model.reservations;if(!plan)return '';
 const t=text=>escapeHtml(window.i18n.t(text));
 const productName=id=>model.products.find(p=>p.id===id)?.name||id;
 const materialName=id=>model.materials.find(m=>m.id===id)?.name||id;
 const summary=inventoryTable(['Item','Reserved','Available','Missing'],[...plan.products.map(p=>({name:productName(p.product_id),...p})),...plan.materials.map(m=>({name:materialName(m.material_id),...m}))].map(item=>`<tr><td data-no-translate>${escapeHtml(item.name)}</td><td>${inventoryQuantity(item.reserved)}</td><td>${inventoryQuantity(item.available)}</td><td class="${item.missing>0?'inventory-shortage':''}">${inventoryQuantity(item.missing)}</td></tr>`).join(''));
 const rows=plan.allocations.map(a=>`<tr><td>${a.priority}</td><td data-no-translate>${escapeHtml(a.order_number||a.order_id)}</td><td>${a.products.map(p=>`<span data-no-translate>${escapeHtml(productName(p.product_id))}</span>: ${t('Reserved')} ${inventoryQuantity(p.reserved)}, ${t('To produce')} ${inventoryQuantity(p.to_produce)}`).join('<br>')}${a.unmapped.length?`<p><span>${t('Unmapped or ambiguous SKUs')}</span>: <span data-no-translate>${escapeHtml(a.unmapped.join(', '))}</span></p>`:''}</td><td>${a.materials.map(m=>`<span data-no-translate>${escapeHtml(materialName(m.material_id))}</span>: ${t('Reserved')} ${inventoryQuantity(m.reserved)}, ${t('Missing')} ${inventoryQuantity(m.missing)}`).join('<br>')||'—'}</td></tr>`).join('');
 return `<details id="inventoryReservations"><summary>${t('Stock by order')}</summary><p>${t('Planning reservations follow ship-by date, then order date. They are recalculated as orders and stock change. Production can still finish with shortages; completing another order can use these pieces.')}</p>${summary}${inventoryTable(['Priority','Order number','Finished products','Materials'],rows)}</details>`;
}
function renderInventory() {
  const model=window.inventoryState;
  if (!model?.materials) return;
  const actions=(kind,id)=>`<button type="button" class="secondary" data-inventory-edit="${kind}" data-id="${id}">Edit</button> <button type="button" class="secondary" data-inventory-delete="${kind}" data-id="${id}">Delete</button>`;
  document.getElementById('inventoryMaterials').innerHTML=inventoryTable(['Material','Manufacturer','Shop / product','Unit','In stock','Needed for queue','After queue','Unit cost','Actions'],model.materials.map(item=>`<tr><td data-no-translate><div class="inventory-item-name">${inventoryImage(item)}<span>${escapeHtml(item.name)}</span></div></td><td data-no-translate>${escapeHtml(item.manufacturer_name || '—')}</td><td>${inventoryPurchaseLink(item)}</td><td data-no-translate>${escapeHtml(item.unit)}</td><td>${inventoryQuantity(item.stock)}</td><td>${inventoryQuantity(item.required)}</td><td class="${item.after_queue<0?'inventory-shortage':''}">${inventoryQuantity(item.after_queue)}</td><td data-no-translate>${costMoney(item.unit_cost,item.cost_currency)}</td><td>${actions('materials',item.id)} <button type="button" class="secondary" data-shopping-add="${item.id}">Add to shopping list</button></td></tr>`).join(''));
  renderShoppingList(model);
  document.getElementById('inventoryMaterials').insertAdjacentHTML('beforeend',renderQueueReservations(model));
  const materialName=id=>model.materials.find(item=>item.id===id)?.name || id;
  const productName=id=>model.products.find(item=>item.id===id)?.name || id;
  document.getElementById('inventoryProducts').innerHTML='<p class="muted">Product margin uses reference selling price and recipe costs; shipping and marketplace fees are entered per order.</p><p class="muted">Use the same VAT basis for recipe costs and reference prices. VAT defaults do not convert recipe amounts.</p>'+inventoryTable(['Product','Recipe per product','Finished in stock','Needed for queue','From finished stock','To produce','Estimated unit cost','Estimated unit margin','Actions'],model.products.map(item=>`<tr><td data-no-translate><div class="inventory-item-name">${inventoryImage(item)}<span>${escapeHtml(item.name)}</span></div></td><td data-no-translate>${item.recipe.map(line=>`${inventoryQuantity(line.quantity)} × ${escapeHtml(materialName(line.material_id))}`).join('<br>') || '—'}</td><td>${inventoryQuantity(item.stock || 0)}</td><td>${inventoryQuantity(item.required)}</td><td>${inventoryQuantity(item.from_stock || 0)}</td><td>${inventoryQuantity(item.to_produce ?? item.required)}</td><td>${item.estimated_cost?.amount==null?'<span>Cost estimate incomplete</span>':`<span data-no-translate>${costMoney(item.estimated_cost.amount,item.cost_currency)}</span>`}</td><td data-no-translate>${item.estimated_cost?.margin_percent==null?'—':escapeHtml(String(item.estimated_cost.margin_percent))+' %'}</td><td>${actions('products',item.id)} <button type="button" data-finished-stock="${item.id}" data-stock-kind="production">Record production</button> <button type="button" class="secondary" data-finished-stock="${item.id}" data-stock-kind="adjustment">Adjust finished stock</button></td></tr>`).join(''));
  document.getElementById('inventorySkus').innerHTML=inventoryTable(['SKU / pattern','Products per SKU','Actions'],model.rules.map(item=>`<tr><td data-no-translate>${escapeHtml(item.sku)}</td><td data-no-translate>${item.components.map(line=>`${inventoryQuantity(line.quantity)} × ${escapeHtml(productName(line.product_id))}`).join('<br>')}</td><td>${actions('skus',item.id)}</td></tr>`).join(''))+(model.unmapped?.length?`<p class="inventory-shortage"><span>Unmapped or ambiguous SKUs</span>: <span data-no-translate>${escapeHtml(model.unmapped.join(', '))}</span></p>`:'');
  document.getElementById('inventoryMovements').innerHTML=inventoryTable(['Date','Item','Quantity','Reason','Order number'],(model.movements||[]).map(item=>`<tr><td>${fmtDateTime(item.created_at)}</td><td data-no-translate>${escapeHtml(item.material_name)}</td><td>${inventoryQuantity(item.quantity)} <span data-no-translate>${escapeHtml(item.unit)}</span></td><td>${escapeHtml(window.i18n.t(item.reason))}</td><td data-no-translate>${escapeHtml(item.external_order_id || '')}</td></tr>`).join(''));
  document.querySelectorAll('[data-inventory-edit]').forEach(button=>button.addEventListener('click',()=>openInventoryEditor(button.dataset.inventoryEdit,button.dataset.id)));
  document.querySelectorAll('[data-inventory-delete]').forEach(button=>button.addEventListener('click',async()=>{
    if (!confirm('Delete this inventory item?')) return;
    button.disabled=true;
    try {await api(`/api/inventory/${button.dataset.inventoryDelete}/${button.dataset.id}`,{method:'DELETE'});await refreshInventoryViews();}
    catch(error){document.getElementById('inventoryMessage').textContent=error.message;}
    finally{button.disabled=false;}
  }));
  document.querySelectorAll('[data-finished-stock]').forEach(button=>button.addEventListener('click',()=>openFinishedStock(button.dataset.finishedStock,button.dataset.stockKind)));
  filterInventoryTables();
  window.i18n?.apply();
}
const inventorySearches = {};
let inventoryActiveTab = 'materials';
const inventorySearchInput = document.getElementById('inventorySearch');
function filterInventoryTables() {
  const normalize=value=>String(value || '').normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase();
  const search=normalize(inventorySearches[inventoryActiveTab] || '').trim();
  const ids={materials:'inventoryMaterials',products:'inventoryProducts',skus:'inventorySkus',shopping:'inventoryShopping',movements:'inventoryMovements'};
  const table=document.querySelector(`#${ids[inventoryActiveTab]} table`);
  if(!table) return;
  table.querySelector('[data-inventory-empty-search]')?.remove();
  const rows=[...table.querySelectorAll('tbody tr')].filter(row=>!row.querySelector('[colspan]'));
  let shown=0;
  rows.forEach((row,index)=>{
    const cells=[...row.cells];
    const searchable=inventoryActiveTab==='movements'?cells:cells.slice(0,-1);
    const text=searchable.map(cell=>cell.textContent+' '+[...cell.querySelectorAll('a')].map(link=>link.getAttribute('href')).join(' ')).join(' ');
    const shortage=inventoryActiveTab!=='materials' || !document.getElementById('inventoryOnlyShortages').checked || window.inventoryState.materials[index]?.after_queue<0;
    row.hidden=!(normalize(text).includes(search) && shortage);
    if(!row.hidden) shown++;
  });
  if(rows.length && !shown) {
    const row=table.tBodies[0].insertRow();row.dataset.inventoryEmptySearch='true';
    const cell=row.insertCell();cell.colSpan=table.tHead.rows[0].cells.length;cell.textContent=window.i18n.t('No matching items.');
  }
  document.getElementById('inventoryFilterCount').innerHTML=`<span>Shown</span> <span data-no-translate>${shown} / ${rows.length}</span>`;
  window.i18n?.apply();
}
inventorySearchInput.addEventListener('input',()=>{inventorySearches[inventoryActiveTab]=inventorySearchInput.value;filterInventoryTables();});
document.getElementById('inventoryOnlyShortages').addEventListener('change',filterInventoryTables);
document.getElementById('inventoryClearFilters').addEventListener('click',()=>{
  inventorySearches[inventoryActiveTab]='';inventorySearchInput.value='';
  if(inventoryActiveTab==='materials') document.getElementById('inventoryOnlyShortages').checked=false;
  filterInventoryTables();inventorySearchInput.focus();
});
let inventoryEditorDraft;
const inventoryEditorParents = [];
let inventoryEditorBusy = false;
const inventoryUnsavedNotice = document.createElement('section');
inventoryUnsavedNotice.className = 'unsaved-order-notice';
inventoryUnsavedNotice.hidden = true;
inventoryUnsavedNotice.setAttribute('role', 'alert');
inventoryUnsavedNotice.innerHTML = '<p>You have unsaved changes.</p><div class="actions"><button type="button" class="secondary" data-keep-editing>Keep editing</button><button type="button" class="secondary danger-button" data-discard-changes>Discard changes</button></div>';
document.getElementById('inventoryDialog').appendChild(inventoryUnsavedNotice);
let inventoryDiscardFocus;
function inventoryEditorSnapshot() {
  return JSON.stringify({fields:[...document.querySelectorAll('#inventoryEditor input:not([type="file"]),#inventoryEditor select,#inventoryEditor textarea')].map(input=>[input.id || input.dataset.inventoryReference || input.dataset.inventoryQuantity, input.value]),image:(Object.hasOwn(inventoryEditorDraft,'image')?inventoryEditorDraft.image:inventoryEditorDraft.item?.image) || null});
}
function inventoryEditorDirty() {
  return document.getElementById('inventoryDialog').open && inventoryEditorDraft && inventoryEditorSnapshot() !== inventoryEditorDraft.initialSnapshot;
}
function setInventoryEditorBusy(busy) {
  inventoryEditorBusy = busy;
  document.querySelectorAll('#inventoryForm button,#inventoryForm input,#inventoryForm select,#inventoryForm textarea').forEach(control=>{control.disabled=busy;});
}
function discardInventoryEditor() {
  inventoryUnsavedNotice.hidden = true;
  if(!restoreInventoryParent()) document.getElementById('inventoryDialog').close();
}
inventoryUnsavedNotice.querySelector('[data-keep-editing]').addEventListener('click',()=>{inventoryUnsavedNotice.hidden=true;inventoryDiscardFocus?.focus();});
inventoryUnsavedNotice.querySelector('[data-discard-changes]').addEventListener('click',()=>{if(!inventoryEditorBusy)discardInventoryEditor();});
window.addEventListener('beforeunload',event=>{
  if(document.getElementById('inventoryDialog').open && (inventoryEditorBusy || inventoryEditorDirty() || inventoryEditorParents.some(parent=>parent.dirty))) {event.preventDefault();event.returnValue='';}
});

function renderInventoryLines() {
  const draft=inventoryEditorDraft;
  const products=draft.kind==='skus';
  const options=products?window.inventoryState.products:window.inventoryState.materials;
  const field=products?'product_id':'material_id';
  document.getElementById('inventoryRecipeRows').innerHTML=draft.lines.map((line,index)=>`<div class="inventory-recipe-row"><div><label>${products?'Product':'Material'}<input data-inventory-reference="${index}" list="inventoryChoices${index}" required maxlength="100" aria-label="${products?'Product':'Material'}" placeholder="${escapeHtml(window.i18n.t('Choose or type a new name'))}" value="${escapeHtml(line.reference_name ?? options.find(item=>item.id===line[field])?.name ?? '')}"></label><datalist id="inventoryChoices${index}">${options.map(item=>`<option data-no-translate value="${escapeHtml(item.name)}">${!products?escapeHtml(item.unit):''}</option>`).join('')}</datalist><button type="button" class="secondary" data-inventory-create-reference="${index}">${products?'New product':'New material'}</button></div><label>Quantity<input data-inventory-quantity="${index}" type="number" min="0.000001" max="1000000000" step="0.000001" required value="${line.quantity ?? 1}"></label><button type="button" data-inventory-remove-line="${index}" class="secondary">Remove</button></div>`).join('');
  document.querySelectorAll('[data-inventory-reference]').forEach(input=>input.addEventListener('input',()=>{
    const line=draft.lines[Number(input.dataset.inventoryReference)];
    line.reference_name=input.value;
    line[field]=options.find(item=>item.name.trim().toLocaleLowerCase()===input.value.trim().toLocaleLowerCase())?.id;
  }));
  document.querySelectorAll('[data-inventory-create-reference]').forEach(button=>button.addEventListener('click',()=>openInventoryReference(Number(button.dataset.inventoryCreateReference))));
  document.querySelectorAll('[data-inventory-quantity]').forEach(input=>input.addEventListener('input',()=>{draft.lines[Number(input.dataset.inventoryQuantity)].quantity=input.value;}));
  document.querySelectorAll('[data-inventory-remove-line]').forEach(button=>button.addEventListener('click',()=>{draft.lines.splice(Number(button.dataset.inventoryRemoveLine),1);renderInventoryLines();}));
  window.i18n?.apply();
}
function openInventoryReference(index) {
  const draft=inventoryEditorDraft,products=draft.kind==='skus';
  const options=products?window.inventoryState.products:window.inventoryState.materials;
  const field=products?'product_id':'material_id';
  const existing=options.find(item=>item.name.trim().toLocaleLowerCase()===(draft.lines[index].reference_name || '').trim().toLocaleLowerCase());
  if(existing) {draft.lines[index][field]=existing.id;delete draft.lines[index].reference_name;renderInventoryLines();return;}
  inventoryEditorParents.push({draft,costFields:[...document.querySelectorAll('#inventoryEditor [data-cost-field]')].map(input=>[input.id,input.value]),name:document.getElementById('inventoryName').value,index,dirty:inventoryEditorDirty()});
  openInventoryEditor(products?'products':'materials',undefined,true);
  document.getElementById('inventoryName').value=draft.lines[index].reference_name || '';
  inventoryEditorDraft.initialSnapshot=inventoryEditorSnapshot();
  document.getElementById(products?'inventoryName':'inventoryUnit').focus({preventScroll:true});
  document.getElementById('inventoryDialog').scrollTop=0;
}
function openInventoryEditor(kind,id,nested=false) {
  inventoryUnsavedNotice.hidden=true;
  if(!nested) inventoryEditorParents.length=0;
  document.getElementById('inventoryNestedHelp').hidden=!inventoryEditorParents.length;
  const model=window.inventoryState;
  const list=kind==='materials'?model.materials:kind==='products'?model.products:model.rules;
  const item=list.find(item=>item.id===id);
  inventoryEditorDraft={kind,id,item,lines:JSON.parse(JSON.stringify(item?.recipe || item?.components || []))};
  document.getElementById('inventoryFormMessage').textContent='';
  document.getElementById('inventoryDialogTitle').textContent=kind==='materials'?'Material':kind==='products'?'Product recipe':'SKU composition';
  document.getElementById('inventoryEditor').innerHTML=kind==='materials'?`<label>Material name<input id="inventoryName" required maxlength="100" value="${escapeHtml(item?.name || '')}"></label><label>Manufacturer<input id="inventoryManufacturer" list="inventoryManufacturers" maxlength="100" value="${escapeHtml(item?.manufacturer_name || '')}"><datalist id="inventoryManufacturers">${(model.manufacturers || []).map(m=>`<option data-no-translate value="${escapeHtml(m.name)}"></option>`).join('')}</datalist></label><p class="muted">Choose an existing manufacturer or enter a new one.</p><label>Shop / product link<input id="inventoryPurchaseUrl" type="url" maxlength="2000" placeholder="https://" value="${escapeHtml(item?.purchase_url || '')}"></label><label>Unit<input id="inventoryUnit" required maxlength="30" placeholder="pcs, m, g, A4" value="${escapeHtml(item?.unit || '')}"></label><label>In stock<input id="inventoryStock" type="number" step="0.000001" required value="${item?.stock || 0}"></label>`:`<label>${kind==='products'?'Product name':'SKU / pattern'}<input id="inventoryName" required maxlength="${kind==='products'?100:160}" value="${escapeHtml(item?.name || item?.sku || '')}"></label><p class="muted">${kind==='products'?'Enter materials needed for one product. Fractional quantities are supported.':'Enter products contained in one SKU. Exact SKUs take priority over * patterns. A combined SKU can be configured directly or assembled from its + separated parts.'}</p><div id="inventoryRecipeRows"></div><button id="inventoryAddRecipeLine" class="secondary" type="button">${kind==='products'?'Add material':'Add product'}</button>`;
  if(kind!=='skus') {
    const costs=kind==='materials'?{unit_cost:'Unit cost'}:{labour_cost:'Labour cost per product',packaging_cost:'Packaging cost per product',reference_price:'Reference selling price'};
    document.getElementById('inventoryEditor').insertAdjacentHTML('beforeend',`<p class="muted">Leave unknown costs blank. Enter 0 when there is no cost.</p><label>Cost currency<input id="inventoryCostCurrency" data-cost-field maxlength="3" pattern="[A-Za-z]{3}" required value="${escapeHtml(item?.cost_currency || 'EUR')}"></label>${Object.entries(costs).map(([field,label])=>`<label>${label}<input id="inventoryCost_${field}" data-cost-field type="text" inputmode="decimal" pattern="([0-9]+([.,][0-9]{1,6})?|[.,][0-9]{1,6})" value="${escapeHtml(item?.[field] ?? '')}"></label>`).join('')}`);
  }
  renderInventoryImageEditor();
  if(kind!=='materials') {
    renderInventoryLines();
    document.getElementById('inventoryAddRecipeLine').addEventListener('click',()=>{inventoryEditorDraft.lines.push({quantity:1});renderInventoryLines();});
  }
  inventoryEditorDraft.initialSnapshot=inventoryEditorSnapshot();
  if(!document.getElementById('inventoryDialog').open) document.getElementById('inventoryDialog').showModal();
  window.i18n?.apply();
}
async function refreshInventoryViews() {
  await loadInventory();renderDashboard();renderTables();
  if(state.currentPrepBatch) await loadPrepBatches(state.currentPrepBatch.id);
}
document.querySelectorAll('[data-inventory-add]').forEach(button=>button.addEventListener('click',()=>openInventoryEditor(button.dataset.inventoryAdd)));
document.getElementById('refreshInventory').addEventListener('click',()=>refreshInventoryViews().catch(error=>{document.getElementById('inventoryMessage').textContent=error.message;}));
function restoreInventoryParent(createdId) {
  const parent=inventoryEditorParents.pop();
  if(!parent) return false;
  openInventoryEditor(parent.draft.kind,parent.draft.id,true);
  inventoryEditorDraft=parent.draft;
  document.getElementById('inventoryName').value=parent.name;
  for(const [id,value] of parent.costFields || [])document.getElementById(id).value=value;
  if(createdId) {
    const field=parent.draft.kind==='skus'?'product_id':'material_id';
    parent.draft.lines[parent.index][field]=createdId;
    delete parent.draft.lines[parent.index].reference_name;
  }
  renderInventoryLines();
  renderInventoryImageEditor();
  setInventoryEditorBusy(inventoryEditorBusy);
  return true;
}
function cancelInventoryEditor() {
  if(inventoryEditorBusy) return;
  if(!inventoryEditorDirty()) {discardInventoryEditor();return;}
  inventoryDiscardFocus=document.activeElement;
  inventoryUnsavedNotice.hidden=false;
  inventoryUnsavedNotice.querySelector('[data-keep-editing]').focus();
  inventoryUnsavedNotice.scrollIntoView({block:'nearest'});
}
document.getElementById('cancelInventoryItem').addEventListener('click',cancelInventoryEditor);
document.getElementById('inventoryDialog').addEventListener('cancel',event=>{event.preventDefault();cancelInventoryEditor();});
document.getElementById('inventoryForm').addEventListener('submit',async event=>{
  event.preventDefault(); if(inventoryEditorBusy)return;const draft=inventoryEditorDraft;
  if(draft.kind!=='materials') {
    const index=draft.lines.findIndex(line=>!line[draft.kind==='skus'?'product_id':'material_id']);
    if(index!==-1) {openInventoryReference(index);return;}
  }
  setInventoryEditorBusy(true);
  inventoryUnsavedNotice.hidden=true;
  const name=document.getElementById('inventoryName').value;
  const body=draft.kind==='materials'?{name,manufacturer:document.getElementById('inventoryManufacturer').value,purchase_url:document.getElementById('inventoryPurchaseUrl').value,unit:document.getElementById('inventoryUnit').value,stock:document.getElementById('inventoryStock').value,...(draft.item?{expected_stock:draft.item.stock}:{})}:draft.kind==='products'?{name,recipe:draft.lines}:{sku:name,components:draft.lines};
  if(draft.kind!=='skus'){body.cost_currency=document.getElementById('inventoryCostCurrency').value;document.querySelectorAll('#inventoryEditor [id^="inventoryCost_"]').forEach(input=>body[input.id.slice('inventoryCost_'.length)]=input.value);}
  if(Object.hasOwn(draft,'image')) body.image=draft.image;
  try {
    const saved=await api(`/api/inventory/${draft.kind}${draft.id?'/'+draft.id:''}`,{method:draft.id?'PATCH':'POST',body:JSON.stringify(body)});draft.id=saved.id;draft.item={...draft.item,...body,id:saved.id};draft.initialSnapshot=inventoryEditorSnapshot();await loadInventory();if(!restoreInventoryParent(saved.id)) document.getElementById('inventoryDialog').close();await refreshInventoryViews().catch(error=>{document.getElementById('inventoryMessage').textContent=error.message;});}
  catch(error){document.getElementById('inventoryFormMessage').textContent=error.message;}
  finally{setInventoryEditorBusy(false);}
});

function inventoryPurchaseLink(item) {
  try { const url = new URL(item.purchase_url); if (!['http:','https:'].includes(url.protocol) || url.username || url.password) return '—';
    return `<a href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(window.i18n?.t('Open shop / product') || 'Open shop / product')}</a>`;
  } catch (_) { return '—'; }
}
function renderShoppingList(model) {
  const items = model.shopping || [];
  document.getElementById('inventoryShopping').innerHTML = inventoryTable(['Material','Manufacturer','Shop / product','Quantity','Actions'], items.map(entry => {
    const item = model.materials.find(m=>m.id===entry.material_id); if (!item) return '';
    return `<tr><td data-no-translate><div class="inventory-item-name">${inventoryImage(item)}<span>${escapeHtml(item.name)}</span></div></td><td data-no-translate>${escapeHtml(item.manufacturer_name || '—')}</td><td>${inventoryPurchaseLink(item)}</td><td><input type="number" aria-label="${escapeHtml(window.i18n.t('Quantity'))}" min="0.000001" max="1000000000" step="0.000001" data-shopping-quantity="${item.id}" value="${Number(entry.quantity)}"> <span data-no-translate>${escapeHtml(item.unit)}</span></td><td><button type="button" data-shopping-receive="${item.id}">Receive into stock</button> <button type="button" class="secondary" data-shopping-remove="${item.id}">Remove</button></td></tr>`;
  }).join(''));
  const run = async (button, url, options) => {
    button.disabled=true;
    try { await api(url, options); await refreshInventoryViews(); }
    catch(error) { document.getElementById('inventoryMessage').textContent=window.i18n.t(error.message); }
    finally { button.disabled=false; }
  };
  document.querySelectorAll('[data-shopping-add]').forEach(button=>button.addEventListener('click',()=>{
    const item=model.materials.find(m=>m.id===button.dataset.shoppingAdd);
    const existing=items.find(entry=>entry.material_id===item.id);
    const quantity=existing ? Number(existing.quantity) : Math.max(0,Number(item.required)-Number(item.stock)) || 1;
    run(button,`/api/inventory/shopping/${item.id}`,{method:'PUT',body:JSON.stringify({quantity})});
  }));
  document.querySelectorAll('[data-shopping-quantity]').forEach(input=>input.addEventListener('change',()=>{
    if (!input.checkValidity()) { input.reportValidity(); return; }
    run(input,`/api/inventory/shopping/${input.dataset.shoppingQuantity}`,{method:'PUT',body:JSON.stringify({quantity:input.value})});
  }));
  document.querySelectorAll('[data-shopping-remove]').forEach(button=>button.addEventListener('click',()=>run(button,`/api/inventory/shopping/${button.dataset.shoppingRemove}`,{method:'DELETE'})));
  document.querySelectorAll('[data-shopping-receive]').forEach(button=>button.addEventListener('click',()=>openInventoryReceipt(button.dataset.shoppingReceive)));
}

document.addEventListener('click', event => {
  if (event.target.closest('[data-open-shopping-list]')) { setView('inventory'); selectInventoryTab('shopping'); document.getElementById('inventoryShopping').scrollIntoView({block:'start'}); }
});

function renderInventoryImageEditor() {
  document.getElementById('inventoryImageEditor')?.remove();
  const draft=inventoryEditorDraft;
  if(draft.kind==='skus') return;
  document.getElementById('inventoryEditor').insertAdjacentHTML('beforeend',`<div id="inventoryImageEditor"><label>Image (PNG, JPEG or WebP)<input id="inventoryImageFile" type="file" accept="image/png,image/jpeg,image/webp"></label><div id="inventoryImagePreview">${inventoryImage({...draft.item,image:Object.hasOwn(draft,'image')?draft.image:draft.item?.image})}</div><button type="button" class="secondary" id="inventoryRemoveImage">Remove image</button></div>`);
  document.getElementById('inventoryRemoveImage').addEventListener('click',()=>{draft.image=null;renderInventoryImageEditor();window.i18n?.apply();});
  document.getElementById('inventoryImageFile').addEventListener('change',async event=>{
    const file=event.target.files[0];if(!file) return;
    if(inventoryEditorBusy)return;setInventoryEditorBusy(true);
    let bitmap;
    try {
      if(!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size>20*1024*1024) throw new Error(window.i18n.t('Choose a PNG, JPEG or WebP image up to 20 MB.'));
      bitmap=await createImageBitmap(file);
      const scale=Math.min(1,512/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
      draft.image=canvas.toDataURL('image/webp',0.85);
      if(inventoryEditorDraft===draft) {renderInventoryImageEditor();window.i18n?.apply();}
    } catch(error) {document.getElementById('inventoryFormMessage').textContent=error.message;}
    finally {bitmap?.close();setInventoryEditorBusy(false);}
  });
}

function selectInventoryTab(tab) {
  inventoryActiveTab=tab;
  inventorySearchInput.value=inventorySearches[tab] || '';
  document.getElementById('inventoryShortageFilter').hidden=tab!=='materials';
  document.querySelectorAll('[data-inventory-panel]').forEach(panel=>panel.hidden=panel.dataset.inventoryPanel!==tab);
  document.querySelectorAll('[data-inventory-tab]').forEach(button=>{button.classList.toggle('active',button.dataset.inventoryTab===tab);button.setAttribute('aria-pressed',String(button.dataset.inventoryTab===tab));});
  filterInventoryTables();
}
document.querySelectorAll('[data-inventory-tab]').forEach(button=>button.addEventListener('click',()=>selectInventoryTab(button.dataset.inventoryTab)));

function inventorySkuImages(skus) {
  const model=window.inventoryState;
  const products=new Set();
  const key=value=>String(value).trim().toUpperCase().replace(/\s*\+\s*/g,' + ');
  const add=sku=>{
    const exact=model.rules.filter(rule=>key(rule.sku)===key(sku));
    const matching=exact.length?exact:model.rules.filter(rule=>window.dashboardPinHelpers.matchesSku(sku,rule.sku));
    if(matching.length===1) matching[0].components.forEach(line=>products.add(line.product_id));
    else if(!matching.length && sku.includes('+')) sku.split('+').forEach(part=>add(part.trim()));
    else if(!matching.length && /\s+[x×]\s*\d+$/.test(sku)) add(sku.replace(/\s+[x×]\s*\d+$/,''));
  };
  (Array.isArray(skus)?skus:String(skus || '').split(/\n|,/)).forEach(add);
  const images=model.products.filter(product=>products.has(product.id)).map(inventoryImage).join('');
  return images?`<div class="inventory-product-images">${images}</div>`:'';
}

let inventoryAddingShortages=false;
document.querySelectorAll('[data-shopping-shortages]').forEach(button=>button.addEventListener('click',async()=>{
  if(inventoryAddingShortages) return;
  inventoryAddingShortages=true;
  document.querySelectorAll('[data-shopping-shortages]').forEach(control=>control.disabled=true);
  const message=document.getElementById('inventoryMessage');message.textContent='';
  try {
    const result=await api('/api/inventory/shopping/shortages',{method:'POST'});
    await refreshInventoryViews();selectInventoryTab('shopping');
    inventorySearches.shopping='';inventorySearchInput.value='';filterInventoryTables();
    message.textContent=`${window.i18n.t('Added items:')} ${result.added}. ${window.i18n.t('Already on shopping list:')} ${result.existing}.`+(result.unmapped?` ${window.i18n.t('Unmapped SKUs were excluded:')} ${result.unmapped}.`:'');
  } catch(error) {message.textContent=window.i18n.t(error.message);}
  finally {inventoryAddingShortages=false;document.querySelectorAll('[data-shopping-shortages]').forEach(control=>control.disabled=false);}
}));

document.querySelectorAll('[data-shopping-export]').forEach(button=>button.addEventListener('click',async()=>{
  const format=button.dataset.shoppingExport;
  const preview=format==='html'?window.open('','_blank'):null;
  if(format==='html' && !preview) {alert(window.i18n.t('Allow pop-ups to open the print preview.'));return;}
  if(preview) {preview.opener=null;preview.document.body.textContent=window.i18n.t('Preparing print preview…');}
  button.disabled=true;
  try {
    const response=await fetch('/api/inventory/shopping/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({format,language:window.i18n.language})});
    if(!response.ok) {const error=await response.json();throw new Error(window.i18n.t(error.error || 'Export failed.'));}
    if(preview) {
      const html=await response.text();if(preview.closed) return;
      preview.document.open();preview.document.write(html);preview.document.close();preview.focus();preview.print();
    } else {
      const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');
      link.href=url;link.download=`shopping-list.${format}`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    }
  } catch(error) {if(preview && !preview.closed) preview.close();document.getElementById('inventoryMessage').textContent=error.message;}
  finally {button.disabled=false;}
}));

let inventoryReceiptDraft,inventoryReceiptBusy=false;
function inventoryReceiptKey() {
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function openInventoryReceipt(id) {
  const item=window.inventoryState.materials.find(item=>item.id===id);
  const entry=window.inventoryState.shopping.find(entry=>entry.material_id===id);
  if(!item || !entry) return;
  inventoryReceiptDraft={id,expected_quantity:Number(entry.quantity),request_key:inventoryReceiptKey()};
  document.getElementById('inventoryReceiptMaterial').textContent=`${item.name} · ${inventoryQuantity(entry.quantity)} ${item.unit}`;
  const input=document.getElementById('inventoryReceiptQuantity');input.max=entry.quantity;input.value=entry.quantity;
  document.getElementById('inventoryReceiptMessage').textContent='';
  document.getElementById('inventoryReceiptDialog').showModal();input.focus();input.select();
}
document.getElementById('inventoryReceiptQuantity').addEventListener('input',()=>{inventoryReceiptDraft.request_key=inventoryReceiptKey();});
document.getElementById('inventoryReceiptCancel').addEventListener('click',()=>{if(!inventoryReceiptBusy)document.getElementById('inventoryReceiptDialog').close();});
document.getElementById('inventoryReceiptDialog').addEventListener('cancel',event=>{if(inventoryReceiptBusy)event.preventDefault();});
document.getElementById('inventoryReceiptForm').addEventListener('submit',async event=>{
  event.preventDefault();if(inventoryReceiptBusy) return;
  inventoryReceiptBusy=true;
  const controls=[document.getElementById('inventoryReceiptSave'),document.getElementById('inventoryReceiptCancel'),document.getElementById('inventoryReceiptQuantity')];controls.forEach(control=>control.disabled=true);
  const draft=inventoryReceiptDraft;
  try {
    await api(`/api/inventory/shopping/${draft.id}/receive`,{method:'POST',body:JSON.stringify({quantity:document.getElementById('inventoryReceiptQuantity').value,expected_quantity:draft.expected_quantity,request_key:draft.request_key})});
    await refreshInventoryViews();document.getElementById('inventoryReceiptDialog').close();
  }catch(error){document.getElementById('inventoryReceiptMessage').textContent=window.i18n.t(error.message);}
  finally{inventoryReceiptBusy=false;controls.forEach(control=>control.disabled=false);}
});

window.addEventListener('languagechange', () => { if (window.inventoryState) renderInventory(); });

let finishedStockDraft,finishedStockBusy=false;
function openFinishedStock(id,kind) {
  const item=window.inventoryState.products.find(item=>item.id===id);if(!item)return;
  finishedStockDraft={id,kind,expected_stock:Number(item.stock || 0),request_key:window.newOrderRequestKey()};
  document.getElementById('finishedStockTitle').textContent=window.i18n.t(kind==='production'?'Record production':'Adjust finished stock');
  document.getElementById('finishedStockProduct').textContent=item.name;
  document.getElementById('finishedStockCurrent').textContent=inventoryQuantity(item.stock || 0);
  document.getElementById('finishedStockHelp').textContent=window.i18n.t(kind==='production'?'Adds finished products and deducts their recipe materials once.':'Set the actual quantity already made. This does not deduct materials.');
  document.getElementById('finishedStockQuantityLabel').textContent=window.i18n.t(kind==='production'?'Quantity produced':'Actual finished stock');
  const input=document.getElementById('finishedStockQuantity');input.min=kind==='production'?'0.000001':'0';input.value=kind==='production'?'1':String(item.stock || 0);
  document.getElementById('finishedStockMessage').textContent='';
  document.getElementById('finishedStockDialog').showModal();input.focus();
}
document.getElementById('finishedStockQuantity').addEventListener('input',()=>{if(finishedStockDraft)finishedStockDraft.request_key=window.newOrderRequestKey();});
document.getElementById('cancelFinishedStock').addEventListener('click',()=>{if(!finishedStockBusy)document.getElementById('finishedStockDialog').close();});
document.getElementById('finishedStockDialog').addEventListener('cancel',event=>{if(finishedStockBusy)event.preventDefault();});
document.getElementById('finishedStockForm').addEventListener('submit',async event=>{
  event.preventDefault();if(finishedStockBusy || !finishedStockDraft)return;
  const draft={...finishedStockDraft,quantity:document.getElementById('finishedStockQuantity').value};
  finishedStockBusy=true;document.querySelectorAll('#finishedStockForm button,#finishedStockForm input').forEach(control=>control.disabled=true);
  try {
    await api(`/api/inventory/products/${draft.id}/stock`,{method:'POST',body:JSON.stringify(draft)});
    document.getElementById('finishedStockDialog').close();
    await refreshInventoryViews().catch(error=>{document.getElementById('inventoryMessage').textContent=error.message;});
  }catch(error){document.getElementById('finishedStockMessage').textContent=window.i18n.t(error.message);}
  finally{finishedStockBusy=false;document.querySelectorAll('#finishedStockForm button,#finishedStockForm input').forEach(control=>control.disabled=false);}
});
