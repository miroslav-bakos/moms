(() => {
 const supported=order=>['etsy','amazon','shopify'].includes(order.channel);
 function confirmTransition(orders,status){
  const targets=status==='shipped'?orders.filter(supported):[];if(!targets.length)return true;
  if(targets.some(o=>!String(o.tracking_code||'').trim()||o.business_outcome!=='active')){alert(window.i18n.t('Add tracking and use active orders before confirming marketplace dispatch.'));return false;}
  const heading=window.i18n.t('Move to Shipped and send the complete shipment with tracking to the marketplace?');
  return confirm(heading+'\n\n'+targets.map(o=>`${o.channel}: ${o.order_name||o.external_order_id} — ${o.tracking_code}`).join('\n'));
 }
 function message(orders){
  const results=orders.filter(o=>o.dispatch_result);
  if(!results.length)return 'Status saved';
  if(results.some(o=>o.dispatch_result.message==='Reconnect Etsy and approve shipping updates before confirming dispatch.'))return 'Reconnect Etsy and approve shipping updates before confirming dispatch.';
  if(results.some(o=>o.dispatch_result.state!=='confirmed'))return 'Status saved. Marketplace dispatch is not confirmed. Review shipment details.';
  return 'Status saved. Marketplace dispatch confirmed.';
 }
 function action(order){
  if(order.workflow_status!=='shipped'||!supported(order)||order.marketplace_dispatch_state==='confirmed')return '';
  const label=order.marketplace_dispatch_state==='uncertain'?'Check marketplace tracking':'Confirm marketplace dispatch';
  return `<button type="button" data-send-shipped-order="${order.id}">${escapeHtml(window.i18n.t(label))}</button>`;
 }
 async function archive(orders){
  if(!confirmTransition(orders,'shipped'))return null;
  const results=[];
  for(const order of orders){
   let updated=order;
   if(supported(order)){
    updated=await api(`/api/orders/${order.id}`,{method:'PATCH',body:JSON.stringify({workflow_status:'shipped',confirm_marketplace_dispatch:true})});
    if(updated.dispatch_result?.state!=='confirmed'){results.push(updated);continue;}
   }
   const archived=await api(`/api/orders/${order.id}`,{method:'PATCH',body:JSON.stringify({shipped:true})});
   results.push({...archived,dispatch_result:updated.dispatch_result});
  }
  return results;
 }
 window.workflowDispatchUI={confirmTransition,message,action,archive};
})();
