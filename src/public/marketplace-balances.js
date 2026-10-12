'use strict';
(() => {
  let snapshot = null, busy = false, failed = false, loadedAt = 0, expanded = false;
  const t = text => window.i18n?.t(text) || text;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const locale = () => window.i18n?.language === 'sk' ? 'sk-SK' : 'en-GB';
  const statuses = { unsupported: 'These balances are not provided by the marketplace API.', not_configured: 'Marketplace is not connected.',
    needs_access: 'Balance access requires marketplace authorization.', unavailable: 'Balances could not be refreshed.', no_balance: 'No balance was returned by the marketplace.' };
  const zero = value => (typeof value === 'number' || typeof value === 'string') && /^-?0+(?:\.0+)?$/.test(String(value));
  function amount(value, currency) {
    if (value === null || value === undefined) return `<span class="balance-unavailable">${escape(t('Unavailable'))}</span>`;
    if (!/^-?\d+(\.\d+)?$/.test(String(value)) || !/^[A-Z]{3}$/.test(currency || '')) return escape(t('Unavailable'));
    try { return escape(new Intl.NumberFormat(locale(), {style:'currency',currency}).format(value)); }
    catch (_) { return escape(`${value} ${currency}`); }
  }
  function date(value) {
    if (!value || !Number.isFinite(new Date(value).getTime())) return '';
    return escape(new Date(value).toLocaleString(locale()));
  }
  function renderSummary() {
    const root = document.getElementById('marketplaceBalanceSummary');
    if (!root) return;
    const summary = snapshot?.summary;
    const currencies = (summary?.currencies || []).filter(row => !zero(row.total));
    root.innerHTML = `<div class="dash-label">${escape(t('Marketplace funds including held balances'))}</div>
      ${currencies.length ? currencies.map(row => `<div class="dash-value" data-no-translate>${amount(row.total,row.currency)}</div>`).join('') : `<div class="muted">${escape(t(busy ? 'Loading balances…' : summary?.currencies?.length ? 'No non-zero balances.' : 'Unavailable'))}</div>`}
      ${summary?.currencies?.length && summary.unavailableMarketplaces?.length ? `<p class="muted">${escape(t('Partial total. Unavailable marketplaces'))}: <span data-no-translate>${summary.unavailableMarketplaces.map(escape).join(', ')}</span></p>` : ''}
      ${summary?.stale || (failed && summary?.currencies?.length) ? `<p class="balance-warning">${escape(t('Includes last successful balances. Refresh failed.'))}</p>` : ''}
      ${summary?.checkedAt ? `<p class="muted">${escape(t('Last successful check'))}: <time data-no-translate datetime="${escape(summary.checkedAt)}">${date(summary.checkedAt)}</time></p>` : ''}`;
  }
  function render() {
    renderSummary();
    const root = document.getElementById('marketplaceBalances');
    if (!root) return;
    expanded = root.querySelector('details')?.open ?? expanded;
    root.setAttribute('aria-label', t('Marketplace balances'));
    const markets = snapshot?.marketplaces || ['amazon','etsy','shopify','sashe'].map(channel => ({channel,name:({amazon:'Amazon',etsy:'Etsy',shopify:'Shopify',sashe:'SAShE'})[channel],rows:[]}));
    const visibleMarkets = markets.map(market => ({...market, rows: market.rows?.length ? market.rows.filter(row => !zero(row.available) || !zero(row.total)) : [{available:null,total:null}]})).filter(market => market.rows.length || market.stale || (market.status && market.status !== 'ok'));
    root.innerHTML = `<details class="marketplace-balances-details"${expanded ? ' open' : ''}><summary><h3>${escape(t('Marketplace balances'))}</h3></summary><div class="section-head"><p class="muted">${escape(t('Automatic account balances. Currencies and accounts are shown separately.'))}</p><button id="refreshBalances" type="button" class="secondary icon-btn" title="${escape(t('Refresh balances'))}" aria-label="${escape(t('Refresh balances'))}" ${busy ? 'disabled' : ''}>↻</button></div>
      <div class="marketplace-balances-grid">${visibleMarkets.map(market => `<article class="dash-card marketplace-balance" data-marketplace="${escape(market.channel)}">
        <h4 data-no-translate>${escape(market.name)}</h4>
        ${market.rows.map(row => `<div class="balance-account">
          ${row.account ? `<p class="balance-account-name" data-no-translate>${escape(row.account)}</p>` : ''}
          <dl>${zero(row.available) ? '' : `<div><dt>${escape(t('Available for payout'))}</dt><dd data-no-translate>${amount(row.available,row.currency)}</dd></div>`}
          ${zero(row.total) ? '' : `<div><dt>${escape(t('Total including held funds'))}</dt><dd data-no-translate>${amount(row.total,row.currency)}</dd></div>`}</dl>
          ${row.updatedAt ? `<p class="muted"><span>${escape(t('Source updated'))}</span>: <time data-no-translate datetime="${escape(row.updatedAt)}">${date(row.updatedAt)}</time></p>` : ''}
          ${row.available === null && row.total !== null ? `<p class="muted">${escape(t('Payout availability is not provided by the marketplace API.'))}</p>` : ''}
        </div>`).join('')}
        ${market.stale ? `<p class="balance-warning" role="status">${escape(t('Refresh failed. Showing the last successful balance.'))}</p>` : market.status && statuses[market.status] ? `<p class="muted">${escape(t(statuses[market.status]))}</p>` : ''}
        ${market.checkedAt ? `<p class="muted"><span>${escape(t(market.stale ? 'Last successful check' : 'Checked'))}</span>: <time data-no-translate datetime="${escape(market.checkedAt)}">${date(market.checkedAt)}</time></p>` : ''}
      </article>`).join('') || `<p class="muted">${escape(t('No non-zero balances.'))}</p>`}</div>
      <p class="muted" role="status">${escape(t(busy ? 'Loading balances…' : failed ? 'Balances could not be refreshed.' : ''))}</p></details>`;
    const details = root.querySelector('details');
    details.querySelector('summary').addEventListener('click', () => { expanded = !details.open; });
    details.addEventListener('toggle', () => { if (details.isConnected) expanded = details.open; });
    root.querySelector('#refreshBalances').addEventListener('click', () => load(true));
  }
  async function load(force = false) {
    if (busy || (!force && snapshot && Date.now() - loadedAt < 300000)) return;
    busy = true; failed = false; render();
    try {
      const response = await fetch(`/api/marketplace-balances${force ? '?refresh=1' : ''}`, {cache:'no-store', signal:AbortSignal.timeout(25000)});
      if (!response.ok) throw new Error('Unavailable');
      const data = await response.json();
      if (!Array.isArray(data.marketplaces)) throw new Error('Invalid balance response');
      snapshot = data; loadedAt = Date.now();
    } catch (_) {
      failed = true;
      if (snapshot) snapshot = { ...snapshot, marketplaces: snapshot.marketplaces.map(market => ({...market,stale:Boolean(market.rows?.length)})) };
    } finally { busy = false; render(); }
  }
  window.marketplaceBalances = {load,render};
  window.addEventListener('languagechange', render);
  window.i18n?.ready.then(render);
})();
