const { query } = require('../db');
const { config } = require('../config');
const { fallbackSince, subtractMinutes, toDate } = require('../utils/dates');

async function listChannelState() {
  const result = await query(
    `SELECT channel, enabled, enabled_override, cursor, last_poll_started_at, last_success_at, last_error, updated_at
     FROM channel_state
     ORDER BY channel`
  );
  return result.rows.map(row => ({ ...row, enabled: effectiveChannelEnabled(row.channel, row) }));
}

async function getChannelState(channel) {
  const result = await query('SELECT * FROM channel_state WHERE channel = $1', [channel]);
  if (result.rowCount) return result.rows[0];

  await query('INSERT INTO channel_state (channel, enabled, cursor) VALUES ($1, false, $2)', [
    channel,
    fallbackSince(config.initialLookbackDays)
  ]);
  return getChannelState(channel);
}

async function setChannelEnabled(channel, enabled, execute = query) {
  await execute(
    `INSERT INTO channel_state (channel, enabled, enabled_override, updated_at)
     VALUES ($1, $2, $2, now())
     ON CONFLICT (channel) DO UPDATE SET enabled = EXCLUDED.enabled, enabled_override = EXCLUDED.enabled_override, updated_at = now()`,
    [channel, enabled]
  );
}

async function setChannelCursor(channel, cursor) {
  await query(
    `UPDATE channel_state
     SET cursor = $2, updated_at = now()
     WHERE channel = $1`,
    [channel, cursor]
  );
}

async function markPollStarted(channel) {
  const result = await query(
    `UPDATE channel_state
     SET last_poll_started_at = now(), updated_at = now()
     WHERE channel = $1 AND ($1 <> 'sashe' OR last_poll_started_at IS NULL OR
       last_poll_started_at <= now() - CASE WHEN last_error ILIKE '%Connection limit%' OR last_error ILIKE '%HTTP 429%'
         THEN interval '60 minutes' ELSE interval '15 minutes' END)
     RETURNING channel`, [channel]
  );
  return result.rowCount > 0;
}

async function markPollSuccess(channel, cursor) {
  await query(
    `UPDATE channel_state
     SET cursor = COALESCE($2, cursor),
         last_success_at = now(),
         last_error = null,
         updated_at = now()
     WHERE channel = $1`,
    [channel, cursor]
  );
}

async function markPollError(channel, error) {
  await query(
    `UPDATE channel_state
     SET last_error = $2, updated_at = now()
     WHERE channel = $1`,
    [channel, String(error && error.message ? error.message : error).slice(0, 2000)]
  );
}

function effectiveChannelEnabled(channel, state = {}) {
  if (typeof state.enabled_override === 'boolean') return state.enabled_override;
  return Boolean(state.enabled || config[channel]?.enabled);
}

function effectiveSince(state) {
  const cursor = toDate(state && state.cursor) || fallbackSince(config.initialLookbackDays);
  return subtractMinutes(cursor, config.pollOverlapMinutes);
}

module.exports = {
  effectiveChannelEnabled,
  listChannelState,
  getChannelState,
  setChannelEnabled,
  setChannelCursor,
  markPollStarted,
  markPollSuccess,
  markPollError,
  effectiveSince
};
