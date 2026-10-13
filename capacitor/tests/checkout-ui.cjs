const {test}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {searchableSelect}=require('../www/form-controls');
const core=require('../www/etims-core');

test('classification search finds name/code without changing a confirmed selection',()=>{
  const dom=new JSDOM('<form><select name="class" required><option value="">Choose</option></select></form>');
  const select=dom.window.document.querySelector('select');
  const choices=Array.from({length:400},(_,i)=>({value:String(10000+i),label:'Fixture '+i}));
  choices.push({value:'60102300',label:'Reading Bóoks <script>alert(1)</script>'});
  const input=searchableSelect(select,choices,'classification');
  assert.equal(select.value,'');assert.equal(select.options.length,151);
  input.value='books 6010';input.dispatchEvent(new dom.window.Event('input'));
  assert.equal(select.options.length,2);assert.equal(select.value,'');
  assert.equal(dom.window.document.querySelectorAll('script').length,0);
  select.value='60102300';select.dispatchEvent(new dom.window.Event('change'));
  input.value='no matches';input.dispatchEvent(new dom.window.Event('input'));
  assert.equal(select.value,'60102300');
  assert.match(dom.window.document.querySelector('[role=status]').textContent,/No matches/);
  assert.equal(new dom.window.FormData(dom.window.document.querySelector('form')).get('class'),'60102300');
  dom.window.close();
});

test('category search preserves the existing product category and Enter does not submit',()=>{
  const dom=new JSDOM('<form><select name="category"><option value="1">Books</option><option value="2" selected>Tools</option></select></form>');
  const select=dom.window.document.querySelector('select'), input=searchableSelect(select,null,'categories');
  input.value='book';input.dispatchEvent(new dom.window.Event('input'));
  assert.equal(select.value,'2');
  const event=new dom.window.KeyboardEvent('keydown',{key:'Enter',cancelable:true});input.dispatchEvent(event);
  assert.equal(event.defaultPrevented,true);assert.equal(dom.window.document.activeElement,select);
  assert.equal(searchableSelect(select,null),undefined);
  dom.window.close();
});

test('Admin product modal searches and saves a category code; staff modal still opens',async()=>{
  const dom=new JSDOM('<body></body>',{runScripts:'outside-only',url:'http://fixture.invalid'});
  const ctx=dom.getInternalVMContext(),source=fs.readFileSync(path.join(__dirname,'../www/admin.js'),'utf8');
  let saved;
  Object.assign(ctx,{state:{menu:{categories:[{id:1,name:'Books'},{id:2,name:'Tools'}],items:[]},profile:{id:'retail'}},
    OraforgeFormControls:{searchableSelect},toast:()=>{},buildMenu:()=>{},
    api:async(path,options)=>{saved=options.body;return {categories:[],items:[]};}});
  for(const name of ['openModal','openItemModal','openUserModal']) {
    const start=source.indexOf('function '+name+'('),next=source.slice(start+9).search(/\n(?:async )?function /);
    vm.runInContext(source.slice(start,start+9+next),ctx);
  }
  ctx.openItemModal(null);
  const doc=dom.window.document,input=doc.querySelector('[type=search]'),select=doc.querySelector('#mCat');
  assert.ok(input);input.value='tool';input.dispatchEvent(new dom.window.Event('input'));
  select.value='2';select.dispatchEvent(new dom.window.Event('change'));
  doc.querySelector('#mName').value='Fixture Product';doc.querySelector('#mPrice').value='100';
  await doc.querySelector('#mSave').onclick();
  assert.equal(saved.category_id,'2');assert.equal(doc.querySelector('.modal-overlay'),null);
  ctx.openUserModal(null);
  assert.ok(doc.querySelector('#mUsername'));assert.equal(doc.querySelector('[type=search]'),null);
  doc.querySelector('#mCancel').click();dom.window.close();
});

function fixture(settings={}) {
  const order={id:1,ticket_no:'FIXTURE-1',status:'open',items:[{menu_item_id:7,qty:1,name:'Fixture',unit_price_cents:116000,line_total_cents:116000}],subtotal_cents:116000,total_cents:116000};
  const rows={orders:[order],items:[{id:7,unit:'pcs',stock_qty:5}],customers:[],settings};
  const ctx={window:{},console,URL,localStorage:{getItem:()=>null},LOCAL_PROFILES_DATA:{profiles:{retail:{}}},tracksStock:p=>p&&p.unit!=='service'};
  const source=fs.readFileSync(path.join(__dirname,'../www/app.js'),'utf8');
  vm.runInNewContext(source.slice(source.indexOf('const LocalPOS ='),source.indexOf('async function api('))+'\nwindow.local=LocalPOS;',ctx);
  const local=ctx.window.local;local.init=async()=> 'retail';local.getShop=async(key,fallback)=>rows[key]??fallback;
  local.saveOrders=async orders=>{rows.orders=orders;};local.setShop=async(key,value)=>{rows[key]=value;};
  return {local,rows,order};
}

test('explicit VAT is inclusive, persisted, and an identical payment cannot decrement stock twice',async()=>{
  const {local,rows}=fixture();
  const body={order_id:1,payment_method:'cash',tax_rate:16};
  const paid=await local.handle('/api/order/pay',{method:'POST',body});
  assert.equal(paid.tax_rate,16);assert.equal(paid.tax_cents,16000);assert.equal(paid.total_cents,116000);
  assert.equal(paid.tax_treatment,'vat');assert.equal(paid.tax_inclusive,true);assert.equal(rows.items[0].stock_qty,4);
  await local.handle('/api/order/pay',{method:'POST',body:{...body,tax_rate:0}});
  assert.equal(rows.orders[0].tax_cents,16000);assert.equal(rows.items[0].stock_qty,4);
});

test('explicit Non-VAT overrides the shop default for this sale only',async()=>{
  const {local,rows}=fixture({tax_rate:16,tax_rate_confirmed:true});
  const paid=await local.handle('/api/order/pay',{method:'POST',body:{order_id:1,payment_method:'cash',tax_rate:0}});
  assert.equal(paid.tax_rate,0);assert.equal(paid.tax_cents,0);assert.equal(paid.tax_treatment,'non_vat');
  assert.equal(rows.settings.tax_rate,16);assert.equal(paid.total_cents,116000);
});

test('invalid tax and unsupported VAT fiscal requests fail before saving payment or stock',async()=>{
  for(const tax of [-1,14,17,NaN]) {
    const {local,rows}=fixture();
    await assert.rejects(local.handle('/api/order/pay',{method:'POST',body:{order_id:1,payment_method:'cash',tax_rate:tax}}),/VAT/);
    assert.equal(rows.orders[0].status,'open');assert.equal(rows.items[0].stock_qty,5);
  }
  const {local,rows}=fixture();
  await assert.rejects(local.handle('/api/order/pay',{method:'POST',body:{order_id:1,payment_method:'cash',tax_rate:16,generate_etims:true,etims_shop_id:'retail'}}),/VAT/);
  assert.equal(rows.orders[0].status,'open');assert.equal(rows.items[0].stock_qty,5);
});

test('rounding a tiny VAT amount to zero cannot silently issue a Non-VAT fiscal invoice',()=>{
  const order={id:1,ticket_no:'FIXTURE-1',status:'paid',subtotal_cents:1,total_cents:1,tax_cents:0,tax_rate:16,discount_cents:0,payment_method:'cash',
    items:[{name:'Fixture',qty:1,unit_price_cents:1,line_total_cents:1}]};
  assert.throws(()=>core.windowsSnapshot(order,'fixture',{}, {name:'Fixture Buyer',pin:'A123456789B'}),/Non-VAT/);
});

test('checkout paints busy immediately and proceeds even when Windows pauses browser frames',async()=>{
  const dom=new JSDOM('<body></body>',{runScripts:'outside-only'}),ctx=dom.getInternalVMContext();
  const source=fs.readFileSync(path.join(__dirname,'../www/app.js'),'utf8');
  const start=source.indexOf('async function showCheckoutModal('),tail=source.slice(start+20).search(/\n(?:async )?function /);
  let payCalls=0,printed=0,resolvePay;
  Object.assign(ctx,{state:{settings:{},items:[],order:{}},money:n=>'KES '+(n/100).toFixed(2),receiptEscape:String,
    requestAnimationFrame:()=>0,renderTicket:()=>{},showReceiptModal:()=>printed++,
    api:async()=>{payCalls++;return new Promise(resolve=>{resolvePay=resolve;});}});
  vm.runInContext(source.slice(start,start+20+tail),ctx);
  await ctx.showCheckoutModal({id:1,ticket_no:'FIXTURE-1',total_cents:116000});
  const doc=dom.window.document,method=doc.querySelector('#checkoutMethod'),button=doc.querySelector('#chkConfirm');
  method.value='cash';method.dispatchEvent(new dom.window.Event('change'));
  button.click();button.dispatchEvent(new dom.window.MouseEvent('click'));
  assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-busy'),'true');
  assert.equal(button.querySelectorAll('.pos-spinner-ring').length,1);assert.equal(doc.querySelector('#chkCancel').disabled,true);
  assert.equal(payCalls,0);
  await new Promise(resolve=>setTimeout(resolve,110));
  assert.equal(payCalls,1);
  resolvePay({id:1,status:'paid'});await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(printed,1);assert.equal(doc.querySelector('#chkConfirm'),null);
  dom.window.close();
});
