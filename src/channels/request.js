// Reads may retry transient HTTP failures; writes never retry automatically.
async function channelFetch(url,options={}) {
 const {retry=true,...fetchOptions}=options;
 const read=!options.method||options.method==='GET';
 for(let attempt=0;attempt<3;attempt++) {
  const response=await fetch(url,{...fetchOptions,signal:options.signal||AbortSignal.timeout(30000)});
  if(!retry||!read||attempt===2||![429,502,503,504].includes(response.status))return response;
  await response.body?.cancel();
  await new Promise(resolve=>setTimeout(resolve,250*2**attempt));
 }
}
module.exports={channelFetch};
