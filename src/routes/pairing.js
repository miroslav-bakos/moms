'use strict';
const express=require('express');
const router=express.Router();
router.use((req,res,next)=>{
  res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
  if(!req.secure)return res.status(403).send('Secure HTTPS is required for pairing.');
  next();
});
router.get('/',(req,res)=>res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MOMS</title><body><main><h1>MOMS</h1><p id="pairMessage">Connecting / Pripájam…</p><script src="/pair/client.js"></script></main></body></html>`));
router.get('/client.js',(req,res)=>res.sendFile(require('node:path').join(__dirname,'../public/pair.js')));
router.post('/',require('../middleware/sameOrigin').sameOrigin,async(req,res)=>{
  try {
    const token=await require('../services/mobilePairing').redeem(req.body.token);
    if(!token)return res.status(400).json({error:'Pairing code expired or already used. Open a new QR code.'});
    res.set('Set-Cookie',`moms_device=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000; Path=/`);
    res.json({ok:true});
  }catch(_){res.status(503).json({error:'Pairing unavailable. Please try again.'});}
});
module.exports=router;
