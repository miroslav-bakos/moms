'use strict';
// Build on the target OS from explicitly supplied, trusted Node/PostgreSQL runtime trees.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const TOOLS = ['postgres','initdb','pg_ctl','pg_dump','pg_restore','psql'];
const root = path.resolve(__dirname, '..');
function copyTree(source, destination) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, {recursive:true});
    for (const name of fs.readdirSync(source)) if (name !== '.bin') copyTree(path.join(source,name),path.join(destination,name));
  } else if (stat.isFile()) {
    fs.copyFileSync(fs.realpathSync(source),destination);
    fs.chmodSync(destination,stat.mode & 0o777);
  } else throw new Error('Runtime contains unsupported files.');
}
function inventory(directory, relative = '') {
  const entries = [];
  for (const name of fs.readdirSync(path.join(directory, relative)).sort()) {
    const item = path.posix.join(relative, name), file = path.join(directory, item), stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('Desktop bundles must contain only regular files and directories.');
    if (stat.isDirectory()) entries.push(...inventory(directory, item));
    else if (item !== 'desktop-manifest.json') entries.push({ path: item, bytes: stat.size, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') });
  }
  return entries;
}
function build({ output, node = process.execPath, postgres, version = require('../package.json').version, 'released-at': releasedAt = new Date().toISOString().slice(0,10) }) {
  if (!path.isAbsolute(output || '') || !path.isAbsolute(node) || !path.isAbsolute(postgres || '') || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(version)) throw new Error('Supply absolute output, node and PostgreSQL runtime paths and a valid version.');
  if (fs.existsSync(output)) throw new Error('Build output must not exist; existing artifacts will not be overwritten.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(releasedAt)||new Date(releasedAt+'T00:00:00Z').toISOString().slice(0,10)!==releasedAt)throw new Error('Invalid release date.');
  if (!/^v22\./.test(execFileSync(node, ['--version'], { encoding: 'utf8' }).trim())) throw new Error('Node 22 is required.');
  const suffix = process.platform === 'win32' ? '.exe' : '';
  for (const tool of TOOLS) {
    const file = path.join(postgres, 'bin', tool + suffix);
    const version = execFileSync(file, ['--version'], { encoding: 'utf8', env: require('../src/desktop/postgres').withRuntime(process.env, postgres), windowsHide: true, timeout: 10000 });
    const match = version.match(/\b(\d+)\.(\d+)\b/);
    if (!match || Number(match[1]) !== 16 || Number(match[2]) < 15) throw new Error('PostgreSQL 16.15+ is required.');
  }
  fs.mkdirSync(output, { recursive: true });
  for (const name of ['src','scripts','migrations','docs','package.json','package-lock.json']) fs.cpSync(path.join(root, name), path.join(output, name), { recursive: true, dereference: true });
  fs.cpSync(path.join(root,'node_modules'), path.join(output,'node_modules'), { recursive: true, dereference: true, filter: file => path.basename(file) !== '.bin' });
  fs.mkdirSync(path.join(output, 'runtime'), { recursive: true });
  fs.copyFileSync(node, path.join(output, 'runtime', 'node' + suffix));
  fs.chmodSync(path.join(output, 'runtime', 'node' + suffix), 0o755);
  for(const file of ['LICENSE','NOTICE'])fs.copyFileSync(path.join(root,file),path.join(output,file));
  const license = [path.join(path.dirname(node),'NODE-LICENSE'),path.join(path.dirname(node),'LICENSE'),path.join(path.dirname(node),'../LICENSE')].find(file=>fs.existsSync(file));
  if (!license) throw new Error('The Node runtime license must accompany its executable.');
  fs.copyFileSync(license,path.join(output,'runtime','NODE-LICENSE'));
  copyTree(postgres, path.join(output, 'runtime', 'postgresql'));
  const pgLicense = path.join(path.dirname(postgres),'POSTGRESQL-LICENSE');
  if (fs.existsSync(pgLicense)) fs.copyFileSync(pgLicense,path.join(output,'runtime','POSTGRESQL-LICENSE'));
  if(process.platform==='win32')fs.writeFileSync(path.join(output,'Install-MOMS.cmd'),'@echo off\r\n"%~dp0runtime\\node.exe" "%~dp0scripts\\install-desktop.js" --bundle "%~dp0."\r\npause\r\n');
  else fs.writeFileSync(path.join(output,process.platform==='darwin'?'Install-MOMS.command':'Install-MOMS.sh'),'#!/bin/sh\nroot=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$root/runtime/node" "$root/scripts/install-desktop.js" --bundle "$root"\n',{mode:0o755});
  const manifest = { format: 1, platform: process.platform, arch: process.arch, version, releasedAt, nodeMajor: 22, postgresMajor: 16, ...(process.platform==='linux'?{minimumGlibc:process.report.getReport().header.glibcVersionRuntime}:{}), files: inventory(output) };
  fs.writeFileSync(path.join(output, 'desktop-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
if (require.main === module) {
  const args = process.argv.slice(2), values = {};
  for (let i=0; i<args.length; i+=2) {
    if (!['--output','--node','--postgres','--version','--released-at'].includes(args[i]) || !args[i+1]) { console.error('Usage: node scripts/build-desktop.js --output <new-absolute-dir> --postgres <runtime-dir> [--node <node-path>] [--version <version>] [--released-at YYYY-MM-DD]'); process.exit(2); }
    values[args[i].slice(2)] = args[i+1];
  }
  try { const manifest = build(values); console.log(`Built MOMS ${manifest.version} for ${manifest.platform}/${manifest.arch}: ${manifest.files.length} verified files.`); }
  catch (_) { console.error('Desktop bundle build failed. Check supplied runtime versions, files and output permissions.'); process.exitCode = 1; }
}
module.exports = { build, inventory };
