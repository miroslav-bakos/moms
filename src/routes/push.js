'use strict';
const router=require('express').Router(),push=require('../services/webPush');
router.use((req,res,next)=>{res.set('Cache-Control','no-store');if(!req.secure)return res.status(403).json({error:'Push notifications require trusted HTTPS.'});next();});
router.use(require('../middleware/sameOrigin').sameOrigin);
router.get('/',(req,res,next)=>{try{res.json(push.settings());}catch(_){res.status(503).json({error:'Notification settings unavailable.'});}});
router.post('/',async(req,res)=>{try{await push.subscribe(req.body);res.json({ok:true});}catch(error){res.status(error.statusCode||400).json({error:error.statusCode?error.message:'Cannot subscribe to notifications.'});}});
router.delete('/',async(req,res)=>{try{await push.unsubscribe(req.body.endpoint);res.json({ok:true});}catch(_){res.status(503).json({error:'Cannot unsubscribe from notifications.'});}});
module.exports=router;
