"""Observed, guarded native application navigation; no application injection."""
from ui_map import UI_MAP, point, region
import json
import time
from workflow import Ui, BASE, ps, read_state
from offline import require_offline
from timing import timed

DIALOGS = set(UI_MAP['dialogs'])
NAVIGATION = {screen:profile['navigation'] for screen,profile in UI_MAP['screens'].items() if 'navigation' in profile}

class Client(Ui):
    def region(self,screen):
        return region(screen)
    def action(self,screen,action,x=0,y=0,text=None):
        instruction=dict(pid=self.pid,action=action,x=x,y=y,text=text,
                         reference=str(BASE/'profiles'/(screen+'.png')),regions=[self.region(screen)])
        if action=='Close':
            navigation=NAVIGATION[screen]
            if (x,y)!=tuple(navigation['point']):raise ValueError('Unverified page navigation point')
            # Xamarin draws these toolbar buttons on a canvas: no UIA Button
            # peer exists. Verify Close/Back/Cancel as well as the page,
            # especially beside the popups' distinct Confirm button.
            instruction.update(navigation_reference=str(BASE/'profiles'/(navigation['profile']+'.png')),
                               navigation_region=navigation['region'])
        return self.send(instruction)
    def detect(self):
        deadline=time.monotonic()+5
        while True:
            try:return self._detect_once()
            except ValueError as error:
                # Closing a page can briefly expose a partially painted frame.
                # Retry only this read; no click or other native action is replayed.
                if not str(error).startswith('Unrecognized eTIMS screen.') or time.monotonic()>=deadline:
                    if str(error).startswith('Unrecognized eTIMS screen.'):self.diagnose()
                    raise
                time.sleep(.15)
    def _detect_once(self):
        profiles=[dict(screen=screen,reference=str(BASE/'profiles'/(screen+'.png')),region=self.region(screen))
                  for screen in sorted(DIALOGS)+['menu','sales','item-management','customer','stock-status','stock-adjustment','detail','print','registration','payment','item-popup','customer-popup']
                  if (BASE/'profiles'/(screen+'.png')).exists()]
        try:
            return json.loads(self.send(dict(pid=self.pid,action='Detect',profiles=profiles)))['screen']
        except RuntimeError as error:
            if '(unrecognized screen)' in str(error):
                raise ValueError('Unrecognized eTIMS screen. Log in normally and finish any unrelated open form. '+str(error)) from None
            if '(window geometry mismatch)' in str(error):
                raise ValueError('Unverified client window geometry') from None
            raise
    def wait(self,screen,timeout=30):
        end=time.monotonic()+timeout
        found=self.detect()
        while found!=screen:
            if time.monotonic()>=end:raise RuntimeError(f'Expected eTIMS page {screen} did not appear; observed {found}. No click was retried.')
            time.sleep(.3)
            found=self.detect()
    def close_owned(self,screen):
        self.close_page(screen)
        if self.detect()=='close-confirm':self.click('close-confirm',*point('close-confirm','yes'))
    def close_page(self,screen):
        self.action(screen,'Close',*NAVIGATION[screen]['point'])
    def menu(self):
        screen=self.detect()
        if screen=='menu':return
        if screen not in ('sales','item-management','customer','stock-status','stock-adjustment','detail','print'):
            raise ValueError('Finish the open eTIMS form before continuing this sale')
        self.close_owned(screen)
        if self.detect()=='stock-status':self.close_owned('stock-status')
        if self.detect()=='sales':self.close_owned('sales')
        self.wait('menu')
    @timed('navigate')
    def reset_menu(self):
        """User-authorized takeover: close unsaved pages, never save/approve/delete."""
        for _ in range(18):
            state=self.file_state()
            if state['file_dialog']:
                require_offline()
                ps('tools/cancel-file-dialog.ps1','-TargetProcessId',str(self.pid),'-DialogTitle',state['file_dialog'])
                continue
            screen=self.detect()
            if screen=='menu':return
            if screen in ('saved','printed','import-success'):
                self.click(screen,*point(screen,'no_or_ok')) # Informational OK only.
            elif screen in ('new-confirm','approve-confirm','stock-confirm','customer-confirm','new-customer'):
                self.click(screen,*point(screen,'no_or_ok')) # No: never create/approve on takeover.
            elif screen=='close-confirm':
                self.click(screen,*point(screen,'yes')) # Close without saving (explicit user instruction).
            elif screen in ('sales','registration','payment','item-popup','customer-popup','item-management','customer','stock-status','stock-adjustment','detail','print'):
                self.close_page(screen)
            else:
                raise ValueError('Unrecognized eTIMS page; no unverified close action was sent')
        raise RuntimeError('eTIMS did not return to its main menu; no sale was submitted')
    @timed('navigate')
    def navigate(self,target):
        if self.detect()==target:return
        self.menu()
        if target=='sales':
            self.click('menu',*point('menu','sales'))
        elif target=='item-management':
            self.click('menu',*point('menu','items'));self.click('menu',*point('menu','items_submenu'))
        elif target=='customer':
            self.click('menu',*point('menu','customers'));self.click('menu',*point('menu','customers_submenu'))
        elif target=='stock-status':
            self.click('menu',*point('menu','stock'));self.click('menu',*point('menu','stock_submenu'))
        else:raise ValueError('Unsupported native destination')
        self.wait(target)
    def normalize(self):
        ps('tools/normalize-window.ps1','-TargetProcessId',str(self.pid))
    def file_state(self,screen=None):
        mode={'print':'Print','detail':'Detail'}.get(screen,'None')
        return json.loads(ps('tools/inspect-file-dialog.ps1','-TargetProcessId',str(self.pid),'-InvoiceScreen',mode))
    def finish_invoice(self,invoice):
        # Only close read-only views whose displayed invoice identity is verified.
        screen=self.detect()
        if screen in ('printed','saved'):
            # This is an informational print acknowledgement, not an approval.
            # Its overlay hides the underlying edit controls from hit testing.
            # Verify the invoice immediately after dismissing this exact message.
            self.click(screen,*point(screen,'no_or_ok'));screen=self.detect()
        if screen=='print':
            self.expect('print',*point('print','invoice'),str(invoice))
            self.close_owned('print');screen=self.detect()
        if screen=='detail':
            self.expect('detail',*point('detail','invoice'),str(invoice))
            self.close_owned('detail');screen=self.detect()
        if screen=='sales':self.close_owned('sales');screen=self.detect()
        if screen!='menu':raise ValueError('Finish the unrelated open eTIMS form before continuing')
    @timed('product_registration')
    def register_products(self,path,registrations,buyer,checkpoint):
        # Validate absence immediately before import: native import can overwrite stock.
        state=read_state(buyer)
        if set(registrations) & {i['ITEM_CD'] for i in state['items']}:
            raise ValueError('An import code already exists; reconcile before any import retry')
        self.navigate('item-management')
        checkpoint('native_product_import_requested')
        self.click('item-management',*point('item-management','import'))
        require_offline()
        ps('tools/choose-native-file.ps1','-TargetProcessId',str(self.pid),'-Path',str(path),'-DialogTitle','Open')
        end=time.monotonic()+60
        while True:
            found={i['ITEM_CD']:i for i in read_state(buyer)['items']}
            if all(code in found for code in registrations):break
            if time.monotonic()>=end:raise RuntimeError('Native product import was not confirmed; do not repeat blindly')
            time.sleep(.5)
        for code,registration in registrations.items():
            item,meta=registration['item'],registration['metadata'];actual=found[code]
            checks={'ITEM_NM':item['name'],'ITEM_CLS_CD':meta['class_code'],'ITEM_TY_CD':meta['item_type'],
                    'ORGN_NAT_CD':meta['origin'],'PKG_UNIT_CD':meta['package_unit'],
                    'QTY_UNIT_CD':meta['quantity_unit'],'TAX_TY_CD':meta['tax_code']}
            from decimal import Decimal
            if any(str(actual[k])!=str(v) for k,v in checks.items()) or Decimal(str(actual['RSD_QTY']))!=Decimal(registration['quantity']):
                raise ValueError('Imported product or actual opening stock differs from the approved registration')
        self.wait('import-success');self.click('import-success',*point('import-success','no_or_ok'))
        checkpoint('products_registered')
    @timed('customer')
    def ensure_customer(self,customer,checkpoint):
        state=read_state(customer['pin'],scope='Customer')
        if state['customers']:
            if len(state['customers'])!=1 or state['customers'][0]['CUST_NM']!=customer['name']:
                raise ValueError('Buyer PIN exists with a different registered name')
            return
        self.navigate('customer');self.click('customer',*point('customer','new'))
        self.wait('new-customer');self.click('new-customer',*point('new-customer','yes'))
        self.text('customer',*point('customer','pin'),customer['pin']);self.text('customer',*point('customer','name'),customer['name'])
        if customer.get('phone'):self.text('customer',*point('customer','phone'),customer['phone'])
        if customer.get('billing_address'):self.text('customer',*point('customer','address'),customer['billing_address'])
        remarks='; '.join(filter(None,[customer.get('remarks'),('Email: '+customer['email']) if customer.get('email') else '']))
        if remarks:self.text('customer',*point('customer','remarks'),remarks)
        checkpoint('customer_save_requested')
        self.click('customer',*point('customer','save'));self.wait('customer-confirm');self.click('customer-confirm',*point('customer-confirm','yes'))
        end=time.monotonic()+30
        while True:
            records=read_state(customer['pin'],scope='Customer')['customers']
            if records:
                if len(records)!=1 or records[0]['CUST_NM']!=customer['name']:raise ValueError('Customer save did not match buyer identity')
                break
            if time.monotonic()>=end:raise RuntimeError('Customer save not confirmed')
            time.sleep(.5)
        if self.detect()=='saved':self.click('saved',*point('saved','no_or_ok'))
        checkpoint('customer_registered')
    @timed('stock_adjustment')
    def adjust_stock(self,code,adjustment,buyer,checkpoint):
        from decimal import Decimal
        current=next(i for i in read_state(buyer)['items'] if i['ITEM_CD']==code)
        if Decimal(str(current['RSD_QTY']))==Decimal(adjustment['after']):return
        if Decimal(str(current['RSD_QTY']))!=Decimal(adjustment['before']):raise ValueError('Stock changed since confirmation; review actual inventory')
        self.navigate('stock-status');self.text('stock-status',*point('stock-status','query'),code)
        self.click('stock-status',*point('stock-status','search'));self.click('stock-status',*point('stock-status','first_result'));self.click('stock-status',*point('stock-status','adjust'))
        self.wait('stock-confirm');self.click('stock-confirm',*point('stock-confirm','yes'));self.wait('stock-adjustment')
        self.expect('stock-adjustment',*point('stock-adjustment','item_code'),code)
        require_offline()
        x,y=point('stock-adjustment','type')
        ps('tools/select-observed-combo.ps1','-TargetProcessId',str(self.pid),'-X',str(x),'-Y',str(y),'-Option','Adjustment In')
        self.text('stock-adjustment',*point('stock-adjustment','reason'),adjustment['reason'])
        self.action('stock-adjustment','Text',*point('stock-adjustment','quantity'),adjustment['quantity'])
        # StockAdjustmentPage calculates Qty After in Entry.Completed.
        # Enter completes this edit; Save is a separate, guarded action.
        self.action('stock-adjustment','Complete',*point('stock-adjustment','quantity'))
        self.expect('stock-adjustment',*point('stock-adjustment','quantity'),adjustment['quantity'],numeric=True)
        self.expect('stock-adjustment',*point('stock-adjustment','after'),adjustment['after'],numeric=True)
        checkpoint('stock_adjustment_requested')
        self.click('stock-adjustment',*point('stock-adjustment','save'))
        end=time.monotonic()+30
        while True:
            item=next(i for i in read_state(buyer)['items'] if i['ITEM_CD']==code)
            if Decimal(str(item['RSD_QTY']))==Decimal(adjustment['after']):break
            if time.monotonic()>=end:raise RuntimeError('Inventory adjustment not confirmed; do not repeat')
            time.sleep(.5)
        if self.detect()=='saved':self.click('saved',*point('saved','no_or_ok'))
        checkpoint('stock_reconciled')
