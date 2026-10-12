(() => {
  const paths = {
    cards:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    add:'M12 5v14M5 12h14', save:'M5 3h12l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8',
    edit:'M4 20l4-1L20 7l-3-3L5 16zM14 7l3 3', delete:'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
    archive:'M3 4h18v5H3zM5 9v12h14V9M9 13h6', print:'M7 8V3h10v5M7 17H4V8h16v9h-3M7 14h10v7H7zM17 11h.01',
    refresh:'M20 10a8 8 0 1 0-2 8M20 4v6h-6', download:'M12 3v12M7 10l5 5 5-5M4 16v5h16v-5',
    upload:'M12 16V4M7 9l5-5 5 5M4 16v5h16v-5', copy:'M9 9h12v12H9zM15 9V3H3v12h6',
    close:'M6 6l12 12M6 18L18 6', check:'M4 12l5 5L20 6', search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14M15 15l6 6',
    settings:'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6', next:'M9 5l7 7-7 7', previous:'M15 5l-7 7 7 7',
    pin:'M8 3h8l-1 7 4 4H5l4-4zM12 14v7', link:'M10 14l4-4M9 16l-2 2a4 4 0 0 1-5-5l4-4M15 8l2-2a4 4 0 0 1 5 5l-4 4',
    list:'M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01', action:'M5 12h14M13 6l6 6-6 6',
    generate:'M4 3h10l6 6v12H4zM14 3v6h6M8 15h8M12 11v8',view:'M2 12c4-9 16-9 20 0-4 9-16 9-20 0zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    info:'M12 11v6M12 7h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  };
  const rules = [
    ['delete',/delete|remove|discard|vymaza|odstrá|zahodi/i], ['close',/cancel|close|clear|zruši|zatvori|vyčisti/i],
    ['generate',/generate|vygener/i], ['view',/show label|zobraziť štítok/i],
    ['print',/print|pdf|label|štít|tlač|vytla/i], ['archive',/archive|shipped|archív|archiv|odoslať/i],
    ['copy',/copy|kopíro/i], ['refresh',/refresh|sync|poll|obnov|synchron/i], ['download',/export|download|stiah/i],
    ['upload',/import|upload|nahra/i], ['save',/save|ulož/i], ['edit',/edit|rename|upravi|úprav|premen/i],
    ['previous',/prev|back|späť|predch/i], ['next',/next|ďalej|nasledu/i], ['pin',/pin|pripnú/i],
    ['search',/search|hľada|vyhľada/i], ['settings',/config|settings|configure|nastav/i], ['info',/details|detail|podrob/i],
    ['link',/connect|authorize|pripoj|autoriz/i], ['add',/add|new|create|prida|nov[ýáé]|vytvori/i],
    ['check',/apply|test|receive|confirm|keep|enable|použi|overi|prija|potvr|pokrač|zapnú/i],
    ['list',/list|table|batch|zoznam|tabuľ|dávk/i],
  ];
  function decorate(button) {
    if (!button.isConnected || button.closest('.flatpickr-calendar')) return;
    const existing = button.querySelector(':scope > .app-button-icon');
    const native = [...button.querySelectorAll('svg')].some(svg => !svg.closest('.app-button-icon'));
    const text = button.textContent.trim();
    if (native || (!/[\p{L}]/u.test(text) && !button.hasAttribute('data-copy'))) { if(existing)existing.remove(); return; }
    const hint = `${button.dataset.boardAction || ''} ${button.id || ''} ${text}`;
    const boardIcons={gls:'generate',parcel:'generate',upload:'upload',edit:'edit',create_batch:'add',add_batch:'add',archive:'archive',delete:'delete'};
    const viewIcon = {board:'cards',open:'list',archive:'archive'}[button.dataset.ordersView] || {cards:'cards',table:'list'}[button.dataset.archiveLayout];
    const key = viewIcon || (button.hasAttribute('data-copy')?'copy':boardIcons[button.dataset.boardAction]) || rules.find(([,pattern]) => pattern.test(hint))?.[0] || 'action';
    if (existing?.dataset.icon === key) return;
    const icon = existing || document.createElement('span');
    icon.className = 'app-button-icon'; icon.dataset.icon = key; icon.setAttribute('aria-hidden','true');
    icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[key]}"/></svg>`;
    if (!existing) button.prepend(icon);
  }
  const pending = new Set(); let scheduled = false;
  function collect(root) {
    if(root.nodeType !== 1)root = root.parentElement;
    if(!root || root.closest('.app-button-icon'))return;
    const owner=root.closest('button'); if(owner)pending.add(owner);
    root.querySelectorAll('button').forEach(button=>pending.add(button));
    if(scheduled)return; scheduled=true;
    setTimeout(()=>{scheduled=false;const buttons=[...pending];pending.clear();buttons.forEach(decorate);});
  }
  document.querySelectorAll('button').forEach(decorate);
  new MutationObserver(records=>records.forEach(record=>{collect(record.target);record.addedNodes.forEach(collect);})).observe(document.body,{childList:true,subtree:true,characterData:true});
})();
