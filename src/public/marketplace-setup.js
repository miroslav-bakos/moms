'use strict';
(async()=>{
 const status=document.getElementById('status'),callback=document.getElementById('callback'),buttons=[...document.querySelectorAll('[data-callback]')];
 try {
  const response=await fetch('/marketplace-guides.json?v=1');if(!response.ok)throw new Error();const guides=await response.json();
  const root=document.getElementById('guides');
  for(const guide of guides){const section=document.createElement('section'),heading=document.createElement('h2'),list=document.createElement('ol');heading.textContent=guide.name;heading.dataset.noTranslate='';section.append(heading);for(const step of guide.steps){const item=document.createElement('li');item.textContent=step;list.append(item);}section.append(list);for(const [title,url] of guide.links){const p=document.createElement('p'),a=document.createElement('a');a.textContent=title;a.href=url;a.target='_blank';a.rel='noopener noreferrer';p.append(a);section.append(p);}root.append(section);}
  await window.i18n.ready;window.i18n.apply();
 }catch(_){status.textContent=window.i18n.t('Could not load the setup guide. Reload this page.');}
 buttons.forEach(button=>button.onclick=async()=>{
  buttons.forEach(b=>b.disabled=true);status.textContent=window.i18n.t('Checking callback setup. This may take up to one minute.');callback.textContent='';
  try{
   const response=await fetch('/api/marketplace-callbacks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:button.dataset.callback})});const result=await response.json();if(!response.ok){if(result.approvalUrl){const url=new URL(result.approvalUrl);if(url.protocol==='https:'&&url.hostname==='login.tailscale.com'){const link=document.createElement('a');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=window.i18n.t('Approve in Tailscale, then retry');callback.append(link);}}throw new Error(result.error||'Callback setup failed.');}
   status.textContent=window.i18n.t(result.enabled?'Callback enabled. Copy this exact Etsy address into your Etsy app:':'Callback disabled.');
   if(result.enabled)callback.textContent=result.url+'/auth/etsy/callback';
  }catch(error){status.textContent=window.i18n.t(error.message);}
  finally{buttons.forEach(b=>b.disabled=false);}
 });
})();
