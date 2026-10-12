const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
async function hash(file){const digest=crypto.createHash('sha256');for await(const bytes of fs.createReadStream(file))digest.update(bytes);return digest.digest('hex');}
async function copy(source,directory){
 if(!path.isAbsolute(directory))throw new Error('Backup copy directory must be absolute.');
 const target=await fs.promises.realpath(directory),origin=await fs.promises.realpath(path.dirname(source));
 if(target===origin||!((await fs.promises.stat(target)).isDirectory()))throw new Error('Choose a separate existing backup directory.');
 const destination=path.join(target,path.basename(source)),partial=destination+'.'+crypto.randomUUID()+'.partial';
 try{
  const expected=await hash(source);
  try{if(await hash(destination)===expected){await fs.promises.chmod(destination,0o600);return;}}catch(e){if(e.code!=='ENOENT')throw e;}
  if(fs.existsSync(destination))throw new Error('Backup copy already exists with different contents.');
  await fs.promises.copyFile(source,partial,fs.constants.COPYFILE_EXCL);await fs.promises.chmod(partial,0o600);
  if(await hash(partial)!==expected)throw new Error('Backup copy checksum mismatch.');
  const file=await fs.promises.open(partial,'r');try{await file.sync();}finally{await file.close();}
  await fs.promises.rename(partial,destination);
 }finally{await fs.promises.unlink(partial).catch(()=>{});}
}
module.exports={copy,hash};
