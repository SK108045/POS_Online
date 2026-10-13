const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../www/etims-core');
const proxy=require('../etims-windows');
const order=()=>({id:4,ticket_no:'FIXTURE-4',status:'paid',subtotal_cents:30000,total_cents:30000,tax_cents:0,discount_cents:0,
  payment_method:'cash',items:[{menu_item_id:7,name:'Fixture Item',qty:2,unit_price_cents:15000,line_total_cents:30000,
    etims_registration:{class_code:'60102300'},etims_inventory:{inventory_before_sale:8,inventory_confirmed:true}}]});
const buyer={pin:'A123456789B',name:'Fixture Buyer'};
test('Windows snapshot requires buyer identity and preserves product/stock/cents',()=>{
  const s=core.windowsSnapshot(order(),'shop',{},buyer);
  assert.equal(s.version,2);assert.equal(s.items[0].product_key,'catalog:7');assert.equal(s.total_cents,30000);
  assert.equal(s.items[0].inventory.inventory_before_sale,8);assert.equal(s.items[0].registration.class_code,'60102300');
  assert.throws(()=>core.windowsSnapshot(order(),'shop',{},{}),/PIN and name/);
});
test('Windows snapshot preserves manual item identity and variant identity',()=>{
  const o=order();o.items[0].menu_item_id=null;o.items[0].variant_info='Large';
  const s=core.windowsSnapshot(o,'shop',{},buyer);assert.equal(s.items[0].product_key,'manual:fixture item|variant:Large');
});
test('unsupported tax never silently becomes a NonVAT invoice',()=>{
  assert.throws(()=>core.windowsSnapshot({...order(),tax_cents:100},'shop',{},buyer),/Non-VAT/);
});
test('Windows capture requires all six fields, matching attempt and total',()=>{
  const snapshot=core.windowsSnapshot(order(),'shop',{},buyer);
  const r={status:'review_required',attempt_id:'same',digest:'same-digest',snapshot};
  const fiscal={cu_invoice_number:'FIXTURE-CU/4',scu_id:'FIXTURE-SCU',receipt_signature:'FIXTURE-SIGN',invoice_number:'4',invoice_date:'2026-10-13',qr_image:'data:image/png;base64,AAAA',local_issuance_status:'issued',kra_acceptance_status:'unverified'};
  const a={type:'capture',source:'windows',fiscal,attempt_id:'same',digest:'same-digest',total_cents:30000};
  const next=core.transition(r,a,'now');assert.equal(next.status,'generated');assert.equal(next.fiscal.kra_acceptance_status,'unverified');
  assert.match(core.receipt(next),/KRA upload unverified/);assert.match(core.receipt(next),/Official KRA QR code/);
  for(const changed of [{total_cents:30001},{attempt_id:'other'},{fiscal:{...fiscal,qr_image:''}},{fiscal:{...fiscal,local_issuance_status:'pending'}}])assert.throws(()=>core.transition(r,{...a,...changed},'now'));
  assert.throws(()=>core.transition(next,{type:'start'},'now'),/Duplicate/);
});
test('helper proxy rejects network clients, foreign origins and DNS rebinding hosts',()=>{
  const req={socket:{remoteAddress:'127.0.0.1'},headers:{host:'localhost:3000',origin:'http://localhost:3000'}};
  assert.equal(proxy.local(req),true);
  for(const changed of [{socket:{remoteAddress:'192.168.1.2'},headers:req.headers},{socket:req.socket,headers:{host:'evil.example:3000'}},{socket:req.socket,headers:{...req.headers,origin:'http://evil.example'}},{socket:req.socket,headers:{...req.headers,'sec-fetch-site':'cross-site'}}])assert.equal(proxy.local(changed),false);
});

test('proxy detects an old helper even when it answers the correct app health check',async()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oraforge-helper-version-'));
  const previous=process.env.ORAFORGE_ETIMS_HOME;
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({app:'oraforge-etims-helper',version:2}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({port:server.address().port}));
    process.env.ORAFORGE_ETIMS_HOME=dir;
    await assert.rejects(proxy.ensure(),error=>error.code==='ETIMS_HELPER_MISMATCH' && /recover this same sale/.test(error.message));
  }finally{
    if(previous===undefined)delete process.env.ORAFORGE_ETIMS_HOME;else process.env.ORAFORGE_ETIMS_HOME=previous;
    await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('proxy verifies the running build and executable rather than the configured path alone',()=>{
  const path=require('node:path'),entry=path.resolve('fixture-runtime','OraforgeEtims.exe');
  const target={entry,mode:'frozen'};
  const health={app:'oraforge-etims-helper',version:2,build:proxy.HELPER_BUILD,runtime_mode:'frozen',runtime_entry:entry,runtime_executable:entry};
  assert.equal(proxy.verifyHealth(health,target),health);
  for(const changed of [{runtime_executable:path.resolve('older-runtime','OraforgeEtims.exe')},{runtime_entry:'wrong-entry'},{build:'old'},{runtime_mode:'source'}]){
    assert.throws(()=>proxy.verifyHealth({...health,...changed},target),error=>error.code==='ETIMS_HELPER_MISMATCH');
  }
});
test('pending receipt exposes helper progress without claiming KRA acceptance',()=>{
  const html=core.receipt({status:'review_required',helper_state:'native_product_import_requested',helper_error:'Review <script>'});
  assert.match(html,/native product import requested/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/accepted/);
});
test('custom POS items persist without a catalogue entry and preserve actual costs',async()=>{
  const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
  const source=fs.readFileSync(path.join(__dirname,'../www/app.js'),'utf8');
  const ctx={window:{},console,URL,localStorage:{getItem:()=>null},LOCAL_PROFILES_DATA:{profiles:{retail:{}}}};
  const body=source.slice(source.indexOf('const LocalPOS ='),source.indexOf('async function api('));
  vm.runInNewContext(body+'\nwindow.local=LocalPOS;',ctx);
  const db=ctx.window.local,original={id:1,status:'open',items:[],subtotal_cents:0,total_cents:0};
  db.init=async()=> 'retail';db.getShop=async key=>key==='orders'?[original]:[];db.saveOrders=async()=>{};
  const result=await db.handle('/api/order/add-manual',{method:'POST',body:{order_id:1,name:'Custom Fixture',sku:'fixture-sku',qty:2,unit_price_cents:15000,cost_cents:10000}});
  assert.equal(result.items[0].menu_item_id,null);assert.equal(result.items[0].etims_product_key,'manual:fixture-sku');
  assert.equal(result.items[0].cost_cents,10000);assert.equal(result.total_cents,30000);
});
