const { query } = require('../db');

async function logEvent(level, source, message, details = {}) {
  await query(
    `INSERT INTO app_events (level, source, message, details)
     VALUES ($1, $2, $3, $4)`,
    [level, source, message, JSON.stringify(details)]
  );
}

async function listEvents(limit = 50) {
  const result = await query(
    `SELECT id, level, source, message, details, created_at
     FROM app_events
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

module.exports = { logEvent, listEvents };
