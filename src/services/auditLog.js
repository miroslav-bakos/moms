'use strict';

const { query } = require('../db');

async function logAudit({ username, action, entityType = '', entityId = '', description, changes }) {
  await query(
    `INSERT INTO audit_log (username, action, entity_type, entity_id, description, changes)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [username || '', action, entityType, String(entityId || ''), description,
      changes !== undefined ? JSON.stringify(changes) : null]
  );
}

async function listAuditLogs(limit = 200) {
  const result = await query(
    `SELECT id, created_at, username, action, entity_type, entity_id, description
     FROM audit_log ORDER BY created_at DESC LIMIT $1`,
    [Math.min(Number(limit) || 200, 1000)]
  );
  return result.rows;
}

async function orderHistory(id) {
  const result = await query(`SELECT id, created_at, username, action, description, changes
    FROM audit_log WHERE entity_type = 'order' AND
    (entity_id = $1 OR (action = 'order.workflow.bulk' AND (changes->'ids' @> $2::jsonb OR changes->'ids' @> $3::jsonb)))
    ORDER BY created_at DESC, id DESC LIMIT 200`, [String(id), JSON.stringify([Number(id)]),JSON.stringify([String(id)])]);
  const fields = new Set(['workflow_status','shipped','skus','address','note','tracking_code','tracking_url','label_created','processed','packed','pinned','business_outcome','record_id','restocked']);
  const safe = values => Object.fromEntries(Object.entries(values || {}).filter(([key,value]) => fields.has(key) && ['string','number','boolean'].includes(typeof value)));
  return result.rows.map(row => ({id:row.id,created_at:row.created_at,username:row.username,action:row.action, changes: row.changes ? {
    before: safe(row.changes.before), after: safe(row.changes.after || row.changes)
  } : null}));
}
module.exports = { logAudit, listAuditLogs, orderHistory };
