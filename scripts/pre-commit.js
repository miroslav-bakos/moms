'use strict';
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname,'..');
for (const [command,args] of [[process.execPath,[path.join(root,'scripts/verify.js')]],['git',['diff','--cached','--check']]]) {
  const result = spawnSync(command,args,{cwd:root,stdio:'inherit'});
  if (result.status !== 0) process.exit(result.status || 1);
}
