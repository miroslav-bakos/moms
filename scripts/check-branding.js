const assert=require('assert/strict');
const fs=require('fs');
const {validateBranding,DEFAULT_NAME}=require('../src/services/branding');
assert.deepEqual(validateBranding({name:'Custom shop'}),{name:'Custom shop'});
assert.deepEqual(validateBranding({name:DEFAULT_NAME,logo:null}),{name:DEFAULT_NAME,logo:null});
const logo='data:image/png;base64,'+fs.readFileSync('src/public/icon-192.png').toString('base64');
assert.equal(validateBranding({name:'Shop',logo}).logo,logo);
for(const body of [{name:''},{name:'x'.repeat(101)},{name:'Shop',logo:'data:image/svg+xml;base64,PHN2Zz4='},{name:'Shop',logo:'data:image/png;base64,'+Buffer.from('fake PNG image').toString('base64')},{name:'Shop',logo:'x'.repeat(1400001)}])assert.throws(()=>validateBranding(body));
console.log('Branding validation: custom name, logo preservation/reset, image signatures and size limits passed');

const {circularIcon}=require('../src/services/branding-icon');
const icon=circularIcon(logo);
assert(icon.includes('<circle cx="256" cy="256" r="256"/>'));
assert(icon.includes('preserveAspectRatio="xMidYMid slice"'));
assert(icon.includes(`href="${logo}"`));
for(const unsafe of ['https://example.com/logo.png','data:image/svg+xml;base64,PHN2Zz4=',logo+'" onload="alert(1)',null])assert.throws(()=>circularIcon(unsafe));

(async()=>{
 const sharp=require('sharp'),{installIcon}=require('../src/services/branding-icon');
 const source=Buffer.from(logo.split(',')[1],'base64');
 for(const format of ['png','jpeg','webp']){
  const encoded=await sharp(source).toFormat(format).toBuffer();
  const upload=`data:image/${format};base64,${encoded.toString('base64')}`;
  for(const size of [180,192,512]){
   const output=await installIcon(upload,size),metadata=await sharp(output).metadata();
   assert.equal(metadata.format,'png');assert.equal(metadata.width,size);assert.equal(metadata.height,size);assert.equal(metadata.hasAlpha,false);
  }
 }
 const defaults=await sharp(await installIcon(null,180)).metadata();assert.equal(defaults.width,180);
 await assert.rejects(installIcon(logo,181));await assert.rejects(installIcon('https://example.com/logo.png',180));
 const red='data:image/png;base64,'+(await sharp({create:{width:10,height:10,channels:3,background:'#ff0000'}}).png().toBuffer()).toString('base64');
 const blue='data:image/png;base64,'+(await sharp({create:{width:10,height:10,channels:3,background:'#0000ff'}}).png().toBuffer()).toString('base64');
 assert.notDeepEqual(await installIcon(red,180),await installIcon(blue,180),'Replacing branding invalidates the icon cache');
 const configFile=require.resolve('../src/config'),original=require.cache[configFile];
 require.cache[configFile]={id:configFile,filename:configFile,loaded:true,exports:{config:{basicAuthUser:'fixture',basicAuthPassword:'fixture-password'}}};
 const {basicAuth}=require('../src/middleware/basicAuth');
 for(const path of ['/app-favicon','/apple-touch-icon.png','/app-icon-192.png','/app-icon-512.png','/manifest.json']){
  let passed=false;await basicAuth({path,headers:{}},{},()=>{passed=true;});assert(passed,`${path} must be accessible to the installer without a session`);
 }
 for(const path of ['/','/api/orders','/api/branding','/app-icon-192.png/extra']){
  let status;const response={set(){return this;},status(code){status=code;return this;},send(){return this;},json(value){assert.equal(value.error,'Authentication required');return this;}};
  await basicAuth({path,headers:{}},response,()=>assert.fail('Private application data must require login'));assert.equal(status,401);
 }
 require.cache[configFile]=original;
 const manifest=require('../src/public/manifest.json');assert.deepEqual(manifest.icons.map(icon=>icon.sizes),['192x192','512x512']);assert(manifest.icons.every(icon=>icon.type==='image/png'));
 const profile=await require('../src/services/webappProfile').create({name:'Shop <test> & "logo"',logo},'https://100.64.0.10:9443');
 assert(profile.includes('Shop &lt;test&gt; &amp; &quot;logo&quot;'));
 assert(profile.includes('<key>URL</key><string>https://100.64.0.10:9443/</string>'));
 assert(profile.includes('<key>FullScreen</key><true/><key>IsRemovable</key><true/>'));
 assert.equal((profile.match(/<key>PayloadType<\/key>/g)||[]).length,2);
 const embedded=Buffer.from(profile.match(/<key>Icon<\/key><data>([^<]+)<\/data>/)[1],'base64');assert.equal((await sharp(embedded).metadata()).width,180);
 assert(!profile.includes('com.apple.security')&&!profile.includes('com.apple.mdm')&&!profile.includes('password'));
 await assert.rejects(require('../src/services/webappProfile').create({name:'Shop',logo},'http://100.64.0.10:3080'));
 console.log('PASS PNG/JPEG/WebP install icons, concrete dimensions, cache invalidation and public icon-only access.');
})().catch(error=>{console.error(error);process.exitCode=1;});
