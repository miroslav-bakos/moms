'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const xml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function checked(value) {
  if (!value || /[\x00-\x1f]/.test(value)) throw new Error('Autostart paths must not contain control characters.');
  return value;
}
// Desktop Entry Exec has both argument quoting and the general string escaping layer.
function desktopArgument(value) {
  return ('"' + checked(value).replace(/([\\"`$])/g, '\\$1') + '"').replace(/\\/g, '\\\\').replace(/%/g, '%%');
}
function windowsArgument(value) {
  return '"' + checked(value).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"';
}
function definition({ platform = process.platform, env = process.env, home = os.homedir(), dataRoot, executable = process.execPath, script, sid }) {
  [dataRoot, executable, script].forEach(checked);
  const id = 'moms-' + crypto.createHash('sha256').update(dataRoot).digest('hex').slice(0, 16);
  const args = [script, 'run', '--data-dir', dataRoot];
  if (platform === 'linux') {
    const config = env.XDG_CONFIG_HOME || path.posix.join(home, '.config');
    if (!path.posix.isAbsolute(config)) throw new Error('XDG_CONFIG_HOME must be absolute.');
    return { id, file: path.posix.join(config, 'autostart', id + '.desktop'), content:
      '[Desktop Entry]\nType=Application\nName=MOMS\nComment=Local order management\nTerminal=false\nExec=' + [executable, ...args].map(desktopArgument).join(' ') + '\n' };
  }
  if (platform === 'darwin') {
    return { id, file: path.posix.join(home, 'Library', 'LaunchAgents', id + '.plist'), content:
      '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>' +
      '<key>Label</key><string>' + id + '</string><key>ProgramArguments</key><array>' + [executable, ...args].map(v => '<string>' + xml(v) + '</string>').join('') +
      '</array><key>RunAtLoad</key><true/><key>ExitTimeOut</key><integer>70</integer></dict></plist>\n' };
  }
  if (platform === 'win32') {
    if (!/^S-1-[\d-]+$/.test(sid || '')) throw new Error('Unable to identify the Windows user for autostart.');
    return { id, file: path.win32.join(dataRoot, '.desktop', 'autostart.xml'), content:
      '<?xml version="1.0" encoding="UTF-8"?>\n<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Triggers><LogonTrigger><Enabled>true</Enabled><UserId>' + sid +
      '</UserId></LogonTrigger></Triggers><Principals><Principal id="User"><UserId>' + sid + '</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>' +
      '<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Hidden>true</Hidden></Settings>' +
      '<Actions Context="User"><Exec><Command>' + xml(executable) + '</Command><Arguments>' + xml(args.map(windowsArgument).join(' ')) + '</Arguments></Exec></Actions></Task>\n' };
  }
  throw new Error('Desktop autostart supports Windows, macOS and Linux.');
}
function configure(enabled, options) {
  const platform = options.platform || process.platform;
  const execute = options.execute || ((command, args) => execFileSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }));
  const sid = platform === 'win32' ? execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Security.Principal.WindowsIdentity]::GetCurrent().User.Value']).trim() : undefined;
  const item = definition({ ...options, platform, sid });
  if (enabled) {
    fs.mkdirSync(path.dirname(item.file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(item.file, item.content, { mode: 0o600 });
    if (platform === 'win32') execute('schtasks.exe', ['/Create', '/TN', item.id, '/XML', item.file, '/F']);
  } else {
    if (platform === 'win32' && fs.existsSync(item.file)) execute('schtasks.exe', ['/Delete', '/TN', item.id, '/F']);
    fs.rmSync(item.file, { force: true });
  }
  return item.file;
}
function enabled(options){
  if((options.platform||process.platform)==='win32')return fs.existsSync(path.join(options.dataRoot,'.desktop','autostart.xml'));
  return fs.existsSync(definition(options).file);
}
module.exports = { definition, configure, enabled, windowsArgument, desktopArgument };
