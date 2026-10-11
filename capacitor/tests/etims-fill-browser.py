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
    portal_document = {'html': '<html><body><h1>Sign in fixture</h1><input type="email"></body></html>'}
    context.route('https://etims.kra.go.ke/**', lambda route: route.fulfill(status=200, content_type='text/html', body=portal_document['html']))
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
      const older=await api('/api/orders',{method:'POST',body:{order_type:'walk-in'}});
      await api('/api/order/add',{method:'POST',body:{order_id:older.id,menu_item_id:state.items[1].id,qty:3}});
      window.fixtureOlderSale=await api('/api/order/pay',{method:'POST',body:{order_id:older.id,payment_method:'cash',customer_phone:'0712345679',generate_etims:true,etims_shop_id:OraforgeEtims.scope(),etims_customer:{pin:'A123456789B',email:'older@example.test',phone:'0712345679',billing_address:'Older receipt address'}}});
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
    portal_document['html'] = fixture
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

    popup.locator('[data-scroll-controls] summary').click()
    expect(popup.locator('[data-scroll-toggle]')).to_be_enabled()
    assert not popup.locator('[data-scroll-toggle]').is_checked()
    popup.locator('[data-scroll-toggle]').check()
    expect(popup.locator('[data-scroll-status]')).to_contain_text('ON')
    with context.expect_page() as experiment_page:
        popup.locator('[data-scroll-logs]').click()
    experiment = experiment_page.value
    expect(experiment.locator('#keepalive-toggle')).to_be_checked()
    expect(experiment.locator('#keepalive-log')).to_contain_text('session_detected')
    experiment.locator('#keepalive-toggle').uncheck()
    expect(popup.locator('[data-scroll-toggle]')).not_to_be_checked()
    experiment.close()
    popup.locator('[data-scroll-controls] summary').click()
    assert popup.evaluate('window.fixtureItemAdds') == 2
    assert popup.evaluate('window.fixtureSubmissions') == 0
    print('PASS existing invoice panel toggles the scroll experiment, opens activity logs and syncs OFF without changing filled invoice data')

    def wait_filled(receipt, count, total):
        expect(popup.locator('[data-oraforge-companion] [data-sale]')).to_contain_text(receipt)
        popup.wait_for_function("document.querySelector('[data-oraforge-companion]').shadowRoot.querySelector('[role=status]').textContent.includes('No invoice submitted.')", timeout=30000)
        assert popup.locator('[data-oraforge-companion] li[data-status=failed]').all_inner_texts() == []
        assert len(popup.evaluate('window.fixtureItems')) == count
        assert popup.evaluate('window.fixtureItems.reduce((s,i)=>s+i.total,0)') == total
        assert popup.evaluate('window.fixtureSubmissions') == 0

    # Offline/online must refill a reset form even when Vue keeps the same input.
    attempt = page.evaluate('async()=> (await OraforgeEtims.list())[0].attempt_id')
    context.set_offline(True)
    expect(popup.locator('[data-oraforge-companion] [role=status]')).to_contain_text('Connection lost')
    popup.evaluate('''()=>{
      window.fixtureItems=[];window.fixtureTable();
      document.querySelector('#customer-section input[type=email]').value='';
      document.querySelector('#customer-section input[type=tel]').value='';
      document.querySelector('textarea[placeholder="Enter full billing address"]').value='';
    }''')
    context.set_offline(False)
    wait_filled(snapshot['receipt_no'], 2, sale['total_cents'])
    assert popup.locator('#customer-section input[type=email]').input_value() == 'test@example.test'
    assert page.evaluate('async()=> (await OraforgeEtims.list())[0].attempt_id') == attempt
    popup.reload()
    wait_filled(snapshot['receipt_no'], 2, sale['total_cents'])
    # Resuming an already open attempt reloads its binding without resetting
    # the prepared form or losing the adapter's item-confirmation safeguards.
    popup.evaluate("window.fixtureKeepSamePage=true;document.querySelector('[data-oraforge-companion]').dataset.testReload='old'")
    page.locator('.etims-manage-receipt').click()
    page.locator('.etims-dialog [data-action=resume]').click()
    popup.wait_for_function("document.querySelector('[data-oraforge-companion]') && !document.querySelector('[data-oraforge-companion]').hasAttribute('data-test-reload')")
    wait_filled(snapshot['receipt_no'], 2, sale['total_cents'])
    assert popup.evaluate('window.fixtureKeepSamePage') is True
    assert popup.evaluate('window.fixtureItemAdds') == 2
    print('PASS offline/online restores the same sale and page reload restores the saved attempt')

    # Closing the popup and using the receipt's Resume action must not claim anew.
    popup.close()
    page.locator('.etims-manage-receipt').click()
    with context.expect_page() as reopened:
        page.locator('.etims-dialog [data-action=resume]').click()
    popup = reopened.value
    popup.on('pageerror', lambda e: errors.append(str(e)))
    # As at first checkout, attach routing after the extension-created window;
    # its initial request is intentionally unable to resolve the real KRA host.
    popup.goto(PORTAL)
    wait_filled(snapshot['receipt_no'], 2, sale['total_cents'])
    assert page.evaluate('async()=> (await OraforgeEtims.list())[0].attempt_id') == attempt

    # Selecting a different historical receipt rebinds this popup and clears the
    # previous form by navigating, rather than mixing two receipts' invoice data.
    older = page.evaluate('window.fixtureOlderSale')
    page.evaluate('async()=>await OraforgeEtims.manage(window.fixtureOlderSale)')
    with popup.expect_navigation(wait_until='domcontentloaded'):
        page.locator('.etims-dialog [data-action=start]').click()
    wait_filled(older['ticket_no'], 1, older['total_cents'])
    assert popup.locator('#customer-section input[type=email]').input_value() == 'older@example.test'
    assert popup.locator('textarea[name="note "]').input_value() == 'POS Receipt: ' + older['ticket_no']
    page.locator('.etims-manage-receipt').click()
    with popup.expect_navigation(wait_until='domcontentloaded'):
        page.locator('.etims-dialog [data-action=resume]').click()
    wait_filled(snapshot['receipt_no'], 2, sale['total_cents'])
    assert popup.locator('textarea[name="note "]').input_value() == 'POS Receipt: ' + snapshot['receipt_no']
    print('PASS receipt Resume reopens the saved attempt; switching historical/live sales updates header, contacts, items and total without mixing data')

    # Verify the same selection from the admin eTIMS workspace.
    page.goto(BASE + '/admin.html')
    page.locator('#adminPinInput').fill('1234')
    page.locator('#adminLoginBtn').click()
    page.locator('.nav-item[data-section=etims]').click()
    old_row = page.locator('[data-invoice-workspace] tbody tr').filter(has_text=older['ticket_no'])
    with popup.expect_navigation(wait_until='domcontentloaded'):
        old_row.locator('[data-action=resume]').click()
    wait_filled(older['ticket_no'], 1, older['total_cents'])
    print('PASS admin selects and resumes the exact historical receipt in the existing popup')

    # A new checkout must open its own visible window without requiring Manage
    # or Resume, even while another sale's minimized companion is still open.
    previous_popup = popup
    previous_popup.locator('[data-oraforge-companion] [data-minimize]').click()
    expect(previous_popup.locator('[data-oraforge-companion] [data-restore]')).to_be_visible()
    page.goto(BASE + '/pos')
    page.wait_for_function('state.items.length>1 && !!window.OraforgeEtims')
    before_pages = set(context.pages)
    before_records = page.evaluate('async()=> (await OraforgeEtims.list()).length')
    page.evaluate('''async()=>{
      const o=await api('/api/orders',{method:'POST',body:{order_type:'walk-in'}});
      await api('/api/order/add',{method:'POST',body:{order_id:o.id,menu_item_id:state.items[0].id,qty:1}});
      state.order=await api('/api/order?id='+o.id);renderTicket();
    }''')
    page.locator('#checkoutBtn').click()
    page.locator('#checkoutMethod').select_option('cash')
    assert not page.locator('#generateEtims').is_checked()
    page.locator('#chkConfirm').click()
    page.locator('#receiptModal').wait_for()
    page.wait_for_function('state.order===null')
    assert set(context.pages) == before_pages
    assert page.evaluate('async()=> (await OraforgeEtims.list()).length') == before_records
    page.locator('#receiptModalClose').click()

    next_sale = page.evaluate('''async()=>{
      const o=await api('/api/orders',{method:'POST',body:{order_type:'walk-in'}});
      await api('/api/order/add',{method:'POST',body:{order_id:o.id,menu_item_id:state.items[0].id,qty:1}});
      state.order=await api('/api/order?id='+o.id);renderTicket();return state.order;
    }''')
    page.locator('#checkoutBtn').click()
    page.locator('#checkoutMethod').select_option('cash')
    page.locator('#generateEtims').check()
    page.locator('#etimsPin').fill('A123456789B')
    page.locator('#etimsEmail').fill('next-checkout@example.test')
    page.locator('#etimsAddress').fill('Next checkout address')
    page.locator('#checkoutCustomerPhone').fill('0712345678')
    with context.expect_page() as next_popup:
        page.locator('#chkConfirm').click()
    popup = next_popup.value
    popup.on('pageerror', lambda e: errors.append(str(e)))
    # As at first checkout, reattach fixture routing after the initial navigation.
    popup.goto(PORTAL)
    wait_filled(next_sale['ticket_no'], 1, next_sale['total_cents'])
    expect(popup.locator('[data-oraforge-companion] [data-minimize]')).to_be_visible()
    assert popup.locator('#customer-section input[type=email]').input_value() == 'next-checkout@example.test'
    expect(previous_popup.locator('[data-oraforge-companion] [data-sale]')).to_contain_text(older['ticket_no'])
    assert previous_popup.evaluate('window.fixtureItems.reduce((s,i)=>s+i.total,0)') == older['total_cents']
    assert previous_popup.evaluate('window.fixtureSubmissions') == 0
    assert page.locator('#receiptModal').is_visible()
    assert page.evaluate('async()=> (await OraforgeEtims.list()).length') == before_records + 1
    print('PASS Confirm & Print automatically opens and fills a fresh KRA popup with an older minimized companion open; ordinary checkout opens none')
    assert errors == [], errors
    popup.screenshot(path='/tmp/oraforge-etims-filled.png', full_page=True)
    print('PASS actual Oraforge checkout -> Chrome bridge/worker -> alternate official host -> delayed SPA form')
    print('PASS real-shaped customer/payment dropdowns, two sequential item popups, quantities/prices, fixed discount, exact total, contacts/address')
    print('PASS repeat Fill adds no duplicates, invoice creation blocked, original POS total unchanged')
    print('Fixture screenshot: /tmp/oraforge-etims-filled.png')
    context.close()
