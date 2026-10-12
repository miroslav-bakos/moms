'use strict';
const express=require('express'),crypto=require('node:crypto');
let server,starting;
const nonce=crypto.randomBytes(24).toString('hex');
function application(router=require('../routes/oauth')) {
 const app=express();app.disable('x-powered-by');
 app.use((req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});next();});
 app.get('/moms-callback-health/'+nonce,(req,res)=>res.json({nonce}));
 app.use((req,res,next)=>{
  if(req.method!=='GET'||!/^\/auth\/(etsy|shopify|amazon)\/callback$/.test(req.path))return res.sendStatus(404);
  // Successful provider redirects finish here, never expose the private app.
  res.redirect=()=>res.type('html').send('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MOMS</title><h1>Account connected / Účet pripojený</h1><p>Return to your MOMS tab. You may close this tab.</p><p>Vráťte sa na kartu MOMS. Túto kartu môžete zavrieť.</p></html>');
  next();
 });
 app.use('/auth',router);
 app.use((error,req,res,next)=>res.status(400).type('text').send('Connection failed or expired. Return to MOMS and start authorization again. / Pripojenie zlyhalo alebo vypršalo. Vráťte sa do MOMS a zopakujte autorizáciu.'));
 return app;
}
async function start(port){
 if(server?.listening)return server;
 if(starting)return starting;
 starting=new Promise((resolve,reject)=>{const candidate=application().listen(port,'127.0.0.1',()=>{server=candidate;resolve(server);});candidate.once('error',reject);}).finally(()=>{starting=null;});return starting;
}
async function stop(){if(starting)await starting.catch(()=>{});if(server){const current=server;server=null;await new Promise((resolve,reject)=>{current.close(e=>e?reject(e):resolve());current.closeIdleConnections?.();});}}
module.exports={application,start,stop,nonce};
