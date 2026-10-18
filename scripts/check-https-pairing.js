'use strict';
// Disposable TLS plumbing check. Its self-signed CA is trusted only by this test client.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),https=require('node:https');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'moms-test-tls-'));let secure,plain;
function stub(file,exports){const filename=require.resolve(file);require.cache[filename]={id:filename,filename,loaded:true,exports};}
const token='a'.repeat(64),device='b'.repeat(64);let used=false;
stub('../src/config',{config:{basicAuthUser:'fixture',basicAuthPassword:'fixture-password',appSecret:'fixture-secret-for-tests-only'}});
stub('../src/services/mobilePairing',{redeem:async value=>{if(used||value!==token)return null;used=true;return device;},authenticate:async value=>value===device});
stub('../src/services/authSessions',{SESSION_MAX_AGE_SECONDS:2678400,equal:(a,b)=>a===b,passwordMatches:value=>value==='fixture-password',issue:async()=> 'c'.repeat(64),authenticate:async()=>false});
const app=require('express')();app.use(require('express').json());app.get('/health',(req,res)=>res.json({ok:true}));app.use('/pair',require('../src/routes/pairing'));app.use(require('../src/middleware/basicAuth').basicAuth);app.get('/',(req,res)=>res.send('fixture'));
const request=(server,options={})=>new Promise((resolve,reject)=>{
 const tls=server===secure,client=tls?https:http;
 const req=client.request({host:'127.0.0.1',port:server.address().port,path:options.path||'/',method:options.method||'GET',headers:options.headers||{},...(tls?{ca:fs.readFileSync(path.join(directory,'cert.pem')),rejectUnauthorized:true}:{}),timeout:5000},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,headers:res.headers}));});req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('Test request timeout')));req.end(options.body);
});
(async()=>{
 const cert=path.join(directory,'cert.pem'),key=path.join(directory,'key.pem');
 require('node:child_process').execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-keyout',key,'-out',cert],{stdio:'ignore'});fs.chmodSync(key,0o600);
 secure=require('../src/httpServer').create(app,{MOMS_TLS_CERT:cert,MOMS_TLS_KEY:key});plain=require('../src/httpServer').create(app,{});
 await Promise.all([new Promise(resolve=>secure.listen(0,'127.0.0.1',resolve)),new Promise(resolve=>plain.listen(0,'127.0.0.1',resolve))]);
 assert.equal((await request(secure,{path:'/health'})).status,200);
 const claim={path:'/pair',method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})};
 assert.equal((await request(plain,{...claim,headers:{...claim.headers,'X-Forwarded-Proto':'https'}})).status,403,'Untrusted proxy headers cannot enable pairing');
 assert.equal((await request(secure,{...claim,headers:{...claim.headers,Origin:'https://attacker.invalid'}})).status,403);
 const paired=await request(secure,claim);assert.equal(paired.status,200);const cookie=paired.headers['set-cookie'][0];assert(cookie.includes('Secure;'));assert(cookie.includes('HttpOnly;'));assert(cookie.includes('SameSite=Strict'));
 assert.equal((await request(secure,claim)).status,400);
 assert.equal((await request(secure,{headers:{Cookie:cookie.split(';')[0]}})).status,200);
 assert.equal((await request(plain,{headers:{Cookie:cookie.split(';')[0]}})).status,401,'Paired credentials require TLS');
 assert.equal((await request(secure,{headers:{Authorization:'Basic '+Buffer.from('fixture:fixture-password').toString('base64')}})).headers['set-cookie'][0].includes('Secure;'),true);
 console.log('PASS disposable HTTPS transport, explicit test CA, secure cookies, cross-origin rejection, single-use pairing and untrusted-proxy refusal.');
})().catch(()=>{console.error('Disposable HTTPS check failed; no tokens or key material logged.');process.exitCode=1;}).finally(async()=>{await Promise.all([secure,plain].filter(Boolean).map(server=>new Promise(resolve=>server.close(resolve))));fs.rmSync(directory,{recursive:true,force:true});});
