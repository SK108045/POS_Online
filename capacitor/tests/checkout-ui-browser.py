"""Rendered checkout -> isolated local persistence -> fixture helper -> receipt.

Every helper route is intercepted. No genuine sale, payment or fiscal issuance.
"""
import json
import os
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
base=os.environ.get('POS_TEST_URL','http://127.0.0.1:3000')
output=os.environ.get('ORAFORGE_UI_TEST_OUTPUT')
source=(ROOT/'capacitor/www/app.js').read_text(encoding='utf-8')
def function(name):
    match=re.search(r'^(?:async )?function '+name+r'\(',source,re.M)
    assert match,name
    following=re.search(r'\n(?:async )?function ',source[match.end():])
    return source[match.start():match.end()+following.start()] if following else source[match.start():]

print('CHECK: starting isolated browser driver.',flush=True)
with sync_playwright() as p:
    print('CHECK: browser driver ready; opening isolated headless browser.',flush=True)
    browser=p.chromium.launch(channel='msedge' if os.name=='nt' else 'chrome',headless=True,timeout=20000,args=['--no-proxy-server'])
    page=browser.new_page(viewport={'width':1366,'height':768})
    page.set_default_timeout(30000)
    def choose(selector,value):
        page.locator(selector).evaluate("(e,value)=>{e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));}",value)
    def check(selector):
        page.locator(selector).evaluate("e=>{e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));}")
    def click(selector):
        page.locator(selector).evaluate('e=>e.click()')
    calls=[];jobs={};preflights=0;errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    def route(request):
        global preflights
        path=request.request.url.split('/api/etims',1)[1]
        body=request.request.post_data_json if request.request.method=='POST' else {}
        calls.append((request.request.method,path,body))
        if path=='/health': result={'app':'oraforge-etims-helper','version':2}
        elif path=='/preflight':
            preflights+=1
            if preflights==1:
                result={'ready':False,'requirements':[{'product_key':'catalog:7','name':'Fixture Book','missing':['class_code','verified']}],
                        'classes':[{'ITEM_CLS_CD':str(10000+i),'ITEM_CLS_NM':'Fixture '+str(i)} for i in range(350)]+
                                  [{'ITEM_CLS_CD':'60102300','ITEM_CLS_NM':'Reading books'}]}
            else:result={'ready':True,'requirements':[]}
        elif path=='/jobs':
            import hashlib
            sale=body['sale'];key=hashlib.sha256(json.dumps([sale['shop_id'],sale['sale_id'],sale['receipt_no']],separators=(',',':')).encode()).hexdigest()
            jobs[key]={'id':key,'state':'native_product_import_requested','error':None,'result':None};result=jobs[key]
        elif path.startswith('/jobs/'):result=jobs[path.split('/')[2]]
        else:raise AssertionError('Unexpected helper route: '+path)
        request.fulfill(status=200,content_type='application/json',body=json.dumps(result))
    page.route('**/api/**',lambda request:route(request) if '/api/etims/' in request.request.url else request.abort())
    page.route(base+'/readonly-fixture',lambda request:request.fulfill(status=200,content_type='text/html',body='<html><body></body></html>'))
    page.goto(base+'/readonly-fixture',wait_until='domcontentloaded')
    print('CHECK: isolated fixture page ready.',flush=True)
    page.add_style_tag(path=str(ROOT/'capacitor/www/styles.css'))
    page.add_style_tag(path=str(ROOT/'capacitor/www/form-controls.css'))
    page.add_style_tag(path=str(ROOT/'capacitor/www/etims-integration.css'))
    page.add_script_tag(content='''window.fixtureRows={};window.printCalls=0;window.payCalls=0;window.print=()=>window.printCalls++;
      window.OraforgeDBReady=Promise.resolve();window.OraforgeShops={activeShopId:()=>"fixture"};
      window.OraforgeDB={get:async(k,f)=>structuredClone(fixtureRows[k]??f),update:async(k,fn,f)=>{const v=fn(structuredClone(fixtureRows[k]??f));fixtureRows[k]=v;return v;}};
      window.toast=()=>{};window.hasCap=()=>false;window.LOCAL_PROFILES_DATA={profiles:{fixture:{}}};
      const state={settings:{business_name:'Fixture Shop',receipt_footer:'Fixture footer'},items:[],categories:[{id:1,name:'Books'},{id:2,name:'Tools'}],profile:{id:'retail'}};
      window.renderTicket=()=>{};''')
    for name in ['form-controls.js','etims-core.js','etims-integration.js']:
        page.add_script_tag(path=str(ROOT/'capacitor/www'/name))
    page.add_script_tag(content=source[:source.index('// ── UI Utilities')])
    page.add_script_tag(content=function('tracksStock'))
    page.add_script_tag(content=source[source.index('const LocalPOS ='):source.index('async function api(')])
    page.add_script_tag(content='''LocalPOS.init=async()=> 'fixture';
      LocalPOS.getShop=async(k,f)=>structuredClone(fixtureRows['shop:fixture:'+k]??f);
      LocalPOS.setShop=async(k,v)=>{fixtureRows['shop:fixture:'+k]=structuredClone(v);};
      LocalPOS.saveOrders=async orders=>LocalPOS.setShop('orders',orders);
      window.api=async(path,options)=>{if(path==='/api/order/pay')window.payCalls++;return LocalPOS.handle(path,options);};
      window.openFixture=async id=>{
        const order={id,ticket_no:'FIXTURE-'+id,status:'open',subtotal_cents:116000,total_cents:116000,tax_cents:0,discount_cents:0,
          items:[{menu_item_id:7,name:'Fixture Book',qty:1,unit_price_cents:116000,line_total_cents:116000}]};
        state.order=order;state.items=[{id:7,name:'Fixture Book',unit:'pcs',stock_qty:20,cost_cents:10000}];
        fixtureRows['shop:fixture:orders']=[order];fixtureRows['shop:fixture:items']=structuredClone(state.items);
        await showCheckoutModal(order);
      };''')
    for name in ['normalizeMpesaPhone','formatMpesaDisplayPhone','getVerifiedSwiftaStatus','triggerSwiftaMpesaCharge','showCheckoutModal','showProductModal']:
        page.add_script_tag(content=function(name))

    page.evaluate('openFixture(101)')
    print('CHECK: checkout DOM '+str(page.locator('#checkoutMethod').count())+'; browser errors '+str(errors),flush=True)
    choose('#checkoutMethod','cash');choose('#checkoutTaxRate','16')
    immediate=page.evaluate('''()=>{const b=document.querySelector('#chkConfirm');b.click();b.dispatchEvent(new MouseEvent('click'));
      return {disabled:b.disabled,busy:b.getAttribute('aria-busy'),spinner:!!b.querySelector('.pos-spinner-ring'),message:document.querySelector('#checkoutMsg').textContent};}''')
    assert immediate['disabled'] and immediate['busy']=='true' and immediate['spinner'] and 'payment' in immediate['message']
    page.wait_for_selector('#receiptModal')
    receipt=page.locator('.sales-receipt').inner_text()
    for text in ['VAT (16%)','VAT Total (16%)','160.00','1000.00','1160.00']:assert text in receipt,text
    assert page.evaluate('window.payCalls')==1
    assert page.evaluate("fixtureRows['shop:fixture:orders'][0].tax_cents")==16000
    assert page.evaluate("fixtureRows['shop:fixture:items'][0].stock_qty")==19
    print('PASS: click feedback is synchronous; duplicate tap blocked; VAT saved inclusive and printed correctly.')

    page.evaluate("state.settings.tax_rate=0;state.settings.tax_rate_confirmed=true;showReceiptModal(fixtureRows['shop:fixture:orders'][0])")
    assert 'VAT Total (16%)' in page.locator('.sales-receipt').inner_text()
    click('#receiptModalClose')
    print('CHECK: starting Non-VAT fiscal checkout fixture.',flush=True)
    page.evaluate('()=>{state.settings.tax_rate=16;return openFixture(102);}');choose('#checkoutMethod','cash')
    choose('#checkoutTaxRate','16');check('#generateEtims')
    print('CHECK: VAT fiscal choice explained and blocked.',flush=True)
    assert page.locator('#chkConfirm').is_disabled()
    assert 'unavailable on this device' in page.locator('#checkoutTaxNotice').inner_text()
    assert preflights==0
    choose('#checkoutTaxRate','0')
    print('CHECK: switched checkout to Non-VAT.',flush=True)
    page.evaluate("()=>{document.querySelector('#etimsName').value='Fixture Buyer';document.querySelector('#etimsPin').value='A123456789B';}")
    page.evaluate('''()=>{window.realBeforePayment=OraforgeEtims.beforePayment;
      OraforgeEtims.beforePayment=async(...args)=>{await new Promise(resolve=>window.releasePreflight=resolve);return realBeforePayment(...args);};}''')
    click('#chkConfirm')
    print('CHECK: fiscal confirmation pressed.',flush=True)
    page.wait_for_function('Boolean(window.releasePreflight)')
    print('CHECK: deliberately delayed preflight entered.',flush=True)
    assert page.locator('#chkConfirm .pos-spinner-ring').count()==1
    assert page.locator('#chkCancel').is_disabled() and page.locator('#checkoutMethod').is_disabled()
    assert 'Checking eTIMS products and stock' in page.locator('#checkoutMsg').inner_text()
    bounds=page.locator('#chkConfirm').bounding_box()
    assert bounds and bounds['y']>=0 and bounds['y']+bounds['height']<=768
    if output:
        Path(output).mkdir(parents=True,exist_ok=True)
        # Optional visual artifact must not block the functional workflow.
        page.wait_for_timeout(200)
        try:
            page.screenshot(path=str(Path(output)/'checkout-immediate-loading.png'),timeout=5000)
        except Exception as error:
            print('CHECK: optional screenshot unavailable ('+type(error).__name__+').',flush=True)
    page.evaluate('releasePreflight()')
    print('CHECK: released preflight; waiting for searchable classification.',flush=True)
    page.wait_for_selector('[data-class-search]')
    search=page.get_by_role('searchbox',name='Search classifications by name or code')
    search.evaluate("e=>{e.value='reading 6010';e.dispatchEvent(new Event('input',{bubbles:true}));}")
    assert page.locator('[data-class-search] option').count()==2
    choose('[data-class-search]','60102300');check('[name="0:verified"]')
    page.get_by_role('button',name='Confirm details',exact=True).evaluate('e=>e.click()')
    page.wait_for_function("document.querySelector('.receipt-etims')?.textContent.includes('native product import requested')")
    assert page.locator('#receiptPrintBtn').is_disabled()
    assert page.evaluate('window.payCalls')==2
    assert len([call for call in calls if call[:2]==('POST','/jobs')])==1
    assert 'Non-VAT' in page.locator('.sales-receipt').inner_text()
    assert page.evaluate("fixtureRows['shop:fixture:orders'][0].tax_cents")==0
    assert calls[1][2]['details']['catalog:7']['class_code']=='60102300'
    print('PASS: searchable missing-product classification reaches the same Non-VAT sale and one helper job.')

    qr='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1EAAAAASUVORK5CYII='
    job=next(iter(jobs.values()));job.update(state='complete',result={'total_cents':116000,
      'fiscal':{'cu_invoice_number':'FIXTURE-CU/102','scu_id':'FIXTURE-SCU','receipt_signature':'FIXTURE-SIGN','invoice_number':'102',
                'invoice_date':'2026-10-13','qr_image':qr,'local_issuance_status':'issued','kra_acceptance_status':'unverified'}})
    page.evaluate('OraforgeEtims.sync()');page.wait_for_function('window.printCalls===1')
    assert page.locator('.receipt-kra-qr').get_attribute('src')==qr
    for value in ['FIXTURE-CU/102','FIXTURE-SIGN','KRA upload unverified']:assert value in page.locator('.sales-receipt').inner_text()
    page.evaluate('OraforgeEtims.sync()');assert page.evaluate('window.printCalls')==1
    click('#receiptModalClose')
    page.evaluate('openFixture(103)');choose('#checkoutMethod','cash');choose('#checkoutTaxRate','0');check('#generateEtims')
    page.evaluate("()=>{document.querySelector('#etimsName').value='Fixture Buyer';document.querySelector('#etimsPin').value='A123456789B';}")
    page.evaluate("()=>{OraforgeEtims.beforePayment=async()=>{throw Error('Fixture preflight error');};}")
    click('#chkConfirm');page.wait_for_function("document.querySelector('#checkoutMsg').textContent==='Fixture preflight error'")
    assert page.locator('#chkConfirm').is_enabled() and page.locator('#chkCancel').is_enabled()
    assert page.locator('#chkConfirm').get_attribute('aria-busy')=='false'
    assert page.evaluate('window.payCalls')==2
    click('#chkCancel')
    page.evaluate('showProductModal()')
    page.get_by_role('searchbox',name='Search product categories').evaluate("e=>{e.value='tool';e.dispatchEvent(new Event('input',{bubbles:true}));}")
    choose('[name=category_id]','2')
    assert page.locator('[name=category_id]').input_value()=='2'
    click('#pmCancel')
    assert errors==[],errors
    print('PASS: original fixture QR/fiscal fields reach final receipt once; errors unlock checkout; new-product category search works.')
    browser.close()
