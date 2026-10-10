"""Optional Chrome UI regression test. Start the local POS on port 3099.
Requires Python Playwright and Google Chrome. KRA is routed to a synthetic fixture;
this test never contacts KRA or creates a real invoice. Uses an isolated profile.
"""
from playwright.sync_api import sync_playwright
from pathlib import Path
import json
import os
ROOT=Path(__file__).resolve().parents[2]
os.chdir(ROOT)
base=os.environ.get('POS_TEST_URL','http://localhost:3099')
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox'])
    ctx=browser.new_context()
    page=ctx.new_page()
    page.on('pageerror',lambda e:print('PAGE_ERROR',str(e)))
    page.on('dialog',lambda d:d.dismiss())
    page.goto(base+'/pos')
    page.evaluate("localStorage.setItem('pos_logged_in','true')")
    page.reload()
    page.wait_for_function('!!window.OraforgeEtims && state.items.length>0')
    sale=page.evaluate('''async()=>{
      await LocalPOS.setShop('settings',{business_name:'Fixture Shop',receipt_footer:'Fixture footer',tax_rate:0});
      const o=await api('/api/orders',{method:'POST',body:{order_type:'walk-in'}});
      await api('/api/order/add',{method:'POST',body:{order_id:o.id,menu_item_id:state.items[0].id,qty:2}});
      state.order=await api('/api/order?id='+o.id);renderTicket();return state.order;
    }''')
    page.locator('#checkoutBtn').click()
    page.locator('#checkoutMethod').select_option('cash')
    assert not page.locator('#generateEtims').is_checked()
    page.locator('#chkConfirm').click()
    page.locator('#receiptModal').wait_for()
    assert page.locator('.receipt-etims').count()==0
    assert page.evaluate("async () => (await OraforgeEtims.list()).length")==0
    print('PASS normal cash checkout unchanged, no fiscal record')
    page.locator('#receiptModalClose').click()
    sale=page.evaluate('''async()=>{
      const o=await api('/api/orders',{method:'POST',body:{order_type:'walk-in'}});
      await api('/api/order/add',{method:'POST',body:{order_id:o.id,menu_item_id:state.items[0].id,qty:2}});
      state.order=await api('/api/order/discount',{method:'POST',body:{order_id:o.id,type:'percent',value:10}});renderTicket();return state.order;
    }''')
    page.locator('#checkoutBtn').click()
    page.locator('#checkoutMethod').select_option('cash')
    page.locator('#generateEtims').check()
    page.locator('#etimsPin').fill('A123456789B')
    page.locator('#etimsEmail').fill('test@example.test')
    page.locator('#checkoutCustomerPhone').fill('0712345678')
    page.locator('#chkConfirm').click()
    page.wait_for_function("document.querySelector('.receipt-etims')?.textContent.includes('Pending')")
    assert page.evaluate('async () => (await OraforgeEtims.list())[0].snapshot.total_cents')==sale['total_cents']
    print('PASS opted checkout saved pending invoice and matching sale total')
    page.locator('.etims-manage-receipt').click()
    page.locator('[data-action=manual]').click()
    page.locator('[name=cu_invoice_number]').fill('TEST-MANUAL-CU/1')
    page.locator('form.etims-dialog button[type=submit]').click()
    page.wait_for_function("document.querySelector('.receipt-etims')?.textContent.includes('TEST-MANUAL-CU/1')")
    assert page.evaluate('async () => (await OraforgeEtims.list())[0].status')=='generated'
    print('PASS manual CU updates receipt and marks generated')
    page.locator('.etims-manage-receipt').click()
    assert page.locator('.etims-dialog [data-action=start]').count()==0
    page.locator('.etims-dialog [data-action=close]').click()
    page.goto(base+'/admin.html')
    page.locator('#adminPinInput').fill('1234');page.locator('#adminLoginBtn').click()
    page.locator('.nav-item[data-section=etims]').click()
    page.locator('[data-invoice-workspace] table').wait_for()
    assert 'TEST-MANUAL-CU/1' in page.locator('[data-invoice-workspace]').inner_text()
    assert page.locator('[data-invoice-workspace] [data-action=start]').count()==0
    page.locator('[data-action=reprint]').click()
    page.wait_for_function("document.querySelector('.receipt-etims')?.textContent.includes('TEST-MANUAL-CU/1')")
    page.screenshot(path='/tmp/etims-receipt.png',full_page=True)
    print('PASS admin generated list and branded receipt reprint')
    browser.close()

fixture=Path('capacitor/tests/fixtures/kra-portal.html').read_text()
snapshot={'version':1,'shop_id':'shop-test','sale_id':1,'receipt_no':'POS-TEST-1','seller_pin':'','customer':{'pin':'A123456789B','phone':'0712345678','email':'test@example.test','billing_address':'Fixture address'},'items':[{'name':'Fixture item','description':'Fixture description','quantity':2.5,'unit_price_cents':1010,'line_total_cents':2525}],'subtotal_cents':2525,'discount':{'type':'percent','value':10,'amount_cents':253},'total_cents':2272,'tax_cents':0,'tax_rate':0,'currency':'KES','payment_method':'mpesa','payment_ref':'TEST-PAYMENT','paid_at':1791630000}
r={'id':json.dumps(['shop-test',1,'POS-TEST-1'],separators=(',',':')),'shop_id':'shop-test','sale_id':1,'receipt_no':'POS-TEST-1','snapshot':snapshot,'digest':'0'*64,'status':'review_required','attempt_id':'TEST-ATTEMPT','history':[]}
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,args=['--no-sandbox'])
    page=browser.new_page()
    page.on('pageerror',lambda e:print('PAGE_ERROR',str(e)))
    page.route('https://ecitizen.kra.go.ke/**',lambda route:route.fulfill(status=200,content_type='text/html',body=fixture))
    page.goto('https://ecitizen.kra.go.ke/individual/etims/sale/create')
    page.evaluate('''r=>{
      window.testJob={record:r,config:{}};window.testMessages=[];
      window.chrome.runtime={onMessage:{addListener(){}},sendMessage:async m=>{
        window.testMessages.push(m);
        if(m.action==='job')return {result:window.testJob};
        if(m.action==='arm')return {result:{armed:true}};
        if(m.action==='capture'){window.testCapture=m.data;return {result:{captured:true}};}
        return {error:'Unexpected request'};
      }};
    }''',r)
    page.add_script_tag(path='chrome-extension/portal-adapter.js')
    page.add_script_tag(path='chrome-extension/portal.js')
    page.wait_for_function("document.querySelector('[name=total]').value==='22.72'")
    assert page.evaluate('window.fixtureSubmissions')==0
    page.locator('#generate').click()
    assert page.evaluate('window.fixtureSubmissions')==0
    page.locator('[data-oraforge-companion] [data-review]').check()
    page.locator('[data-oraforge-companion] [data-arm]').click()
    page.wait_for_function("window.testMessages.some(m=>m.action==='arm')")
    page.locator('#generate').click()
    page.wait_for_function('!!window.testCapture')
    assert page.evaluate('window.fixtureSubmissions')==1
    page.locator('#generate').click()
    assert page.evaluate('window.fixtureSubmissions')==1
    assert page.evaluate('window.testCapture.fiscal.cu_invoice_number')=='TEST-CU/0001'
    page.screenshot(path='/tmp/etims-portal-review.png',full_page=True)
    print('PASS trusted cashier review + one native Generate click + automatic official capture + duplicate click blocked')
    browser.close()

import tempfile
fixture=Path('capacitor/tests/fixtures/kra-portal.html').read_text()
with sync_playwright() as p, tempfile.TemporaryDirectory(prefix='oraforge-full-extension-') as temp:
    context=p.chromium.launch_persistent_context(temp,executable_path='/usr/bin/google-chrome',headless=True,ignore_default_args=['--disable-extensions'],args=['--no-sandbox','--enable-unsafe-extension-debugging','--host-resolver-rules=MAP ecitizen.kra.go.ke ~NOTFOUND'])
    cdp=context.browser.new_browser_cdp_session()
    print('loaded',cdp.send('Extensions.loadUnpacked',{'path':str(Path('chrome-extension').resolve())}))
    context.route('https://ecitizen.kra.go.ke/**',lambda route:route.fulfill(status=200,content_type='text/html',body=fixture))
    page=context.pages[0];page.on('pageerror',lambda e:print('POS ERROR',str(e)))
    page.on('dialog',lambda d:(print('DIALOG',d.message),d.dismiss()))
    page.goto('http://localhost:3099/pos')
    page.evaluate("localStorage.setItem('pos_logged_in','true')");page.reload()
    page.wait_for_function('state.items.length>0')
    print('bridge',page.evaluate("async()=>OraforgeEtims.bridge('ping')"))
    sale=page.evaluate('''async()=>{
      const o=await api('/api/orders',{method:'POST',body:{order_type:'walk-in'}});
      await api('/api/order/add',{method:'POST',body:{order_id:o.id,menu_item_id:state.items[0].id,qty:2}});
      state.order=await api('/api/order/discount',{method:'POST',body:{order_id:o.id,type:'fixed',value:3.21}});renderTicket();return state.order;
    }''')
    page.locator('#checkoutBtn').click();page.locator('#checkoutMethod').select_option('cash');page.locator('#generateEtims').check();page.locator('#etimsPin').fill('A123456789B');page.locator('#checkoutCustomerPhone').fill('0712345678')
    with context.expect_page() as popup_info:page.locator('#chkConfirm').click()
    popup=popup_info.value;popup.on('pageerror',lambda e:print('PORTAL ERROR',str(e)));popup.goto('https://ecitizen.kra.go.ke/individual/etims/sale/create')
    popup.wait_for_function("!!document.querySelector('[data-oraforge-companion]')")
    popup.wait_for_function("document.querySelector('[name=total]').value !== '0.00'")
    assert round(float(popup.locator('[name=total]').input_value())*100)==sale['total_cents']
    assert popup.evaluate('window.fixtureSubmissions')==0
    print('PASS real extension opened KRA popup and filled exact sale')
    popup.locator('#generate').click();assert popup.evaluate('window.fixtureSubmissions')==0
    popup.locator('[data-oraforge-companion] [data-review]').check();popup.locator('[data-oraforge-companion] [data-arm]').click()
    popup.wait_for_function("document.querySelector('[data-oraforge-companion]').shadowRoot.querySelector('[role=status]').textContent.includes('Now click')")
    popup.locator('#generate').click()
    popup.wait_for_function("document.querySelector('[data-oraforge-companion]').shadowRoot.querySelector('[role=status]').textContent.includes('captured')")
    page.wait_for_function("document.querySelector('.receipt-etims')?.textContent.includes('TEST-CU/0001')")
    assert page.evaluate("async()=>(await OraforgeEtims.list())[0].status")=='generated'
    saved=page.evaluate("async()=>api('/api/order?id='+ (await OraforgeEtims.list())[0].sale_id)")
    assert saved['etims']['fiscal']['scu_id']=='TEST-SCU'
    assert saved['total_cents']==sale['total_cents']
    popup.locator('#generate').click();assert popup.evaluate('window.fixtureSubmissions')==1
    print('PASS real worker/bridge/portal pipeline captured genuine fixture fields and updated original sale + branded receipt; duplicate blocked')
    context.close()
