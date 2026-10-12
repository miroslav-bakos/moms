const crypto = require('node:crypto');
const { query, withClient } = require('../db');

function workflowError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function statusLabel(value) {
  const label = String(value || '').trim();
  if (!label || label.length > 60) throw workflowError('Status name must contain 1–60 characters.');
  return label;
}

async function listWorkflowStatuses() {
  const result = await query(`SELECT s.id, s.label, s.position, s.background_color, s.background_alpha, s.production_complete, COUNT(o.id)::int AS order_count
    FROM order_workflow_statuses s LEFT JOIN orders o ON o.workflow_status = s.id
    GROUP BY s.id ORDER BY s.position, s.id`);
  return result.rows;
}

async function saveWorkflowStatus(id, value) {
  const label = statusLabel(value);
  try {
    if (id) {
      const result = await query('UPDATE order_workflow_statuses SET label = $1 WHERE id = $2 RETURNING *', [label, id]);
      if (!result.rows.length) throw workflowError('Status not found.', 404);
      return result.rows[0];
    }
    const result = await query(`INSERT INTO order_workflow_statuses (id, label, position)
      VALUES ($1, $2, (SELECT COALESCE(MAX(position), 0) + 1 FROM order_workflow_statuses)) RETURNING *`,
    ['custom_' + crypto.randomUUID(), label]);
    return result.rows[0];
  } catch (error) {
    if (error.code === '23505') throw workflowError('A status with that name already exists.');
    throw error;
  }
}

async function deleteWorkflowStatus(id) {
  if (id === 'new') throw workflowError('The default status can be renamed but cannot be removed.');
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const found = await client.query('SELECT id FROM order_workflow_statuses WHERE id = $1 FOR UPDATE', [id]);
      if (!found.rows.length) throw workflowError('Status not found.', 404);
      const affected = (await client.query('SELECT * FROM orders WHERE workflow_status=$1 ORDER BY id FOR UPDATE',[id])).rows;
      for (const order of affected) await require('./inventory').reconcile(client,order,{...order,workflow_status:'new'});
      await client.query("UPDATE orders SET workflow_status = 'new', updated_at = now() WHERE workflow_status = $1", [id]);
      await client.query('DELETE FROM order_workflow_statuses WHERE id = $1', [id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

module.exports = { listWorkflowStatuses, saveWorkflowStatus, deleteWorkflowStatus };

async function reorderWorkflowStatuses(ids) {
  if(!Array.isArray(ids) || !ids.length || ids.some(id=>typeof id!=='string') || new Set(ids).size!==ids.length) throw workflowError('Invalid status order.');
  return withClient(async client=>{
    await client.query('BEGIN');
    try {
      await client.query('LOCK TABLE order_workflow_statuses IN SHARE ROW EXCLUSIVE MODE');
      const current=(await client.query('SELECT id FROM order_workflow_statuses')).rows;
      if(current.length!==ids.length || current.some(row=>!ids.includes(row.id))) throw workflowError('Statuses changed. Refresh and try again.',409);
      await client.query('UPDATE order_workflow_statuses s SET position=o.position FROM unnest($1::text[]) WITH ORDINALITY AS o(id,position) WHERE s.id=o.id',[ids]);
      await client.query('COMMIT');return {ok:true};
    }catch(error){await client.query('ROLLBACK');throw error;}
  });
}
module.exports.reorderWorkflowStatuses=reorderWorkflowStatuses;

async function saveWorkflowAppearance(id, body = {}) {
  const color = body.background_color;
  const alpha = body.background_alpha;
  if ((color !== null && (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))) || typeof alpha !== 'number' || !Number.isFinite(alpha) || alpha < 0 || alpha > 1 || Math.abs(alpha * 100 - Math.round(alpha * 100)) > 1e-8) throw workflowError('Choose a valid color and opacity between 0 and 100%.');
  const result = await query('UPDATE order_workflow_statuses SET background_color=$2, background_alpha=$3 WHERE id=$1 RETURNING *', [id, color?.toLowerCase() || null, alpha]);
  if (!result.rows.length) throw workflowError('Status not found.', 404);
  return result.rows[0];
}
module.exports.saveWorkflowAppearance = saveWorkflowAppearance;

// Changing semantics is prospective: occupied stages must first be emptied.
async function saveProductionMeaning(id, body={}) {
 if(typeof body.production_complete!=='boolean'||(id==='new'&&body.production_complete))throw workflowError('Choose a valid production meaning.');
 return withClient(async client=>{
  await client.query('BEGIN');
  try {
   await client.query('SELECT id FROM inventory_config_lock WHERE id=true FOR UPDATE');
   const status=(await client.query('SELECT * FROM order_workflow_statuses WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!status)throw workflowError('Status not found.',404);
   if(status.production_complete!==body.production_complete){
    if((await client.query('SELECT id FROM orders WHERE workflow_status=$1 LIMIT 1',[id])).rowCount)throw workflowError('Move orders out of this stage before changing its production meaning.',409);
    await client.query('UPDATE order_workflow_statuses SET production_complete=$2 WHERE id=$1',[id,body.production_complete]);
   }
   await client.query('COMMIT');return {...status,production_complete:body.production_complete};
  }catch(error){await client.query('ROLLBACK');throw error;}
 });
}
module.exports.saveProductionMeaning=saveProductionMeaning;
