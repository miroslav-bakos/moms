const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.isFile() && /\.(?:c|m)?js$/.test(full)) {
      files.push(full);
    }
  }
}

walk(path.join(root, 'src'));
walk(path.join(root, 'scripts'));

let failed = false;
for (const file of files) {
  if (file === __filename) continue;
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}

if (failed) {
  process.exit(1);
}

console.log(`Checked ${files.length - 1} JavaScript files.`);
