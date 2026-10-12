// All API calls are mocked. Never writes to a running application.
const {chromium}=require(process.env.MOMS_PLAYWRIGHT_MODULE || '@playwright/test');
const fs=require('fs'),http=require('http'),assert=require('assert/strict'),path=require('path');
const root=path.resolve(__dirname,'..');
require.cache[require.resolve('../src/db')]={exports:{query:()=>{throw new Error('Mock UI must never query a database');}}};
const {renderShopping}=require('../src/services/shoppingExport');
const server=http.createServer((req,res)=>{
 const file=path.join(root,'src/public',req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);
 try {res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.MOMS_CHROMIUM_PATH}),page=await browser.newPage({viewport:{width:1500,height:950},serviceWorkers:'block'});
 await page.addInitScript(()=>localStorage.setItem('mobile-connect-seen','true'));
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const model={materials:[],products:[],rules:[],shopping:[],manufacturers:[],unmapped:[],movements:[]};let counter=1,failShortages=false,failExport=false;const exportRequests=[],receiptRequests=[];let failReceipt=false,failInventorySave=false,holdInventorySave=null;
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());let data=[];
  if(url.pathname==='/api/inventory/shopping/export') {
   const body=route.request().postDataJSON();exportRequests.push(body);
   if(failExport) return route.fulfill({status:400,json:{error:'The shopping list is empty.'}});
   const rows=model.shopping.map(entry=>({...model.materials.find(material=>material.id===entry.material_id),quantity:entry.quantity}));
   return route.fulfill({body:await renderShopping(rows,body.format,body.language),contentType:body.format==='html'?'text/html':'application/octet-stream'});
  } else if(url.pathname==='/api/inventory/shopping/shortages') {
   if(failShortages) return route.fulfill({status:500,json:{error:'Fixture shortage failure'}});
   let added=0,existing=0;
   for(const material of model.materials.filter(item=>item.after_queue<0)) {
    if(model.shopping.some(item=>item.material_id===material.id)) existing++;
    else {model.shopping.push({material_id:material.id,quantity:-material.after_queue});added++;}
   }
   data={added,existing,unmapped:1};
  } else if(/^\/api\/inventory\/shopping\/[^/]+\/receive$/.test(url.pathname)) {
   const body=route.request().postDataJSON();receiptRequests.push(body);
   if(failReceipt) return route.fulfill({status:409,json:{error:'Shopping quantity changed. Refresh and try again.'}});
   const id=url.pathname.split('/')[4],entry=model.shopping.find(item=>item.material_id===id),material=model.materials.find(item=>item.id===id);
   assert.equal(body.expected_quantity,Number(entry.quantity));
   material.stock=Number(material.stock)+Number(body.quantity);entry.quantity-=Number(body.quantity);
   if(!entry.quantity) model.shopping=model.shopping.filter(item=>item!==entry);
   data={id};
  } else if(url.pathname.startsWith('/api/inventory')) {
   if(['POST','PATCH'].includes(route.request().method())) {
    if(holdInventorySave)await holdInventorySave;
    if(failInventorySave)return route.fulfill({status:409,json:{error:'Fixture inventory save failed'}});
   }
   if(route.request().method()==='POST') {
    const kind=url.pathname.split('/')[3],body=route.request().postDataJSON(),id='00000000-0000-4000-8000-'+String(counter++).padStart(12,'0');
    (kind==='skus'?model.rules:model[kind]).push({...body,id,required:0,after_queue:Number(body.stock || 0)});data={id};
   } else data=model;
  } else if(url.pathname==='/api/orders') data=url.searchParams.get('paginate')==='true'?{orders:[],total:0}:[];
  else if(url.pathname==='/api/config') data={channels:{},shipping:{}};
  else if(url.pathname==='/api/branding') data={name:'MOMS',logo:null};
  else if(url.pathname==='/api/dashboard') data=null;
  else if(['/api/tracking/statuses','/api/authorizations'].includes(url.pathname)) data={};
  await route.fulfill({json:data});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/#inventory`,{waitUntil:'domcontentloaded'});
 await page.locator('[data-inventory-tab="skus"]').click();
 await page.locator('[data-inventory-add="skus"]').click();await page.locator('#inventoryName').fill('5setorange + holder');
 await page.locator('#inventoryAddRecipeLine').click();await page.locator('[data-inventory-reference="0"]').fill('Munari <new>');
 await page.locator('[data-inventory-quantity="0"]').fill('2');
 await page.locator('[data-inventory-create-reference="0"]').click();
 assert.equal(await page.locator('#inventoryName').inputValue(),'Munari <new>');
 await page.locator('#inventoryAddRecipeLine').click();await page.locator('[data-inventory-reference="0"]').fill('Paper <new>');
 await page.locator('[data-inventory-create-reference="0"]').click();
 await page.locator('#inventoryUnit').fill('A4');await page.locator('#inventoryStock').fill('10');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAK0lEQVR4nGNkaGAgGzCRr5VhVDOpgIlkHUhgVDOJgIlUDchgVDOJgKIAAwDFMgCoOrIAcgAAAABJRU5ErkJggg==','base64');
 await page.locator('#inventoryImageFile').setInputFiles({name:'image.png',mimeType:'image/png',buffer:png});
 await page.waitForFunction(()=>Boolean(inventoryEditorDraft.image));
 await page.locator('#saveInventoryItem').click();await page.waitForFunction(()=>inventoryEditorDraft.kind==='products' && !inventoryEditorBusy);
 assert.equal(await page.locator('#inventoryName').inputValue(),'Munari <new>');
 assert.equal(await page.locator('[data-inventory-reference="0"]').inputValue(),'Paper <new>');
 await page.locator('[data-inventory-quantity="0"]').fill('0.5');
 await page.locator('#inventoryImageFile').setInputFiles({name:'image.png',mimeType:'image/png',buffer:png});await page.waitForFunction(()=>Boolean(inventoryEditorDraft.image));
 await page.locator('#saveInventoryItem').click();await page.waitForFunction(()=>inventoryEditorDraft.kind==='skus' && !inventoryEditorBusy);
 assert.equal(await page.locator('#inventoryName').inputValue(),'5setorange + holder');
 assert.equal(await page.locator('[data-inventory-quantity="0"]').inputValue(),'2');
 await page.locator('#saveInventoryItem').click();await page.locator('#inventoryDialog').waitFor({state:'hidden'});
 await page.evaluate(()=>refreshInventoryViews());
 assert.equal(await page.locator('#inventoryMessage').textContent(),'');
 assert.equal(model.rules[0].components[0].product_id,model.products[0].id);
 assert.equal(model.products[0].recipe[0].material_id,model.materials[0].id);
 await page.locator('[data-inventory-tab="materials"]').click();
 assert(await page.locator('#inventoryMaterials .inventory-item-image').isVisible());
 await page.locator('#inventoryShowImages').uncheck();assert(!(await page.locator('#inventoryMaterials .inventory-item-image').isVisible()));
 await page.reload();await page.locator('#inventoryMaterials table').waitFor();assert(!(await page.locator('#inventoryShowImages').isChecked()));
 await page.locator('#inventoryShowImages').check();
 for(const language of ['en','sk']) {
  await page.evaluate(lang=>window.i18n.setLanguage(lang),language);
  for(const width of [1500,390]) {
   await page.setViewportSize({width,height:950});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.locator('[data-inventory-tab="products"]').click();
   await page.locator('[data-inventory-edit="products"]').click();
   await page.locator('[data-inventory-reference="0"]').fill('Unsaved material');
   await page.locator('[data-inventory-create-reference="0"]').click();
   await page.locator('#cancelInventoryItem').click();
   assert.equal(await page.locator('#inventoryName').inputValue(),'Munari <new>');
   await page.locator('#saveInventoryItem').click();assert(await page.locator('#inventoryFormMessage').textContent());
   await page.keyboard.press('Escape');
   assert(await page.locator('#inventoryDialog .unsaved-order-notice').isVisible());
   await page.locator('#inventoryDialog [data-discard-changes]').click();
   if(process.env.MOMS_UI_SCREENSHOTS && language==='sk')await page.screenshot({path:`${process.env.MOMS_UI_SCREENSHOTS}-${width}.png`,fullPage:true});
  }
 }
 await page.evaluate(()=>{state.currentPrepBatch={id:1,name:'Fixture',orders:[],production:window.inventoryState};renderBatchView();});
 assert.equal(await page.locator('#batchContent .inventory-item-image').count(),2);
 model.materials.push({id:'00000000-0000-4000-8000-000000000099',name:'Žltý papier <A4>',manufacturer_name:'Papierové štúdio',unit:'A4',stock:1,required:2.5,after_queue:-1.5});
 model.materials.push({id:'00000000-0000-4000-8000-000000000098',name:'Thread',manufacturer_name:'Thread maker',unit:'m',stock:50,required:1,after_queue:49});
 await page.evaluate(()=>loadInventory());
 for(const language of ['en','sk']) {
  await page.evaluate(lang=>window.i18n.setLanguage(lang),language);
  for(const width of [1500,390]) {
   await page.setViewportSize({width,height:950});
   await page.locator('[data-inventory-tab="materials"]').click();
   await page.locator('#inventorySearch').fill('zlty');
   assert.equal(await page.locator('#inventoryMaterials tbody tr:visible').count(),1);
   assert(await page.locator('#inventoryMaterials').getByText('Žltý papier <A4>',{exact:true}).isVisible());
   await page.locator('#inventorySearch').fill('papierove studio');
   await page.evaluate(()=>loadInventory());
   assert.equal(await page.locator('#inventoryMaterials tbody tr:visible').count(),1);
   await page.locator('[data-inventory-tab="products"]').click();
   assert.equal(await page.locator('#inventorySearch').inputValue(),'');
   await page.locator('#inventorySearch').fill('Paper <new>');
   assert.equal(await page.locator('#inventoryProducts tbody tr:visible').count(),1);
   await page.locator('[data-inventory-tab="materials"]').click();
   assert.equal(await page.locator('#inventorySearch').inputValue(),'papierove studio');
   await page.locator('#inventoryClearFilters').click();
   await page.locator('#inventoryOnlyShortages').check();
   assert.equal(await page.locator('#inventoryMaterials tbody tr:visible').count(),1);
   await page.locator('#inventorySearch').fill('Thread');
   assert.equal(await page.locator('#inventoryMaterials [data-inventory-empty-search]').count(),1);
   await page.locator('#inventoryClearFilters').click();
   assert.equal(await page.locator('#inventoryMaterials tbody tr:visible').count(),3);
   await page.locator('#inventorySearch').fill('Add to shopping list');
   assert.equal(await page.locator('#inventoryMaterials [data-inventory-empty-search]').count(),1,'Action labels are not searched');
   await page.locator('#inventoryClearFilters').click();
   await page.locator('[data-inventory-tab="products"]').click();
   await page.locator('#inventoryClearFilters').click();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
 }
 for(const language of ['en','sk']) {
  await page.evaluate(lang=>window.i18n.setLanguage(lang),language);
  for(const width of [1500,390]) {
   await page.setViewportSize({width,height:950});
   await page.locator('[data-inventory-tab="materials"]').click();
   await page.locator('#inventorySearch').fill('no matching material');
   const stockBefore=model.materials.map(item=>item.stock);
   await page.locator('[data-inventory-panel="materials"] [data-shopping-shortages]').click();
   await page.locator('[data-inventory-panel="shopping"]:not([hidden])').waitFor();
   assert.equal(await page.locator('#inventorySearch').inputValue(),'','Bulk action clears shopping search to show added items');
   assert.equal(await page.locator('[data-shopping-quantity]').inputValue(),'1.5');
   assert.deepEqual(model.materials.map(item=>item.stock),stockBefore);
   await page.locator('[data-inventory-panel="shopping"] [data-shopping-shortages]').click();
   await page.waitForFunction(()=>document.getElementById('inventoryMessage').textContent.includes('0.'));
   assert.equal(model.shopping.length,1);
   assert(await page.locator('#inventoryMessage').textContent());
   failShortages=true;
   await page.locator('[data-inventory-panel="shopping"] [data-shopping-shortages]').click();
   await page.waitForFunction(()=>document.getElementById('inventoryMessage').textContent==='Fixture shortage failure');
   assert(!(await page.locator('[data-inventory-panel="shopping"] [data-shopping-shortages]').isDisabled()));
   failShortages=false;
   await page.locator('[data-inventory-tab="materials"]').click();await page.locator('#inventoryClearFilters').click();
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
 }
 await page.evaluate(()=>{
  const open=window.open;
  window.open=(...args)=>{const preview=open(...args);if(preview)preview.print=()=>{preview.__printed=true;};return preview;};
 });
 for(const language of ['en','sk']) {
  await page.evaluate(lang=>window.i18n.setLanguage(lang),language);
  for(const width of [1500,390]) {
   await page.setViewportSize({width,height:950});
   await page.locator('[data-inventory-tab="shopping"]').click();
   await page.locator('#inventorySearch').fill('hide everything');
   for(const format of ['csv','xlsx']) {
    const download=page.waitForEvent('download');await page.locator(`[data-shopping-export="${format}"]`).click();
    assert.equal((await download).suggestedFilename(),`shopping-list.${format}`);
    assert.deepEqual(exportRequests.at(-1),{format,language},'Export is whole list independent of UI filter');
   }
   const popup=page.waitForEvent('popup');await page.locator('[data-shopping-export="html"]').click();const preview=await popup;
   await preview.waitForFunction(()=>window.__printed===true);assert(await preview.getByRole('heading',{name:language==='sk'?'Nákupný zoznam':'Shopping list',exact:true}).isVisible());assert.equal(await preview.locator('tbody tr').count(),1);assert(await preview.getByText('Žltý papier <A4>',{exact:true}).isVisible());if(process.env.MOMS_UI_SCREENSHOTS)await preview.screenshot({path:`${process.env.MOMS_UI_SCREENSHOTS}-print-${language}-${width}.png`,fullPage:true});await preview.close();
   failExport=true;await page.locator('[data-shopping-export="csv"]').click();
   await page.waitForFunction(()=>!document.querySelector('[data-shopping-export="csv"]').disabled);
   assert.equal(await page.locator('#inventoryMessage').textContent(),language==='sk'?'Nákupný zoznam je prázdny.':'The shopping list is empty.');failExport=false;
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
 }
 for(const language of ['en','sk']) {
  await page.evaluate(lang=>window.i18n.setLanguage(lang),language);
  for(const width of [1500,390]) {
   await page.setViewportSize({width,height:950});
   const material=model.materials[0];model.shopping=[{material_id:material.id,quantity:3}];
   await page.evaluate(()=>refreshInventoryViews());
   await page.locator('[data-inventory-tab="shopping"]').click();await page.locator('#inventoryClearFilters').click();
   await page.locator('[data-shopping-receive]').click();
   await page.locator('#inventoryReceiptCancel').click();assert.equal(model.shopping[0].quantity,3);
   await page.locator('[data-shopping-receive]').click();await page.locator('#inventoryReceiptQuantity').fill('1.25');
   const stock=Number(material.stock);material.stock=stock;failReceipt=true;await page.locator('#inventoryReceiptSave').click();
   await page.waitForFunction(()=>Boolean(document.getElementById('inventoryReceiptMessage').textContent));
   assert(!(await page.locator('#inventoryReceiptSave').isDisabled()));assert.equal(material.stock,stock);
   const key=receiptRequests.at(-1).request_key;failReceipt=false;await page.locator('#inventoryReceiptSave').click();
   await page.locator('#inventoryReceiptDialog').waitFor({state:'hidden'});
   assert.equal(receiptRequests.at(-1).request_key,key);assert.equal(material.stock,stock+1.25);assert.equal(model.shopping[0].quantity,1.75);
   await page.locator('[data-shopping-receive]').click();assert.equal(await page.locator('#inventoryReceiptQuantity').inputValue(),'1.75');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.locator('#inventoryReceiptSave').click();await page.locator('#inventoryReceiptDialog').waitFor({state:'hidden'});
   assert.equal(model.shopping.length,0);assert.equal(material.stock,stock+3);
  }
 }
 for(const language of ['en','sk']) for(const width of [1500,390]) {
  await page.setViewportSize({width,height:950});await page.evaluate(lang=>window.i18n.setLanguage(lang),language);
  for(const kind of ['materials','products','skus']) {
   await page.evaluate(kind=>openInventoryEditor(kind,undefined),kind);
   await page.locator('#cancelInventoryItem').click();assert(!(await page.locator('#inventoryDialog').evaluate(el=>el.open)));
   await page.evaluate(kind=>openInventoryEditor(kind,undefined),kind);
   await page.locator('#inventoryName').fill('Unsaved fixture');await page.locator('#cancelInventoryItem').click();
   const notice=page.locator('#inventoryDialog .unsaved-order-notice');assert(await notice.isVisible());
   assert.equal(await notice.locator('p').textContent(),language==='sk'?'Máte neuložené zmeny.':'You have unsaved changes.');
   if(process.env.MOMS_UI_SCREENSHOTS && language==='sk' && width===390 && kind==='products')await page.screenshot({path:process.env.MOMS_UI_SCREENSHOTS+'-unsaved-mobile.png'});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await notice.locator('[data-keep-editing]').click();assert.equal(await page.locator('#inventoryName').inputValue(),'Unsaved fixture');
   assert(await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;}));
   await page.locator('#inventoryName').fill('');await page.keyboard.press('Escape');assert(!(await page.locator('#inventoryDialog').evaluate(el=>el.open)));
   await page.evaluate(kind=>openInventoryEditor(kind,undefined),kind);
   if(kind==='materials')await page.locator('#inventoryUnit').fill('m');
   else await page.locator('#inventoryAddRecipeLine').click();
   await page.keyboard.press('Escape');assert(await notice.isVisible());await notice.locator('[data-discard-changes]').click();
  }
  // A changed child can be discarded without losing the parent's pending recipe.
  await page.evaluate(()=>openInventoryEditor('products',window.inventoryState.products[0].id));
  await page.locator('[data-inventory-reference="0"]').fill('Child fixture');await page.locator('[data-inventory-quantity="0"]').fill('2.5');
  await page.locator('[data-inventory-create-reference="0"]').click();
  assert(await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;}),'Unsaved parent is protected while clean child is open');
  await page.locator('#inventoryUnit').fill('A4');await page.keyboard.press('Escape');
  await page.locator('#inventoryDialog [data-discard-changes]').click();
  assert.equal(await page.locator('[data-inventory-reference="0"]').inputValue(),'Child fixture');
  assert.equal(await page.locator('[data-inventory-quantity="0"]').inputValue(),'2.5');
  await page.locator('#cancelInventoryItem').click();await page.locator('#inventoryDialog [data-discard-changes]').click();
  // Removing an existing image counts as a change even though the file input is empty.
  await page.evaluate(()=>openInventoryEditor('materials',window.inventoryState.materials[0].id));
  await page.locator('#inventoryRemoveImage').click();await page.locator('#cancelInventoryItem').click();
  assert(await page.locator('#inventoryDialog .unsaved-order-notice').isVisible());
  await page.locator('#inventoryDialog [data-discard-changes]').click();
  assert(!(await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;})));
 }
 await page.evaluate(()=>openInventoryEditor('materials'));
 await page.locator('#inventoryName').fill('Failed save fixture');await page.locator('#inventoryUnit').fill('pcs');
 let releaseSave;holdInventorySave=new Promise(resolve=>{releaseSave=resolve;});failInventorySave=true;
 await page.locator('#saveInventoryItem').click();await page.waitForFunction(()=>inventoryEditorBusy);
 assert(await page.locator('#cancelInventoryItem').isDisabled());assert(await page.locator('#inventoryName').isDisabled());
 await page.keyboard.press('Escape');assert(await page.locator('#inventoryDialog').evaluate(el=>el.open));
 releaseSave();holdInventorySave=null;await page.waitForFunction(()=>!inventoryEditorBusy);failInventorySave=false;
 assert.equal(await page.locator('#inventoryName').inputValue(),'Failed save fixture');assert(await page.locator('#inventoryFormMessage').textContent());
 await page.locator('#cancelInventoryItem').click();assert(await page.locator('#inventoryDialog .unsaved-order-notice').isVisible());
 await page.locator('#inventoryDialog [data-discard-changes]').click();
 if(process.env.MOMS_UI_SCREENSHOTS) for(const theme of ['light','dark']) for(const width of [1500,390]) for(const kind of ['materials','products']) {
  await page.setViewportSize({width,height:950});
  await page.evaluate(({theme,kind})=>{document.documentElement.dataset.theme=theme;window.i18n.setLanguage('sk');openInventoryEditor(kind,window.inventoryState[kind][0].id);},{theme,kind});
  await page.screenshot({path:`${process.env.MOMS_UI_SCREENSHOTS}-${theme}-${width}-${kind}.png`});
  await page.locator('#cancelInventoryItem').click();
 }
 assert.deepEqual(errors,[]);
 console.log('PASS nested SKU/product/material creation, parent draft quantities, cancel/Escape, unknown-name validation, image upload, toggle persistence, batch images, accent-insensitive inventory search, recipe search, per-tab filters, shortages, empty results, whole-list CSV/XLSX downloads and print popup, error recovery, unsaved fields/recipes/images, parent protection, failed and pending saves, EN/SK desktop/mobile.');
 await browser.close();server.close();
})().catch(e=>{console.error(e);server.close();process.exit(1)});
