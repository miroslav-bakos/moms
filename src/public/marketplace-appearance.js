(() => {
 const channels={etsy:'Etsy',shopify:'Shopify',amazon:'Amazon',sashe:'SAShE',manual:'Manual',other:'Other'};
 const defaults={etsy:'#f1641e',shopify:'#5e8e3e',amazon:'#232f3e',sashe:'#c0392b',manual:'#0891b2',other:'#6e8fb5'};
 let saved={};
 const t=text=>escapeHtml(window.i18n.t(text));
 function channel(order){if(Object.hasOwn(channels,order.channel))return order.channel;const vendor=String(order.vendor||'').toLowerCase();return Object.keys(channels).find(name=>vendor.includes(name))||'other';}
 function style(value){const color=value?.background_color,alpha=Number(value?.background_alpha);if(typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color)||!Number.isFinite(alpha)||alpha<0||alpha>0.5)return '';return `--marketplace-order-bg:color-mix(in srgb,${color} ${Math.round(alpha*100)}%,var(--panel));`;}
 function attributes(order){const name=channel(order),value=style(saved[name]);return `data-marketplace="${name}"${value?` data-marketplace-colored style="${value}"`:''}`;}
 function render(){const root=document.getElementById('marketplaceAppearance');if(!root)return;
 root.innerHTML=Object.entries(channels).map(([name,label])=>{const value=saved[name]||{};return `<form class="marketplace-color-row" data-marketplace-form="${name}"><h4 data-no-translate>${escapeHtml(label)}</h4><label>${t('Background color')}<input type="color" name="color" value="${escapeHtml(value.background_color||defaults[name])}"></label><label>${t('Color intensity')}<input type="range" name="alpha" min="0" max="50" step="1" value="${Math.round(Number(value.background_alpha??0.15)*100)}"><output data-no-translate>${Math.round(Number(value.background_alpha??0.15)*100)}%</output></label><span class="marketplace-color-preview" style="${style(value)}">${t('Order preview')}</span><div class="actions"><button type="submit">${t('Save')}</button><button type="button" data-reset-marketplace class="secondary">${t('Reset color')}</button></div><p role="status" data-marketplace-message></p></form>`;}).join('');
 root.querySelectorAll('form').forEach(form=>{
  const color=form.elements.color,alpha=form.elements.alpha,preview=form.querySelector('.marketplace-color-preview');
  const update=()=>{form.querySelector('output').textContent=alpha.value+'%';preview.style.cssText=style({background_color:color.value,background_alpha:Number(alpha.value)/100});};color.oninput=update;alpha.oninput=update;
  async function save(reset){form.querySelectorAll('input,button').forEach(el=>el.disabled=true);const message=form.querySelector('[data-marketplace-message]');message.textContent='';
   try{const value=await api(`/api/marketplace-appearance/${form.dataset.marketplaceForm}`,{method:'PATCH',body:JSON.stringify({background_color:reset?null:color.value,background_alpha:reset?0.15:Number(alpha.value)/100})});saved[value.channel]=value;if(reset){color.value=defaults[value.channel];alpha.value='15';form.querySelector('output').textContent='15%';}preview.style.cssText=style(value);message.textContent=window.i18n.t('Saved. Order colors apply to all devices.');renderTables();renderOrderBoard();}
   catch(error){message.textContent=window.i18n.t(error.message);}finally{form.querySelectorAll('input,button').forEach(el=>el.disabled=false);}
  }
  form.onsubmit=event=>{event.preventDefault();save(false);};form.querySelector('[data-reset-marketplace]').onclick=()=>save(true);
 });window.i18n.apply();
 }
 async function load(){try{const rows=await api('/api/marketplace-appearance');document.getElementById('marketplaceAppearanceMessage').textContent='';saved=Object.fromEntries((Array.isArray(rows)?rows:[]).filter(r=>Object.hasOwn(channels,r.channel)).map(r=>[r.channel,r]));render();}catch(_){document.getElementById('marketplaceAppearanceMessage').textContent=window.i18n.t('Could not load marketplace colors. Try again.');render();}}
 window.marketplaceAppearance={attributes,load,channel,style};
})();
