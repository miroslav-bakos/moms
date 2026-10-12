'use strict';
(async()=>{
  const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);
  try {
    const result=await fetch('/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),cache:'no-store'});
    if(!result.ok)throw new Error();
    location.replace('/');
  }catch(_){document.getElementById('pairMessage').textContent='Pairing expired or unavailable. Open a new QR code. / Párovanie vypršalo alebo nie je dostupné. Otvorte nový QR kód.';}
})();
