'use strict';
// Installer-only snapshots: no server/scheduler starts, and bootstrap secrets never reach stdout.
const fs = require('node:fs');
const path = require('node:path');
const { dataDirectory, desktopEnvironment } = require('../src/desktop/runtime');
async function snapshot({ dataRoot, output, restore = false }) {
  dataRoot = dataDirectory(dataRoot);
  if (!path.isAbsolute(output) || path.dirname(output) !== path.join(dataRoot,'backups') || !/^pre-update-[a-z0-9-]+\.moms\.gz$/.test(path.basename(output))) throw new Error('Invalid private update snapshot path.');
  let database, pool;
  const env = desktopEnvironment(dataRoot,process.env);
  try {
    if (!env.DATABASE_URL) database = await require('../src/desktop/postgres').start({dataRoot,directory:env.MOMS_POSTGRES_DIR,env});
    Object.assign(process.env,database?.env || (env.MOMS_POSTGRES_DIR ? require('../src/desktop/postgres').withRuntime(env,env.MOMS_POSTGRES_DIR) : env));
    pool = require('../src/db');
    const deadline=Date.now()+65000;
    while(true){
      const active=await pool.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'");
      if(!active.rows[0].count)break;
      if(Date.now()>deadline)throw new Error('Database connections remain active; update snapshot refused.');
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    const backup = require('../src/services/backup');
    if (await backup.recoverInterruptedRestore()) return 3; // Re-execute with freshly loaded settings.
    if (restore) await backup.restoreFromBuffer(fs.readFileSync(output));
    else {
      fs.mkdirSync(path.dirname(output),{recursive:true,mode:0o700});
      const bytes = await backup.createBundle(), temporary = output+'.partial';
      const fd = fs.openSync(temporary,'wx',0o600);
      try { fs.writeFileSync(fd,bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temporary,output);
    }
    return 0;
  } finally { await pool?.closePool(); await database?.stop(); }
}
if(require.main===module){
  const [command,dataRoot,output]=process.argv.slice(2);
  if(!['create','restore'].includes(command)||!dataRoot||!output){console.error('Usage: desktop-snapshot.js <create|restore> <data-root> <private-snapshot-path>');process.exit(2);}
  snapshot({dataRoot,output,restore:command==='restore'}).then(code=>{process.exitCode=code;}).catch(()=>{console.error('Private desktop snapshot operation failed. Existing recovery backups are preserved.');process.exitCode=1;});
}
module.exports={snapshot};
