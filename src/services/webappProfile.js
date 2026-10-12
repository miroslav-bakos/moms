'use strict';
const { randomUUID, createHash } = require('node:crypto');
const { secureOrigin } = require('./scanAccess');
const { installIcon } = require('./branding-icon');
const escape = value => String(value).replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[character]));

async function create(branding, origin) {
  origin=secureOrigin(origin);
  if(!origin)throw new Error('A secure application address is required.');
  const id='com.moms.webclip.'+createHash('sha256').update(origin).digest('hex').slice(0,16);
  const icon=await installIcon(branding.logo,180);
  const string=(key,value)=>`<key>${key}</key><string>${escape(value)}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
${string('PayloadType','Configuration')}${string('PayloadIdentifier',id)}${string('PayloadUUID',randomUUID())}
<key>PayloadVersion</key><integer>1</integer>${string('PayloadDisplayName',branding.name)}
${string('PayloadDescription','Adds one removable full-screen MOMS web app shortcut with its embedded icon.')}
<key>PayloadRemovalDisallowed</key><false/>
<key>PayloadContent</key><array><dict>
${string('PayloadType','com.apple.webClip.managed')}${string('PayloadIdentifier',id+'.shortcut')}${string('PayloadUUID',randomUUID())}
<key>PayloadVersion</key><integer>1</integer>${string('PayloadDisplayName',branding.name)}
${string('Label',branding.name)}${string('URL',origin+'/')}
<key>FullScreen</key><true/><key>IsRemovable</key><true/><key>Precomposed</key><true/>
<key>Icon</key><data>${icon.toString('base64')}</data>
</dict></array></dict></plist>`;
}
module.exports={create};
