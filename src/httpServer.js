'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),https=require('node:https');
function create(app,env=process.env) {
  const cert=env.MOMS_TLS_CERT,key=env.MOMS_TLS_KEY;
  if(Boolean(cert)!==Boolean(key))throw new Error('Both HTTPS certificate and private key are required.');
  if(cert){
    if(!path.isAbsolute(cert)||!path.isAbsolute(key))throw new Error('HTTPS certificate paths must be absolute.');
    return https.createServer({cert:fs.readFileSync(cert),key:fs.readFileSync(key),minVersion:'TLSv1.2'},app);
  }
  return http.createServer(app);
}
module.exports={create};
