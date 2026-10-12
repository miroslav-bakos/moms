/* Scans collect orders only; the existing reviewed workflow dialog performs mutations. */
(() => {
  const selected=new Map(), seen=new Set();
  const video=document.getElementById('scanVideo'), message=document.getElementById('scanMessage');
  let stream=null,generation=0,busy=false,searchMode=false,controls=null,layout=localStorage.getItem('scan-layout')==='list'?'list':'cards';
  const dialog=document.getElementById('scanAddDialog');
  let syncEpoch=0,refreshing=false,bulkIds=null,torchTrack=null,torchOn=false;
  const torchButton=document.getElementById('scanTorch');
  function replaceList(orders){selected.clear();for(const order of orders)selected.set(Number(order.id),order);render();}
  async function refresh(){
    if(refreshing||busy||searchMode||document.hidden)return;
    refreshing=true;const epoch=syncEpoch;
    try{const orders=await api('/api/scan-list',{cache:'no-store'});if(epoch===syncEpoch)replaceList(orders);}
    catch(error){if(state.activeView==='scan')message.textContent=t(error.message);}
    finally{refreshing=false;}
  }
  async function remove(ids){
    if(busy)return;busy=true;syncEpoch++;render();
    try{replaceList(await api('/api/scan-list',{method:'DELETE',body:JSON.stringify({ids})}));seen.clear();message.textContent='';}
    catch(error){announce(t(error.message));}
    finally{busy=false;render();}
  }
  function announce(text){message.textContent=text;document.getElementById('scanAddMessage').textContent=text;}
  const t=text=>window.i18n.t(text);
  function stop(){generation++;torchTrack=null;torchOn=false;torchButton.hidden=true;torchButton.disabled=false;torchButton.setAttribute('aria-pressed','false');controls?.stop();controls=null;stream?.getTracks().forEach(track=>track.stop());stream=null;video.srcObject=null;video.hidden=true;document.getElementById('scanCameraFrame').hidden=true;}
  function render(){
    const root=document.getElementById('scanList');root.replaceChildren();
    root.className='scan-parcels scan-'+layout;
    document.querySelectorAll('[data-scan-layout]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.scanLayout===layout)));
    for(const saved of selected.values()){
      const order=saved;
      const row=document.createElement('button');row.type='button';row.className='scan-parcel';row.dataset.noTranslate='';
      const fields=[['vendor',order.vendor],['order',order.order_name||order.external_order_id],['tracking',order.tracking_code||'—'],['skus',order.skus||'']];
      for(const [name,value] of fields){
        const field=document.createElement('span');field.className='scan-parcel-'+name;field.textContent=value;row.append(field);
      }
      const customer=document.createElement('span');customer.className='scan-parcel-customer';
      const address=String(order.address||'');const country=detectCountryCode(address);
      if(country){
        const flag=document.createElement('img');flag.className='country-flag';flag.width=16;flag.height=12;
        flag.src='https://flagcdn.com/16x12/'+country.toLowerCase()+'.png';flag.alt=CODE_TO_NAME[country]||country;flag.title=flag.alt;customer.append(flag);
      }
      const name=document.createElement('span');name.textContent=address.trim().split('\n')[0]||t('Missing address');customer.append(name);
      row.insertBefore(customer,row.querySelector('.scan-parcel-tracking'));
      const arrow=document.createElementNS('http://www.w3.org/2000/svg','svg');arrow.setAttribute('viewBox','0 0 24 24');arrow.setAttribute('aria-hidden','true');arrow.classList.add('scan-parcel-arrow');
      const path=document.createElementNS(arrow.namespaceURI,'path');path.setAttribute('d','M9 5l7 7-7 7');arrow.append(path);row.append(arrow);
      row.onclick=()=>{const index=state.openOrders.findIndex(item=>Number(item.id)===Number(order.id));if(index<0)state.openOrders.push(order);else state.openOrders[index]=order;openBoardOrderDetails(order.id);};
      root.append(row);
    }
    document.getElementById('scanApply').disabled=!selected.size || busy;
    document.getElementById('scanAdd').disabled=busy;
    document.getElementById('scanClear').disabled=!selected.size || busy;
    document.querySelector('#scanForm button').disabled=busy;
  }
  async function add(code){
    code=String(code||'').trim();if(!code||busy)return;
    const mode=searchMode,current=generation;busy=true;syncEpoch++;render();
    try{
      const result=await api(mode?'/api/orders/scan-match?code='+encodeURIComponent(code)+'&mode=search':'/api/scan-list',mode?{}:{method:'POST',body:JSON.stringify({code})});
      if(state.activeView!=='scan' || mode!==searchMode || current!==generation)return;
      if(mode){
        const order=result;
        stop();dialog.close();document.getElementById('boardSearch').value=order.tracking_code||order.external_order_id;
        document.getElementById('boardSearchPanel').hidden=false;
        document.getElementById('boardSearchToggle').setAttribute('aria-expanded','true');
        window.orderWorkspace?.clear();state.boardStage=order.shipped?'shipped':order.workflow_status||'new';state.boardShippedCollapsed=false;if(order.shipped)await loadBoardArchive();setView('board');renderOrderBoard();searchMode=false;return;
      }
      replaceList(result);announce(t('Added to scan list'));
      stop();dialog.close();
    }catch(error){announce(t(error.message)+' · '+t('Detected code')+': '+code);document.getElementById('scanCode').value=code;}
    finally{busy=false;render();}
  }
  document.getElementById('scanForm').onsubmit=async event=>{event.preventDefault();const input=document.getElementById('scanCode');await add(input.value);input.value='';input.focus();};
  function mode(search){if(searchMode!==search)seen.clear();searchMode=search;document.querySelector('#scanView h2').textContent=t(search?'Scan shipping label':'Scan');for(const id of ['scanList','scanApply','scanClear','scanLayout','scanAdd'])document.getElementById(id).hidden=search;}
  document.getElementById('boardScanSearch').onclick=()=>{mode(true);setView('scan');dialog.showModal();void startCamera();};
  document.querySelectorAll('[data-view="scan"]').forEach(button=>button.addEventListener('click',()=>{mode(false);}));
  document.getElementById('scanAdd').onclick=()=>{mode(false);seen.clear();announce('');document.getElementById('scanSecureLink').hidden=true;dialog.showModal();void startCamera();};
  document.getElementById('scanClose').onclick=()=>dialog.close();
  dialog.addEventListener('close',stop);
  document.querySelectorAll('[data-scan-layout]').forEach(button=>button.onclick=()=>{layout=button.dataset.scanLayout;localStorage.setItem('scan-layout',layout);render();});
  torchButton.onclick=async()=>{
    const track=torchTrack,current=generation;if(!track||torchButton.disabled)return;
    torchButton.disabled=true;const next=!torchOn;
    try{
      await track.applyConstraints({advanced:[{torch:next}]});
      if(current===generation){torchOn=next;torchButton.setAttribute('aria-pressed',String(next));}
    }catch(_){if(current===generation)announce(t('Camera light could not be changed.'));}
    finally{if(current===generation)torchButton.disabled=false;}
  };
  async function startCamera(){
    stop();const current=generation;
    try{
      if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia){announce(t('Live camera requires HTTPS. Open secure Scan to use the camera.'));
        const access=await api('/api/scan-camera-access');const link=document.getElementById('scanSecureLink');link.hidden=!access.url;if(access.url)link.href=access.url+'/#scan';return;}
      const reader=new ZXingBrowser.BrowserMultiFormatReader();
      let detector=null;
      if(window.BarcodeDetector){
        try{const formats=await BarcodeDetector.getSupportedFormats();const supported=formats.filter(f=>['qr_code','code_128','code_39','ean_13','ean_8','itf','data_matrix','pdf417','upc_a','upc_e','codabar'].includes(f));if(supported.length)detector=new BarcodeDetector({formats:supported});}catch(_){/* Use the bundled decoder. */}
      }
      const acquired=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false});
      if(current!==generation){acquired.getTracks().forEach(track=>track.stop());return;}
      const track=acquired.getVideoTracks()[0];
      // Optional autofocus must never prevent camera startup on unsupported devices.
      let capabilities={};try{capabilities=track?.getCapabilities?.()||{};}catch(_){/* Optional camera controls may be unavailable. */}
      if(capabilities.focusMode?.includes('continuous')){
        try{await track.applyConstraints({advanced:[{focusMode:'continuous'}]});}catch(_){/* Keep the working camera settings. */}
      }
      if(current!==generation){acquired.getTracks().forEach(track=>track.stop());return;}
      stream=acquired;video.srcObject=stream;video.hidden=false;document.getElementById('scanCameraFrame').hidden=false;await video.play();if(current!==generation)return;announce(t('Point the camera at a parcel code')+' · '+t('Keep the barcode horizontal across the red line. Tilt the parcel to avoid glare.'));
      function updateLightAvailability(){
        let torch;try{torch=track?.getCapabilities?.().torch;}catch(_){/* Camera control unavailable. */}
        torchTrack=(torch===true||(Array.isArray(torch)&&torch.includes(true)))?track:null;
        torchButton.hidden=false;torchButton.disabled=!torchTrack;
        torchButton.setAttribute('aria-label',t('Flashlight'));
        torchButton.title=t(torchTrack?'Flashlight':'Camera light is unavailable for this camera or browser.');
      }
      updateLightAvailability();
      const cameraCrop=document.getElementById('scanPreview');
      let nextLightCheck=performance.now()+1000;

      function preview(){
        if(current!==generation)return;
        if(video.readyState>=2)window.parcelCodeReader.cropFrame(video,cameraCrop);
        if(!torchTrack&&performance.now()>=nextLightCheck){updateLightAvailability();nextLightCheck=performance.now()+1000;}
        requestAnimationFrame(preview);
      }
      preview();
      async function frame(){
        if(current!==generation)return;
        try{if(video.readyState>=2 && !busy){const source=cameraCrop;const native=detector?await detector.detect(source):[];const codes=native.length?native.map(code=>code.rawValue):window.parcelCodeReader.decode(source,reader,{attempts:12});for(const code of codes){if(current!==generation)return;if(!seen.has(code)){seen.add(code);await add(code);}}}}
        catch(error){announce(t(error.message));stop();return;}
        if(current===generation)setTimeout(frame,350);
      }
      void frame();
    }catch(error){if(current===generation){stop();announce(t(error.message));}}
  }
  document.getElementById('scanClear').onclick=()=>remove([...selected.keys()]);
  document.getElementById('scanApply').onclick=()=>{
    stop();render();state.selectedOrderIds=new Set(selected.keys());
    if(!selected.size)return;
    bulkIds=[...selected.keys()];
    const ids=new Set(state.openOrders.map(o=>Number(o.id)));
    for(const order of selected.values())if(!ids.has(Number(order.id)))state.openOrders.push(order);
    document.getElementById('changeSelectedStatus').click();
  };
  document.getElementById('bulkStatusDialog').addEventListener('close',()=>{
    const ids=bulkIds;bulkIds=null;
    if(ids&&!state.selectedOrderIds.size)void remove(ids);
    else void refresh();
  });
  document.getElementById('orderDetailsDialog').addEventListener('close',()=>void refresh());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();else if(state.activeView==='scan')void refresh();});
  window.addEventListener('pagehide',stop);
  window.parcelScan={refresh,stop:()=>{stop();if(dialog.open)dialog.close();}};
  setInterval(()=>{if(state.activeView==='scan'&&!dialog.open&&!document.getElementById('bulkStatusDialog').open)void refresh();},3000);
  void refresh();
  render();
})();
