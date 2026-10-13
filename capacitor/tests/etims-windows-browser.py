"""Isolated browser integration regression. Helper routes are fixtures;
never sends a fiscal job to the native client. Run against the local POS server.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
base=os.environ.get('POS_TEST_URL','http://localhost:3000')
with sync_playwright() as p:
    browser=p.chromium.launch(channel='msedge' if os.name=='nt' else 'chrome',headless=True)
    page=browser.new_page();calls=[];jobs={}
    def route(request):
        path=request.request.url.split('/api/etims',1)[1]
        body=request.request.post_data_json if request.request.method=='POST' else {}
        calls.append((request.request.method,path,body))
        if path=='/health':result={'app':'oraforge-etims-helper','version':2}
        elif path=='/preflight':result={'ready':True,'requirements':[]}
        elif path=='/jobs':
            import hashlib
            sale=body['sale'];key=hashlib.sha256(json.dumps([sale['shop_id'],sale['sale_id'],sale['receipt_no']],separators=(',',':')).encode()).hexdigest()
            jobs[key]={'id':key,'state':'native_product_import_requested','error':None,'result':None};result=jobs[key]
        elif path.startswith('/jobs/'):result=jobs[path.split('/')[2]]
        else:raise AssertionError('Unexpected helper route')
        request.fulfill(status=200,content_type='application/json',body=json.dumps(result))
    page.route('**/api/etims/**',route)
    page.route(base+'/readonly-fixture',lambda r:r.fulfill(status=200,content_type='text/html',body='<html><body></body></html>'))
    # Establish an isolated origin without loading app authentication or data.
    page.goto(base+'/readonly-fixture')
    page.set_content('<div id="toastContainer"></div>')
    page.add_script_tag(content='''window.fixtureRows={};window.printCalls=0;window.print=()=>window.printCalls++;
      window.OraforgeDBReady=Promise.resolve();window.OraforgeShops={activeShopId:()=>"fixture"};
      window.OraforgeDB={get:async(k,f)=>structuredClone(window.fixtureRows[k] ?? f),update:async(k,fn,f)=>{const v=fn(structuredClone(window.fixtureRows[k] ?? f));window.fixtureRows[k]=v;return v;}};
      window.toast=()=>{};const state={settings:{business_name:'Fixture Shop',receipt_footer:'Fixture footer'}};''')
    page.add_script_tag(path=str(ROOT/'capacitor/www/etims-core.js'))
    page.add_script_tag(path=str(ROOT/'capacitor/www/etims-integration.js'))
    source=(ROOT/'capacitor/www/app.js').read_text(encoding='utf-8')
    page.add_script_tag(content=source[:source.index('// ── UI Utilities')])
    sale=page.evaluate('''async()=>{
      const o={id:8,ticket_no:'FIXTURE-8',status:'paid',subtotal_cents:30000,total_cents:30000,tax_cents:0,discount_cents:0,payment_method:'cash',
        etims_requested:true,etims_shop_id:'fixture',etims_customer:{name:'Fixture Buyer',pin:'A123456789B'},
        items:[{menu_item_id:7,name:'Fixture product',qty:2,unit_price_cents:15000,line_total_cents:30000,
          etims_registration:{class_code:'60102300'},etims_inventory:{inventory_before_sale:8,inventory_confirmed:true}}]};
      fixtureRows['shop:fixture:orders']=[o];showReceiptModal(o,false,true);
      await OraforgeEtims.afterPayment(o,{});return o;
    }''')
    page.wait_for_function("document.querySelector('.receipt-etims').textContent.includes('native product import requested')")
    assert page.locator('#receiptPrintBtn').is_disabled()
    assert page.evaluate('window.printCalls')==0
    assert len([c for c in calls if c[:2]==('POST','/jobs')])==1
    print('PASS: paid POS sale sent once; final print waits during registration')
    # Original QR fixture is a valid tiny PNG so image.decode is exercised.
    qr='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1EAAAAASUVORK5CYII='
    job=next(iter(jobs.values()));job.update(state='complete',result={'total_cents':30000,'local_issuance_status':'issued','kra_acceptance_status':'unverified',
      'fiscal':{'cu_invoice_number':'FIXTURE-CU/8','scu_id':'FIXTURE-SCU','receipt_signature':'FIXTURE-SIGN','invoice_number':'8','invoice_date':'2026-10-13',
                'qr_image':qr,'local_issuance_status':'issued','kra_acceptance_status':'unverified'}})
    page.evaluate('OraforgeEtims.sync()')
    page.wait_for_function('window.printCalls===1')
    html=page.locator('.receipt-modal-print-area').inner_text()
    for expected in ['Fixture product','300.00','FIXTURE-CU/8','FIXTURE-SCU','FIXTURE-SIGN','KRA upload unverified']:assert expected in html,expected
    assert page.locator('.receipt-kra-qr').get_attribute('src')==qr
    page.evaluate('OraforgeEtims.sync()');assert page.evaluate('window.printCalls')==1
    error=page.evaluate('''async()=>{try{await OraforgeEtims.start(JSON.stringify(['fixture',8,'FIXTURE-8']));return '';}catch(e){return e.message;}}''')
    assert 'Duplicate' in error
    print('PASS: six fields + original QR appear on full receipt, print opens once, duplicate issuance blocked')
    page.evaluate('''o=>{showReceiptModal(o);window.normal=structuredClone(o);normal.id=9;normal.ticket_no='FIXTURE-9';normal.etims_requested=false;showReceiptModal(normal);}''',sale)
    assert page.locator('#receiptPrintBtn').is_enabled()
    assert page.locator('.receipt-etims').count()==0
    print('PASS: ordinary non-fiscal receipt remains printable')
    browser.close()
