'use strict';
// Each worker boot recovers interrupted restore before migrations or loading cached configuration.
const { recoverInterruptedRestore } = require('../services/backup');
const { migrate } = require('../migrate');
const { closePool } = require('../db');
let stopping = false;
const markStopping = () => { stopping = true; };
const message = value => { if (value?.type === 'moms-shutdown') markStopping(); };
process.on('SIGTERM', markStopping); process.on('SIGINT', markStopping);
process.on('message', message); process.on('disconnect', markStopping);
(async () => {
  if (await recoverInterruptedRestore()) { await closePool(); process.exit(0); }
  if (!stopping) await migrate();
  process.removeListener('SIGTERM', markStopping); process.removeListener('SIGINT', markStopping);
  process.removeListener('message', message); process.removeListener('disconnect', markStopping);
  if (stopping) { await closePool(); process.exit(0); }
  require('../server');
})().catch(async () => {
  console.error('Desktop database recovery or migrations failed. Existing data is preserved.');
  await closePool().catch(() => {}); process.exit(1);
});
