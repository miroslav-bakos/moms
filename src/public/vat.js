// VAT is an explicit seller choice, independent of occupation or business form.
function vatFields(value={},order=false){
 const v=value||{},mode=v.mode||'unreviewed';
 return `<fieldset class="vat-fields"><legend>VAT treatment</legend><p class="muted">For sole traders, artists and companies. Business type does not determine VAT registration.</p><div class="order-detail-grid"><label>VAT status<select name="vat_mode"><option value="unreviewed" ${mode==='unreviewed'?'selected':''}>VAT not reviewed</option><option value="nonpayer" ${mode==='nonpayer'?'selected':''}>Not VAT registered</option><option value="payer" ${mode==='payer'?'selected':''}>VAT registered</option></select></label><label>Default VAT rate (%)<input name="vat_rate" type="text" inputmode="decimal" value="${escapeHtml(v.rate??'')}" data-no-translate></label><label>Entered cost amounts<select name="vat_cost_basis"><option value="gross" ${v.costs_include_vat!==false?'selected':''}>Including VAT</option><option value="net" ${v.costs_include_vat===false?'selected':''}>Excluding deductible VAT</option></select></label></div>${order?`<div class="order-detail-grid"><label>VAT included in order revenue<input name="vat_revenue" inputmode="decimal" value="${escapeHtml(v.revenue_vat??'')}" data-no-translate></label><label>Deductible VAT included in recorded costs<input name="vat_deductible" inputmode="decimal" value="${escapeHtml(v.deductible_vat??'')}" data-no-translate></label></div><button type="button" class="secondary" data-vat-calculate>Calculate revenue VAT at this rate</button><p class="muted">Use the calculator only if the entire order total includes VAT at this single rate. For mixed rates or marketplace-collected taxes, enter the verified VAT amount manually. Enter only deductible VAT actually included in recorded costs; own labour is not automatically taxed. Recipe and extra costs must use the selected basis; do not deduct VAT twice.</p>`:''}<p class="muted">Not VAT registered: no VAT is deducted. VAT registered: revenue VAT and deductible input VAT are entered explicitly for each order. Changing defaults does not rewrite saved orders or recipe costs.</p></fieldset>`;
}
function vatFormValue(form){return {mode:form.elements.vat_mode.value,rate:form.elements.vat_rate.value,costs_include_vat:form.elements.vat_cost_basis.value==='gross',revenue_vat:form.elements.vat_revenue?.value,deductible_vat:form.elements.vat_deductible?.value};}
function bindVatFields(form){
 const update=()=>{const payer=form.elements.vat_mode.value==='payer';
 for(const name of ['vat_rate','vat_cost_basis','vat_revenue','vat_deductible'])if(form.elements[name])form.elements[name].disabled=!payer;
 if(form.elements.vat_deductible)form.elements.vat_deductible.disabled=!payer||form.elements.vat_cost_basis.value==='net';
 form.querySelector('[data-vat-calculate]')?.toggleAttribute('disabled',!payer);
 };form.elements.vat_mode.addEventListener('change',update);form.elements.vat_cost_basis.addEventListener('change',update);update();return update;
}
async function loadVatPreferences(){
 const root=document.getElementById('vatPreferences');if(!root||root.dataset.loaded)return;root.dataset.loaded='true';root.innerHTML='<p>Loading...</p>';
 try{
 const data=await api('/api/vat-preferences');
 root.innerHTML=`<h3>VAT defaults</h3><form id="vatPreferencesForm">${vatFields(data)}<button type="submit">Save VAT defaults</button><p role="status"></p></form>`;
 const form=root.querySelector('form');bindVatFields(form);let revision=Number(data.revision),busy=false;
 form.addEventListener('submit',async event=>{event.preventDefault();if(busy)return;busy=true;const button=form.querySelector('button[type=submit]');button.disabled=true;
 try{const saved=await api('/api/vat-preferences',{method:'PUT',body:JSON.stringify({...vatFormValue(form),expected_revision:revision})});revision=Number(saved.revision);form.querySelector('[role=status]').textContent=window.i18n.t('VAT defaults saved. Existing orders are unchanged.');}
 catch(error){form.querySelector('[role=status]').textContent=window.i18n.t(error.message);}finally{busy=false;button.disabled=false;}});
 }catch(error){delete root.dataset.loaded;root.textContent=window.i18n.t(error.message);}
 window.i18n?.apply();
}
