'use strict';

const { query, withClient } = require('../db');

async function getChannelRoi(from, to, execute = query) {
  const res = await execute(
    `SELECT
       channel,
       COUNT(*) AS order_count,
       SUM(revenue_amount) AS total_revenue,
       AVG(revenue_amount) AS avg_order_value,
       NULLIF(UPPER(BTRIM(revenue_currency)), '') AS currency
     FROM orders
     WHERE revenue_amount IS NOT NULL
       AND COALESCE(created_at, imported_at) >= $1
       AND COALESCE(created_at, imported_at) < $2
     GROUP BY channel, NULLIF(UPPER(BTRIM(revenue_currency)), '')
     ORDER BY total_revenue DESC NULLS LAST`,
    [from, to]
  );
  return res.rows.map((r) => ({
    channel: r.channel,
    orderCount: Number(r.order_count),
    totalRevenue: r.total_revenue != null ? Number(r.total_revenue) : null,
    avgOrderValue: r.avg_order_value != null ? Number(r.avg_order_value) : null,
    currency: r.currency || null
  }));
}

async function getRevenueTimeline(from, to, granularity = 'month', execute = query) {
  const trunc = ['day', 'week', 'month'].includes(granularity) ? granularity : 'month';
  const res = await execute(
    `SELECT
       DATE_TRUNC($1, COALESCE(created_at, imported_at)) AS period,
       TO_CHAR(DATE_TRUNC($1, COALESCE(created_at, imported_at)), 'YYYY-MM') AS period_label,
       channel,
       NULLIF(UPPER(BTRIM(revenue_currency)), '') AS currency,
       SUM(revenue_amount) AS total_revenue,
       COUNT(*) AS order_count
     FROM orders
     WHERE revenue_amount IS NOT NULL
       AND COALESCE(created_at, imported_at) >= $2
       AND COALESCE(created_at, imported_at) < $3
     GROUP BY period, channel, NULLIF(UPPER(BTRIM(revenue_currency)), '')
     ORDER BY period ASC, channel`,
    [trunc, from, to]
  );
  return res.rows.map((r) => ({
    period: r.period,
    periodLabel: r.period_label,
    currency: r.currency || null,
    channel: r.channel,
    totalRevenue: r.total_revenue != null ? Number(r.total_revenue) : null,
    orderCount: Number(r.order_count)
  }));
}

async function getSalesOverview(from, to) {
  if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)) || Date.parse(from) >= Date.parse(to)) {
    const error = new Error('Choose a valid sales period.'); error.statusCode = 400; throw error;
  }
  return withClient(async client => {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      const execute = client.query.bind(client);
      const counts = (await execute(`SELECT COUNT(*)::int AS orders, COUNT(revenue_amount)::int AS priced,
        COUNT(*) FILTER (WHERE shipped = false)::int AS open_orders
        FROM orders WHERE COALESCE(created_at, imported_at) >= $1 AND COALESCE(created_at, imported_at) < $2`, [from, to])).rows[0];
      const channels = await getChannelRoi(from, to, execute);
      const timeline = await getRevenueTimeline(from, to, 'month', execute);
      const currencies = (await execute(`SELECT NULLIF(UPPER(BTRIM(revenue_currency)), '') AS currency,
        SUM(revenue_amount) AS total, AVG(revenue_amount) AS average, COUNT(*)::int AS orders
        FROM orders WHERE revenue_amount IS NOT NULL AND COALESCE(created_at, imported_at) >= $1 AND COALESCE(created_at, imported_at) < $2
        GROUP BY NULLIF(UPPER(BTRIM(revenue_currency)), '') ORDER BY currency NULLS LAST`, [from, to])).rows.map(row => ({currency: row.currency, total: Number(row.total), average: Number(row.average), orders: row.orders}));
      const profitability = await require('./profitability').read(execute, from, to);
      await client.query('COMMIT');
      return { from, to, orderCount: counts.orders, pricedOrderCount: counts.priced, missingAmountCount: counts.orders - counts.priced, openOrderCount: counts.open_orders, currencies, channels, timeline, profitability };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  });
}

async function getOpenOrderValue(execute = query) {
  const rows = (await execute(`SELECT NULLIF(UPPER(BTRIM(revenue_currency)), '') AS currency,
    SUM(revenue_amount) AS total, COUNT(*)::int AS orders,
    COUNT(*) FILTER (WHERE revenue_amount IS NULL)::int AS missing
    FROM orders WHERE shipped = false
    GROUP BY NULLIF(UPPER(BTRIM(revenue_currency)), '') ORDER BY currency NULLS LAST`)).rows;
  return {
    orderCount: rows.reduce((sum,row)=>sum+row.orders,0),
    missingAmountCount: rows.reduce((sum,row)=>sum+row.missing,0),
    currencies: rows.filter(row=>row.total!==null).map(row=>({currency:row.currency,total:String(row.total)}))
  };
}

module.exports = { getChannelRoi, getRevenueTimeline, getSalesOverview, getOpenOrderValue };
