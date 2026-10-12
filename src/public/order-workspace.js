/* Local working views contain filter preferences only, never customer searches. */
(() => {
  const key='moms-working-views-v1';
  let saved=[]; try { saved=JSON.parse(localStorage.getItem(key)||'[]'); if(!Array.isArray(saved))saved=[]; saved=saved.filter(v=>v&&typeof v.id==='string'&&typeof v.name==='string'&&v.filters&&typeof v.filters==='object'); } catch(_) {}
  let filters={},sort='date',selected='';
  const toggle=document.getElementById('boardFiltersToggle'),panel=document.getElementById('boardManagementPanel');
  toggle.onclick=()=>{panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));};
  const searchToggle=document.getElementById('boardSearchToggle'),searchPanel=document.getElementById('boardSearchPanel');
  searchToggle.onclick=()=>{searchPanel.hidden=!searchPanel.hidden;searchToggle.setAttribute('aria-expanded',String(!searchPanel.hidden));if(!searchPanel.hidden)document.getElementById('boardSearch').focus();};
  const labels={today:'Due today',overdue:'Overdue',address:'Missing address',label:'Missing label',unmapped:'Unmapped SKUs',payment:'Pending payment',unknownPayment:'Unknown payment'};
  const t=value=>window.i18n?.t(value)||value;
  const unmapped=()=>window.inventoryState?.unmapped || [];
  const matches=order=>window.orderFilterHelpers.workMatches(order,filters,unmapped());
  const persist=()=>{try{localStorage.setItem(key,JSON.stringify(saved));}catch(_){}};
  function render(){
    searchToggle.setAttribute('aria-pressed',String(Boolean(document.getElementById('boardSearch').value.trim())));
    const active=Object.values(filters).some(Boolean);
    document.getElementById('orderBoard').classList.toggle('work-filtered',active);
    toggle.setAttribute('aria-pressed',String(active));
    let root=document.getElementById('orderWorkFilters');
    if(!root){root=document.createElement('div');root.id='orderWorkFilters';root.className='work-filters';panel.append(root);}
    const select=(id,label,values,value)=>`<label>${escapeHtml(t(label))}<select id="${id}"><option value="">${escapeHtml(t('All'))}</option>${values.map(([v,l])=>`<option value="${escapeHtml(v)}"${v===value?' selected':''}>${escapeHtml(l)}</option>`).join('')}</select></label>`;
    root.innerHTML=select('workAttention','Attention',Object.entries(labels).map(([v,l])=>[v,t(l)]),filters.attention)+
      select('workVendor','Sales channel',[...new Set(state.openOrders.map(o=>o.vendor))].sort().map(v=>[v,v]),filters.vendor)+
      select('workStage','Status',WORKFLOW_STAGES.filter(([v])=>v!=='shipped').map(([v,l])=>[v,translatedWorkflowLabel(v,l)]),filters.stage)+
      select('workLabel','Label',[['y',t('Yes')],['n',t('No')]],filters.label)+
      `<label>${escapeHtml(t('Ship by from'))}<input id="workFrom" type="date" value="${escapeHtml(filters.from||'')}"></label><label>${escapeHtml(t('Ship by to'))}<input id="workTo" type="date" value="${escapeHtml(filters.to||'')}"></label>`+
      `<label>${escapeHtml(t('Sort'))}<select id="workSort"><option value="date"${sort==='date'?' selected':''}>${escapeHtml(t('Ship by'))}</option><option value="newest"${sort==='newest'?' selected':''}>${escapeHtml(t('Newest first'))}</option></select></label>`+
      select('workSaved','Saved views',saved.map(v=>[v.id,v.name]),selected)+
      `<div class="actions"><button id="workSave" type="button">${escapeHtml(t('Save view'))}</button><button id="workRename" type="button"${!selected?' disabled':''}>${escapeHtml(t('Rename'))}</button><button id="workDelete" type="button"${!selected?' disabled':''}>${escapeHtml(t('Delete view'))}</button><button id="workClear" type="button">${escapeHtml(t('Clear filters'))}</button></div><p class="work-filter-summary" role="status">${escapeHtml(t('Matching orders'))}: ${state.openOrders.filter(o=>matches(o)&&window.orderFilterHelpers.boardMatches(o,document.getElementById('boardSearch').value)).length} / ${state.openOrders.length}${state.orderLoadErrors?.open?' — '+escapeHtml(t('Displayed data may be outdated.')):''}</p>`;
    for(const [id,field]of Object.entries({workAttention:'attention',workVendor:'vendor',workStage:'stage',workLabel:'label',workFrom:'from',workTo:'to'}))root.querySelector('#'+id).onchange=event=>{filters[field]=event.target.value;selected='';renderOrderBoard();};
    root.querySelector('#workSort').onchange=event=>{sort=event.target.value;renderOrderBoard();};
    root.querySelector('#workSaved').onchange=event=>{selected=event.target.value;const view=saved.find(v=>v.id===selected);filters=view?{...view.filters}:{};sort=view?.sort||'date';renderOrderBoard();};
    root.querySelector('#workClear').onclick=()=>{filters={};selected='';sort='date';document.getElementById('boardSearch').value='';renderOrderBoard();};
    root.querySelector('#workSave').onclick=()=>{const name=prompt(t('View name'));if(!name?.trim())return;const id=String(Date.now());saved.push({id,name:name.trim().slice(0,100),filters:{...filters},sort});selected=id;persist();render();};
    root.querySelector('#workRename').onclick=()=>{const view=saved.find(v=>v.id===selected);if(!view)return;const name=prompt(t('View name'),view.name);if(!name?.trim())return;view.name=name.trim().slice(0,100);persist();render();};
    root.querySelector('#workDelete').onclick=()=>{saved=saved.filter(v=>v.id!==selected);selected='';persist();render();};
  }
  function dashboard(){return `<div class="dash-grid work-alerts">${Object.entries(labels).map(([kind,label])=>`<button type="button" class="dash-card" data-work-alert="${kind}"><span class="dash-label">${escapeHtml(t(label))}</span><strong class="dash-big">${state.openOrders.filter(o=>window.orderFilterHelpers.workMatches(o,{attention:kind},unmapped())).length}</strong></button>`).join('')}</div>`;}
  function bindDashboard(root){root.querySelectorAll('[data-work-alert]').forEach(button=>button.onclick=()=>{filters={attention:button.dataset.workAlert};selected='';document.getElementById('boardSearch').value='';state.boardStage='new';setView('board');renderOrderBoard();});}
  const dispatchTime=order=>{for(const value of [order.dispatched_at,order.created_at,order.imported_at]){const time=Date.parse(value);if(Number.isFinite(time))return time;}return -Infinity;};
  window.orderWorkspace={clear(){filters={};selected='';},render,dashboard,bindDashboard,matches,get filters(){return {...filters};},sortOrders(orders,stage){if(stage==='shipped')return orders.sort((a,b)=>dispatchTime(b)-dispatchTime(a)||Number(b.id)-Number(a.id));return orders.sort((a,b)=>sort==='newest'?String(b.created_at||b.imported_at||'').localeCompare(String(a.created_at||a.imported_at||'')):String(a.ship_by_date||'9999').localeCompare(String(b.ship_by_date||'9999')));}};
})();
