'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Pool } = require('pg');
const execute = promisify(execFile);
const TOOLS = ['postgres', 'initdb', 'pg_ctl', 'pg_dump', 'pg_restore', 'psql'];
function binary(directory, name, platform = process.platform) {
  if (!TOOLS.includes(name) || !path.isAbsolute(directory)) throw new Error('Invalid PostgreSQL runtime directory.');
  return path.join(directory, 'bin', name + (platform === 'win32' ? '.exe' : ''));
}
function withRuntime(env, directory) {
  const key = Object.keys(env).find(key => key.toUpperCase() === 'PATH') || 'PATH';
  const result={ ...env, [key]: path.join(directory, 'bin') + path.delimiter + (env[key] || '') };
  const library=process.platform==='darwin'?'DYLD_LIBRARY_PATH':process.platform==='linux'?'LD_LIBRARY_PATH':null;
  if(library)result[library]=path.join(directory,'lib')+(env[library]?path.delimiter+env[library]:'');
  return result;
}
function durable(file, value) {
  const temporary = file + '.partial';
  const fd = fs.openSync(temporary, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  if (process.platform !== 'win32') {
    const fd = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function connection(record, database = 'moms') {
  if (record.version !== 1 || record.major !== 16 || !Number.isInteger(record.port) || record.port < 1024 || record.port > 65535 || !/^[a-f0-9]{64}$/.test(record.password)) throw new Error('Invalid managed database configuration.');
  return `postgres://moms:${record.password}@127.0.0.1:${record.port}/${database}`;
}
async function start({ dataRoot, directory, env = process.env, run = execute }) {
  if (!path.isAbsolute(directory || '')) throw new Error('A bundled PostgreSQL runtime is required. Set MOMS_POSTGRES_DIR to its absolute directory.');
  env = withRuntime(env, directory);
  for (const name of TOOLS) {
    if (!fs.existsSync(binary(directory, name))) throw new Error('Bundled PostgreSQL runtime is incomplete.');
    let version;
    try { version = (await run(binary(directory, name), ['--version'], { env, windowsHide: true, timeout: 10000 })).stdout; }
    catch (_) { throw new Error('Unable to execute the bundled PostgreSQL runtime.'); }
    const match = version.match(/\b(\d+)\.(\d+)\b/);
    if (!match || Number(match[1]) !== 16 || Number(match[2]) < 15) throw new Error('The desktop runtime requires PostgreSQL 16.15 or newer in the 16 series.');
  }
  const root = path.join(dataRoot, 'postgres'); fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const configFile = path.join(root, 'connection.json'), cluster = path.join(root, 'data');
  let record;
  if (fs.existsSync(configFile)) {
    try { record = JSON.parse(fs.readFileSync(configFile, 'utf8')); connection(record); }
    catch (_) { throw new Error('Unable to read the private managed database configuration.'); }
  } else {
    if (fs.existsSync(cluster)) throw new Error('Database files exist without their connection configuration. Recover the original configuration; the existing cluster will not be replaced.');
    record = { version: 1, major: 16, port: await freePort(), password: crypto.randomBytes(32).toString('hex') };
    durable(configFile, record);
  }
  const options = { env, cwd: dataRoot, windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024 };
  if (!fs.existsSync(path.join(cluster, 'PG_VERSION'))) {
    if (fs.existsSync(cluster) && fs.readdirSync(cluster).length) throw new Error('Incomplete database initialization; existing files are preserved.');
    const passwordFile = path.join(root, 'init-password');
    fs.writeFileSync(passwordFile, record.password + '\n', { mode: 0o600 });
    try {
      const locale = process.platform === 'linux' ? ['--locale=C.UTF-8'] : process.platform === 'darwin' ? ['--locale=en_US.UTF-8'] : [];
      await run(binary(directory, 'initdb'), ['-D', cluster, '-U', 'moms', '--pwfile=' + passwordFile, '--auth=scram-sha-256', '--encoding=UTF8', ...locale, '--data-checksums'], options);
    } catch (_) { throw new Error('Managed database initialization failed. Inspect the PostgreSQL runtime and data-directory permissions.'); }
    finally { fs.rmSync(passwordFile, { force: true }); }
  }
  if (fs.readFileSync(path.join(cluster, 'PG_VERSION'), 'utf8').trim() !== '16') throw new Error('Managed database major version differs; a database upgrade must be performed explicitly.');
  let running = false;
  try { await run(binary(directory, 'pg_ctl'), ['-D', cluster, 'status'], options); running = true; } catch (_) {}
  // Also repairs a boot interrupted after initdb but before writing the listener configuration.
  if (!running) fs.appendFileSync(path.join(cluster, 'postgresql.conf'), `\n# MOMS managed listener\nlisten_addresses = '127.0.0.1'\nport = ${record.port}\nunix_socket_directories = ''\n`);
  const stop = async () => {
    try { await run(binary(directory, 'pg_ctl'), ['-D', cluster, '-m', 'fast', '-w', '-t', '60', 'stop'], options); }
    catch (_) { throw new Error('Managed PostgreSQL did not stop cleanly. Its data files are preserved.'); }
  };
  try {
    if (!running) await run(binary(directory, 'pg_ctl'), ['-D', cluster, '-l', path.join(root, 'server.log'), '-w', '-t', '60', 'start'], options);
    const pool = new Pool({ connectionString: connection(record, 'postgres'), connectionTimeoutMillis: 5000 });
    try {
      const identity = await pool.query("SELECT current_setting('data_directory') AS directory");
      if (fs.realpathSync(identity.rows[0].directory) !== fs.realpathSync(cluster)) throw new Error('Wrong database cluster.');
      const unicode = await pool.query("SELECT lower('ŠŤŽ') = 'šťž' AS supported");
      if (!unicode.rows[0].supported) throw new Error('Database locale does not support Slovak case-insensitive search.');
      const found = await pool.query("SELECT 1 FROM pg_database WHERE datname='moms'");
      if (!found.rowCount) await pool.query('CREATE DATABASE moms');
    } finally { await pool.end(); }
  } catch (_) {
    await stop().catch(() => {});
    throw new Error('Managed database startup failed. Check the private PostgreSQL log; no existing database was replaced.');
  }
  return { env: { ...env, DATABASE_URL: connection(record), MOMS_MANAGED_DATABASE: '1' }, stop };
}
module.exports = { start, binary, withRuntime, durable, connection };
