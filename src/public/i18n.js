'use strict';
(() => {
  const storageKey = 'local-orders-language';
  let language = 'en';
  try { language = localStorage.getItem(storageKey) === 'sk' ? 'sk' : 'en'; } catch (_) {}
  let dictionary = {};
  let reverse = {};
  const originals = new WeakMap();
  const attributes = new WeakMap();
  const patterns = [
    [/^Backup is valid — (\d+) labels, settings and database$/, (_, n) => `Záloha je platná — štítky: ${n}, nastavenia a databáza`],
    [/^Status saved\. Could not refresh inventory: (.+)$/s, (_, error) => `Stav uložený. Nepodarilo sa obnoviť sklad: ${error}`],
    [/^Configure these production SKUs first: (.+)$/s, (_, skus) => `Najprv nastavte skladbu týchto SKU: ${skus}`],
    [/^(\d+) orders? selected$/, (_, n) => `Vybrané objednávky: ${n}`],
    [/^(\d+) of (\d+)$/, (_, a, b) => `${a} z ${b}`],
    [/^(\d+) orders · Default$/, (_, n) => `Objednávky: ${n} · Predvolený`],
    [/^avg (.+)$/, (_, value) => `priemer ${value}`],
    [/^Actions for order (.+)$/, (_, id) => `Akcie objednávky ${id}`],
    [/^(\d+) latest$/, (_, n) => `Posledné záznamy: ${n}`],
    [/^Select order (.+)$/, (_, id) => `Vybrať objednávku ${id}`],
    [/^Add to (.+)$/, (_, name) => `Pridať do ${name}`],
    [/^Delete (.+)\?$/, (_, name) => `Odstrániť ${name}?`],
    [/^Permanently delete (\d+) orders?\?$/, (_, n) => `Natrvalo odstrániť objednávky (${n})?`],
    [/^Mark (\d+) orders? as shipped and move to Archive\?$/, (_, n) => `Odoslať objednávky (${n}) a presunúť ich do archívu?`],
    [/^Generate (.+) labels? for (\d+) orders?\?$/, (_, type, n) => `Vytvoriť štítky ${translate(type)} pre objednávky (${n})?`],
    [/^Imported (\d+) order\(s\) into Archive\.$/, (_, n) => `Do archívu boli importované objednávky (${n}).`],
    [/^Could not save: (.+)$/s, (_, error) => `Nepodarilo sa uložiť: ${translate(error)}`],
    [/^Could not save status: (.+)$/s, (_, error) => `Nepodarilo sa uložiť stav: ${translate(error)}`],
    [/^Could not complete action: (.+)$/s, (_, error) => `Akciu sa nepodarilo dokončiť: ${translate(error)}`],
    [/^Backup failed: (.+)$/s, (_, error) => `Zálohovanie zlyhalo: ${translate(error)}`],
    [/^Last updated: (.+)$/, (_, date) => `Posledná aktualizácia: ${date}`],
    [/^Last API update: (.+)$/, (_, date) => `Posledná synchronizácia API: ${date}`],
    [/^(.+) · (\d+) open orders$/, (_, name, n) => `${name} · otvorené objednávky: ${n}`],
    [/^(.+) theme$/, (_, name) => `Vzhľad: ${translate(name)}`],
    [/^Gift: (.+)$/s, (_, message) => `Darček: ${message}`],
    [/^Search (archived )?orders$/, (_, archived) => archived ? 'Hľadať archivované objednávky' : 'Hľadať objednávky'],
    [/^Page (\d+) of (\d+)$/, (_, a, b) => `Strana ${a} z ${b}`],
    [/^(\d+) per page$/, (_, n) => `${n} na stranu`],
    [/^(.+) · pending restart$/, (_, s) => `${translate(s)} · čaká na reštart`],
    [/^(.+) — restart pending$/, (_, s) => `${translate(s)} — čaká na reštart`],
    [/^Save (.+)$/, (_, s) => `Uložiť: ${translate(s)}`],
    [/^Filter (.+)$/, (_, s) => `Filtrovať: ${translate(s)}`],
    [/^Status for order (.+)$/, (_, s) => `Stav objednávky ${s}`],
    [/^Ship by (.+)$/, (_, s) => `Odoslať do ${s}`],
    [/^Overdue · Ship by (.+)$/, (_, s) => `Po termíne · Odoslať do ${s}`],
    [/^(\d+) orders$/, (_, n) => `Objednávky: ${n}`],
    [/^(\d+) selected$/, (_, n) => `Vybrané: ${n}`],
    [/^(.+) selected$/, (_, n) => `Vybrané: ${n}`],
    [/^Mark order (.+) as shipped and move it to Archive\?$/, (_, id) => `Odoslať objednávku ${id} a presunúť ju do archívu?`],
    [/^Permanently delete order (.+)\?$/, (_, id) => `Natrvalo odstrániť objednávku ${id}?`],
    [/^Delete mapping for (.+)\?$/, (_, sku) => `Odstrániť mapovanie pre ${sku}?`],
    [/^Remove "(.+)"\? Its (\d+) orders will move to "(.+)"\. Archiving will not change\.$/, (_, name, n, target) => `Odstrániť „${name}“? Objednávky (${n}) sa presunú do „${target}“. Archivácia sa nezmení.`],
    [/^Restore from "(.+)"\?\n\nThis will overwrite all current data\.$/, (_, file) => `Obnoviť zo súboru „${file}“?\n\nPrepíšu sa všetky aktuálne údaje.`],
    [/^Restore failed: (.+)$/s, (_, error) => `Obnova zlyhala: ${translate(error)}`],
    [/^Upload failed: (.+)$/s, (_, error) => `Nahrávanie zlyhalo: ${translate(error)}`],
    [/^Failed: (.+)$/s, (_, error) => `Zlyhalo: ${translate(error)}`],
    [/^Settings unavailable: (.+)$/s, (_, error) => `Nastavenia nie sú dostupné: ${translate(error)}`],
    [/^Could not copy (.+): (.+)$/s, (_, kind, error) => `Nepodarilo sa kopírovať ${translate(kind)}: ${translate(error)}`],
    [/^([A-Z_]+): enter a non-negative number\.$/, (_, key) => `${key}: zadajte nezáporné číslo.`],
    [/^([A-Z_]+): choose true or false\.$/, (_, key) => `${key}: vyberte áno alebo nie.`],
    [/^([A-Z_]+): invalid URL\.$/, (_, key) => `${key}: neplatná adresa.`],
    [/^([A-Z_]+): use an HTTP or HTTPS URL\.$/, (_, key) => `${key}: použite adresu HTTP alebo HTTPS.`],
  ];
  function translate(source) {
    const raw = String(source ?? '');
    if (language === 'en') return raw;
    const core = raw.trim();
    const compact = core.replace(/\s+/g, ' ');
    let result = dictionary[core] || dictionary[compact];
    if (!result) for (const [pattern, replacement] of patterns) {
      if (pattern.test(core)) { result = core.replace(pattern, replacement); break; }
    }
    return result ? raw.slice(0, raw.indexOf(core)) + result + raw.slice(raw.indexOf(core) + core.length) : raw;
  }
  function protectedContent(element, text = false) {
    if (!element || element.closest('[data-no-translate],script,style,textarea,pre,code')) return true;
    // Table values are order/product/log data. Translate their controls, not data.
    if (text && element.closest('.board-customer > span,.board-card-heading > a,.board-card-heading > strong,.board-products,.board-note,.address-first-line,.address-full,.card-customer-name:not(.muted),.card-order-id,.card-skus,.tracking-number-copy,.board-tracking-number a,.vendor-other,.note-text:not(.muted)')) return true;
    return text && element.closest('td') && !element.closest('button,option,.button,.feedback-requested,.feedback-request-btn');
  }
  const options = { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title','placeholder','aria-label','data-label'] };
  const observer = new MutationObserver(records => {
    observer.disconnect();
    const roots = new Set();
    for (const record of records) {
      if (record.type === 'childList') for (const node of record.addedNodes) roots.add(node);
      else roots.add(record.target);
    }
    for (const root of roots) applyTo(root);
    observer.observe(document.body, options);
  });
  function applyTo(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      const parent = root.parentElement;
      if (protectedContent(parent, true)) return;
      const previous = originals.get(root);
      const source = previous && root.data === previous.output ? previous.source : (reverse[root.data.trim()] || root.data);
      const output = translate(source);
      originals.set(root, { source, output });
      if (root.data !== output) root.data = output;
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    if (protectedContent(root)) return;
    const values = attributes.get(root) || {};
    for (const attribute of options.attributeFilter) {
      if (!root.hasAttribute(attribute)) continue;
      const value = root.getAttribute(attribute);
      const previous = values[attribute];
      const source = previous && value === previous.output ? previous.source : (reverse[value.trim()] || value);
      const output = translate(source);
      values[attribute] = { source, output };
      if (value !== output) root.setAttribute(attribute, output);
    }
    attributes.set(root, values);
    for (const child of root.childNodes) applyTo(child);
  }
  function apply() {
    observer.disconnect();
    document.documentElement.lang = language;
    applyTo(document.body);
    const select = document.getElementById('languageSelect');
    if (select) select.value = language;
    observer.observe(document.body, options);
  }
  function setLanguage(value) {
    language = value === 'sk' ? 'sk' : 'en';
    try { localStorage.setItem(storageKey, language); } catch (_) {}
    apply();
    window.dispatchEvent(new CustomEvent('languagechange', { detail: language }));
  }
  const calendarSk = {
    weekdays: { shorthand: ['Ne','Po','Ut','St','Št','Pi','So'], longhand: ['Nedeľa','Pondelok','Utorok','Streda','Štvrtok','Piatok','Sobota'] },
    months: { shorthand: ['Jan','Feb','Mar','Apr','Máj','Jún','Júl','Aug','Sep','Okt','Nov','Dec'], longhand: ['Január','Február','Marec','Apríl','Máj','Jún','Júl','August','September','Október','November','December'] },
    firstDayOfWeek: 1, rangeSeparator: ' – ', scrollTitle: 'Rolovaním zmeňte hodnotu', toggleTitle: 'Kliknutím prepnite', time_24hr: true,
  };
  window.i18n = { t: translate, apply, setLanguage, get language() { return language; }, get locale() { return language === 'sk' ? 'sk-SK' : 'en-GB'; }, get calendarLocale() { return language === 'sk' ? calendarSk : { rangeSeparator: ' – ' }; } };
  for (const name of ['alert','confirm','prompt']) {
    const original = window[name].bind(window);
    window[name] = (message, ...args) => original(translate(message), ...args);
  }
  document.getElementById('languageSelect').addEventListener('change', event => setLanguage(event.target.value));
  apply();
  window.i18n.ready = fetch('/locales/sk.json?v=72').then(response => { if (!response.ok) throw new Error('Language unavailable'); return response.json(); }).then(data => { dictionary = data; reverse = Object.fromEntries(Object.entries(data).map(([en, sk]) => [sk, en])); apply(); }).catch(() => { setLanguage('en'); });
})();
