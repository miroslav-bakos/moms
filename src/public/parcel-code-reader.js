/* Shared by live-camera decoding and disposable label fixtures. */
(() => {
  const fallbackState=new WeakMap();
  const rows=[0.5];
  for(let offset=1;offset<=19;offset++)rows.push(0.5-offset*0.025,0.5+offset*0.025);
  // Reconstruct a one-dimensional signal from multiple neighbouring lines.
  // A lower quartile recovers dark bars interrupted by bright tape reflections;
  // a median rejects speckles. Local range normalization removes uneven lighting.
  function repair(base,row,mode){
    const band=document.createElement('canvas');band.width=base.width;band.height=32;
    const ctx=band.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(base,0,Math.max(0,Math.min(base.height-32,base.height*row-16)),base.width,Math.min(32,base.height),0,0,band.width,32);
    const data=ctx.getImageData(0,0,band.width,32).data,signal=new Float32Array(band.width);
    for(let x=0;x<band.width;x++){
      const values=[];for(let y=0;y<32;y++){const i=(y*band.width+x)*4;values.push((data[i]+data[i+1]+data[i+2])/3);}
      values.sort((a,b)=>a-b);signal[x]=values[mode===0?8:16];
    }
    const binary=new Uint8Array(band.width);
    for(let x=0;x<band.width;x++){
      let low=255,high=0;
      for(let k=Math.max(0,x-16);k<=Math.min(band.width-1,x+16);k++){low=Math.min(low,signal[k]);high=Math.max(high,signal[k]);}
      binary[x]=high-low>=8&&signal[x]<low+(high-low)*0.5?0:255;
    }
    // Only bridge isolated single-pixel holes; never guess missing code symbols.
    if(mode===2){const original=binary.slice();for(let x=1;x<binary.length-1;x++)if(original[x-1]===0&&original[x+1]===0)binary[x]=0;}
    band.height=64;const pixels=ctx.createImageData(band.width,64);
    for(let y=0;y<64;y++)for(let x=0;x<band.width;x++){const i=(y*band.width+x)*4;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=binary[x];pixels.data[i+3]=255;}
    ctx.putImageData(pixels,0,0);return band;
  }
  function decode(source,reader,{attempts=546}={}){
    const width=source.videoWidth||source.naturalWidth||source.width,height=source.videoHeight||source.naturalHeight||source.height;
    if(!width||!height)return [];
    const scale=Math.min(1,2560/Math.max(width,height)),canvases=new Map();
    function rotated(angle){
      if(canvases.has(angle))return canvases.get(angle);
      const canvas=document.createElement('canvas');
      canvas.width=Math.round((angle?height:width)*scale);canvas.height=Math.round((angle?width:height)*scale);
      const context=canvas.getContext('2d',{willReadFrequently:true});context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);
      context.translate(canvas.width/2,canvas.height/2);context.rotate(angle*Math.PI/180);
      context.drawImage(source,-width*scale/2,-height*scale/2,width*scale,height*scale);
      canvases.set(angle,canvas);return canvas;
    }
    // Keep ordinary QR/barcode detection first, including vertical GLS labels.
    for(const angle of [0,90]){
      try{return [reader.decodeFromCanvas(rotated(angle)).getText().trim()];}catch(_){/* Try the other orientation. */}
    }
    // Tape reflections can spoil individual scan lines. Sweep the frame from
    // the centre outwards, alternating orientation and contrast per strip
    // and require the barcode decoder's checksum.
    let state=fallbackState.get(reader);
    if(!state){state={step:0,recovered:new Map(),reader:new ZXingBrowser.BrowserMultiFormatOneDReader()};fallbackState.set(reader,state);}
    const angles=height>width?[90,0]:[0,90];
    const total=rows.length*angles.length*7;
    for(let count=0;count<Math.min(total,Math.max(0,attempts));count++){
      const step=state.step++%total,variant=Math.floor(step/2)%7,threshold=[150,120,180,null][variant];
      const angle=angles[step%2],row=rows[Math.floor(step/14)%rows.length],base=rotated(angle);
      if(variant>=4){
        try{
          const code=state.reader.decodeFromCanvas(repair(base,row,variant-4)).getText().trim();
          const observation=angle+':'+row+':'+variant,previous=state.recovered.get(code);
          // A reconstructed barcode needs corroboration from another strip/mode.
          if(previous&&previous!==observation)return [code];
          state.recovered.set(code,observation);if(state.recovered.size>16)state.recovered.delete(state.recovered.keys().next().value);
        }catch(_){/* Try another reconstruction. */}
        continue;
      }
      const strip=document.createElement('canvas');strip.width=base.width;strip.height=64;
      const context=strip.getContext('2d',{willReadFrequently:true});
      context.imageSmoothingEnabled=false;
      context.drawImage(base,0,Math.max(0,Math.min(base.height-4,base.height*row-2)),base.width,Math.min(4,base.height),0,0,strip.width,strip.height);
      const pixels=context.getImageData(0,0,strip.width,strip.height);
      let cutoff=threshold;
      if(cutoff===null){
        const histogram=new Uint32Array(256);
        for(let index=0;index<pixels.data.length;index+=4)histogram[Math.round((pixels.data[index]+pixels.data[index+1]+pixels.data[index+2])/3)]++;
        const count=pixels.data.length/4;let low=0,high=255,sum=0;
        for(;low<255;low++){sum+=histogram[low];if(sum>=count*0.1)break;}
        sum=0;for(;high>0;high--){sum+=histogram[high];if(sum>=count*0.1)break;}
        cutoff=(low+high)/2;
      }
      for(let index=0;index<pixels.data.length;index+=4){
        const gray=(pixels.data[index]+pixels.data[index+1]+pixels.data[index+2])/3,value=gray<cutoff?0:255;
        pixels.data[index]=pixels.data[index+1]=pixels.data[index+2]=value;
      }
      context.putImageData(pixels,0,0);
      try{return [state.reader.decodeFromCanvas(strip).getText().trim()];}catch(_){/* Next strip or contrast level. */}
    }
    return [];
  }
  function cropFrame(source,canvas=document.createElement('canvas')){
    const width=source.videoWidth||source.naturalWidth||source.width,height=source.videoHeight||source.naturalHeight||source.height;
    if(!width||!height)return null;
    // Match the preview's centred object-fit:cover in a 3:1 window, retaining
    // camera pixels rather than scaling down to the CSS preview size.
    const cropWidth=Math.min(width,height*3),cropHeight=cropWidth/3;
    canvas.width=Math.round(cropWidth);canvas.height=Math.round(cropHeight);
    canvas.getContext('2d').drawImage(source,(width-cropWidth)/2,(height-cropHeight)/2,cropWidth,cropHeight,0,0,canvas.width,canvas.height);
    return canvas;
  }
  window.parcelCodeReader={decode,cropFrame};
})();
