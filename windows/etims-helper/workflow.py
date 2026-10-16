"""UI-only invoice submission, read-only reconciliation, client PDF capture."""
from __future__ import annotations
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
from urllib.parse import parse_qs, urlparse

from ui_map import UI_MAP, point, region, payment_points
from pdf_invoice import read_sale, extract
from settings import ASSETS, HOME, require_identity
from timing import span, mark, timed

BASE = ASSETS
DATA = HOME
CLIENT_HASH = UI_MAP['client_sha256']


def ps(script: str, *args: str, timeout=90) -> str:
    from powershell_host import execute
    result = execute(script, args, timeout)
    if result.returncode:
        # Avoid including connection internals or arbitrary stderr in logs.
        reason=''
        if Path(script).name=='ui-step.ps1':
            stderr=result.stderr.decode('utf-8-sig',errors='replace')
            safe_reasons={'Screen does not match the verified workflow':'screen mismatch',
                          'Target has no keyboard/mouse focus':'target focus unavailable',
                          'Client has an active modal dialog':'unexpected modal dialog',
                          'Observed point is not an allowed target Edit control':'edit control mismatch',
                          'Unverified window geometry':'window geometry mismatch',
                          'Unrecognized eTIMS screen':'unrecognized screen',
                          'Expected file dialog missing':'file dialog not ready'}
            safe_reasons['Target not ready before input']='target busy before input'
            safe_reasons['Observed page navigation button missing']='page navigation control mismatch'
            safe_reasons['Unsupported display settings']='unsupported display settings: run the machine check; eTIMS content must fit on one monitor of at least 1366x768'
            safe_reasons['Target window changed']='target moved or resized after observation'
            safe_reasons['Observed UIA selector missing or ambiguous']='UIA selector missing or ambiguous'
            reason=next((' ('+description+')' for message,description in safe_reasons.items() if message in stderr),'')
            detail=re.search(r'\[profile=([a-z-]{1,40}); score=(0\.[0-9]{6}|1\.000000)\]',stderr)
            if detail:reason+=' '+detail[0]
        elif Path(script).name in ('normalize-window.ps1','display-state.ps1'):
            stderr=result.stderr.decode('utf-8-sig',errors='replace')
            if 'Unsupported display settings' in stderr:reason=' (unsupported display settings: run the machine check; eTIMS content must fit on one monitor of at least 1366x768)'
            elif 'Unverified window geometry' in stderr:reason=' (window geometry mismatch: normalized content must fit on one monitor)'
        raise RuntimeError(f'{Path(script).name} failed{reason}; stopped without retrying the action')
    return result.stdout.decode('utf-8-sig').strip()


def read_state(pin: str, invoice=-1, scope=None) -> dict:
    config = require_identity()
    return json.loads(ps('read-state.ps1', '-BuyerPin', pin, '-TaxpayerPin', config['taxpayer_pin'],
                         '-BranchId', config['branch_id'], '-InvoiceId', str(invoice),
                         '-InstallationDir', config['installation_dir'], '-DatabasePath', config['database_path'],
                         '-Scope', scope or ('Invoice' if invoice >= 0 else 'Full')))


def ledger_path(request_id: str) -> Path:
    if not request_id.strip() or len(request_id) > 120:
        raise ValueError('Enter a unique sale reference of 1–120 characters')
    return DATA / 'ledger' / (hashlib.sha256(request_id.encode()).hexdigest() + '.json')


def write_ledger(path: Path, data: dict):
    temporary = path.with_suffix('.next')
    temporary.write_text(json.dumps(data, indent=2), encoding='utf-8')
    temporary.replace(path)


def verify_sale(state: dict, request: dict, approved=False):
    sales = state['sales']
    if len(sales) != 1:
        raise ValueError('Expected exactly one stored invoice')
    sale = sales[0]
    expected_status = '02' if approved else '01'
    if (sale['CUST_TIN'] != request['buyer_pin'] or
            (sale['CUST_NM'] != request['buyer_name'] and not (request['buyer_pin'] == 'NA' and sale['CUST_NM'] in ('Walk-In', 'Walk-In Customer', 'Luke', 'Luke '))) or
            sale['SALES_STTS_CD'] != expected_status or
            Decimal(str(sale['TOT_AMT'])) != Decimal(request['total']) or
            Decimal(str(sale['TOT_TAX_AMT'])) != 0):
        raise ValueError('Stored invoice differs from the reviewed sale')
    def key(item, stored=False):
        return (item['ITEM_CD' if stored else 'item_code'],
                Decimal(str(item['QTY' if stored else 'quantity'])),
                Decimal(str(item['PRC' if stored else 'unit_price'])),
                item['TAX_TY_CD' if stored else 'tax_code'])
    if sorted(key(i, True) for i in state['lines']) != sorted(key(i) for i in request['lines']):
        raise ValueError('Stored invoice lines differ from the reviewed sale')
    if approved and (len(state['receipts']) != 1 or sale['PMT_TY_CD'] != request['payment_code']):
        raise ValueError('Payment or fiscal receipt missing after approval')


def verify_pdf(result: dict, state: dict):
    if not result['all_six_fields_present'] or len(state['receipts']) != 1:
        raise ValueError('Six-field extraction or local receipt is incomplete')
    receipt = state['receipts'][0]
    date = datetime.strptime(receipt['RCPT_PBCT_DT'], '%Y%m%d%H%M%S').isoformat() + '+03:00'
    if (result['receipt_signature'] != receipt['RCPT_SIGN'] or
            str(result['invoice_number']) not in (str(receipt['INVC_NO']),receipt['CU_INVOICE_NUMBER']) or
            result['cu_invoice_number'] != receipt['CU_INVOICE_NUMBER'] or
            result['scu_id'] != receipt['SCU_ID'] or result['invoice_date'] != date):
        raise ValueError('PDF fiscal fields differ from the original local receipt')
    data = parse_qs(urlparse(result['qr_code']['payload']).query).get('Data', [])
    config = require_identity()
    if data != [config['taxpayer_pin'] + config['branch_id'] + receipt['RCPT_SIGN']]:
        raise ValueError('QR payload differs from this invoice signature and branch')


def preflight(pdf: Path | dict, pin: str, name: str, payment: str, mappings: dict | None = None) -> tuple[dict, dict]:
    config = require_identity()
    from offline import require_offline
    require_offline(config)
    client = Path(config['installation_dir']) / 'bin/EBM2x.dll'
    if hashlib.sha256(client.read_bytes()).hexdigest() != CLIENT_HASH:
        raise ValueError('Client build changed; this UI profile needs revalidation')
    if pin != 'NA' and not re.fullmatch(r'[A-Z]\d{9}[A-Z]', pin):
        raise ValueError('Enter the actual buyer KRA PIN')
    if payment not in ('01', '02', '03', '04', '05', '06', '07'):
        raise ValueError('Choose a supported payment category')
    request = json.loads(json.dumps(pdf)) if isinstance(pdf, dict) else read_sale(pdf)
    state = read_state(pin)
    if len(state['process_ids']) != 1:
        raise ValueError('Open exactly one eTIMS client and log in normally')
    from display import require_display
    require_display(state['process_ids'][0],state.get('display'))
    if state['default_printer'] != ['Microsoft Print to PDF']:
        raise ValueError('The Windows default printer must be Microsoft Print to PDF before this workflow')
    if len(state['customers']) != 1 or (state['customers'][0]['CUST_NM'] != name and not (pin == 'NA' and state['customers'][0]['CUST_NM'] in ('Walk-In', 'Walk-In Customer', 'Luke', 'Luke '))):
        raise ValueError('Buyer PIN and name must match one active eTIMS customer account')
    needed = defaultdict(Decimal)
    for line in request['lines']:
        explicit = (mappings or {}).get(line['name']) or line['item_code']
        candidates = [i for i in state['items'] if
                      (i['ITEM_CD'] == explicit if explicit else i['ITEM_NM'].casefold() == line['name'].casefold())]
        if len(candidates) != 1 or candidates[0]['TAX_TY_CD'] != line['tax_code']:
            raise ValueError('Each PDF item needs one matching active Non-VAT product; use an explicit code map if ambiguous')
        line['item_code'] = candidates[0]['ITEM_CD']
        needed[line['item_code']] += Decimal(line['quantity'])
    for code, quantity in needed.items():
        current = next(i for i in state['items'] if i['ITEM_CD'] == code)
        if current.get('ITEM_TY_CD') != '3' and Decimal(str(current['RSD_QTY'])) < quantity:
            raise ValueError('Insufficient registered stock; reconcile actual stock in eTIMS first')
    request.update(buyer_pin=pin, buyer_name=name, payment_code=payment,
                   taxpayer_pin=config['taxpayer_pin'], branch_id=config['branch_id'])
    return request, state


class Ui:
    def __init__(self, pid: int):
        self.pid = pid

    def action(self, screen: str, action: str, x=0, y=0, text=None):
        instruction = dict(pid=self.pid, action=action, x=x, y=y, text=text,
                           reference=str(BASE / 'profiles' / (screen + '.png')),
                           regions=[region(screen)])
        return self.send(instruction)

    def send(self, instruction: dict):
        with tempfile.TemporaryDirectory(prefix='etims-step-') as folder:
            path = Path(folder) / 'instruction.json'
            path.write_text(json.dumps(instruction), encoding='utf-8')
            deadline=time.monotonic()+5
            while True:
                if instruction.get('action') in ('Click','Close','Text','File','Complete'):
                    from offline import require_offline
                    require_offline()
                try:
                    return ps('ui-step.ps1', '-Instruction', str(path), timeout=40)
                except RuntimeError as error:
                    # Faster transport must still allow the native page to paint.
                    # This exact category is emitted BEFORE any input is sent.
                    # Never replay focus failures, timeouts or a dispatched action.
                    if any(reason in str(error) for reason in ('(screen mismatch)','(target busy before input)')) and time.monotonic()<deadline:
                        time.sleep(.1)
                        continue
                    screen=Path(instruction.get('reference','print-file')).stem
                    if instruction.get('action')!='Detect' and '(screen mismatch)' in str(error):
                        diagnostic=dict(instruction)
                        if instruction.get('navigation_reference') and ('profile='+Path(instruction['navigation_reference']).stem+';') in str(error):
                            diagnostic.update(reference=instruction['navigation_reference'],regions=[instruction['navigation_region']])
                        self.diagnose(diagnostic)
                    raise RuntimeError(f"UI {instruction.get('action')} on {screen}: {error}") from None

    def diagnose(self,instruction=None):
        # Failure-only read. Never retry the original action to collect evidence.
        profiles=([dict(screen=Path(instruction['reference']).stem,reference=instruction['reference'],region=instruction['regions'][0])]
                  if instruction else [dict(screen=name,reference=str(BASE/'profiles'/(name+'.png')),region=profile['region'])
                                       for name,profile in UI_MAP['screens'].items()])
        with tempfile.TemporaryDirectory(prefix='etims-diagnostic-') as folder:
            path=Path(folder)/'instruction.json'
            path.write_text(json.dumps(dict(pid=self.pid,action='Diagnose',profiles=profiles,directory=str(DATA/'diagnostics'))),encoding='utf-8')
            try:ps('ui-step.ps1','-Instruction',str(path),timeout=40)
            except Exception:pass # Diagnostics cannot dispatch input or hide the original failure.

    def click(self, screen, x, y):
        self.action(screen, 'Click', x, y)

    def text(self, screen, x, y, value):
        self.action(screen, 'Text', x, y, str(value))
        self.expect(screen, x, y, str(value))

    def value(self, screen, x, y):
        return json.loads(self.action(screen, 'Read', x, y))['value']

    def expect(self, screen, x, y, value, numeric=False):
        # Input is sent once. Only the read is repeated while WPF processes it.
        from decimal import InvalidOperation
        deadline = time.monotonic() + 3
        while True:
            actual = self.value(screen, x, y)
            try:
                matches = (Decimal(actual.replace(',', '')) == Decimal(value)) if numeric else actual == value
            except InvalidOperation:
                matches = False
            if matches:
                return
            if time.monotonic() >= deadline:
                raise ValueError(f'UI field at {x},{y} on {screen} does not match the reviewed value; stopped')
            time.sleep(.05)

    def wait_screen(self, screen, seconds=30):
        end = time.monotonic() + seconds
        while True:
            try:
                # Read a harmless, already observed field to validate the page.
                field = {'print':'invoice','sales':'invoice','payment':'buyer_pin','registration':'invoice'}[screen]
                x,y=point(screen,field)
                return self.value(screen, x, y)
            except (RuntimeError, ValueError):
                if time.monotonic() >= end:
                    raise RuntimeError('Expected page did not appear; no click was retried')
                time.sleep(.08)


def wait_database(pin: str, invoice: int, approved: bool, timeout=60) -> dict:
    end = time.monotonic() + timeout
    while True:
        state = read_state(pin, invoice)
        if len(state['sales']) == 1:
            if not approved or (state['sales'][0]['SALES_STTS_CD'] == '02' and state['receipts']):
                return state
        if time.monotonic() >= end:
            raise RuntimeError('Database confirmation timed out; do not resubmit this sale')
        time.sleep(.08)


def choose_print_path(ui, path, seconds=30):
    deadline = time.monotonic() + seconds
    with span('print_dialog'):
        while True:
            try:
                ui.send(dict(pid=ui.pid, action='File', path=str(path)))
                return
            except RuntimeError as error:
                # This category is emitted only before any file input/save.
                if '(file dialog not ready)' not in str(error) or path.exists() or time.monotonic() >= deadline:
                    raise
                time.sleep(.1)


def wait_pdf(path, seconds=60):
    """Wait for one complete printed file. Never print again or start QR early."""
    import fitz
    deadline = time.monotonic() + seconds
    with span('pdf_wait'):
        while True:
            try:
                before = path.stat()
                if before.st_size > 50_000_000:
                    raise ValueError('Printed PDF exceeds the supported size')
                raw = path.read_bytes()
                after = path.stat()
                if (before.st_size == after.st_size == len(raw) and before.st_mtime_ns == after.st_mtime_ns
                        and raw.rstrip().endswith(b'%%EOF')):
                    with fitz.open(stream=raw, filetype='pdf') as document:
                        if not document.needs_pass and 0 < len(document) <= 20:
                            return
            except (OSError, fitz.FileDataError):
                pass
            if time.monotonic() >= deadline:
                raise RuntimeError('Original PDF did not become complete; recover this same sale without reissuing')
            time.sleep(.1)


@timed('invoice_workflow')
def _issue(pdf: Path, pin: str, name: str, payment: str, request_id: str,
          new_sale_confirmed: bool, progress=print, mappings: dict | None = None) -> dict:
    if not new_sale_confirmed:
        raise ValueError('Confirm that this is a new, separate real sale before issuance')
    ledger = ledger_path(request_id)
    if ledger.exists():
        existing = json.loads(ledger.read_text(encoding='utf-8'))
        raise ValueError(f'Sale reference already recorded ({existing["stage"]}); review its result before any further action')
    request, before = preflight(pdf, pin, name, payment, mappings)
    ledger.parent.mkdir(parents=True, exist_ok=True)
    run = dict(request_id=request_id, stage='prepared', request=request,
               created_utc=datetime.now(timezone.utc).isoformat(), kra_acceptance_verified=False)
    # Exclusive file creation prevents concurrent reuse of the same sale reference.
    with ledger.open('x', encoding='utf-8') as file:
        json.dump(run, file, indent=2)
    folder = DATA / 'output' / ledger.stem
    folder.mkdir(parents=True, exist_ok=False)
    ui = Ui(before['process_ids'][0])
    mark('prepared')
    def checkpoint(stage, **values):
        run.update(stage=stage, **values)
        write_ledger(ledger, run)
        mark(stage)
        progress(stage.replace('_', ' '))
    try:
        progress('Checking Sales Management page')
        ui.wait_screen('sales', 5)
        ui.click('sales', *point('sales','new'))
        ui.click('new-confirm', *point('new-confirm','yes'))
        invoice = int(ui.wait_screen('registration'))
        if read_state(pin, invoice)['sales']:
            raise ValueError('This invoice number already exists; stopped before save')
        checkpoint('entering_invoice', invoice_id=invoice)
        ui.click('registration', *point('registration','choose_buyer'))
        ui.text('customer-popup', *point('customer-popup','query'), pin)
        ui.click('customer-popup', *point('customer-popup','search'))
        ui.click('customer-popup', *point('customer-popup','first_result'))
        ui.expect('customer-popup', *point('customer-popup','selected_code'), pin)
        ui.click('customer-popup', *point('customer-popup','confirm'))
        ui.expect('registration', *point('registration','buyer_pin'), pin)
        for line in request['lines']:
            ui.click('registration', *point('registration','choose_item'))
            ui.text('item-popup', *point('item-popup','query'), line['item_code'])
            ui.click('item-popup', *point('item-popup','search'))
            ui.click('item-popup', *point('item-popup','first_result'))
            ui.expect('item-popup', *point('item-popup','selected_code'), line['item_code'])
            ui.click('item-popup', *point('item-popup','confirm'))
            ui.expect('registration', *point('registration','item_code'), line['item_code'])
            # Masked amount fields format commas; verification compares Decimal.
            ui.action('registration', 'Text', *point('registration','price'), line['unit_price'])
            ui.expect('registration', *point('registration','price'), line['unit_price'], numeric=True)
            ui.action('registration', 'Text', *point('registration','quantity'), line['quantity'])
            ui.expect('registration', *point('registration','quantity'), line['quantity'], numeric=True)
            # Item selection refreshes the header from TranRecord and can clear
            # unsaved text. Confirm copies this entry to TranRecord.Remark.
            ui.text('registration', *point('registration','reference'), 'Oraforge:' + request_id)
            ui.click('registration', *point('registration','confirm_line'))
        ui.expect('registration', *point('registration','reference'), 'Oraforge:' + request_id)
        ui.expect('registration', *point('registration','total'), request['total'], numeric=True)
        checkpoint('draft_save_requested')
        ui.click('registration', *point('registration','save'))
        draft = wait_database(pin, invoice, False)
        verify_sale(draft, request)
        if draft['sales'][0].get('REMARK')!='Oraforge:'+request_id:
            raise ValueError('Stored draft lost its POS reference; stopped before fiscal approval')
        checkpoint('draft_saved')
        ui.click('saved', *point('saved','no_or_ok'))
        ui.text('sales', *point('sales','invoice'), str(invoice))
        ui.click('sales', *point('sales','search'))
        ui.click('sales', *point('sales','first_result'))
        ui.click('sales', *point('sales','detail'))
        ui.expect('detail', *point('detail','invoice'), str(invoice))
        ui.expect('detail', *point('detail','buyer_pin'), pin)
        ui.click('detail', *point('detail','approve'))
        ui.click('approve-confirm', *point('approve-confirm','yes'))
        ui.wait_screen('payment')
        ui.expect('payment', *point('payment','buyer_pin'), pin)
        checkpoint('approval_requested')
        ui.click('payment', *payment_points[payment])
        approved = wait_database(pin, invoice, True)
        verify_sale(approved, request, approved=True)
        checkpoint('issued', receipt=approved['receipts'][0])
        ui.wait_screen('print')
        ui.expect('print', *point('print','invoice'), str(invoice))
        ui.click('print', *point('print','print_a4'))
        result_pdf = folder / 'eTIMS-issued-invoice.pdf'
        # Persist the intended output before Save: recovery can reconcile a
        # completed file even if the worker stops before its acknowledgement.
        checkpoint('pdf_requested', pdf=str(result_pdf))
        choose_print_path(ui, result_pdf)
        wait_pdf(result_pdf)
        with span('pdf_extract'):
            result = extract(result_pdf, folder / 'extracted')
        with span('fiscal_verification'):
            verify_pdf(result, approved)
        result.update(local_invoice_id=invoice, request_id=request_id, local_database_verified=True,
                      extraction_only=False, execution_method='Windows UI automation through the normal eTIMS client')
        (folder / 'result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        checkpoint('complete', result=str(folder / 'result.json'))
        # Engine finishes the verified print/detail views, including the distinct
        # "Print the document." info popup. Do not probe the wrong saved popup
        # here: it needlessly spends the whole screen-mismatch retry budget.
        return result
    except Exception as error:
        run['last_error'] = str(error)
        run['requires_review_before_retry'] = True
        write_ledger(ledger, run)
        raise


def issue(pdf: Path, pin: str, name: str, payment: str, request_id: str,
          new_sale_confirmed: bool, progress=print, mappings: dict | None = None) -> dict:
    DATA.mkdir(parents=True, exist_ok=True)
    lock = DATA / 'active-run.lock'
    try:
        stream = lock.open('x', encoding='utf-8')
    except FileExistsError:
        raise ValueError('Another automation run or an interrupted run holds the lock; review it before proceeding') from None
    try:
        with stream:
            json.dump(dict(pid=os.getpid(), request_id=request_id), stream)
        return _issue(pdf, pin, name, payment, request_id, new_sale_confirmed, progress, mappings)
    finally:
        lock.unlink()
