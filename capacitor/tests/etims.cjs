const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {JSDOM}=require('jsdom');
const {IDBFactory}=require('fake-indexeddb');
const core=require('../www/etims-core');
const {adapter,money}=require('../../chrome-extension/portal-adapter');
const fixture=fs.readFileSync(path.join(__dirname,'fixtures/kra-portal.html'),'utf8');
const order=()=>({id:1,ticket_no:'POS-TEST-1',status:'paid',payment_method:'mpesa',payment_ref:'TEST-PAYMENT',paid_at:1791630000,
  items:[{name:'Fixture item',description:'Fixture description',qty:2.5,unit_price_cents:1010,line_total_cents:2525}],
  subtotal_cents:2525,discount_type:'percent',discount_value:10,discount_cents:253,total_cents:2272,tax_cents:0,tax_rate:0});
const snap=()=>core.snapshot(order(),'shop-test',{}, {pin:'A123456789B',phone:'0712345678',email:'test@example.test',billing_address:'Fixture address'});
function record() {
  const snapshot=snap();return {id:JSON.stringify(['shop-test',1,'POS-TEST-1']),shop_id:'shop-test',sale_id:1,receipt_no:'POS-TEST-1',snapshot,
    digest:crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),status:'review_required',attempt_id:'attempt-test',history:[]};
}
const official=()=>({cu_invoice_number:'TEST-CU/0001',scu_id:'TEST-SCU',receipt_signature:'TEST-SIGNATURE',invoice_number:'TEST-INV-1',invoice_date:'2026-10-10',qr_image:'data:image/png;base64,AAAA'});

test('sale snapshot preserves decimal quantities, exact cents, customer, discounts and payment',()=>{
  const s=snap();assert.equal(s.total_cents,2272);assert.equal(s.items[0].quantity,2.5);assert.equal(s.items[0].unit_price_cents,1010);
  assert.equal(s.discount.amount_cents,253);assert.equal(s.customer.email,'test@example.test');assert.equal(s.payment_method,'mpesa');assert.equal(s.customer.name,undefined);
  const fixed={...order(),discount_type:'fixed',discount_value:2.53};assert.equal(core.snapshot(fixed,'shop').total_cents,2272);
  assert.throws(()=>core.snapshot({...order(),total_cents:2273},'shop'),/total/);
  assert.throws(()=>core.snapshot({...order(),status:'open'},'shop'),/completed/);
  assert.throws(()=>core.snapshot({...order(),is_quote:1},'shop'));
  assert.throws(()=>core.customer({pin:'invalid'}));assert.equal(core.customer({}).pin,'');
});

test('uncertain attempts require a documented check; generated CU blocks retries and changes',()=>{
  const r={...record(),status:'pending',attempt_id:null};
  const started=core.transition(r,{type:'start',attempt_id:'attempt-test'},'now');
  assert.equal(started.status,'review_required');
  assert.throws(()=>core.transition(started,{type:'start',attempt_id:'new'},'now'),/Check/);
  assert.throws(()=>core.transition(started,{type:'checked_absent',reason:''},'now'));
  const pending=core.transition(started,{type:'checked_absent',reason:'Searched receipt and total'},'now');assert.equal(pending.status,'pending');
  const generated=core.transition(started,{type:'capture',source:'manual',fiscal:{cu_invoice_number:'TEST-CU/0001'}},'now');
  assert.equal(generated.status,'generated');assert.equal(generated.fiscal.scu_id,undefined);
  assert.throws(()=>core.transition(generated,{type:'start'},'now'),/Duplicate/);
  assert.throws(()=>core.transition(generated,{type:'checked_absent',reason:'test'},'now'));
  assert.throws(()=>core.transition(generated,{type:'capture',source:'manual',fiscal:{cu_invoice_number:'OTHER-CU'}},'now'),/different/);
});

test('automatic confirmation must match attempt, digest and exact amount',()=>{
  const r=record(), action={type:'capture',source:'portal',fiscal:official(),attempt_id:r.attempt_id,digest:r.digest,total_cents:2272};
  assert.equal(core.transition(r,action,'now').status,'generated');
  for (const change of [{attempt_id:'stale'},{digest:'wrong'},{total_cents:2273}]) assert.throws(()=>core.transition(r,{...action,...change},'now'),/match/);
  assert.throws(()=>core.transition(r,{...action,fiscal:{cu_invoice_number:'TEST-CU'}},'now'),/incomplete/);
});

test('receipts include only recorded fiscal fields and approved QR image formats',()=>{
  assert.equal(core.receipt(null),'');assert.match(core.receipt({...record(),status:'pending'}),/Pending/);
  const html=core.receipt({...record(),fiscal:{...official(),source:'manual',receipt_signature:'<script>test</script>'}});
  assert.match(html,/TEST-CU\/0001/);assert.match(html,/Manually recorded/);assert.ok(!html.includes('<script>'));
  for (const url of ['javascript:alert(1)','https://evil.test/qr.png','data:image/svg+xml;base64,AAAA']) assert.throws(()=>core.qr(url));
});

test('portal adapter fills real field controls and leaves KRA-resolved name alone',async()=>{
  const dom=new JSDOM(fixture,{url:'https://ecitizen.kra.go.ke/individual/etims/sale/create',runScripts:'dangerously'});
  const a=adapter(dom.window.document),s=snap();
  assert.deepEqual(a.fill(s),[]);assert.deepEqual(a.verify(s),[]);
  assert.equal(dom.window.document.querySelector('[name=customer_name]').value,'KRA-resolved fixture customer');
  assert.equal(dom.window.fixtureSubmissions,0);assert.equal(await a.capture(s),null);
  dom.window.document.querySelector('[name="items[0][unit_price]"]').value='10.11';assert.ok(a.verify(s).some(e=>e.includes('differs')));
  dom.window.close();
});

test('capture requires complete invoice plus exact POS reference and total',async()=>{
  const dom=new JSDOM(fixture,{url:'https://ecitizen.kra.go.ke/individual/etims/sale/create',runScripts:'dangerously'});
  const a=adapter(dom.window.document),s=snap();a.fill(s);
  dom.window.document.getElementById('invoice').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  assert.equal((await a.capture(s)).cu_invoice_number,'TEST-CU/0001');
  dom.window.document.querySelector('[name=reference]').value='OTHER';assert.ok(await a.capture(s));
  [...dom.window.document.querySelectorAll('#official dt')].find(el=>el.textContent==='Reference').nextElementSibling.textContent='OTHER';assert.equal(await a.capture(s),null);
  assert.equal(money('KES 1,234.56'),123456);assert.equal(money('12.345'),null);
  dom.window.close();
});

test('multiple lines, fixed discounts and zero totals fill without issuing',()=>{
  const dom=new JSDOM(fixture,{url:'https://ecitizen.kra.go.ke/individual/etims/sale/create',runScripts:'dangerously'});
  const a=adapter(dom.window.document),s=snap();
  s.items.push({name:'Second fixture',description:'',quantity:1,unit_price_cents:200,line_total_cents:200});
  s.payment_method='card';s.subtotal_cents=2725;s.discount={type:'fixed',value:3.21,amount_cents:321};s.total_cents=2404;
  assert.equal(a.addItem(),true);assert.deepEqual(a.fill(s),[]);assert.deepEqual(a.verify(s),[]);
  s.discount={type:'percent',value:100,amount_cents:2725};s.total_cents=0;
  a.fill(s);assert.deepEqual(a.verify(s),[]);assert.equal(dom.window.fixtureSubmissions,0);
  dom.window.close();
});

test('atomic database transform permits only one claim across concurrent tabs',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/sqlite-bridge.js'),'utf8').replace(/^import .*;$/gm,'').split('window.OraforgeDB =')[0];
  const ctx={indexedDB:new IDBFactory(),Capacitor:{getPlatform:()=> 'web'},window:{}};
  vm.runInNewContext(source+'\nwindow.DB = OraforgeDB;',ctx);
  const first=await new ctx.window.DB().init(), second=await new ctx.window.DB().init();
  await first.set('invoice', {...record(),status:'pending'});
  const results=await Promise.allSettled([first,second].map(db=>db.update('invoice',r=>core.transition(r,{type:'start',attempt_id:crypto.randomUUID()},'now'))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
  assert.equal((await first.get('invoice')).status,'review_required');
  assert.throws(()=>core.transition(record(),{type:'unsupported'},'now'));
});

function worker(storage={},tabs=new Map()) {
  let listener, alarmListener, changeListener, tabId=Math.max(40,...tabs.keys());const messages=[],alarms=new Map();
  const chrome={alarms:{get:async name=>alarms.get(name),create:async(name,config)=>alarms.set(name,config),clear:async name=>alarms.delete(name),onAlarm:{addListener:fn=>alarmListener=fn}},storage:{onChanged:{addListener:fn=>changeListener=fn},local:{get:async k=>({[k]:structuredClone(storage[k])}),set:async value=>Object.assign(storage,structuredClone(value))}},
    runtime:{onMessage:{addListener:fn=>listener=fn}},
    tabs:{query:async()=>[...tabs.values()],get:async id=>{if(!tabs.has(id))throw Error('No tab');return tabs.get(id);},remove:async id=>tabs.delete(id),update:async(id,options)=>Object.assign(tabs.get(id),options),sendMessage:async(id,message)=>{messages.push({id,...message});}},
    windows:{create:async options=>{const tab={id:++tabId,windowId:10,url:options.url};tabs.set(tab.id,tab);return {id:10,tabs:[tab]};},update:async()=>{}}};
  const context=vm.createContext({chrome,URL,console,crypto:crypto.webcrypto,TextEncoder});
  context.importScripts=name=>vm.runInContext(fs.readFileSync(path.join(__dirname,'../../chrome-extension',name),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../../chrome-extension/background.js'),'utf8'),context);
  const pos={url:'http://localhost:3000/pos',frameId:0,tab:{id:2}};
  const send=(action,data={},sender=pos,role='pos')=>new Promise(resolve=>listener({action,data,role},sender,resolve));
  return {send,storage,tabs,pos,messages,alarms,alarm:()=>alarmListener({name:'oraforge_activity_tick'}),change:value=>{storage.oraforgeScrollKeepAliveEnabled=value;changeListener({oraforgeScrollKeepAliveEnabled:{newValue:value}},'local');}};
}
function otherRecord(saleId,receipt) {
  const r=record();r.sale_id=r.snapshot.sale_id=saleId;r.receipt_no=r.snapshot.receipt_no=receipt;
  r.id=JSON.stringify([r.shop_id,saleId,receipt]);r.attempt_id='attempt-'+saleId;
  r.digest=crypto.createHash('sha256').update(JSON.stringify(r.snapshot)).digest('hex');return r;
}
test('scroll logs accept only official top-level pages and retain bounded metadata without sale or session data',async()=>{
  const w=worker(),portal={url:'https://ecitizen.kra.go.ke/individual/etims/sale/create?token=DO-NOT-LOG',frameId:0,tab:{id:41}};
  const data={event:'scroll_cycle',enabled:true,visible:true,observed_ms:60000,cycles:1,delta:2,restored:true,
    token:'DO-NOT-LOG',customer_pin:'DO-NOT-LOG',url:portal.url,record:record()};
  for(let i=0;i<205;i++)assert.equal((await w.send('log',data,portal,'scroll_keepalive')).result.logged,true);
  const logs=w.storage.oraforgeScrollKeepAliveLog;assert.equal(logs.length,200);
  assert.equal(logs[0].origin,'https://ecitizen.kra.go.ke');assert.equal(logs[0].restored,true);
  assert.ok(!JSON.stringify(logs).includes('DO-NOT-LOG'));assert.equal(w.storage.oraforgeJobsV1,undefined);
  assert.match((await w.send('log',data,{...portal,url:'https://evil.test'},'scroll_keepalive')).error,/Untrusted/);
  assert.match((await w.send('log',data,{...portal,frameId:1},'scroll_keepalive')).error,/Untrusted/);
  assert.match((await w.send('log',{event:'INVOICE DATA'},portal,'scroll_keepalive')).error,/Invalid/);
});
test('opted checkout opens a fresh KRA popup even when an unarmed sale is already open',async()=>{
  const w=worker(),first=record(),next=otherRecord(2,'POS-CHECKOUT-2');
  assert.equal((await w.send('start',{record:first,new_popup:true})).result.opened,true);
  assert.equal((await w.send('start',{record:next,new_popup:true})).result.opened,true);
  assert.equal(w.tabs.size,2);
  for (const [tabId,expected] of [[41,first],[42,next]]) {
    const portal={url:w.tabs.get(tabId).url,frameId:0,tab:{id:tabId}};
    const job=(await w.send('job',{},portal,'portal')).result;
    assert.equal(job.record.id,expected.id);
    assert.equal(job.record.attempt_id,expected.attempt_id);
    assert.equal(job.armed,false);
  }
  assert.equal(w.messages.filter(m=>m.action==='detached').length,0);
  assert.match((await w.send('start',{record:next,new_popup:true})).error,/already/);
  assert.equal(w.tabs.size,2);
});
test('reopening unarmed sales reuses their attempt and switches the popup to the selected receipt',async()=>{
  let w=worker();const live=record(),old=otherRecord(2,'POS-OLDER-2');
  const portal={url:'https://ecitizen.kra.go.ke/individual/etims/sale/create',frameId:0,tab:{id:41}};
  await w.send('start',{record:live});
  await w.send('start',{record:old});
  assert.equal(w.tabs.size,1);assert.ok(w.messages.some(m=>m.action==='detached'));
  assert.equal((await w.send('job',{},portal,'portal')).result.record.receipt_no,old.receipt_no);
  assert.ok((await w.send('arm',{attempt_id:live.attempt_id,digest:live.digest,total_cents:2272,receipt_no:live.receipt_no},portal,'portal')).error);
  w=worker(w.storage,w.tabs);
  const resumed=await w.send('resume',{record:live});
  assert.equal(resumed.result.receipt_no,live.receipt_no);
  let job=(await w.send('job',{},portal,'portal')).result;
  assert.equal(job.record.attempt_id,live.attempt_id);assert.equal(job.recovery,false);
  await w.send('recover',{record:live});
  assert.equal(w.tabs.get(41).url,'https://ecitizen.kra.go.ke/individual/etims/sale');
  assert.equal((await w.send('job',{},portal,'portal')).result.recovery,true);
  assert.equal((await w.send('resume',{record:live})).result.mode,'fill');
  assert.equal(w.tabs.get(41).url,'https://ecitizen.kra.go.ke/individual/etims/sale/create');
  assert.equal((await w.send('resume',{record:old})).result.receipt_no,old.receipt_no);
  job=(await w.send('job',{},portal,'portal')).result;
  assert.equal(job.record.receipt_no,old.receipt_no);assert.equal(w.tabs.size,1);
});
test('armed, generated, missing and mismatched attempts cannot resume filling',async()=>{
  const w=worker(),r=record(),portal={url:'https://ecitizen.kra.go.ke/individual/etims/sale/create',frameId:0,tab:{id:41}};
  assert.match((await w.send('resume',{record:r})).error,/cannot safely resume/);
  await w.send('start',{record:r});
  assert.ok((await w.send('resume',{record:{...r,attempt_id:'stale'}})).error);
  const changed=structuredClone(r);changed.snapshot.customer.email='different@example.test';changed.digest=crypto.createHash('sha256').update(JSON.stringify(changed.snapshot)).digest('hex');
  assert.match((await w.send('resume',{record:changed})).error,/saved POS sale differs/);
  const data={attempt_id:r.attempt_id,digest:r.digest,total_cents:2272,receipt_no:r.receipt_no};
  await w.send('arm',data,portal,'portal');
  assert.match((await w.send('resume',{record:r})).error,/cannot safely resume/);
  const another=otherRecord(2,'POS-SECOND-2');await w.send('start',{record:another});
  assert.equal(w.tabs.size,2);assert.equal((await w.send('job',{},portal,'portal')).result.record.id,r.id);
  await w.send('capture',{...data,fiscal:official()},portal,'portal');
  assert.match((await w.send('resume',{record:r})).error,/already recorded/);
  const unknown=worker();await unknown.send('recover',{record:r});
  assert.match((await unknown.send('resume',{record:r})).error,/cannot safely resume/);
});
test('extension job survives worker restart and blocks duplicate attempts',async()=>{
  const w=worker(),r=record();assert.equal((await w.send('start',{record:r})).result.opened,true);
  assert.match((await w.send('start',{record:r})).error,/already/);
  const restarted=worker(w.storage);
  assert.match((await restarted.send('start',{record:r})).error,/already/);
  assert.match((await restarted.send('ping',{}, {url:'https://evil.test',frameId:0})).error,/permitted/);
  assert.match((await restarted.send('ping',{}, {...w.pos,frameId:1})).error,/permitted/);
});
test('extension rejects a changed snapshot before opening any portal window',async()=>{
  const w=worker(),r=record();r.digest='0'.repeat(64);
  assert.match((await w.send('start',{record:r})).error,/snapshot changed/);assert.equal(w.tabs.size,0);
});
test('extension captures only its bound tab and retains official results until POS recovers',async()=>{
  const w=worker(),r=record();await w.send('start',{record:r});
  const portal={url:'https://ecitizen.kra.go.ke/individual/etims/sale/create',frameId:0,tab:{id:41}};
  const data={attempt_id:r.attempt_id,digest:r.digest,total_cents:2272,receipt_no:r.receipt_no};
  assert.ok((await w.send('capture',{...data,fiscal:official()},portal,'portal')).error);
  assert.equal((await w.send('arm',data,portal,'portal')).result.armed,true);
  assert.ok((await w.send('arm',data,portal,'portal')).error);
  assert.ok((await w.send('capture',{...data,fiscal:official()},{...portal,tab:{id:99}},'portal')).error);
  assert.ok((await w.send('capture',{...data,total_cents:2273,fiscal:official()},portal,'portal')).error);
  assert.equal((await w.send('capture',{...data,fiscal:official()},portal,'portal')).result.captured,true);
  const restarted=worker(w.storage);assert.equal((await restarted.send('results')).result[0].fiscal.cu_invoice_number,'TEST-CU/0001');
  assert.ok((await restarted.send('checked_absent',{id:r.id,attempt_id:r.attempt_id,reason:'test'})).error);
});
test('checked absence closes the stale form before a new attempt',async()=>{
  const w=worker(),r=record();await w.send('start',{record:r});assert.equal(w.tabs.size,1);
  assert.equal((await w.send('checked_absent',{id:r.id,attempt_id:r.attempt_id,reason:'Searched existing invoices'})).result.reset,true);
  assert.equal(w.tabs.size,0);
  assert.equal((await w.send('start',{record:{...r,attempt_id:'new-attempt'}})).result.opened,true);
});

test('portal script never submits automatically and blocks scripted generation',async()=>{
  const dom=new JSDOM(fixture,{url:'https://ecitizen.kra.go.ke/individual/etims/sale/create',runScripts:'dangerously'});
  const r=record();dom.window.OraforgeKraAdapter={adapter};
  dom.window.chrome={runtime:{onMessage:{addListener(){}},sendMessage:async m=>m.action==='job'?{result:{record:r,config:{}}}:{error:'Unexpected action: '+m.action}}};
  dom.window.eval(fs.readFileSync(path.join(__dirname,'../../chrome-extension/portal.js'),'utf8'));
  await new Promise(resolve=>setTimeout(resolve,50));
  dom.window.document.getElementById('generate').click();
  assert.equal(dom.window.fixtureSubmissions,0);
  dom.window.document.getElementById('invoice').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  assert.equal(dom.window.fixtureSubmissions,0);
  const panel=dom.window.document.querySelector('[data-oraforge-companion]').shadowRoot;
  panel.querySelector('[data-review]').checked=true;panel.querySelector('[data-arm]').click();
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(dom.window.fixtureSubmissions,0);
  dom.window.close();
});

async function until(predicate) {
  const end=Date.now()+5000;
  while (!predicate()) {if(Date.now()>end)throw Error('Timed out waiting for portal state.');await new Promise(resolve=>setTimeout(resolve,20));}
}
test('portal detects accessibility visibility changes and refills after reconnection with the same inputs',async()=>{
  const dom=new JSDOM(fixture,{url:'https://ecitizen.kra.go.ke/individual/etims/sale/create',runScripts:'dangerously'});
  const d=dom.window.document,form=d.getElementById('invoice'),r=record();
  let online=true;
  Object.defineProperty(dom.window.navigator,'onLine',{get:()=>online});
  dom.window.OraforgeKraAdapter={adapter};
  dom.window.chrome={runtime:{onMessage:{addListener(){}},sendMessage:async m=>m.action==='job'?{result:{record:r,config:{}}}:{error:'Unexpected action'}}};
  form.setAttribute('aria-hidden','true');
  dom.window.eval(fs.readFileSync(path.join(__dirname,'../../chrome-extension/portal.js'),'utf8'));
  await until(()=>d.querySelector('[data-oraforge-companion]')?.shadowRoot.querySelector('[role=status]').textContent.includes('Missing:'));
  form.removeAttribute('aria-hidden');
  const reference=form.elements.reference,email=form.elements.email;
  await until(()=>reference.value===r.receipt_no && form.elements.total.value==='22.72');
  const panel=d.querySelector('[data-oraforge-companion]').shadowRoot;
  await until(()=>!panel.querySelector('[data-fill]').disabled);
  online=false;dom.window.dispatchEvent(new dom.window.Event('offline'));
  assert.match(panel.querySelector('[role=status]').textContent,/Connection lost/);
  form.reset();assert.equal(reference.value,'');
  online=true;dom.window.dispatchEvent(new dom.window.Event('online'));
  await until(()=>reference.value===r.receipt_no && email.value===r.snapshot.customer.email && form.elements.total.value==='22.72' && !panel.querySelector('[data-fill]').disabled);
  assert.equal(form.elements.email,email);assert.equal(dom.window.fixtureSubmissions,0);
  dom.window.close();
});
test('portal keeps recovery instructions and removes an old panel when its binding disappears',async()=>{
  const dom=new JSDOM('<html><body><h1>Loading fixture</h1></body></html>',{url:'https://ecitizen.kra.go.ke/individual/etims/sale/create',runScripts:'dangerously'});
  let listener,next={record:record(),config:{},recovery:true,can_resume:true};
  dom.window.OraforgeKraAdapter={adapter};
  dom.window.chrome={runtime:{onMessage:{addListener(fn){listener=fn;}},sendMessage:async()=>({result:next})}};
  dom.window.eval(fs.readFileSync(path.join(__dirname,'../../chrome-extension/portal.js'),'utf8'));
  await until(()=>dom.window.document.querySelector('[data-oraforge-companion]'));
  const panel=dom.window.document.querySelector('[data-oraforge-companion]').shadowRoot;
  await until(()=>panel.querySelector('[role=status]').textContent.includes('Resume filling in KRA'));
  assert.equal(panel.querySelector('[data-fill]').disabled,true);
  assert.ok(!panel.querySelector('[role=status]').textContent.includes('Missing:'));
  next=null;listener({action:'reload_job'});
  await until(()=>!dom.window.document.querySelector('[data-oraforge-companion]'));
  dom.window.close();
});

const vueFixture=fs.readFileSync(path.join(__dirname,'fixtures/kra-vue-invoice.html'),'utf8');
const vueDom=()=>new JSDOM(vueFixture,{url:'https://ecitizen.kra.go.ke/business/fixture/etims/sale/create',runScripts:'dangerously'});
const {lineDiscounts}=require('../../chrome-extension/portal-adapter');

test('invoice detection uses live controls across routes and excludes login/other documents',()=>{
  const dom=vueDom(),a=adapter(dom.window.document);
  assert.equal(a.detect().ready,true);assert.equal(a.detect().kind,'kra-vue');
  dom.window.history.pushState({},'','/a-new-route#/sales/invoice/new');assert.equal(a.detect().ready,true);
  dom.window.document.querySelector('h1').textContent='Create Quotation';assert.equal(a.detect().ready,false);
  dom.window.document.body.innerHTML='<h1>Sign in</h1><input type="email"><input type="password">';assert.equal(a.detect().ready,false);
  dom.window.close();
});

test('live-shaped Vue dropdowns and item popup fill every line and repeat without duplicates',async()=>{
  const dom=vueDom(),d=dom.window.document,a=adapter(d),s=snap();
  s.items.push({name:'Second fixture',description:'Second description',quantity:2,unit_price_cents:101,line_total_cents:202});
  s.subtotal_cents=2727;s.discount={type:'percent',value:10,amount_cents:273};s.total_cents=2454;
  d.querySelector('[name="note "]').value='Existing cashier note';
  const report=await a.fillSale(s,{timeout:350});
  assert.deepEqual(report.filter(r=>r.status==='failed'),[]);
  assert.deepEqual(a.verify(s),[]);assert.equal(a.rows().length,2);
  assert.equal(dom.window.fixtureItemOpens,2);assert.equal(dom.window.fixtureItemAdds,2);
  assert.equal(dom.window.fixtureSubmissions,0);assert.equal(dom.window.fixtureCustomerAdds,0);
  assert.equal(d.querySelector('[aria-label="Country code"]').value,'+254');
  assert.equal(d.querySelector('[type=email]').value,'test@example.test');
  assert.match(d.querySelector('#customer-choice').textContent,/KRA-resolved fixture buyer/);
  assert.equal(d.querySelector('[name="note "]').value,'Existing cashier note\nPOS Receipt: POS-TEST-1');
  assert.match(d.body.textContent,/Fixture terms retained/);
  assert.deepEqual((await a.fillSale(s,{timeout:250})).filter(r=>r.status==='failed'),[]);
  assert.equal(dom.window.fixtureItemAdds,2);assert.equal(dom.window.fixtureSubmissions,0);
  dom.window.close();
});

test('fixed discounts and percentage rounding preserve exact invoice cents in item popups',async()=>{
  const dom=vueDom(),a=adapter(dom.window.document),s=snap();
  s.items=[1,2].map(i=>({name:'Fixture '+i,description:'',quantity:1,unit_price_cents:105,line_total_cents:105}));
  s.subtotal_cents=210;s.discount={type:'percent',value:10,amount_cents:21};s.total_cents=189;
  assert.deepEqual(lineDiscounts(s).map(d=>d.amount_cents),[11,10]);
  assert.ok(lineDiscounts(s).every(d=>d.type==='fixed'));
  assert.deepEqual((await a.fillSale(s,{timeout:300})).filter(r=>r.status==='failed'),[]);
  assert.equal(dom.window.fixtureItems.reduce((sum,i)=>sum+i.total,0),189);
  assert.equal(dom.window.fixtureItems[0].description,'Fixture 1');
  s.discount={type:'fixed',value:0.31,amount_cents:31};
  assert.deepEqual(lineDiscounts(s).map(d=>d.amount_cents),[16,15]);
  dom.window.close();
});

test('new PIN uses the real customer validation dialog, never manually supplies a name',async()=>{
  const dom=vueDom(),a=adapter(dom.window.document),s=snap();s.customer.pin='P222222222D';
  const report=await a.fillSale(s,{timeout:300});
  assert.deepEqual(report.filter(r=>r.status==='failed'),[]);
  assert.equal(dom.window.fixtureValidations,1);assert.equal(dom.window.fixtureCustomerAdds,1);
  assert.match(dom.window.document.querySelector('#customer-choice').textContent,/KRA-resolved new fixture buyer/);
  assert.equal(dom.window.fixtureSubmissions,0);assert.deepEqual(a.verify(s),[]);
  dom.window.close();
});

test('missing required customer email pauses in validation dialog without invented data',async()=>{
  const dom=vueDom(),a=adapter(dom.window.document),s=snap();s.customer.pin='A222222222D';s.customer.email='';
  const report=await a.fillSale(s,{timeout:200});
  assert.ok(report.some(r=>r.field==='New customer email' && r.status==='failed'));
  assert.equal(dom.window.fixtureCustomerAdds,0);assert.equal(dom.window.fixtureItemOpens,0);assert.equal(dom.window.fixtureSubmissions,0);
  assert.ok(dom.window.document.querySelector('[role=dialog]'));dom.window.close();
});

test('ambiguous or unavailable payment options are reported without guessing accounts',async()=>{
  for (const method of ['mpesa','cash']) {
    const dom=vueDom(),a=adapter(dom.window.document),s=snap();s.payment_method=method;
    dom.window.document.getElementById('selected-payment').textContent='Card';
    const report=await a.fillSale(s,{timeout:200});
    assert.ok(report.some(r=>r.field==='Payment option' && r.status==='failed'));
    assert.equal(dom.window.document.getElementById('selected-payment').textContent,'Card');
    assert.equal(dom.window.fixtureSubmissions,0);dom.window.close();
  }
});

test('missing item control or unconfirmed Add stops safely and reports specific failure',async()=>{
  const missing=vueDom(),ma=adapter(missing.window.document,{item_price:'#not-present'});
  const report=await ma.fillSale(snap(),{timeout:150});
  assert.ok(report.some(r=>r.field.endsWith('price') && r.status==='failed'));
  assert.equal(missing.window.fixtureItemAdds,0);assert.equal(missing.window.fixtureSubmissions,0);missing.window.close();
  const lost=vueDom(),la=adapter(lost.window.document);lost.window.fixtureLoseAddConfirmation=true;
  const result=await la.fillSale(snap(),{timeout:180});
  assert.ok(result.some(r=>r.field.endsWith('added') && r.status==='failed'));
  assert.equal(lost.window.fixtureItemAdds,1);
  await la.fillSale(snap(),{timeout:100});assert.equal(lost.window.fixtureItemAdds,1);assert.equal(lost.window.fixtureItemOpens,1);
  lost.window.close();
});

test('another receipt cannot overwrite a populated KRA form and late item confirmation is reconciled',async()=>{
  const dom=vueDom(),d=dom.window.document,a=adapter(d),s=snap();
  await a.fillSale(s,{timeout:250});
  const other=structuredClone(s);other.receipt_no='POS-OTHER';other.customer.email='other@example.test';
  const report=await a.fillSale(other,{timeout:200});
  assert.ok(report.some(r=>r.field==='POS receipt reference' && r.status==='failed'));
  assert.equal(d.querySelector('input[type=email]').value,s.customer.email);
  assert.equal(dom.window.fixtureItemAdds,1);dom.window.close();

  const late=vueDom(),la=adapter(late.window.document);late.window.fixtureLoseAddConfirmation=true;
  await la.fillSale(s,{timeout:150});assert.equal(late.window.fixtureItemAdds,1);
  const item=s.items[0],discount=lineDiscounts(s)[0];
  late.window.fixtureItems.push({name:item.name,description:item.description,quantity:item.quantity,price:item.unit_price_cents,total:item.line_total_cents-discount.amount_cents,discount:discount.amount_cents});
  late.window.document.querySelector('[role=dialog]').remove();late.window.fixtureTable();
  assert.deepEqual((await la.fillSale(s,{timeout:250})).filter(r=>r.status==='failed'),[]);
  assert.equal(late.window.fixtureItemAdds,1);assert.equal(late.window.fixtureSubmissions,0);late.window.close();
});

test('KRA worker permits official portal redirects and configured URLs but rejects other origins',async()=>{
  const sites=require('../../chrome-extension/portal-sites');
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../../chrome-extension/manifest.json'),'utf8'));
  for (const origin of sites.origins) assert.ok(manifest.content_scripts[1].matches.includes(origin+'/*'));
  assert.equal(sites.allowed('https://etims.kra.go.ke/invoice/new'),true);
  for (const url of ['http://ecitizen.kra.go.ke/x','https://ecitizen.kra.go.ke.evil.test/x','https://evil.test','https://user:secret@ecitizen.kra.go.ke']) assert.equal(sites.allowed(url),false);
  const w=worker({portalUrls:{create:'https://etims.kra.go.ke/actual-invoice-route'}}),r=record();
  assert.equal((await w.send('start',{record:r})).result.opened,true);
  assert.equal(w.tabs.get(41).url,'https://etims.kra.go.ke/actual-invoice-route');
  for (const origin of sites.origins) {
    const sender={url:origin+'/actual/invoice/new',frameId:0,tab:{id:41}};
    assert.equal((await w.send('job',{},sender,'portal')).result.record.id,r.id);
    assert.ok((await w.send('job',{}, {...sender,frameId:1},'portal')).error);
  }
  assert.ok((await w.send('job',{}, {url:'https://ecitizen.kra.go.ke.evil.test/',frameId:0,tab:{id:41}},'portal')).error);
  assert.equal((await w.send('job',{}, {url:'https://etims.kra.go.ke/',frameId:0,tab:{id:999}},'portal')).result,null);
  const bad=worker({portalUrls:{create:'https://evil.test'}});
  assert.ok((await bad.send('start',{record:r})).error);assert.equal(bad.tabs.size,0);
});

test('ambiguous customer phone does not select or create an arbitrary customer',async()=>{
  const dom=vueDom(),a=adapter(dom.window.document),s=snap();s.customer.pin='';
  dom.window.document.querySelectorAll('#customer-menu button p:nth-child(2)').forEach(p=>p.textContent='+254712345678');
  const report=await a.fillSale(s,{timeout:200});
  assert.ok(report.some(r=>r.field==='Customer selection' && r.status==='failed' && /Multiple/.test(r.detail)));
  assert.ok(dom.window.document.getElementById('customer-toggle'));
  assert.equal(dom.window.fixtureCustomerAdds,0);assert.equal(dom.window.fixtureSubmissions,0);
  dom.window.close();
});


test('background activity alarm persists the opt-in, targets only allowed live tabs and stops when disabled',async()=>{
  const tabs=new Map([
    [41,{id:41,url:'https://ecitizen.kra.go.ke/individual/etims/sale/create'}],
    [42,{id:42,url:'https://evil.test/'}],
    [43,{id:43,url:'https://etims.kra.go.ke/',discarded:true}]
  ]);
  const w=worker({oraforgeScrollKeepAliveEnabled:true},tabs);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(w.alarms.get('oraforge_activity_tick').periodInMinutes,1);
  await w.alarm();assert.deepEqual(w.messages,[{id:41,action:'oraforge_activity_tick'}]);
  w.change(false);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(w.alarms.size,0);await w.alarm();assert.equal(w.messages.length,1);
  w.change(true);await new Promise(resolve=>setImmediate(resolve));assert.equal(w.alarms.size,1);
});
