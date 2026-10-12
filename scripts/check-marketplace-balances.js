'use strict';
const assert = require('node:assert/strict');
const { summarizeBalances, money, amazonRows, shopifyRows, readAmazon, createBalanceService } = require('../src/services/marketplaceBalances');
// Financial snapshots must never be silently served from an offline SW cache.
const handlers={};require('node:vm').runInNewContext(require('node:fs').readFileSync(require('node:path').join(__dirname,'../src/public/sw.js'),'utf8'),{self:{addEventListener:(name,handler)=>handlers[name]=handler},URL});
assert.equal(handlers.fetch,undefined,'Financial snapshots must always use the authenticated network request');
const total = (id = 'DE', currency = 'EUR', value = 25) => ({balanceType:'TOTAL',amount:{currencyCode:currency,currencyAmount:value},
  partnerMetadata:{marketplaceId:id,accountType:'Standard Orders'},lastUpdatedTime:'2026-10-07T08:00:00Z',
  balances:[{balanceType:'AVAILABLE',amount:{currencyCode:currency,currencyAmount:0}},
    {balanceType:'RESERVED',amount:{currencyCode:currency,currencyAmount:value}}]});
(async () => {
  assert.deepEqual(money(0,'EUR'),{amount:'0',currency:'EUR'});
  const summary=summarizeBalances([
    {name:'Amazon',checkedAt:'2026-10-07T08:00:00Z',rows:[{currency:'EUR',total:'0.10',available:'0.05'},{currency:'EUR',total:'0.20',available:'0.10'},{currency:'USD',total:'10'}]},
    {name:'Shopify',checkedAt:'2026-10-07T09:00:00Z',rows:[{currency:'EUR',total:'-0.05'},{currency:'USD',total:'-10'}]},
    {name:'Etsy',rows:[]},{name:'SAShE',rows:[{currency:'EUR',total:null}]}]);
  assert.deepEqual(summary.currencies,[{currency:'EUR',total:'0.25'},{currency:'USD',total:'0'}]);
  assert.deepEqual(summary.unavailableMarketplaces,['Etsy','SAShE']);assert.equal(summary.checkedAt,'2026-10-07T08:00:00Z');assert.equal(summary.stale,false);
  assert.equal(summarizeBalances([{name:'Amazon',stale:true,rows:[{currency:'EUR',total:'2.00'}]}]).stale,true);
  assert.deepEqual(summarizeBalances([{name:'Etsy',rows:[]}]).currencies,[],'Missing funds are never a zero');
  assert.deepEqual(summarizeBalances([{name:'Bad',rows:[{currency:'EUR',total:'invalid'}]}]).unavailableMarketplaces,['Bad']);
  assert.throws(()=>money('0.'+'1'.repeat(1000),'EUR'));

  for (const value of [null, '', NaN, Infinity, {}, 'secret', 1e30]) assert.throws(()=>money(value,'EUR'));
  assert.throws(()=>money(1,'<script>'));
  const rows = amazonRows([total(),total('US','USD',-5)],{de:'DE'});
  assert.equal(rows[0].total,'25'); assert.equal(rows[0].available,'0'); assert.equal(rows[1].currency,'USD');
  assert.equal(rows[1].total,'-5'); assert.equal(rows[0].account,'DE · Standard Orders');
  assert.equal(amazonRows([{...total(),balances:[]}])[0].available,null);
  assert.throws(()=>amazonRows([total(),total()]));
  assert.throws(()=>amazonRows([{...total(),asOfDate:'2025-01-01'}]));
  assert.throws(()=>amazonRows([{...total(),balances:[{balanceType:'AVAILABLE',amount:{currencyCode:'USD',currencyAmount:1}}]}]));
  let calls=0;
  const pages=await readAmazon(async request=>{assert.equal(request.query.balanceType,'TOTAL');assert(!request.query.asOfDate);return ++calls===1?{balances:[total()],nextToken:'next'}:{balances:[total('US','USD')]}},{},null,async()=>{});
  assert.equal(pages.length,2);
  await assert.rejects(readAmazon(async()=>({balances:[],nextToken:'repeat'}),{},null,async()=>{}),/Repeated/);
  calls=0;await assert.rejects(readAmazon(async()=>{if(++calls===2)throw new Error('Failed page');return {balances:[total()],nextToken:'next'};},{},null,async()=>{}),/Failed page/);
  assert.deepEqual(shopifyRows([{amount:'0.00',currencyCode:'EUR'}])[0],{account:'Shopify Payments',currency:'EUR',available:null,total:'0.00',updatedAt:null});
  assert.throws(()=>shopifyRows([{amount:'1',currencyCode:'EUR'},{amount:'2',currencyCode:'EUR'}]));
  let clock=Date.now(), denied=false, reads=0;
  const settings={amazon:{lwaClientId:'fixture',lwaClientSecret:'fixture',refreshToken:'fixture',marketplaceIds:{de:'DE'}},shopify:{shopDomain:'fixture'}};
  const service=createBalanceService({settings,now:()=>clock,amazon:async()=>{reads++;if(denied){const error=new Error('SECRET PRIVATE PAYLOAD');error.status=403;throw error;}return {balances:[total()]};},shopify:async()=>[{amount:'10.00',currencyCode:'USD'}]});
  const [first,second]=await Promise.all([service.load(),service.load()]);assert.deepEqual(first,second);assert.equal(reads,1);
  assert.equal(first.marketplaces.find(item=>item.channel==='etsy').status,'unsupported');
  clock+=1000;await service.load(true);assert.equal(reads,1,'Force refresh has a cooldown');
  clock+=31000;denied=true;const stale=(await service.load(true)).marketplaces[0];
  assert.equal(stale.status,'needs_access');assert.equal(stale.stale,true);assert.equal(stale.rows[0].total,'25');assert.equal(stale.checkedAt,first.marketplaces[0].checkedAt);
  assert(!JSON.stringify(stale).includes('SECRET'));
  const empty=createBalanceService({settings:{}});assert.equal((await empty.load()).marketplaces[0].status,'not_configured');
  const timeout=createBalanceService({settings,timeoutMs:5,amazon:()=>new Promise(()=>{}),shopify:async()=>null});
  const timed=await timeout.load();assert.equal(timed.marketplaces[0].status,'unavailable');assert.equal(timed.marketplaces[2].status,'no_balance');
  // Adapter uses only a balance GraphQL query and never returns upstream errors.
  const {config}=require('../src/config');config.shopify.shopDomain='fixture.myshopify.com';config.shopify.accessToken='fixture';
  const {fetchPaymentBalances}=require('../src/channels/shopify');
  global.fetch=async(url, options)=>{assert(url.endsWith('/graphql.json'));assert(!options.body.includes('mutation'));return {ok:true,json:async()=>({data:{shopifyPaymentsAccount:{balance:[{amount:'12.34',currencyCode:'EUR'}]}}})};};
  assert.equal((await fetchPaymentBalances())[0].amount,'12.34');
  global.fetch=async()=>({ok:true,json:async()=>({errors:[{message:'SECRET',extensions:{code:'ACCESS_DENIED'}}]})});
  await assert.rejects(fetchPaymentBalances(),error=>error.status===403&&!error.message.includes('SECRET'));
  console.log('Marketplace balances: currencies, zero/null, current snapshots, complete pagination, duplicate guards, safe errors, cache, timeout and read-only adapter passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
