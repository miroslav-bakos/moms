// Costs are recipe estimates or explicit manual amounts; missing values never mean zero.
function costMoney(value,currency){if(value==null)return '—';try{return escapeHtml(new Intl.NumberFormat(window.i18n?.locale || 'en-GB',{style:'currency',currency:currency || 'EUR',maximumFractionDigits:6}).format(value));}catch(_){return escapeHtml(String(value)+' '+String(currency || ''));}}
const orderCostLabels={production_cost:'Manual production cost',shipping_cost:'Shipping cost',marketplace_fee:'Marketplace fee',payment_fee:'Payment fee',other_cost:'Other cost'};
function renderOrderCosts(id,model){
 const section=document.getElementById('orderCosts');if(!section)return;
 const e=model.estimate,entered=model.entered;
 const vat=entered.vat || (Number(entered.revision)===0?model.preferences:null) || {mode:'unreviewed',costs_include_vat:true};
 section.innerHTML=`<h3>Costs and margin</h3><p class="muted">Recipe costs are estimates, including finished stock. Contribution uses the order total and entered costs; it is not accounting net profit.</p><dl class="order-detail-grid"><div class="order-detail-field"><dt>Production cost</dt><dd data-no-translate>${costMoney(e.production.amount,e.currency)}</dd></div><div class="order-detail-field"><dt>Cost source</dt><dd>${escapeHtml(window.i18n.t(e.production.basis))}${e.production.captured_at&&entered.production_cost==null?` <span data-no-translate>${escapeHtml(fmtDateTime(e.production.captured_at))}</span>`:''}</dd></div><div class="order-detail-field"><dt>VAT treatment</dt><dd>${escapeHtml(window.i18n.t(({payer:'VAT adjusted',nonpayer:'Not VAT registered'})[e.vat_mode] || 'VAT not reviewed'))}</dd></div><div class="order-detail-field"><dt>Total cost</dt><dd data-no-translate>${costMoney(e.total,e.currency)}</dd></div><div class="order-detail-field"><dt>Estimated contribution</dt><dd data-cost-result data-no-translate>${costMoney(e.profit,e.currency)}</dd></div><div class="order-detail-field"><dt>Estimated margin</dt><dd data-cost-result data-no-translate>${e.margin_percent==null?'—':escapeHtml(String(e.margin_percent))+' %'}</dd></div></dl>${e.missing.length?`<p>Cost estimate incomplete</p><ul>${e.missing.map(m=>`<li><span>${escapeHtml(window.i18n.t(m.reason))}</span>${m.name?`: <span data-no-translate>${escapeHtml(m.name==='revenue_amount'?window.i18n.t('Order total'):orderCostLabels[m.name]?window.i18n.t(orderCostLabels[m.name]):m.name)}</span>`:''}</li>`).join('')}</ul>`:''}<details><summary>Production cost breakdown</summary>${e.production.products.map(p=>`<details><summary data-no-translate>${escapeHtml(p.name)} × ${escapeHtml(String(p.quantity))}: ${costMoney(p.amount,p.unit.currency)}</summary><ul>${p.unit.lines.map(line=>`<li data-no-translate>${escapeHtml(line.name)}: ${escapeHtml(String(line.quantity))} × ${costMoney(line.unit_cost,p.unit.currency)} = ${costMoney(line.amount,p.unit.currency)}</li>`).join('')}</ul><p><span>Labour cost per product</span>: <span data-no-translate>${costMoney(p.unit.labour_cost,p.unit.currency)}</span></p><p><span>Packaging cost per product</span>: <span data-no-translate>${costMoney(p.unit.packaging_cost,p.unit.currency)}</span></p></details>`).join('') || '—'}</details><form id="orderCostForm"><p class="muted">Leave unknown costs blank. Enter 0 when there is no cost. A manual production cost overrides the recipe estimate.</p><div class="order-detail-grid"><label>Cost currency<input name="currency" maxlength="3" pattern="[A-Za-z]{3}" required value="${escapeHtml(entered.currency)}" data-no-translate></label>${Object.entries(orderCostLabels).map(([field,label])=>`<label>${label}<input name="${field}" inputmode="decimal" type="text" pattern="([0-9]+([.,][0-9]{1,6})?|[.,][0-9]{1,6})" value="${escapeHtml(entered[field] ?? '')}" data-no-translate></label>`).join('')}</div>${vatFields(vat,true)}<div class="actions"><button type="submit">Save costs</button></div><p id="orderCostMessage" role="status"></p></form>`;
 const form=section.querySelector('form');let busy=false;const updateVat=bindVatFields(form);
 form.querySelector('[data-vat-calculate]').addEventListener('click',async()=>{if(busy)return;busy=true;form.querySelectorAll('input,select,button').forEach(c=>c.disabled=true);try{const value=await api('/api/vat-calculate',{method:'POST',body:JSON.stringify({amount:e.recorded_revenue??e.revenue,rate:form.elements.vat_rate.value})});form.elements.vat_revenue.value=value.vat;form.querySelector('#orderCostMessage').textContent=window.i18n.t('VAT calculated. Check the amount and save costs.');}catch(error){form.querySelector('#orderCostMessage').textContent=window.i18n.t(error.message);}finally{busy=false;form.querySelectorAll('input,select,button').forEach(c=>c.disabled=false);updateVat();}});
 const baseline=JSON.stringify([...new FormData(form)]);
 section.costDirty=()=>busy || JSON.stringify([...new FormData(form)])!==baseline;
 section.costGuard=()=>{if(busy)return false;return !section.costDirty() || confirm(window.i18n.t('Discard unsaved costs?'));};
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;busy=true;
  const body={expected_revision:Number(entered.revision)};for(const [name,value] of new FormData(form))if(!name.startsWith('vat_'))body[name]=value;body.vat=vatFormValue(form);
  form.querySelectorAll('input,select,button').forEach(control=>control.disabled=true);
  try {const saved=await api(`/api/orders/${id}/costs`,{method:'PUT',body:JSON.stringify(body)});if(orderCostsVisible(id)&&document.getElementById('orderCosts')===section)renderOrderCosts(id,saved);}
  catch(error){if(orderCostsVisible(id)&&document.getElementById('orderCosts')===section)form.querySelector('#orderCostMessage').textContent=window.i18n.t(error.message);}
  finally{busy=false;form.querySelectorAll('input,select,button').forEach(control=>control.disabled=false);updateVat();}
 });
 window.i18n?.apply();
}
function orderCostsVisible(id){const dialog=document.getElementById('orderDetailsDialog');return dialog.open&&Number(dialog.dataset.detailId)===Number(id);}
async function loadOrderCosts(id){
 document.getElementById('orderCosts')?.remove();
 const section=document.createElement('section');section.id='orderCosts';section.innerHTML='<h3>Costs and margin</h3><p>Loading...</p>';
 document.getElementById('orderDetailsContent').append(section);window.i18n?.apply();
 try {const model=await api(`/api/orders/${id}/costs`);if(orderCostsVisible(id)&&document.getElementById('orderCosts')===section)renderOrderCosts(id,model);}
 catch(error){if(orderCostsVisible(id)&&document.getElementById('orderCosts')===section)section.textContent=window.i18n.t(error.message);}
}

const costDialog=document.getElementById('orderDetailsDialog');
function canLeaveOrderCosts(){return document.getElementById('orderCosts')?.costGuard?.() ?? true;}
costDialog.addEventListener('cancel',event=>{if(!canLeaveOrderCosts())event.preventDefault();});
costDialog.addEventListener('click',event=>{if(event.target.closest('#closeOrderDetails,[data-board-action]')&&!canLeaveOrderCosts()){event.preventDefault();event.stopImmediatePropagation();}},true);
window.addEventListener('beforeunload',event=>{if(costDialog.open&&document.getElementById('orderCosts')?.costDirty?.()){event.preventDefault();event.returnValue='';}});
async function refreshOrderCosts(id){
 const section=document.getElementById('orderCosts');
 if(!section || !orderCostsVisible(id))return;
 if(section.costDirty?.()){section.querySelectorAll('[data-cost-result]').forEach(el=>el.textContent='—');section.querySelector('#orderCostMessage').textContent=window.i18n.t('Order changed. Save costs to refresh the estimate.');return;}
 try{const model=await api(`/api/orders/${id}/costs`);if(orderCostsVisible(id)&&document.getElementById('orderCosts')===section&&!section.costDirty?.())renderOrderCosts(id,model);}
 catch(error){if(orderCostsVisible(id)&&document.getElementById('orderCosts')===section)document.getElementById('orderCostMessage').textContent=window.i18n.t(error.message);}
}
