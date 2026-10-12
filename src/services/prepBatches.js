const { query, withClient } = require('../db');

async function listPrepBatches() {
  const result = await query(`
    SELECT b.id, b.name, b.created_at,
      COUNT(o.id)::int AS order_count
    FROM prep_batches b
    LEFT JOIN prep_batch_orders bo ON bo.batch_id = b.id
    LEFT JOIN orders o ON o.id = bo.order_id AND o.shipped = false
    GROUP BY b.id
    ORDER BY b.created_at DESC, b.id DESC
  `);
  return result.rows;
}

async function getPrepBatch(id) {
  const result = await query(`
    SELECT b.id, b.name, b.created_at,
      COALESCE(json_agg(json_build_object(
        'id', o.id, 'channel', o.channel, 'vendor', o.vendor,
        'external_order_id', o.external_order_id, 'order_name', o.order_name,
        'skus', o.skus, 'skus_locked', o.skus_locked, 'workflow_status', o.workflow_status, 'shipped', o.shipped, 'raw_skus', o.raw_skus, 'address', o.address,
        'ship_by_date', o.ship_by_date, 'order_url', o.order_url,
        'source_payload', o.source_payload, 'prepared_gobbis', o.prepared_gobbis
      ) ORDER BY bo.position) FILTER (WHERE o.id IS NOT NULL), '[]'::json) AS orders
    FROM prep_batches b
    LEFT JOIN prep_batch_orders bo ON bo.batch_id = b.id
    LEFT JOIN orders o ON o.id = bo.order_id AND o.shipped = false
    WHERE b.id = $1
    GROUP BY b.id
  `, [id]);
  const batch = result.rows[0] || null;
  if (batch) batch.production = await require('./inventory').overview(batch.orders);
  return batch;
}

async function createPrepBatch(orderIds, createdBy = '') {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const valid = await client.query(
        'SELECT id FROM orders WHERE id = ANY($1::bigint[]) AND shipped = false ORDER BY id',
        [orderIds]
      );
      if (valid.rowCount !== orderIds.length) throw new Error('One or more selected orders are no longer open. Refresh the orders and try again.');
      const inserted = await client.query(
        `INSERT INTO prep_batches (name, created_by) VALUES ($1, $2) RETURNING id`,
        [`Batch · ${new Date().toLocaleDateString('en-GB')} · ${orderIds.length} orders`, createdBy]
      );
      const id = inserted.rows[0].id;
      await client.query(
        `INSERT INTO prep_batch_orders (batch_id, order_id, position)
         SELECT $1, order_id, ordinality::int FROM unnest($2::bigint[]) WITH ORDINALITY AS x(order_id, ordinality)`,
        [id, orderIds]
      );
      await client.query('COMMIT');
      return getPrepBatch(id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function addOrdersToPrepBatch(id, orderIds) {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const batch = await client.query('SELECT id FROM prep_batches WHERE id = $1', [id]);
      if (!batch.rowCount) throw new Error('Batch not found.');
      const valid = await client.query(
        'SELECT id FROM orders WHERE id = ANY($1::bigint[]) AND shipped = false',
        [orderIds]
      );
      if (valid.rowCount !== orderIds.length) throw new Error('One or more selected orders are no longer open. Refresh the orders and try again.');
      await client.query(
        `INSERT INTO prep_batch_orders (batch_id, order_id, position)
         SELECT $1, order_id, (SELECT COALESCE(MAX(position), 0) FROM prep_batch_orders WHERE batch_id = $1) + ordinality::int
         FROM unnest($2::bigint[]) WITH ORDINALITY AS x(order_id, ordinality)
         ON CONFLICT (batch_id, order_id) DO NOTHING`,
        [id, orderIds]
      );
      await client.query('COMMIT');
      return getPrepBatch(id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function deletePrepBatch(id) {
  const result = await query('DELETE FROM prep_batches WHERE id = $1', [id]);
  return result.rowCount > 0;
}

module.exports = { listPrepBatches, getPrepBatch, createPrepBatch, addOrdersToPrepBatch, deletePrepBatch };
