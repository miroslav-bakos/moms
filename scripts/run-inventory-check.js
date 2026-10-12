// Creates and removes an isolated database. Production order/material rows are never changed.
const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');
const { config } = require('../src/config');
const original = require('../src/db');
const admin = new Pool({connectionString:config.databaseUrl});
const name = 'moms_inventory_test_' + crypto.randomBytes(8).toString('hex');
let pool;
(async () => {
  await admin.query('CREATE DATABASE "' + name + '"');
  const url = new URL(config.databaseUrl); url.pathname = '/' + name;
  pool = new Pool({connectionString:url.toString()});
  const db = {query:pool.query.bind(pool),withClient:async fn=>{
    const client=await pool.connect();try{return await fn(client);}finally{client.release();}
  }};
  require.cache[require.resolve('../src/db')].exports=db;
  await require('./check-inventory-db')(path.resolve(__dirname,'..'),db);
  await require('./check-release-db')(path.resolve(__dirname,'..'),db);
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(async()=>{
  if(pool)await pool.end();
  try {await admin.query('DROP DATABASE IF EXISTS "' + name + '"');}
  finally {await admin.end();await original.closePool();}
});
