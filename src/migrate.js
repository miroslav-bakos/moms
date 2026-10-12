const fs = require('fs');
const path = require('path');
const { query, withClient, closePool } = require('./db');

async function ensureMigrationTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function migrate() {
  const migrationsDir = path.resolve(__dirname, '..', 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  await ensureMigrationTable();

  for (const file of files) {
    const already = await query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
    if (already.rowCount) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await withClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
    console.log(`Applied migration ${file}`);
  }
}

if (require.main === module) {
  require('./services/backup').recoverInterruptedRestore().then(async recovered => {
    if (recovered) { await closePool(); process.exit(1); }
    return migrate();
  })
    .then(() => closePool())
    .catch(async (error) => {
      console.error(error);
      await closePool();
      process.exit(1);
    });
}

module.exports = { migrate };
