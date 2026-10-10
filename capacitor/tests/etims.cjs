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

function worker(storage={}) {
  let listener, tabId=40;const tabs=new Map();
  const chrome={storage:{local:{get:async k=>({[k]:structuredClone(storage[k])}),set:async value=>Object.assign(storage,structuredClone(value))}},
    runtime:{onMessage:{addListener:fn=>listener=fn}},
    tabs:{get:async id=>{if(!tabs.has(id))throw Error('No tab');return tabs.get(id);},remove:async id=>tabs.delete(id),update:async()=>{},sendMessage:async()=>{}},
    windows:{create:async options=>{const tab={id:++tabId,windowId:10,url:options.url};tabs.set(tab.id,tab);return {id:10,tabs:[tab]};},update:async()=>{}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../chrome-extension/background.js'),'utf8'),{chrome,URL,console,crypto:crypto.webcrypto,TextEncoder});
  const pos={url:'http://localhost:3000/pos',frameId:0,tab:{id:2}};
  const send=(action,data={},sender=pos,role='pos')=>new Promise(resolve=>listener({action,data,role},sender,resolve));
  return {send,storage,tabs,pos};
}
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
  const panel=dom.window.document.querySelector('[data-oraforge-companion]').shadowRoot;
  panel.querySelector('[data-review]').checked=true;panel.querySelector('[data-arm]').click();
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(dom.window.fixtureSubmissions,0);
  dom.window.close();
});
