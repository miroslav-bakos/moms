'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Run only while backup maintenance owns the application, after its full bundle is durable.
function prune({ directory, references, days, now = Date.now() }) {
  if (!Number.isInteger(days) || days < 1 || days > 36500) return 0;
  const used = new Set();
  for (const reference of references) {
    if (!reference) continue;
    if (!reference.startsWith('/labels/')) {
      if (/labels/i.test(reference)) return 0; // Unknown local representation: preserve everything.
      continue;
    }
    let name;
    try { name = decodeURIComponent(reference.slice(8).split(/[?#]/)[0]); } catch (_) { return 0; }
    if (!name || name.includes('\\') || name.includes('\0') || name.split('/').some(part => !part || part === '.' || part === '..')) return 0;
    used.add(name);
  }
  const cutoff = now - days * 86400000;
  let count = 0;
  function visit(relative = '') {
    for (const item of fs.readdirSync(path.join(directory,relative), {withFileTypes:true})) {
      const name = relative ? relative + '/' + item.name : item.name;
      const file = path.join(directory,name);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) visit(name);
      else if (stat.isFile() && !used.has(name) && Math.max(stat.mtimeMs,stat.ctimeMs) < cutoff) {
        fs.unlinkSync(file); count++;
      }
    }
  }
  if (fs.existsSync(directory)) visit();
  return count;
}
module.exports = { prune };
