'use strict';
const assert = require('node:assert/strict');
const { amazonReleaseSchedule, readAmazonRelease, summarizeBalances, money, amazonRows, shopifyRows, readAmazon, createBalanceService } = require('../src/services/marketplaceBalances');
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
  const service=createBalanceService({settings,now:()=>clock,amazon:async({path})=>{if(path.endsWith('/transactions'))return {transactions:[]};reads++;if(denied){const error=new Error('SECRET PRIVATE PAYLOAD');error.status=403;throw error;}return {balances:[total()]};},shopify:async()=>[{amount:'10.00',currencyCode:'USD'}]});
  const [first,second]=await Promise.all([service.load(),service.load()]);assert.deepEqual(first,second);assert.equal(reads,1);
  assert.equal(first.marketplaces.find(item=>item.channel==='etsy').status,'unsupported');
  clock+=1000;await service.load(true);assert.equal(reads,1,'Force refresh has a cooldown');
  clock+=31000;denied=true;const stale=(await service.load(true)).marketplaces[0];
  assert.equal(stale.status,'needs_access');assert.equal(stale.stale,true);assert.equal(stale.rows[0].total,'25');assert.equal(stale.checkedAt,first.marketplaces[0].checkedAt);
  assert(!JSON.stringify(stale).includes('SECRET'));
  const empty=createBalanceService({settings:{}});assert.equal((await empty.load()).marketplaces[0].status,'not_configured');
  const timeout=createBalanceService({settings,timeoutMs:5,amazon:()=>new Promise(()=>{}),shopify:async()=>null});
  const timed=await timeout.load();assert.equal(timed.marketplaces[0].status,'unavailable');assert.equal(timed.marketplaces[2].status,'no_balance');
  const at=Date.parse('2026-10-13T10:00:00Z');
  const deferred=(id,amount='0.10',date='2026-10-14T08:00:00Z',currency='EUR')=>({transactionId:id,transactionStatus:'DEFERRED',totalAmount:{currencyAmount:amount,currencyCode:currency},contexts:[{contextType:'DeferredContext',maturityDate:date}]});
  const tx=[deferred('a'),deferred('b','0.20','2026-10-14T22:00:00Z'),deferred('c','50','2026-10-15T00:00:00Z'),deferred('usd','5','2026-10-14T01:00:00Z','USD'),deferred('fee','-0.05')];
  tx.push({...deferred('released','999'),transactionStatus:'DEFERRED_RELEASED'});
  assert.deepEqual(amazonReleaseSchedule(tx,at),{status:'ok',date:'2026-10-14',amounts:[{currency:'EUR',amount:'0.25'},{currency:'USD',amount:'5'}]});
  assert.equal(amazonReleaseSchedule([...tx,{...deferred('unknown'),contexts:[]}],at).status,'partial');
  assert.deepEqual(amazonReleaseSchedule([deferred('past','10','2026-10-12T12:00:00Z')],at),{status:'partial',date:null,amounts:[]});
  assert.equal(amazonReleaseSchedule([deferred('today','1','2026-10-13T00:00:00Z')],at).date,'2026-10-13');
  assert.equal(amazonReleaseSchedule([deferred('offset','1','2026-10-15T01:00:00+02:00')],at).date,'2026-10-14');
  assert.equal(amazonReleaseSchedule([],at).status,'no_schedule');
  assert.throws(()=>amazonReleaseSchedule([tx[0],tx[0]],at),/duplicate/);
  assert.throws(()=>amazonReleaseSchedule([deferred('bad','not-money')],at));
  assert.throws(()=>amazonReleaseSchedule([deferred('bad','1','not-a-date')],at));
  assert.equal(amazonReleaseSchedule([deferred('zero','0'),deferred('later','5','2026-10-15T00:00:00Z')],at).date,'2026-10-15');
  let queries=[];
  const schedule=await readAmazonRelease(async({path,query})=>{
    assert.equal(path,'/finances/2024-06-19/transactions');queries.push(query);
    return query.nextToken?{transactions:tx}:{transactions:[],nextToken:'second'};
  },at,null,async()=>{});
  assert.equal(schedule.amounts[0].amount,'0.25');
  assert.equal(queries[0].transactionStatus,'DEFERRED');
  assert.deepEqual(queries[1],{...queries[0],nextToken:'second'});
  assert.equal(Date.parse(queries[0].postedBefore)-Date.parse(queries[0].postedAfter),180*86400000);
  await assert.rejects(readAmazonRelease(async()=>({transactions:[],nextToken:'repeat'}),at,null,async()=>{}),/Repeated/);
  let releaseCalls=0;
  await assert.rejects(readAmazonRelease(async()=>({transactions:[],nextToken:String(++releaseCalls)}),at,null,async()=>{}),/limit/);
  releaseCalls=0;
  await assert.rejects(readAmazonRelease(async()=>{if(releaseCalls++)throw new Error('page failed');return {transactions:tx,nextToken:'next'};},at,null,async()=>{}),/page failed/);
  await assert.rejects(readAmazonRelease(async()=>({}),at),/Invalid/);
  const releaseFailure=createBalanceService({settings,timeoutMs:5,amazon:({path})=>path.endsWith('/transactions')?new Promise(()=>{}):Promise.resolve({balances:[total()]}),shopify:async()=>null});
  const safe=(await releaseFailure.load()).marketplaces[0];
  assert.equal(safe.status,'ok');assert.equal(safe.rows[0].total,'25');assert.equal(safe.releaseSchedule.status,'unavailable');
  const withRelease=createBalanceService({settings,now:()=>at,amazon:async({path})=>path.endsWith('/transactions')?{transactions:tx}:{balances:[total()]},shopify:async()=>null});
  const withSchedule=await withRelease.load();assert.equal(withSchedule.marketplaces[0].releaseSchedule.amounts[0].amount,'0.25');
  assert.equal(withSchedule.summary.currencies[0].total,'25','Planned releases are already included in balances');
  // Adapter uses only a balance GraphQL query and never returns upstream errors.
  const {config}=require('../src/config');config.shopify.shopDomain='fixture.myshopify.com';config.shopify.accessToken='fixture';
  const {fetchPaymentBalances}=require('../src/channels/shopify');
  global.fetch=async(url, options)=>{assert(url.endsWith('/graphql.json'));assert(!options.body.includes('mutation'));return {ok:true,json:async()=>({data:{shopifyPaymentsAccount:{balance:[{amount:'12.34',currencyCode:'EUR'}]}}})};};
  assert.equal((await fetchPaymentBalances())[0].amount,'12.34');
  global.fetch=async()=>({ok:true,json:async()=>({errors:[{message:'SECRET',extensions:{code:'ACCESS_DENIED'}}]})});
  await assert.rejects(fetchPaymentBalances(),error=>error.status===403&&!error.message.includes('SECRET'));
  console.log('Marketplace balances: currencies, zero/null, current snapshots, complete pagination, duplicate guards, safe errors, cache, timeout and read-only adapter passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
