(() => {
 const t=text=>escapeHtml(window.i18n.t(text));
 let latest=null;
 async function load(){
  let root=document.getElementById('serviceDiagnostics');if(!root){root=document.createElement('section');root.id='serviceDiagnostics';root.className='local-setup';document.getElementById('dashboardView').prepend(root);}
  try {latest=await api('/api/service-diagnostics');const warnings=(latest.channels||[]).filter(c=>c.enabled&&c.state!=='healthy');const backup=latest.backup?.state!=='healthy',copy=latest.backup_copy&&latest.backup_copy.state!=='healthy';root.hidden=!warnings.length&&!backup&&!copy;
   root.innerHTML=`<h3>${t('Service needs attention')}</h3>${copy?`<p>${t('Backup copy needs attention. Check the configured drive or network folder and create a new backup.')}</p>`:''}${warnings.map(c=>`<p><strong data-no-translate>${escapeHtml(c.channel)}</strong> — ${t(c.state==='connection_error'?'Connection failed. Open channel settings and check the account connection.':'Import is out of date. Check the connection and run synchronization.')} <button type="button" data-diagnostic-channel="${escapeHtml(c.channel)}">${t('Open settings')}</button></p>`).join('')}${backup?`<p>${t(latest.backup.state==='failed'?'The last backup failed. Check disk space and create a new backup.':'No recent backup. Create a backup and keep a copy outside this device.')} <button type="button" data-diagnostic-backup>${t('Backups')}</button></p>`:''}`;
   root.querySelectorAll('[data-diagnostic-channel]').forEach(b=>b.onclick=()=>{setView('settings');setSettingsTab('auth');});root.querySelector('[data-diagnostic-backup]')?.addEventListener('click',()=>{setView('settings');setSettingsTab('backup');});
  }catch(_){root.hidden=false;root.textContent=window.i18n.t('Could not check service health. Try again.');}
 }
 document.getElementById('downloadServiceDiagnostics').onclick=async()=>{const button=document.getElementById('downloadServiceDiagnostics');button.disabled=true;try{latest=await api('/api/service-diagnostics');const url=URL.createObjectURL(new Blob([JSON.stringify(latest,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='moms-diagnostics.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(_){alert('Could not check service health. Try again.');}finally{button.disabled=false;}};
 window.serviceDiagnostics={load};window.addEventListener('languagechange',()=>{if(document.getElementById('serviceDiagnostics'))load();});
})();
