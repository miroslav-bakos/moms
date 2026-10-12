'use strict';
const crypto = require('node:crypto');
const {config}=require('../config');
const {query,withClient}=require('../db');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const enabled=()=>Boolean(config.basicAuthUser && config.basicAuthPassword);
const owner=()=>hash(JSON.stringify([config.basicAuthUser,config.basicAuthPassword,config.appSecret]));
const valid=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
async function issue() {
  if(!enabled())throw new Error('Configure application login before pairing.');
  const token=crypto.randomBytes(32).toString('hex');
  await withClient(async client=>{
    await client.query('BEGIN');
    try {
      await client.query('DELETE FROM mobile_pairing_codes WHERE owner_hash=$1 OR expires_at<=now()',[owner()]);
      await client.query("INSERT INTO mobile_pairing_codes VALUES($1,$2,now()+interval '5 minutes')",[hash(token),owner()]);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}
  });
  return token;
}
async function redeem(token) {
  if(!enabled()||!valid(token))return null;
  return withClient(async client=>{
    await client.query('BEGIN');
    try {
      const code=await client.query('DELETE FROM mobile_pairing_codes WHERE token_hash=$1 AND owner_hash=$2 AND expires_at>now() RETURNING token_hash',[hash(token),owner()]);
      if(!code.rowCount){await client.query('ROLLBACK');return null;}
      const device=crypto.randomBytes(32).toString('hex');
      await client.query('DELETE FROM mobile_devices WHERE expires_at<=now()');
      await client.query("INSERT INTO mobile_devices(token_hash,owner_hash,expires_at) VALUES($1,$2,now()+interval '30 days')",[hash(device),owner()]);
      await client.query('COMMIT');return device;
    }catch(error){await client.query('ROLLBACK');throw error;}
  });
}
async function authenticate(token) {
  if(!enabled()||!valid(token))return false;
  return Boolean((await query('SELECT 1 FROM mobile_devices WHERE token_hash=$1 AND owner_hash=$2 AND expires_at>now()',[hash(token),owner()])).rowCount);
}
async function revoke() {
  await withClient(async client=>{
    await client.query('BEGIN');
    try {
      // Lock/delete codes first so a concurrent redemption cannot create a device after revocation.
      await client.query('DELETE FROM mobile_pairing_codes WHERE owner_hash=$1',[owner()]);
      await client.query('DELETE FROM mobile_devices WHERE owner_hash=$1',[owner()]);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}
  });
}
module.exports={issue,redeem,authenticate,revoke,owner};
