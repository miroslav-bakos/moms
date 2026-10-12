'use strict';
(async()=>{
 const button=document.getElementById('compose'),status=document.getElementById('status');
 try {
  const response=await fetch('/api/support');if(!response.ok)throw new Error();const {email,version}=await response.json();
  if(!email){status.textContent=window.i18n.t('Support email is not configured.');return;}
  if(typeof email!=='string'||!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email))throw new Error();
  document.getElementById('contact').textContent=email;button.disabled=false;
  button.onclick=()=>{const body=`MOMS ${String(version||'')}\n\n${document.getElementById('problem').value}`;window.location.href=`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('MOMS support')}&body=${encodeURIComponent(body)}`;status.textContent=window.i18n.t('If your email app did not open, write to the address above.');};
 }catch(_){status.textContent=window.i18n.t('Could not load support contact. Try again.');}
})();
