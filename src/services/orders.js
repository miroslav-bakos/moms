const { query, withClient } = require('../db');
const { addBusinessDays, toIso } = require('../utils/dates');
const { resolveSkuText } = require('./products');

async function normalizeOrder(order) {
  const rawSkus = order.rawSkus || [];
  const skus = order.skus || await resolveSkuText(rawSkus);
  const createdAt = order.createdAt || null;
  const shipByDate = order.shipByDate || addBusinessDays(createdAt, 2);
  const status = order.status || '';

  return {
    channel: order.channel,
    vendor: order.vendor || order.channel,
    externalOrderId: String(order.externalOrderId || '').trim(),
    orderName: order.orderName || '',
    status,
    skus,
    rawSkus,
    createdAt,
    updatedAtSource: order.updatedAtSource || order.createdAt || null,
    shipByDate,
    address: order.address || '',
    note: order.note || '',
    isGift: Boolean(order.isGift),
    giftMessage: order.giftMessage || '',
    shipped: Boolean(order.shipped || /^shipped$/i.test(status) || /^fulfilled$/i.test(status) || /^cancell?ed$/i.test(status)),
    trackingCode: order.trackingCode || '',
    trackingUrl: order.trackingUrl || '',
    orderUrl: order.orderUrl || '',
    sourcePayload: order.sourcePayload || {},
    revenueAmount: order.revenueAmount != null ? Number(order.revenueAmount) : null,
    revenueCurrency: order.revenueCurrency || null
  };
}

async function upsertOrder(input) {
  const order = await normalizeOrder(input);
  if (!order.channel || !order.externalOrderId) {
    throw new Error('Order must include channel and externalOrderId.');
  }

  const canceled = /^cancell?ed$/i.test(order.status);
  const businessOutcome = canceled ? 'canceled' : order.sourcePayload?.financial_status === 'refunded' ? 'refunded' : 'active';
  const insertNote = canceled
    ? (order.note ? `${order.note} | CANCELED` : 'CANCELED')
    : order.note;

  const result = await query(
    `INSERT INTO orders (
       channel, vendor, external_order_id, order_name, status, skus, raw_skus,
       created_at, updated_at_source, ship_by_date, address, note, is_gift,
       gift_message, shipped, tracking_code, tracking_url, order_url, source_payload,
       revenue_amount, revenue_currency, business_outcome,
       updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12, $13,
       $14, $15, $16, $17, $18, $19,
       $20, $21, $23,
       now()
     )
     ON CONFLICT (channel, external_order_id) DO UPDATE SET
       vendor = EXCLUDED.vendor,
       order_name = EXCLUDED.order_name,
       status = EXCLUDED.status,
       business_outcome = CASE WHEN orders.business_outcome_locked THEN orders.business_outcome ELSE EXCLUDED.business_outcome END,
       skus = CASE WHEN orders.skus_locked OR EXISTS(SELECT 1 FROM order_inventory WHERE order_id=orders.id AND consumed=true) OR EXISTS(SELECT 1 FROM order_shipments WHERE order_id=orders.id) THEN orders.skus ELSE EXCLUDED.skus END,
       raw_skus = CASE WHEN EXISTS(SELECT 1 FROM order_inventory WHERE order_id=orders.id AND consumed=true) OR EXISTS(SELECT 1 FROM order_shipments WHERE order_id=orders.id) THEN orders.raw_skus ELSE EXCLUDED.raw_skus END,
       created_at = COALESCE(EXCLUDED.created_at, orders.created_at),
       updated_at_source = COALESCE(EXCLUDED.updated_at_source, orders.updated_at_source),
       ship_by_date = COALESCE(EXCLUDED.ship_by_date, orders.ship_by_date),
       address = CASE WHEN orders.address_locked THEN orders.address ELSE COALESCE(NULLIF(EXCLUDED.address, ''), orders.address) END,
       note = CASE
         WHEN $22 AND COALESCE(orders.note, '') !~* 'CANCELED'
           THEN CASE WHEN COALESCE(orders.note, '') = '' THEN 'CANCELED' ELSE orders.note || ' | CANCELED' END
         ELSE COALESCE(NULLIF(EXCLUDED.note, ''), orders.note)
       END,
       is_gift = EXCLUDED.is_gift,
       gift_message = COALESCE(NULLIF(EXCLUDED.gift_message, ''), orders.gift_message),
       shipped = orders.shipped OR EXCLUDED.shipped,
       tracking_code = COALESCE(NULLIF(EXCLUDED.tracking_code, ''), orders.tracking_code),
       tracking_url = COALESCE(NULLIF(EXCLUDED.tracking_url, ''), orders.tracking_url),
       order_url = COALESCE(NULLIF(EXCLUDED.order_url, ''), orders.order_url),
       source_payload = EXCLUDED.source_payload,
       revenue_amount = COALESCE(EXCLUDED.revenue_amount, orders.revenue_amount),
       revenue_currency = COALESCE(EXCLUDED.revenue_currency, orders.revenue_currency),
       updated_at = now()
     RETURNING *`,
    [
      order.channel,
      order.vendor,
      order.externalOrderId,
      order.orderName,
      order.status,
      order.skus,
      JSON.stringify(order.rawSkus),
      toIso(order.createdAt),
      toIso(order.updatedAtSource),
      toIso(order.shipByDate),
      order.address,
      insertNote,
      order.isGift,
      order.giftMessage,
      order.shipped,
      order.trackingCode,
      order.trackingUrl,
      order.orderUrl,
      JSON.stringify(order.sourcePayload),
      order.revenueAmount,
      order.revenueCurrency,
      canceled,
      businessOutcome
    ]
  );

  return result.rows[0];
}

async function listOrders(options = {}, execute = query) {
  const paginate = Boolean(options.paginate);
  const limit = Math.min(Number(options.limit) || (paginate ? 50 : 500), options.export ? 5001 : 2000);
  const offset = paginate ? Math.max(Number(options.offset) || 0, 0) : 0;
  const status = String(options.status || '').toLowerCase();
  // One statement gives the board a complete, consistent snapshot of active work.
  const complete = options.complete === true && status === 'open' && !paginate;
  const whereParts = [];
  const filterParams = [];

  if (options.pinnedOnly) {
    whereParts.push('pinned = true');
  } else if (options.ids && options.ids.length) {
    filterParams.push(options.ids);
    whereParts.push(`id = ANY($${filterParams.length})`);
  } else if (status === 'open' || (options.activeOnly !== false && status !== 'archive' && status !== 'all')) {
    whereParts.push('shipped = false');
  } else if (status === 'archive') {
    whereParts.push('shipped = true');
  }

  if (paginate) {
    const search = String(options.search || '').trim();
    if (search) {
      filterParams.push(`%${search}%`);
      const searchParam = `$${filterParams.length}`;
      whereParts.push(`(
        COALESCE(vendor, '') ILIKE ${searchParam} OR COALESCE(external_order_id, '') ILIKE ${searchParam} OR
        COALESCE(order_name, '') ILIKE ${searchParam} OR COALESCE(skus, '') ILIKE ${searchParam} OR
        COALESCE(address, '') ILIKE ${searchParam} OR COALESCE(tracking_code, '') ILIKE ${searchParam} OR
        COALESCE(note, '') ILIKE ${searchParam} OR COALESCE(shipping_weight::text, '') ILIKE ${searchParam} OR
        COALESCE(source_payload->>'order_number', '') ILIKE ${searchParam}
      )`);
    }
    for (const col of ['vendor', 'external_order_id', 'skus', 'address', 'tracking_code', 'note', 'shipping_weight','business_outcome']) {
      const val = String(options[col] || '').trim();
      if (val) {
        filterParams.push(`%${val}%`);
        whereParts.push(`${col} ILIKE $${filterParams.length}`);
      }
    }
    for (const col of ['created_at', 'ship_by_date', 'delivered_at']) {
      const from = String(options[`${col}_from`] || '').trim();
      const to = String(options[`${col}_to`] || '').trim();
      if (from) {
        filterParams.push(from);
        whereParts.push(`${col}::date >= $${filterParams.length}::date`);
      }
      if (to) {
        filterParams.push(to);
        whereParts.push(`${col}::date <= $${filterParams.length}::date`);
      }
    }
    if (options.label_created === 'y' || options.label_created === 'n') {
      filterParams.push(options.label_created === 'y');
      whereParts.push(`label_created = $${filterParams.length}`);
    }
  }

  const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  const ALLOWED_SORT = new Set(['vendor', 'external_order_id', 'skus', 'created_at', 'ship_by_date', 'address', 'note', 'tracking_code','dispatched_at']);
  const sortCol = ALLOWED_SORT.has(options.sortKey) ? options.sortKey : status==='archive'?'dispatched_at':'created_at';
  const sortDir = options.sortDir === 'asc' ? 'ASC' : 'DESC';
  const sortExpr = sortCol === 'dispatched_at' ? 'COALESCE(dispatched_at, created_at, imported_at)' : sortCol === 'created_at' ? 'COALESCE(created_at, imported_at)' : sortCol;

  const result = await execute(
    `SELECT orders.*,
       (SELECT state FROM marketplace_dispatches WHERE order_id=orders.id) AS marketplace_dispatch_state,
       (SELECT COALESCE(sum(quantity),0) FROM order_lines WHERE order_id=orders.id) AS fulfillment_quantity,
       (SELECT COALESCE(sum(sl.quantity),0) FROM order_shipment_lines sl JOIN order_shipments s ON s.id=sl.shipment_id WHERE s.order_id=orders.id AND s.canceled_at IS NULL) AS fulfilled_quantity
     FROM orders ${whereClause}
     ORDER BY ${sortExpr} ${sortDir} NULLS LAST, id ${sortDir}
     ${complete ? '' : `LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}`}`,
    complete ? filterParams : [...filterParams, limit, offset]
  );

  if (paginate) {
    const countResult = await execute(
      `SELECT COUNT(*) FROM orders ${whereClause}`,
      filterParams
    );
    return { orders: result.rows, total: Number(countResult.rows[0].count) };
  }

  return result.rows;
}

async function updateOrderFlags(id, patch) {
  const assignments = [];
  const values = [];
  if (Object.prototype.hasOwnProperty.call(patch, 'workflow_status')) {
    const status = await query('SELECT id FROM order_workflow_statuses WHERE id = $1', [patch.workflow_status]);
    if (!status.rows.length) {
      const error = new Error('Invalid order workflow status.');
      error.statusCode = 400;
      throw error;
    }
    values.push(patch.workflow_status);
    assignments.push(`workflow_status = $${values.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'business_outcome')) {
    if (!['active','canceled','refunded','returned'].includes(patch.business_outcome)) {const error=new Error('Invalid business outcome.');error.statusCode=400;throw error;}
    values.push(patch.business_outcome); assignments.push(`business_outcome = $${values.length}`, 'business_outcome_locked = true');
  }

  const allowed = ['processed', 'packed', 'shipped', 'label_created', 'feedback_requested', 'pinned'];

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      values.push(Boolean(patch[key]));
      assignments.push(`${key} = $${values.length}`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'tracking_code')) {
    values.push(String(patch.tracking_code || ''));
    const codeParam = `$${values.length}`;
    assignments.push(`tracking_code = ${codeParam}`);
    if (!Object.prototype.hasOwnProperty.call(patch, 'delivered_at')) {
      assignments.push(`delivered_at = CASE WHEN tracking_code IS DISTINCT FROM ${codeParam} THEN NULL ELSE delivered_at END`);
    }
    if (!Object.prototype.hasOwnProperty.call(patch, 'tracking_status')) {
      assignments.push(`tracking_status = CASE WHEN tracking_code IS DISTINCT FROM ${codeParam} THEN '' ELSE tracking_status END`);
    }
  }

  for (const key of ['tracking_url', 'tracking_status', 'label_url', 'address', 'note', 'skus', 'shipping_weight','business_outcome']) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      values.push(String(patch[key] || ''));
      assignments.push(`${key} = $${values.length}`);
      // Manual edits to address/skus must survive later API polls, which otherwise
      // overwrite these fields with fresh channel data on every upsert.
      if (key === 'address') assignments.push('address_locked = true');
      // An unchanged save must not disable automatic product mapping.
      if (key === 'skus') assignments.push(`skus_locked = skus_locked OR skus IS DISTINCT FROM $${values.length}`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'prepared_gobbis')) {
    values.push(JSON.stringify(Array.isArray(patch.prepared_gobbis) ? patch.prepared_gobbis : []));
    assignments.push(`prepared_gobbis = $${values.length}::jsonb`);
  }

  for (const key of ['created_at', 'ship_by_date', 'delivered_at']) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      values.push(patch[key] || null);
      assignments.push(`${key} = $${values.length}`);
    }
  }

  if (!assignments.length) {
    const current = await query('SELECT * FROM orders WHERE id = $1', [id]);
    return current.rows[0] || null;
  }

  values.push(id);
  return withClient(async client => {
    await client.query('BEGIN');
    try {
      const before = (await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if (!before) { await client.query('ROLLBACK'); return null; }
      if (Object.prototype.hasOwnProperty.call(patch,'skus') && before.skus !== String(patch.skus || '')) {
        const frozen=await client.query('SELECT order_id FROM order_inventory WHERE order_id=$1 AND consumed=true UNION SELECT order_id FROM order_shipments WHERE order_id=$1 UNION SELECT order_id FROM order_returns WHERE order_id=$1',[id]);
        if(frozen.rowCount) {const error=new Error('Order lines are recorded. SKU edits require an inventory review.');error.statusCode=409;throw error;}
        await client.query('DELETE FROM order_lines WHERE order_id=$1',[id]);
      }
      const result = await client.query(`UPDATE orders SET ${assignments.join(', ')}, updated_at = now() WHERE id=$${values.length} RETURNING *`,values);
      const after = result.rows[0];
      if (['workflow_status','shipped','skus'].some(key => Object.prototype.hasOwnProperty.call(patch,key))) await require('./inventory').reconcile(client,before,after);
      await client.query('COMMIT'); return after;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  });
}

// Lock selected orders in a stable order; all inventory movements share this transaction.
async function updateOrderWorkflow(ids, status) {
  const fail = (message, code = 400) => { const error = new Error(message); error.statusCode = code; throw error; };
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) fail('Select between 1 and 500 different orders.');
  if (typeof status !== 'string') fail('Invalid order workflow status.');
  return withClient(async client => {
    await client.query('BEGIN');
    try {
      if (!(await client.query('SELECT id FROM order_workflow_statuses WHERE id=$1 FOR KEY SHARE', [status])).rowCount) fail('Invalid order workflow status.');
      const rows = (await client.query('SELECT * FROM orders WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE', [ids])).rows;
      if (rows.length !== ids.length || rows.some(order => order.shipped)) fail('Selected orders changed. Refresh and try again.', 409);
      const updated = [];
      for (const before of rows) {
        const after = (await client.query('UPDATE orders SET workflow_status=$2, updated_at=now() WHERE id=$1 RETURNING *', [before.id, status])).rows[0];
        await require('./inventory').reconcile(client, before, after);
        updated.push(after);
      }
      await client.query('COMMIT');
      return updated;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  });
}

async function archiveShipped() {
  const result = await query(
    `UPDATE orders
     SET updated_at = now()
     WHERE shipped = true
     RETURNING id`
  );
  return result.rowCount;
}

async function deleteOrder(id) {
  return withClient(async client => {
    await client.query('BEGIN');
    try {
      const order = (await client.query('SELECT channel FROM orders WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!order) { await client.query('COMMIT'); return false; }
      const history = await client.query('SELECT order_id FROM order_inventory WHERE order_id = $1 UNION SELECT order_id FROM order_shipments WHERE order_id=$1 UNION SELECT order_id FROM order_returns WHERE order_id=$1', [id]);
      // Imported identities and recorded stock snapshots must survive future sync/reopening.
      if (order.channel !== 'manual' || history.rows.length) {
        const error = new Error('This order has an import identity or stock history. Archive it instead of deleting it.');
        error.statusCode = 409; throw error;
      }
      await client.query('DELETE FROM order_lines WHERE order_id=$1',[id]);
      await client.query('DELETE FROM orders WHERE id = $1', [id]);
      await client.query('COMMIT'); return true;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  });
}

module.exports = { upsertOrder, listOrders, updateOrderFlags, updateOrderWorkflow, archiveShipped, deleteOrder };
