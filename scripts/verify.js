'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const checks = {
  harness: ['harness'],
  sync: ['marketplace-dispatch-channels', 'marketplace-dispatch', 'channel-enabling', 'scheduler', 'lifecycle', 'channel-pagination', 'amazon-sashe-sync', 'marketplace-balances'],
  settings: ['service-diagnostics', 'data-paths', 'desktop', 'desktop-postgres', 'desktop-install', 'tailscale', 'web-push', 'application-settings', 'localization', 'branding', 'mobile-connect'],
  orders: ['accounting-export', 'order-workflow', 'order-export', 'open-export', 'order-print', 'thailand-address'],
  inventory: ['setup-trial', 'cost-math', 'vat', 'profitability', 'production-math', 'dashboard-pins', 'shopping-export'],
  backup: ['private-cache', 'backup-copy', 'backup-bundle', 'backup-origin', 'label-retention']
};
const args = process.argv.slice(2);
const valid = args.every(a => ['--changed', '--db'].includes(a) || a.startsWith('--base='));
if (!valid || (args.includes('--db') && args.includes('--changed'))) {
  console.error('Usage: npm run verify -- [--changed] [--base=<git-ref>] | npm run verify:db'); process.exit(2);
}
let staging;
let passed = 0;
const started = Date.now();
function run(name, file, cwd, env, preload) {
  const result = spawnSync(process.execPath, [...(preload ? ['--require', preload] : []), file], {
    cwd, env, encoding: 'utf8', timeout: args.includes('--db') ? 180000 : 30000, maxBuffer: 2 * 1024 * 1024
  });
  if (result.status !== 0) {
    console.error(`FAIL ${name}\n${result.stdout || ''}${result.stderr || ''}${result.error?.message || ''}`);
    throw new Error(`${name} failed`);
  }
  passed++;
}
function groups() {
  if (!args.includes('--changed')) return Object.keys(checks);
  const base = args.find(a => a.startsWith('--base='))?.slice(7) || 'HEAD';
  const git = command => {
    const result = spawnSync('git', command, {cwd: root, encoding: 'utf8'});
    if (result.status !== 0) throw new Error('Cannot determine changed files. Run the full verify suite.');
    return result.stdout.trim().split('\n').filter(Boolean);
  };
  const files = [...git(['diff','--name-only',base,'--']), ...git(['ls-files','--others','--exclude-standard'])];
  if (!files.length) return Object.keys(checks);
  const selected = new Set();
  for (const file of files) {
    if (/^(AGENTS\.md|docs\/|PRODUCT-BACKLOG\.md|README\.md)$/.test(file)) continue;
    const matches = Object.keys(checks).filter(group => ({
      harness: /scripts\/verify|scripts\/harness|check-harness/,
      sync: /channels\/|scheduler|channelState|marketplaceBalances|check-(channel|scheduler|amazon-sashe)/,
      settings: /paths\.js|data-paths|desktop|settings\/|config\.js|branding|mobileConnect|localization|locales\/|i18n/,
      orders: /orders\.js|order(Print|Export|Import|Workflow)|countries|thailand|workflow|check-order/,
      inventory: /inventory|costMath|orderCosts|cost-math|dashboardPins|productionMath|production-math|dashboard-pins/,
      backup: /backup|sameOrigin|maintenance/
    })[group].test(file));
    if (!matches.length) return Object.keys(checks); // Shared/unknown changes fail safe to full coverage.
    matches.forEach(group => selected.add(group));
  }
  return [...selected];
}
try {
  // Syntax is cheap and always covers the whole repository.
  run('syntax', path.join(root,'scripts/check-syntax.js'), root, process.env);
  staging = fs.mkdtempSync(path.join(os.tmpdir(), 'moms-backup-check-'));
  const env = { ...process.env, SETTINGS_DIR: path.join(staging,'settings'), BACKUP_DIR: path.join(staging,'backups') };
  delete env.MOMS_DATA_DIR; // Never inherit the desktop application's data root into tests.
  if (args.includes('--db')) {
    const database = process.env.MOMS_TEST_DATABASE_URL;
    if (!database || !['postgres:','postgresql:'].includes(new URL(database).protocol)) throw new Error('Set MOMS_TEST_DATABASE_URL to a dedicated PostgreSQL test service with CREATE DATABASE/ROLE privileges.');
    for (const directory of ['src','scripts','migrations']) fs.cpSync(path.join(root,directory),path.join(staging,directory),{recursive:true});
    fs.symlinkSync(path.join(root,'node_modules'),path.join(staging,'node_modules'),'junction');
    // Prevent staged code from loading deployment .env; config receives only the explicit test URL.
    fs.writeFileSync(path.join(staging,'no-dotenv.cjs'), "require('dotenv').config=()=>({parsed:{}});\n");
    env.DATABASE_URL = database;
    for (const file of ['run-inventory-check','check-inventory-shopping','check-order-import','check-order-scan','check-backup-restore','check-mobile-pairing','check-sync-restart']) {
      run(file,path.join(staging,'scripts',file+'.js'),staging,env,path.join(staging,'no-dotenv.cjs'));
    }
  } else {
    // No production credentials are needed or read by offline checks.
    for (const field of require('../src/settings/schema.json')) delete env[field.env];
    env.SETTINGS_DIR = path.join(staging,'settings'); env.BACKUP_DIR = path.join(staging,'backups');
    env.DATABASE_URL = 'postgres://offline:offline@127.0.0.1:1/offline';
    for (const group of groups()) for (const name of checks[group]) {
      run(name,path.join(root,'scripts/check-'+name+'.js'),root,env,path.join(root,'scripts/harness/offline.cjs'));
    }
  }
  console.log(`PASS ${passed} checks (${((Date.now()-started)/1000).toFixed(1)}s); ${args.includes('--db') ? 'disposable databases' : 'offline, no live services'}.`);
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally {
  if (staging) fs.rmSync(staging,{recursive:true,force:true});
}
