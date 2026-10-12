'use strict';
const path = require('node:path');
const os = require('node:os');
function defaultDataDirectory(platform = process.platform, env = process.env, home = os.homedir()) {
  if (platform === 'win32') return path.win32.join(env.LOCALAPPDATA || path.win32.join(home,'AppData','Local'),'MOMS');
  if (platform === 'darwin') return path.posix.join(home,'Library','Application Support','MOMS');
  return path.posix.join(env.XDG_DATA_HOME || path.posix.join(home,'.local','share'),'MOMS');
}
function getPaths(env = process.env) {
  const appRoot = path.resolve(__dirname,'..');
  const dataRoot = env.MOMS_DATA_DIR || '';
  if (dataRoot && !path.isAbsolute(dataRoot)) throw new Error('MOMS_DATA_DIR must be an absolute path.');
  return {
    labelsDir: dataRoot ? path.join(dataRoot,'labels') : path.join(appRoot,'labels'),
    settingsDir: path.resolve(env.SETTINGS_DIR || (dataRoot ? path.join(dataRoot,'settings') : path.join(appRoot,'settings'))),
    backupDir: path.resolve(env.BACKUP_DIR || (dataRoot ? path.join(dataRoot,'backups') : '/backup'))
  };
}
module.exports = {getPaths,defaultDataDirectory};
