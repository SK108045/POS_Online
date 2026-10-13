"""Observed, guarded native application navigation; no application injection."""
from pathlib import Path
import tempfile
import time
from PIL import Image, ImageChops
from workflow import Ui, BASE, ps, read_state
from offline import require_offline

DIALOGS = {'close-confirm','stock-confirm','customer-confirm','new-customer','new-confirm','approve-confirm','saved','printed','import-success'}
REGIONS = {'menu':[10,110,270,440]}

class Client(Ui):
    def region(self,screen):
        return REGIONS.get(screen, [405,330,580,58] if screen in DIALOGS else [35,57,500,60])
    def action(self,screen,action,x=0,y=0,text=None):
        return self.send(dict(pid=self.pid,action=action,x=x,y=y,text=text,
                             reference=str(BASE/'profiles'/(screen+'.png')),regions=[self.region(screen)]))
    def detect(self):
        deadline=time.monotonic()+5
        while True:
            try:return self._detect_once()
            except ValueError as error:
                # Closing a page can briefly expose a partially painted frame.
                # Retry only this read; no click or other native action is replayed.
                if not str(error).startswith('Unrecognized eTIMS screen.') or time.monotonic()>=deadline:raise
                time.sleep(.15)
    def _detect_once(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'screen.png'
            self.send(dict(pid=self.pid,action='Snapshot',path=str(path)))
            with Image.open(path) as actual:
                if actual.size != (1384,786):
                    raise ValueError('Unverified client window geometry')
                for screen in list(DIALOGS)+['menu','sales','item-management','customer','stock-status','stock-adjustment','detail','print','registration']:
                    reference=BASE/'profiles'/(screen+'.png')
                    if not reference.exists():continue
                    x,y,w,h=self.region(screen)
                    with Image.open(reference) as expected:
                        a=actual.crop((x,y,x+w,y+h)).convert('RGB');b=expected.convert('RGB')
                        count=bad=0
                        for yy in range(0,h,2):
                            for xx in range(0,w,2):
                                count+=1
                                if max(abs(i-j) for i,j in zip(a.getpixel((xx,yy)),b.getpixel((xx,yy))))>24:bad+=1
                        if bad/count <= .004:return screen
        raise ValueError('Unrecognized eTIMS screen. Log in normally and finish any unrelated open form.')
    def wait(self,screen,timeout=30):
        end=time.monotonic()+timeout
        found=self.detect()
        while found!=screen:
            if time.monotonic()>=end:raise RuntimeError(f'Expected eTIMS page {screen} did not appear; observed {found}. No click was retried.')
            time.sleep(.3)
            found=self.detect()
    def close_owned(self,screen):
        self.click(screen,1314,89)
        if self.detect()=='close-confirm':self.click('close-confirm',705,530)
    def menu(self):
        screen=self.detect()
        if screen=='menu':return
        if screen not in ('sales','item-management','customer','stock-status','stock-adjustment','detail','print'):
            raise ValueError('Finish the open eTIMS form before continuing this sale')
        self.close_owned(screen)
        if self.detect()=='stock-status':self.close_owned('stock-status')
        if self.detect()=='sales':self.close_owned('sales')
        self.wait('menu')
    def navigate(self,target):
        if self.detect()==target:return
        self.menu()
        if target=='sales':
            self.click('menu',160,325)
        elif target=='item-management':
            self.click('menu',160,197);self.click('menu',420,255)
        elif target=='customer':
            self.click('menu',160,261);self.click('menu',420,319)
        elif target=='stock-status':
            self.click('menu',160,520);self.click('menu',420,625)
        else:raise ValueError('Unsupported native destination')
        self.wait(target)
    def normalize(self):
        ps('tools/normalize-window.ps1','-TargetProcessId',str(self.pid))
    def finish_invoice(self,invoice):
        # Only close read-only views whose displayed invoice identity is verified.
        screen=self.detect()
        if screen=='printed':
            # This is an informational print acknowledgement, not an approval.
            # Its overlay hides the underlying edit controls from hit testing.
            # Verify the invoice immediately after dismissing this exact message.
            self.click('printed',885,530);screen=self.detect()
        if screen=='print':
            self.expect('print',330,324,str(invoice))
            self.close_owned('print');screen=self.detect()
        if screen=='detail':
            self.expect('detail',240,216,str(invoice))
            self.close_owned('detail');screen=self.detect()
        if screen=='menu':self.navigate('sales');return
        if screen!='sales':raise ValueError('Finish the unrelated open eTIMS form before continuing')
    def register_products(self,path,registrations,buyer,checkpoint):
        # Validate absence immediately before import: native import can overwrite stock.
        state=read_state(buyer)
        if set(registrations) & {i['ITEM_CD'] for i in state['items']}:
            raise ValueError('An import code already exists; reconcile before any import retry')
        self.navigate('item-management')
        checkpoint('native_product_import_requested')
        self.click('item-management',705,89)
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
        self.wait('import-success');self.click('import-success',885,530)
        checkpoint('products_registered')
    def ensure_customer(self,customer,checkpoint):
        state=read_state(customer['pin'])
        if state['customers']:
            if len(state['customers'])!=1 or state['customers'][0]['CUST_NM']!=customer['name']:
                raise ValueError('Buyer PIN exists with a different registered name')
            return
        self.navigate('customer');self.click('customer',950,89)
        self.wait('new-customer');self.click('new-customer',705,530)
        self.text('customer',300,216,customer['pin']);self.text('customer',300,252,customer['name'])
        if customer.get('phone'):self.text('customer',1200,179,customer['phone'])
        if customer.get('billing_address'):self.text('customer',300,324,customer['billing_address'])
        remarks='; '.join(filter(None,[customer.get('remarks'),('Email: '+customer['email']) if customer.get('email') else '']))
        if remarks:self.text('customer',750,324,remarks)
        checkpoint('customer_save_requested')
        self.click('customer',1070,89);self.wait('customer-confirm');self.click('customer-confirm',705,530)
        end=time.monotonic()+30
        while True:
            records=read_state(customer['pin'])['customers']
            if records:
                if len(records)!=1 or records[0]['CUST_NM']!=customer['name']:raise ValueError('Customer save did not match buyer identity')
                break
            if time.monotonic()>=end:raise RuntimeError('Customer save not confirmed')
            time.sleep(.5)
        if self.detect()=='saved':self.click('saved',885,530)
        checkpoint('customer_registered')
    def adjust_stock(self,code,adjustment,buyer,checkpoint):
        from decimal import Decimal
        current=next(i for i in read_state(buyer)['items'] if i['ITEM_CD']==code)
        if Decimal(str(current['RSD_QTY']))==Decimal(adjustment['after']):return
        if Decimal(str(current['RSD_QTY']))!=Decimal(adjustment['before']):raise ValueError('Stock changed since confirmation; review actual inventory')
        self.navigate('stock-status');self.text('stock-status',1000,179,code)
        self.click('stock-status',1300,179);self.click('stock-status',410,262);self.click('stock-status',1194,89)
        self.wait('stock-confirm');self.click('stock-confirm',705,530);self.wait('stock-adjustment')
        self.expect('stock-adjustment',300,179,code)
        require_offline()
        ps('tools/select-observed-combo.ps1','-TargetProcessId',str(self.pid),'-X','160','-Y','506','-Option','Adjustment In')
        self.text('stock-adjustment',750,506,adjustment['reason'])
        self.action('stock-adjustment','Text',450,615,adjustment['quantity'])
        # StockAdjustmentPage calculates Qty After in Entry.Completed.
        # Enter completes this edit; Save is a separate, guarded action.
        self.action('stock-adjustment','Complete',450,615)
        self.expect('stock-adjustment',450,615,adjustment['quantity'],numeric=True)
        self.expect('stock-adjustment',750,615,adjustment['after'],numeric=True)
        checkpoint('stock_adjustment_requested')
        self.click('stock-adjustment',1194,89)
        end=time.monotonic()+30
        while True:
            item=next(i for i in read_state(buyer)['items'] if i['ITEM_CD']==code)
            if Decimal(str(item['RSD_QTY']))==Decimal(adjustment['after']):break
            if time.monotonic()>=end:raise RuntimeError('Inventory adjustment not confirmed; do not repeat')
            time.sleep(.5)
        if self.detect()=='saved':self.click('saved',885,530)
        checkpoint('stock_reconciled')
