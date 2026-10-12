'use strict';

const express = require('express');
const path = require('path');
const { listBackups, deleteBackup, performBackup, restoreBackup, restoreFromBuffer, verifyFromBuffer } = require('../services/backup');
const { logAudit } = require('../services/auditLog');

function reqUser(req) {
  return req.authUser || req.headers['tailscale-user-login'] || req.headers['tailscale-user-name'] || '';
}

const router = express.Router();
router.use(require('../middleware/sameOrigin').sameOrigin);

router.get('/download', async (req, res, next) => {
  try {
    const backup = await performBackup();
    res.download(path.join(require('../paths').getPaths().backupDir, backup.filename), backup.filename);
  } catch (error) { next(error); }
});
function respondRestored(res, result) {
  res.once('finish', () => { setTimeout(() => process.exit(0), 300); });
  res.json({ ok: true, ...result });
}

router.post('/restore', express.raw({ type: '*/*', limit: '500mb' }), async (req, res, next) => {
  try {
    const result = await restoreFromBuffer(req.body);
    logAudit({ username: reqUser(req), action: 'backup.restore_file', entityType: 'backup', entityId: '', description: 'Restored database from uploaded backup file' }).catch(() => {});
    respondRestored(res, result);
  } catch (err) { next(err); }
});

router.get('/list', async (req, res, next) => {
  try { res.json(await listBackups()); } catch (err) { next(err); }
});

router.post('/now', async (req, res, next) => {
  try {
    const backup = await performBackup();
    logAudit({ username: reqUser(req), action: 'backup.create', entityType: 'backup', entityId: String(backup.id), description: `Created manual backup: ${backup.filename}` }).catch(() => {});
    res.json(backup);
  } catch (err) { next(err); }
});

router.post('/:id/restore', async (req, res, next) => {
  try {
    const ok = await restoreBackup(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Not found' });
    logAudit({ username: reqUser(req), action: 'backup.restore', entityType: 'backup', entityId: req.params.id, description: `Restored database from backup #${req.params.id}` }).catch(() => {});
    respondRestored(res, ok);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const ok = await deleteBackup(Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Not found' });
    logAudit({ username: reqUser(req), action: 'backup.delete', entityType: 'backup', entityId: req.params.id, description: `Deleted backup #${req.params.id}` }).catch(() => {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/verify', express.raw({ type: '*/*', limit: '500mb' }), async (req, res, next) => {
  try { res.json(await verifyFromBuffer(req.body)); }
  catch (error) { error.statusCode = 400; next(error); }
});

module.exports = router;
