'use strict';
const express=require('express');
const {config}=require('../config');
const sessions=require('../services/authSessions');
const {getCookie}=require('../middleware/basicAuth');
const {sameOrigin}=require('../middleware/sameOrigin');
const router=express.Router(), attempts=new Map();
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function local(req) {return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)&&/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.get('Host')||'')&&!req.get('X-Forwarded-For')&&!req.get('X-Forwarded-Host');}
function page(req,res,message='',status=200) {
  const sk=req.query.lang==='sk'||req.body?.lang==='sk',t=(en,sl)=>sk?sl:en,setup=!sessions.configured();
  res.status(status).type('html').send(`<!doctype html><html lang="${sk?'sk':'en'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MOMS — ${t('Sign in','Prihlásenie')}</title><style>body{font:17px system-ui;background:#eef3fa;color:#16263b;margin:0;padding:24px}main{max-width:420px;margin:8vh auto;background:white;padding:24px;border-radius:18px}label,input,button{display:block;box-sizing:border-box;width:100%;margin:12px 0}input,button{font:inherit;padding:12px;border:1px solid #8c9aad;border-radius:8px}button{background:#0561d8;color:white}a{color:#0561d8}p{line-height:1.5}</style><main><h1>MOMS</h1><a href="/login?lang=en">English</a> · <a href="/login?lang=sk">Slovenčina</a><h2>${setup?t('Create your owner login','Vytvorte prihlásenie vlastníka'):t('Sign in','Prihlásenie')}</h2><p>${setup?t('Complete this step on the computer running MOMS. Choose a password of at least 12 characters.','Dokončite tento krok na počítači, kde beží MOMS. Zvoľte heslo s aspoň 12 znakmi.'):t('Use your MOMS owner name and password.','Použite meno a heslo vlastníka MOMS.')}</p><p role="alert">${escape(message)}</p><form method="post" action="/login"><input type="hidden" name="lang" value="${sk?'sk':'en'}"><label>${t('Name','Meno')}<input name="username" autocomplete="username" maxlength="100" required></label><label>${t('Password','Heslo')}<input type="password" name="password" autocomplete="${setup?'new-password':'current-password'}" ${setup?'minlength="12"':''} maxlength="1024" required></label>${setup?`<label>${t('Repeat password','Zopakujte heslo')}<input type="password" name="confirm" autocomplete="new-password" required></label>`:''}<button>${setup?t('Create login','Vytvoriť prihlásenie'):t('Sign in','Prihlásiť sa')}</button></form></main></html>`);
}
router.use((req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"});next();});
router.use(express.urlencoded({extended:false,limit:'8kb'}));
router.get('/',(req,res)=>page(req,res));
router.post('/',sameOrigin,async(req,res)=>{
  const sk=req.body.lang==='sk',t=(en,sl)=>sk?sl:en,ip=req.socket.remoteAddress;
  const now=Date.now();for(const [key,value] of attempts)if(value.until<=now)attempts.delete(key);
  const record=attempts.get(ip)||{count:0,until:now+15*60*1000};
  if(record.count>=10||(!attempts.has(ip)&&attempts.size>=5000))return page(req,res,t('Too many attempts. Try again in 15 minutes.','Priveľa pokusov. Skúste znova o 15 minút.'),429);
  attempts.set(ip,{...record,count:record.count+1});
  try {
    if(!sessions.configured()) {
      if(!local(req))return page(req,res,t('Open http://localhost:'+config.port+' on the computer running MOMS to create the owner login.','Otvorte http://localhost:'+config.port+' na počítači s MOMS a vytvorte prihlásenie.'),403);
      const {username,password,confirm}=req.body;
      if(typeof username!=='string'||!username.trim()||username.length>100||/[\r\n\0:]/.test(username)||typeof password!=='string'||password.length<12||password.length>1024||password!==confirm)return page(req,res,t('Enter a name and two matching passwords of at least 12 characters.','Zadajte meno a dve rovnaké heslá s aspoň 12 znakmi.'),400);
      const store=require('../settings/store'),saved=store.read(),hashed=sessions.passwordHash(password);
      saved.values.APP_BASIC_AUTH_USER=username.trim();saved.values.APP_BASIC_AUTH_PASSWORD=hashed;store.write(saved);
      config.basicAuthUser=username.trim();config.basicAuthPassword=hashed;
    } else if(!sessions.equal(req.body.username,config.basicAuthUser)||!sessions.passwordMatches(req.body.password))return page(req,res,t('Incorrect name or password.','Nesprávne meno alebo heslo.'),401);
    const token=await sessions.issue();attempts.delete(ip);res.clearCookie('moms_signed_out',{path:'/'});
    res.cookie('loa_session',token,{httpOnly:true,secure:Boolean(req.secure),sameSite:'lax',maxAge:12*60*60*1000,path:'/'});res.redirect('/');
  } catch (_) {page(req,res,t('Sign-in is temporarily unavailable. Please try again.','Prihlásenie je dočasne nedostupné. Skúste znova.'),503);}
});
router.post('/logout',sameOrigin,async(req,res)=>{
  try {await sessions.revoke(getCookie(req,'loa_session'));await sessions.revoke(getCookie(req,'moms_device'));res.cookie('moms_signed_out','1',{httpOnly:true,secure:Boolean(req.secure),sameSite:'lax',path:'/'});res.clearCookie('loa_session',{path:'/'});res.clearCookie('moms_device',{path:'/'});res.redirect('/login');}
  catch(_){res.status(503).send('Unable to sign out. Please try again.');}
});
module.exports=router;
