"""Chrome regression: actual Oraforge checkout -> extension -> KRA-shaped DOM.
Start the isolated POS server as documented. Authenticated KRA is NOT contacted.
The portal fixture uses supplied/source-verified controls with simulated state.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
import os
import tempfile
ROOT = Path(__file__).resolve().parents[2]
BASE = os.environ.get('POS_TEST_URL', 'http://localhost:3099')
PORTAL = 'https://etims.kra.go.ke/dynamic/sales/invoice'
fixture = (ROOT / 'capacitor/tests/fixtures/kra-vue-invoice.html').read_text()
fixture = fixture.replace('<div id="payment-options">', '<div id="payment-options"><button type="button"><div><p>Cash : TEST CASH</p></div></button>')
with sync_playwright() as p, tempfile.TemporaryDirectory(prefix='oraforge-fill-extension-') as profile:
    context = p.chromium.launch_persistent_context(
        profile, executable_path='/usr/bin/google-chrome', headless=True,
        ignore_default_args=['--disable-extensions'],
        args=['--no-sandbox', '--enable-unsafe-extension-debugging',
              '--host-resolver-rules=MAP ecitizen.kra.go.ke ~NOTFOUND, MAP etims.kra.go.ke ~NOTFOUND, MAP kra.ecitizen.go.ke ~NOTFOUND'])
    cdp = context.browser.new_browser_cdp_session()
    loaded = cdp.send('Extensions.loadUnpacked', {'path': str(ROOT / 'chrome-extension')})
    options = context.new_page()
    options.goto('chrome-extension://' + loaded['id'] + '/options.html')
    expect(options.locator('#selectors')).to_have_value('{}')
    options.locator('#create-url').fill(PORTAL)
    options.locator('#save').click()
    expect(options.locator('#status')).to_contain_text('Saved')
    options.close()
    # First load is a simulated login/shell; the SPA renders its form later.
    context.route('https://etims.kra.go.ke/**', lambda route: route.fulfill(status=200, content_type='text/html', body='<html><body><h1>Sign in fixture</h1><input type="email"></body></html>'))
    context.route('https://ecitizen.kra.go.ke/**', lambda route: route.abort())
    context.route('https://kra.ecitizen.go.ke/**', lambda route: route.abort())
    page = context.pages[0]
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('dialog', lambda d: d.dismiss())
    page.goto(BASE + '/pos')
    page.evaluate("localStorage.setItem('pos_logged_in','true')")
    page.reload()
    page.wait_for_function('state.items.length>1 && !!window.OraforgeEtims')
    sale = page.evaluate('''async()=>{
      await LocalPOS.setShop('settings',{business_name:'Fill Fixture Shop',tax_rate:0});
      const o=await api('/api/orders',{method:'POST',body:{order_type:'walk-in'}});
      await api('/api/order/add',{method:'POST',body:{order_id:o.id,menu_item_id:state.items[0].id,qty:2.5}});
      await api('/api/order/add',{method:'POST',body:{order_id:o.id,menu_item_id:state.items[1].id,qty:1}});
      state.order=await api('/api/order/discount',{method:'POST',body:{order_id:o.id,type:'fixed',value:3.21}});
      renderTicket();return state.order;
    }''')
    page.locator('#checkoutBtn').click()
    page.locator('#checkoutMethod').select_option('cash')
    page.locator('#generateEtims').check()
    page.locator('#etimsPin').fill('A123456789B')
    page.locator('#etimsEmail').fill('test@example.test')
    page.locator('#etimsAddress').fill('Fixture billing address')
    page.locator('#checkoutCustomerPhone').fill('0712345678')
    with context.expect_page() as popup_info:
        page.locator('#chkConfirm').click()
    popup = popup_info.value
    popup.on('pageerror', lambda e: errors.append(str(e)))
    # Reattach after the extension-created initial navigation; DNS is blocked.
    popup.goto(PORTAL)
    popup.wait_for_function("!!document.querySelector('[data-oraforge-companion]')")
    assert 'Missing:' in popup.locator('[data-oraforge-companion] [role=status]').inner_text()
    # Keep the content script/observer alive while Vue-style navigation renders.
    popup.evaluate('''html=>{
      history.pushState({},'', '/business/fixture/etims/sale/create?view=invoice');
      const dom=new DOMParser().parseFromString(html,'text/html');
      const scripts=[...dom.querySelectorAll('script')].map(s=>s.textContent);
      const panel=document.querySelector('[data-oraforge-companion]');
      document.body.replaceChildren(...dom.body.children);
      document.documentElement.append(panel);
      for(const source of scripts){const script=document.createElement('script');script.textContent=source;document.body.append(script);}
    }''', fixture)
    popup.wait_for_function("document.querySelector('[data-oraforge-companion]').shadowRoot.querySelector('[role=status]').textContent.includes('No invoice submitted.')", timeout=30000)
    report = popup.locator('[data-oraforge-companion] [data-report]').inner_text()
    failures = popup.locator('[data-oraforge-companion] li[data-status=failed]').all_inner_texts()
    assert failures == [], failures
    snapshot = page.evaluate('async()=> (await OraforgeEtims.list())[0].snapshot')
    actual = popup.evaluate('window.fixtureItems')
    assert len(actual) == len(snapshot['items']) == 2
    for line, expected in zip(actual, snapshot['items']):
        assert line['name'] == expected['name']
        assert line['description'] == (expected['description'] or expected['name'])
        assert line['quantity'] == expected['quantity']
        assert line['price'] == expected['unit_price_cents']
    assert sum(line['total'] for line in actual) == sale['total_cents']
    assert sum(line['discount'] for line in actual) == 321
    assert popup.locator('#selected-payment').inner_text() == 'Cash'
    assert popup.locator('#customer-section input[type=email]').input_value() == 'test@example.test'
    assert popup.locator('#customer-section input[type=tel]').input_value() == '0712345678'
    assert popup.locator('textarea[placeholder="Enter full billing address"]').input_value() == 'Fixture billing address'
    assert popup.evaluate('window.fixtureSubmissions') == 0
    assert popup.evaluate('window.fixtureItemAdds') == 2
    popup.locator('[data-oraforge-companion] [data-fill]').click()
    popup.wait_for_function("!document.querySelector('[data-oraforge-companion]').shadowRoot.querySelector('[data-fill]').disabled")
    assert popup.evaluate('window.fixtureItemAdds') == 2
    popup.locator('#issue').click()
    assert popup.evaluate('window.fixtureSubmissions') == 0
    assert page.evaluate('async()=> (await OraforgeEtims.list())[0].status') == 'review_required'
    assert errors == [], errors
    popup.screenshot(path='/tmp/oraforge-etims-filled.png', full_page=True)
    print('PASS actual Oraforge checkout -> Chrome bridge/worker -> alternate official host -> delayed SPA form')
    print('PASS real-shaped customer/payment dropdowns, two sequential item popups, quantities/prices, fixed discount, exact total, contacts/address')
    print('PASS repeat Fill adds no duplicates, invoice creation blocked, original POS total unchanged')
    print('Fixture screenshot: /tmp/oraforge-etims-filled.png')
    context.close()
