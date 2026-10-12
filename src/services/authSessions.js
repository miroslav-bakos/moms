'use strict';
const crypto = require('node:crypto');
const {config} = require('../config');
const {query} = require('../db');
const pairing = require('./mobilePairing');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const valid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function configured() { return Boolean(config.basicAuthUser && config.basicAuthPassword); }
function equal(a,b) { const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length && crypto.timingSafeEqual(x,y); }
function passwordMatches(password) {
  const saved=config.basicAuthPassword;
  if(typeof password!=='string'||password.length>1024)return false;
  if(!saved.startsWith('scrypt:'))return equal(password,saved);
  const [,salt,digest]=saved.split(':');
  return equal(crypto.scryptSync(password,salt,64).toString('hex'),digest);
}
function passwordHash(password) {const salt=crypto.randomBytes(16).toString('hex');return `scrypt:${salt}:${crypto.scryptSync(password,salt,64).toString('hex')}`;}
async function issue() {
  if(!configured())throw new Error('Set up the owner login first.');
  const token=crypto.randomBytes(32).toString('hex');
  await query('DELETE FROM mobile_devices WHERE expires_at<=now()');
  await query("INSERT INTO mobile_devices(token_hash,owner_hash,expires_at) VALUES($1,$2,now()+interval '12 hours')",[hash(token),pairing.owner()]);
  return token;
}
async function authenticate(token) {return configured() && valid(token) && Boolean((await query('SELECT 1 FROM mobile_devices WHERE token_hash=$1 AND owner_hash=$2 AND expires_at>now()',[hash(token),pairing.owner()])).rowCount);}
async function revoke(token) {if(valid(token))await query('DELETE FROM mobile_devices WHERE token_hash=$1 AND owner_hash=$2',[hash(token),pairing.owner()]);}
module.exports={configured,equal,passwordMatches,passwordHash,issue,authenticate,revoke,hash,owner:pairing.owner};
