'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async function checkSales(root, db) {
  const database = (await db.query('SELECT current_database() AS name')).rows[0].name;
  assert(database.startsWith('moms_inventory_test_'), 'Sales tests require a disposable database');
  const insert = async (channel, amount, currency, date, archived = false, imported = null) => db.query(`INSERT INTO orders(channel,vendor,external_order_id,revenue_amount,revenue_currency,created_at,imported_at,shipped)
    VALUES($1,'Fixture',gen_random_uuid()::text,$2,$3,$4,COALESCE($5::timestamptz,now()),$6)`, [channel,amount,currency,date,imported,archived]);
  await insert('manual',100,'eur','2050-10-01T00:00:00Z');
  await insert('manual',200,'USD','2050-10-02T00:00:00Z');
  await insert('shopify',50,'EUR','2050-10-03T00:00:00Z',true);
  await insert('etsy',0,'EUR','2050-10-04T00:00:00Z');
  await insert('amazon',null,null,'2050-10-05T00:00:00Z');
  await insert('sashe',10,null,'2050-10-06T00:00:00Z');
  await insert('manual',-5,'EUR','2050-10-07T00:00:00Z');
  await insert('manual',2,'EUR',null,false,'2050-10-08T00:00:00Z');
  await insert('manual',999,'EUR','2050-11-01T00:00:00Z');
  await insert('manual',999,'EUR','2050-09-30T23:59:59Z');
  const analytics = require(path.join(root,'src/services/analytics'));
  const result = await analytics.getSalesOverview('2050-10-01T00:00:00Z','2050-11-01T00:00:00Z');
  assert.equal(result.orderCount,8); assert.equal(result.pricedOrderCount,7);
  assert.equal(result.missingAmountCount,1); assert.equal(result.openOrderCount,7);
  const eur = result.currencies.find(row=>row.currency==='EUR');
  assert.equal(eur.total,147); assert.equal(eur.average,29.4); assert.equal(eur.orders,5);
  assert.equal(result.currencies.find(row=>row.currency==='USD').total,200);
  assert.equal(result.currencies.find(row=>row.currency===null).total,10);
  assert.equal(result.channels.filter(row=>row.channel==='manual').length,2,'Currencies within one channel stay separate');
  assert.equal(result.timeline.filter(row=>row.channel==='manual').length,2);
  assert(result.profitability.totals.every(row=>row.profit===null),'Unknown expenses must not become profit');
  await db.query(`INSERT INTO order_costs(order_id,production_cost,shipping_cost,marketplace_fee,payment_fee,other_cost,currency)
    SELECT id,10,2,1,0,0,'EUR' FROM orders WHERE revenue_amount=50 AND created_at='2050-10-03T00:00:00Z'`);
  const profit=await analytics.getSalesOverview('2050-10-01T00:00:00Z','2050-11-01T00:00:00Z');
  const profitEur=profit.profitability.totals.find(row=>row.currency==='EUR');
  assert.equal(profitEur.complete,1);assert.equal(profitEur.profit,'37.000000');
  assert.equal(profit.profitability.channels.find(row=>row.label==='shopify').profit,'37.000000');
  await db.withClient(async client=>{
    await client.query('BEGIN');
    try {
      await client.query("SET LOCAL TIME ZONE 'Europe/Bratislava'");
      const rows=await analytics.getRevenueTimeline('2050-10-01T00:00:00Z','2050-11-01T00:00:00Z','month',client.query.bind(client));
      assert(rows.every(row=>row.periodLabel==='2050-10'),'Month labels must survive timezone conversion');
    } finally {await client.query('ROLLBACK');}
  });
  await assert.rejects(analytics.getSalesOverview('bad','2050-11-01'),/valid sales period/);
  await assert.rejects(analytics.getSalesOverview('2050-11-01','2050-10-01'),/valid sales period/);
  await db.withClient(async client=>{
    await client.query('BEGIN');
    try {
      await client.query('CREATE TEMP TABLE orders(shipped boolean,revenue_amount numeric(12,2),revenue_currency text) ON COMMIT DROP');
      await client.query("INSERT INTO orders VALUES(false,10.10,'eur'),(false,0.20,' EUR '),(false,99,'USD'),(true,500,'EUR'),(false,NULL,'EUR'),(false,5,NULL),(false,0,'EUR')");
      const value=await analytics.getOpenOrderValue(client.query.bind(client));
      assert.equal(value.orderCount,6);assert.equal(value.missingAmountCount,1);
      assert.deepEqual(value.currencies,[{currency:'EUR',total:'10.30'},{currency:'USD',total:'99.00'},{currency:null,total:'5.00'}]);
      await client.query('DELETE FROM orders');assert.deepEqual(await analytics.getOpenOrderValue(client.query.bind(client)),{orderCount:0,missingAmountCount:0,currencies:[]});
    } finally {await client.query('ROLLBACK');}
  });
  const empty=await analytics.getSalesOverview('2051-01-01','2051-02-01');
  assert.equal(empty.orderCount,0); assert.deepEqual(empty.currencies,[]);
};
