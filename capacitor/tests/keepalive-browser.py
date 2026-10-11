"""Real 60-second Chrome timer test, with KRA DNS blocked and local fixtures.
This does not test or claim any change to KRA's authenticated session timeout.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
PORTAL = 'https://ecitizen.kra.go.ke/individual/etims/sale/create'
fixture = '''<!doctype html><html><head><style>html{scroll-behavior:smooth}body{height:3000px}</style></head><body>
<button><span class="sr-only">Open user menu</span></button><h1>Create Sales Invoice</h1>
<form><input id="email" type="email" value="fixture@example.test"><textarea id="description">Keep invoice data</textarea><button type="button">Add Item</button><button type="submit">Create Invoice</button></form>
<script>
window.fixtureScrolls=0;window.fixtureClicks=0;window.fixtureSubmits=0;window.fixtureChanges=0;window.fixtureMouseMoves=0;
document.addEventListener("mousemove",e=>{if(!e.isTrusted)window.fixtureMouseMoves++;});
document.addEventListener('scroll',()=>window.fixtureScrolls++);
document.addEventListener('click',()=>window.fixtureClicks++);
document.addEventListener('submit',e=>{window.fixtureSubmits++;e.preventDefault();});
document.addEventListener('input',()=>window.fixtureChanges++);
</script></body></html>'''

with sync_playwright() as p, tempfile.TemporaryDirectory(prefix='oraforge-scroll-extension-') as profile:
    context = p.chromium.launch_persistent_context(
        profile, executable_path='/usr/bin/google-chrome', headless=True,
        ignore_default_args=['--disable-extensions'],
        args=['--no-sandbox', '--enable-unsafe-extension-debugging',
              '--host-resolver-rules=MAP ecitizen.kra.go.ke ~NOTFOUND, MAP etims.kra.go.ke ~NOTFOUND, MAP kra.ecitizen.go.ke ~NOTFOUND'])
    cdp = context.browser.new_browser_cdp_session()
    loaded = cdp.send('Extensions.loadUnpacked', {'path': str(ROOT / 'chrome-extension')})
    context.route('https://ecitizen.kra.go.ke/**', lambda route: route.fulfill(status=200, content_type='text/html', body=fixture))
    context.route('https://etims.kra.go.ke/**', lambda route: route.abort())
    context.route('https://kra.ecitizen.go.ke/**', lambda route: route.abort())
    requests = []
    context.on('request', lambda request: requests.append(request.url))
    ui = context.new_page()
    ui.goto('chrome-extension://' + loaded['id'] + '/keepalive.html')
    expect(ui.locator('#keepalive-toggle')).to_be_enabled()
    assert not ui.locator('#keepalive-toggle').is_checked()
    page = context.new_page()
    page.goto(PORTAL)
    page.evaluate("document.querySelector('#description').focus();window.scrollTo({top:100,left:0,behavior:'instant'})")
    page.wait_for_function('window.scrollY===100 && window.fixtureScrolls>0')
    before = page.evaluate('''()=>({x:scrollX,y:scrollY,email:document.querySelector('#email').value,
      description:document.querySelector('#description').value,focus:document.activeElement.id,
      clicks:fixtureClicks,submits:fixtureSubmits,changes:fixtureChanges,scrolls:fixtureScrolls})''')
    ui.locator('#keepalive-mode').select_option('both')
    ui.locator('#keepalive-toggle').check()
    expect(ui.locator('#keepalive-status')).to_contain_text('ON')
    request_count = len(requests)
    started = time.monotonic()
    print('Waiting for the actual 60-second content-script timer…', flush=True)
    # No activity or manual scroll in the portal during this wait.
    expect(ui.locator('#keepalive-log')).to_contain_text('scroll_cycle', timeout=75000)
    expect(ui.locator('#keepalive-log')).to_contain_text('mouse_cycle')
    elapsed = time.monotonic() - started
    assert elapsed >= 58, elapsed
    logs = ui.evaluate("async()=> (await chrome.storage.local.get('oraforgeScrollKeepAliveLog')).oraforgeScrollKeepAliveLog")
    cycles = [entry for entry in logs if entry['event'] == 'scroll_cycle']
    assert len(cycles) == 1 and cycles[0]['delta'] == 12 and cycles[0]['restored'], cycles
    assert cycles[0]['mode'] == 'both', cycles
    assert len([entry for entry in logs if entry['event'] == 'mouse_cycle' and entry['mode'] == 'both']) == 1, logs
    assert cycles[0]['target'] == 'page' and cycles[0]['event_observed'], cycles
    assert cycles[0]['observed_ms'] >= 59000
    assert len(requests) == request_count, requests[request_count:]
    actual = page.evaluate('''()=>({x:scrollX,y:scrollY,email:document.querySelector('#email').value,
      description:document.querySelector('#description').value,focus:document.activeElement.id,
      clicks:fixtureClicks,submits:fixtureSubmits,changes:fixtureChanges,scrolls:fixtureScrolls})''')
    assert actual.pop('scrolls') > before.pop('scrolls')
    assert page.evaluate('window.fixtureMouseMoves') == 2
    assert actual == before, (actual, before)
    print('PASS real 60-second scroll produces a browser scroll event; position, invoice data and focus restored; no clicks/submissions/network calls', flush=True)

    # SPA logout while the switch remains ON must stop the timer.
    page.evaluate("document.body.innerHTML='<h1>Session expired</h1><input autocomplete=one-time-code>'")
    expect(ui.locator('#keepalive-log')).to_contain_text('logged_out')
    print('Waiting through another full interval after logout detection…', flush=True)
    # Playwright's wait runs asynchronously in this test process; the agent polls
    # its output rather than blocking user communication for this interval.
    deadline = time.monotonic() + 62
    while time.monotonic() < deadline:
        ui.wait_for_timeout(1000)
    logs = ui.evaluate("async()=> (await chrome.storage.local.get('oraforgeScrollKeepAliveLog')).oraforgeScrollKeepAliveLog")
    assert len([entry for entry in logs if entry['event'] == 'scroll_cycle']) == 1
    assert len([entry for entry in logs if entry['event'] == 'mouse_cycle']) == 1
    assert ui.locator('#keepalive-toggle').is_checked()
    assert any(entry['event'] == 'logged_out' and entry['cycles'] == 1 for entry in logs)
    ui.locator('#keepalive-toggle').uncheck()
    expect(ui.locator('#keepalive-status')).to_contain_text('OFF')
    options = context.new_page()
    options.goto('chrome-extension://' + loaded['id'] + '/options.html')
    expect(options.locator('#keepalive-toggle')).to_be_enabled()
    assert not options.locator('#keepalive-toggle').is_checked()
    ui.locator('#clear-log').click()
    expect(ui.locator('#keepalive-log')).to_have_text('No activity yet.')
    print('PASS detected logout stops subsequent ticks, persisted ON/OFF toggle syncs with Options, local activity logs can be cleared', flush=True)
    print('Live KRA timeout effect remains UNVERIFIED; this is a browser/fixture test only.', flush=True)
    context.close()

