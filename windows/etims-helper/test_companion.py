"""Isolated contract, registration and crash-safety tests. No native client writes."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile
import xml.etree.ElementTree as ET
from contracts import validate, job_id, to_request, product_key, digest
from products import plan, workbook
from store import Store

CONFIG={'taxpayer_pin':'A123456789B','branch_id':'01'}
META=dict(class_code='60102300',item_type='2',origin='KE',package_unit='OU',quantity_unit='NO',tax_code='D',unit_cost_cents=10000,verified=True)
def sale():
    return dict(version=2,currency='KES',shop_id='fixture',sale_id=1,receipt_no='FIXTURE-1',customer={'pin':'A987654321Z','name':'Fixture Buyer'},
                payment_method='cash',subtotal_cents=30000,total_cents=30000,tax_cents=0,discount={'amount_cents':0},
                items=[dict(product_key='catalog:1',name='Fixture Book',quantity=2,unit_price_cents=15000,line_total_cents=30000,
                            registration=copy.deepcopy(META),inventory={'inventory_before_sale':8,'inventory_confirmed':True})])
def state():
    return dict(items=[],classes=[{'ITEM_CLS_CD':'60102300'}],codes=[{'CD_CLS':g,'CD':v} for g,v in [('24','2'),('24','3'),('05','KE'),('17','OU'),('10','NO'),('04','D')]])
def item(stock=8):
    return dict(ITEM_CD='KE-2OUXNOX-0000001',ITEM_NM='Fixture Book',ITEM_CLS_CD='60102300',ITEM_TY_CD='2',ORGN_NAT_CD='KE',PKG_UNIT_CD='OU',QTY_UNIT_CD='NO',TAX_TY_CD='D',RSD_QTY=stock,USE_YN='Y',EXPIRATION_YN='N')

class CompanionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.home=Path(self.temp.name);self.store=Store(self.home/'companion.sqlite3')
    def tearDown(self):self.temp.cleanup()
    def test_integer_cents_and_required_buyer(self):
        validate(sale())
        for mutate in [lambda s:s['customer'].pop('pin'),lambda s:s.update(total_cents=29999),lambda s:s['items'][0].update(quantity=3),lambda s:s['items'][0].update(unit_price_cents=150.0)]:
            s=sale();mutate(s)
            with self.assertRaises(ValueError):validate(s)
    def test_tax_and_discount_are_never_silently_changed(self):
        for field in ('tax','discount'):
            s=sale()
            if field=='tax':s['tax_cents']=400
            else:s['discount']['amount_cents']=100;s['total_cents']-=100
            with self.assertRaisesRegex(ValueError,'Non-VAT'):validate(s)
    def test_repeated_product_identity_must_agree(self):
        s=sale();second=copy.deepcopy(s['items'][0]);second['name']='Different product';s['items'].append(second)
        with self.assertRaisesRegex(ValueError,'inconsistent'):validate(s)
    def test_job_identity_does_not_change_with_payload(self):
        s=sale();key=job_id(s);self.store.create(s)
        self.assertEqual(key,self.store.create(s)['id'])
        s['customer']['name']='Another Buyer'
        self.assertEqual(key,job_id(s))
        with self.assertRaisesRegex(ValueError,'different sale details'):self.store.create(s)
    def test_completed_job_and_mapping_survive_restart(self):
        s=sale();key=self.store.create(s)['id'];self.store.update(key,'complete',result={'local_invoice_id':4})
        self.store.map('mapping','CODE',META)
        restarted=Store(self.home/'companion.sqlite3')
        self.assertEqual(restarted.get(key)['result']['local_invoice_id'],4)
        self.assertEqual(restarted.mapping('mapping')['code'],'CODE')
        self.assertEqual(restarted.interrupted(),[])
        with self.assertRaises(ValueError):restarted.map('mapping','OTHER',META)
    def test_multiple_missing_products_get_stable_distinct_codes(self):
        s=sale();second=copy.deepcopy(s['items'][0]);second.update(product_key='manual:another',name='Another Book');s['items'].append(second)
        p=plan(s,{},state(),self.store,CONFIG)
        self.assertEqual(p['requirements'],[]);self.assertEqual(len(p['missing']),2)
        again=plan(s,{},state(),self.store,CONFIG);self.assertEqual(p['codes'],again['codes'])
        for k,v in p['mappings'].items():self.store.map(k,v['code'],v['metadata'])
        self.assertEqual(p['codes'],plan(s,{},state(),self.store,CONFIG)['codes'])
    def test_existing_product_is_selected_without_import(self):
        s=sale();st=state();st['items']=[item()];p=plan(s,{},st,self.store,CONFIG)
        self.assertEqual(p['missing'],{});self.assertEqual(p['codes']['catalog:1'],item()['ITEM_CD'])
    def test_ambiguous_or_inactive_products_are_not_duplicated(self):
        st=state();other=item();other['ITEM_CD']='ANOTHER';st['items']=[item(),other]
        p=plan(sale(),{},st,self.store,CONFIG);self.assertIn('existing_code',p['requirements'][0]['missing'])
        st['items']=[{**item(),'USE_YN':'N'}]
        with self.assertRaisesRegex(ValueError,'inactive'):plan(sale(),{},st,self.store,CONFIG)
    def test_unknown_classification_or_origin_is_rejected(self):
        for field in ('class_code','origin','tax_code'):
            s=sale();s['items'][0]['registration'][field]='UNKNOWN'
            with self.assertRaises(ValueError):plan(s,{},state(),self.store,CONFIG)
    def test_stock_is_not_invented_and_confirmation_is_per_sale(self):
        s=sale();s['items'][0]['inventory']={}
        p=plan(s,{},state(),self.store,CONFIG)
        self.assertIn('inventory_before_sale',p['requirements'][0]['missing'])
        self.assertIn('inventory_confirmed',p['requirements'][0]['missing'])
        s['items'][0]['inventory']={'inventory_before_sale':1,'inventory_confirmed':True}
        with self.assertRaisesRegex(ValueError,'Actual inventory'):plan(s,{},state(),self.store,CONFIG)
    def test_legitimate_stock_delta_and_no_stale_inventory_mapping(self):
        s=sale();st=state();st['items']=[item(0)]
        p=plan(s,{'catalog:1':{'stock_reason':'Physical count verified'}},st,self.store,CONFIG)
        self.assertEqual(p['adjustments'][item()['ITEM_CD']]['quantity'],'8')
        meta=next(iter(p['mappings'].values()))['metadata'];self.assertNotIn('inventory_before_sale',meta)
        s['items'][0]['inventory']={}
        key=product_key(s,s['items'][0],**{'taxpayer':CONFIG['taxpayer_pin'],'branch':'01'})
        self.store.map(key,item()['ITEM_CD'],{**META,'inventory_before_sale':999,'inventory_confirmed':True})
        self.assertIn('inventory_before_sale',plan(s,{},st,self.store,CONFIG)['requirements'][0]['missing'])
    def test_combined_stock_across_two_pos_keys_is_checked(self):
        s=sale();second=copy.deepcopy(s['items'][0]);second['product_key']='catalog:2';s['items'].append(second)
        st=state();st['items']=[item(3)]
        with self.assertRaisesRegex(ValueError,'combined stock'):plan(s,{},st,self.store,CONFIG)
    def test_import_workbook_contains_only_missing_products_and_actual_stock(self):
        p=plan(sale(),{},state(),self.store,CONFIG);out=workbook(p['missing'],self.home/'import','01')
        with ZipFile(out) as z:
            ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
            strings=ET.fromstring(z.read('xl/sharedStrings.xml'));texts=[''.join(t.itertext()) for t in strings]
            sheet=ET.fromstring(z.read('xl/worksheets/sheet1.xml'));rows=sheet.findall('s:sheetData/s:row',ns)
            self.assertEqual(len(rows),2);self.assertIn('Fixture Book',texts)
            cells={c.attrib['r']:c.find('s:v',ns).text for c in rows[1]}
            self.assertEqual(cells['AD2'],'100');self.assertEqual(cells['AE2'],'8')
    def test_expiry_product_is_never_imported_without_batch_workflow(self):
        s=sale();s['items'][0]['expiry_date']='2028-01-01'
        with self.assertRaisesRegex(ValueError,'Expiry-controlled'):plan(s,{},state(),self.store,CONFIG)
    def test_request_is_bound_to_exact_pos_snapshot(self):
        s=sale();r=to_request(s,{'catalog:1':'CODE'})
        self.assertEqual(r['pos_sale_digest'],digest(s));self.assertEqual(r['payment_code'],'01')
        self.assertEqual(r['total'],'300');self.assertEqual(r['lines'][0]['quantity'],'2')
    def test_kenya_default_only_applies_to_new_products(self):
        s=sale();s['items'][0]['registration'].pop('origin');config={**CONFIG,'registration_defaults':{'origin':'KE'}}
        p=plan(s,{},state(),self.store,config);self.assertEqual(next(iter(p['missing'].values()))['metadata']['origin'],'KE')
        st=state();st['items']=[{**item(),'ORGN_NAT_CD':'CN'}]
        p=plan(s,{},st,self.store,config);self.assertEqual(next(iter(p['mappings'].values()))['metadata']['origin'],'CN')
    def test_actual_device_identity_must_match_before_ui_writes(self):
        from engine import verify_device
        row={'TIN':CONFIG['taxpayer_pin'],'BHF_ID':'01'}
        verify_device({'registered_devices':[row,row]},CONFIG)
        for devices in ([],[{**row,'BHF_ID':'02'}],[row,{**row,'TIN':'A000000000Z'}]):
            with self.assertRaisesRegex(ValueError,'installed eTIMS device'):
                verify_device({'registered_devices':devices},CONFIG)
    def test_offline_requirement_stops_preflight_before_native_reads(self):
        from engine import Engine
        engine=Engine.__new__(Engine);engine.store=self.store
        with patch('engine.require_identity',return_value=CONFIG),patch('engine.require_offline',side_effect=ValueError('Internet blocking missing')),patch('engine.workflow.read_state') as read:
            with self.assertRaisesRegex(ValueError,'Internet blocking'):
                engine.prepare(sale())
            read.assert_not_called()
    def test_offline_requirement_blocks_every_mutating_ui_action(self):
        import workflow
        for action in ('Click','Text','File','Complete'):
            with patch('offline.require_offline',side_effect=ValueError('Internet blocking missing')),patch('workflow.ps') as execute:
                with self.assertRaisesRegex(ValueError,'Internet blocking'):
                    workflow.Ui(123).send({'action':action})
                execute.assert_not_called()
    def test_privilege_mismatch_stops_preparation_before_native_navigation(self):
        from engine import Engine
        native=state();native.update(registered_devices=[{'TIN':CONFIG['taxpayer_pin'],'BHF_ID':'01'}],process_ids=[123])
        engine=Engine.__new__(Engine);engine.store=self.store
        with patch('engine.require_identity',return_value={**CONFIG,'installation_dir':'fixture'}),patch('engine.require_offline'),patch('engine.Path') as path,patch('engine.hashlib.sha256') as sha,patch('engine.workflow.read_state',return_value=native),patch('engine.require_ui_access',side_effect=ValueError('Repair eTIMS Helper Access')),patch('engine.Client') as client:
            import workflow
            sha.return_value.hexdigest.return_value=workflow.CLIENT_HASH
            with self.assertRaisesRegex(ValueError,'Repair eTIMS'):engine.prepare(sale())
            client.assert_not_called()
    def test_all_powershell_children_are_hidden_in_gui_build(self):
        import subprocess,workflow,pdf_invoice
        from powershell_host import PowerShellHost
        result=subprocess.CompletedProcess([],0,stdout=b'null',stderr=b'')
        with patch('powershell_host.execute',return_value=result) as run:
            workflow.ps('read-state.ps1')
            self.assertEqual(run.call_args.args[0],'read-state.ps1')
            with patch('pdf_invoice.settings',return_value={'installation_dir':'fixture'}):
                pdf_invoice.decode_qr(Path('fixture.png'))
            self.assertEqual(run.call_args.args[0],'tools/decode-qr.ps1')
        with patch.object(subprocess,'CREATE_NO_WINDOW',0x08000000,create=True),patch('subprocess.Popen') as start:
            host=PowerShellHost()
            with patch('powershell_host.threading.Thread'):
                host._start()
            self.assertEqual(start.call_args.kwargs['creationflags'],0x08000000)
            self.assertEqual(start.call_args.kwargs['stderr'],subprocess.DEVNULL)
            self.assertIn('-STA',start.call_args.args[0])
    def test_stock_adjustment_completes_native_entry_before_calculation_and_save(self):
        from client import Client
        after={'saved':False,'completed':False,'checked':False}
        native=lambda _: {'items':[{'ITEM_CD':'BOOK','RSD_QTY':20 if after['saved'] else 0}]}
        class NativeStock(Client):
            def navigate(self,*args):pass
            def text(self,*args):pass
            def wait(self,*args):pass
            def detect(self):return 'stock-adjustment'
            def action(self,screen,action,*args):
                if action=='Complete':after['completed']=True
            def click(self,screen,x,y):
                if screen=='stock-adjustment' and (x,y)==(1194,89):
                    if not after['checked']:raise AssertionError('Save before verified native calculation')
                    after['saved']=True
            def expect(self,screen,x,y,value,**kwargs):
                if (x,y)==(750,615):
                    if not after['completed']:raise ValueError('Native Entry.Completed was not triggered')
                    after['checked']=True
        with patch('client.read_state',side_effect=native),patch('client.require_offline'),patch('client.ps'):
            NativeStock(123).adjust_stock('BOOK',{'before':'0','after':'20','quantity':'20','reason':'Verified physical count'},'fixture',lambda _:None)
        self.assertTrue(after['saved'])
    def test_ui_failure_reports_only_whitelisted_reason(self):
        import subprocess,workflow
        result=subprocess.CompletedProcess([],1,stdout=b'',stderr=b'Screen does not match the verified workflow; password=PRIVATE-CREDENTIAL')
        with patch('powershell_host.execute',return_value=result):
            with self.assertRaisesRegex(RuntimeError,'screen mismatch') as error:workflow.ps('ui-step.ps1')
        self.assertNotIn('PRIVATE-CREDENTIAL',str(error.exception))
    def test_faster_transport_waits_only_on_screen_guard_before_input(self):
        import workflow
        instruction=dict(action='Click',reference='sales.png')
        with patch('workflow.ps',side_effect=[RuntimeError('ui-step.ps1 failed (screen mismatch); stopped without retrying the action'),'done']) as execute,patch('offline.require_offline') as offline,patch('workflow.time.sleep'):
            self.assertEqual(workflow.Ui(123).send(instruction),'done')
            self.assertEqual(execute.call_count,2)
            self.assertEqual(offline.call_count,2)
        for message in ('target focus unavailable','Windows worker timed out','Windows operation failed'):
            with patch('workflow.ps',side_effect=RuntimeError(message)) as execute,patch('offline.require_offline'):
                with self.assertRaises(RuntimeError):workflow.Ui(123).send(instruction)
                execute.assert_called_once()
    def test_navigation_tolerates_only_transient_unrecognized_snapshots(self):
        from client import Client
        with patch.object(Client,'_detect_once',side_effect=[ValueError('Unrecognized eTIMS screen. Transition frame'),'sales']) as snapshot,patch('client.time.sleep'):
            self.assertEqual(Client(123).detect(),'sales')
            self.assertEqual(snapshot.call_count,2)
        with patch.object(Client,'_detect_once',side_effect=ValueError('Unverified client window geometry')) as snapshot:
            with self.assertRaisesRegex(ValueError,'geometry'):Client(123).detect()
            snapshot.assert_called_once()
        with patch.object(Client,'_detect_once',side_effect=ValueError('Unrecognized eTIMS screen. Unknown page')) as snapshot,patch('client.time.monotonic',side_effect=[0,6]):
            with self.assertRaisesRegex(ValueError,'Unrecognized'):Client(123).detect()
            snapshot.assert_called_once()
    def test_cleanup_checks_native_invoice_identity_before_closing_any_view(self):
        from client import Client
        with patch.object(Client,'detect',side_effect=['print','detail','sales']),patch.object(Client,'expect') as expect,patch.object(Client,'close_owned') as close:
            Client(123).finish_invoice(5)
            self.assertEqual(expect.call_args_list[0].args,('print',330,324,'5'))
            self.assertEqual(expect.call_args_list[1].args,('detail',240,216,'5'))
            self.assertEqual([c.args[0] for c in close.call_args_list],['print','detail'])
        with patch.object(Client,'detect',return_value='print'),patch.object(Client,'expect',side_effect=ValueError('Wrong invoice')),patch.object(Client,'close_owned') as close:
            with self.assertRaisesRegex(ValueError,'Wrong invoice'):Client(123).finish_invoice(5)
            close.assert_not_called()
    def test_only_completed_companion_invoices_can_own_a_native_view(self):
        key=self.store.create(sale())['id']
        self.assertIsNone(self.store.completed_invoice(5))
        self.store.update(key,'complete',result={'local_invoice_id':5,'fiscal':{'cu_invoice_number':'FIXTURE/5'}})
        self.assertEqual(self.store.completed_invoice(5)['fiscal']['cu_invoice_number'],'FIXTURE/5')
        self.assertIsNone(self.store.completed_invoice(6))
    def test_recovery_of_ledger_never_calls_fresh_issue(self):
        from engine import Engine
        s=sale();key=self.store.create(s)['id'];ledger=self.home/'ledger.json'
        ledger.write_text(json.dumps({'invoice_id':4,'request':{'pos_sale_digest':digest(s)}}))
        engine=Engine.__new__(Engine);engine.store=self.store
        with patch('engine.workflow.ledger_path',return_value=ledger),patch.object(engine,'resume',return_value={'verified':True}) as resume,patch.object(engine,'result',return_value={'local_invoice_id':4}),patch('engine.workflow.issue') as issue:
            engine.run(key);resume.assert_called_once();issue.assert_not_called()
        self.assertEqual(self.store.get(key)['state'],'complete')
    def test_pdf_capture_progress_cannot_publish_a_complete_job_without_result(self):
        from engine import Engine
        s=sale();key=self.store.create(s)['id']
        engine=Engine.__new__(Engine);engine.store=self.store
        registration=dict(requirements=[],mappings={},missing={},adjustments={},codes={'catalog:1':'BOOK'})
        def issue(*args):
            args[6]('complete')
            self.assertEqual(self.store.get(key)['state'],'invoice_captured')
            self.assertIsNone(self.store.get(key)['result'])
            return {'captured':True}
        with patch('engine.workflow.ledger_path',return_value=self.home/'absent.json'),patch.object(engine,'prepare',return_value=(CONFIG,{'process_ids':[123]},registration)),patch('engine.Client') as native,patch('engine.workflow.issue',side_effect=issue),patch.object(engine,'result',return_value={'fiscal':{'verified':True}}):
            native.return_value.detect.return_value='menu'
            engine.run(key)
        self.assertEqual(self.store.get(key)['state'],'complete')
        self.assertTrue(self.store.get(key)['result']['fiscal']['verified'])
    def test_native_item_selection_cannot_erase_the_pos_reference_before_draft_save(self):
        import workflow
        request=to_request(sale(),{'catalog:1':'BOOK'});key=job_id(sale())
        edits={'remark':'','stored':None}
        class NativeSale:
            def __init__(self,*args):pass
            def wait_screen(self,screen,*args):return '4' if screen=='registration' else ''
            def text(self,screen,x,y,value):
                if screen=='registration' and (x,y)==(300,433):edits['remark']=value
            def click(self,screen,x,y):
                if screen=='item-popup' and (x,y)==(1314,89):edits['remark']=''
                if screen=='registration' and (x,y)==(844,434):edits['stored']=edits['remark']
            def action(self,*args):pass
            def expect(self,screen,x,y,value,**kwargs):
                if screen=='registration' and (x,y)==(300,433):
                    if edits['remark']!=value:raise ValueError('Native header refresh erased reference')
        def stop_after_draft(stage):
            if stage=='draft saved':raise RuntimeError('TEST_STOP_AFTER_VERIFIED_DRAFT')
        with patch('workflow.DATA',self.home),patch('workflow.ledger_path',return_value=self.home/'marker-ledger.json'),patch('workflow.preflight',return_value=(request,{'process_ids':[123]})),patch('workflow.Ui',NativeSale),patch('workflow.read_state',return_value={'sales':[]}),patch('workflow.wait_database',side_effect=lambda *args:{'sales':[{'REMARK':edits['stored']}]}),patch('workflow.verify_sale'):
            with self.assertRaisesRegex(RuntimeError,'TEST_STOP_AFTER_VERIFIED_DRAFT'):
                workflow._issue(request,request['buyer_pin'],request['buyer_name'],'01',key,True,stop_after_draft)
        self.assertEqual(edits['stored'],'Oraforge:'+key)
    def test_approved_legacy_capture_recovers_with_blank_native_marker_without_ui(self):
        from engine import Engine
        import hashlib
        s=sale();key=job_id(s);request=to_request(s,{'catalog:1':'BOOK'})
        pdf=self.home/'original.pdf';pdf.write_bytes(b'fixture-original-pdf')
        raw=dict(request_id=key,local_invoice_id=4,pdf=str(pdf),pdf_sha256=hashlib.sha256(pdf.read_bytes()).hexdigest())
        result=self.home/'captured.json';result.write_text(json.dumps(raw))
        recorded=dict(invoice_id=4,request=request,result=str(result))
        native={'registered_devices':[{'TIN':CONFIG['taxpayer_pin'],'BHF_ID':'01'}],
                'process_ids':[123],'sales':[{'SALES_STTS_CD':'02','REMARK':''}]}
        engine=Engine.__new__(Engine)
        with patch('engine.workflow.read_state',return_value=native),patch('engine.require_identity',return_value=CONFIG),patch('engine.workflow.verify_sale'),patch('engine.workflow.verify_pdf') as verify,patch('engine.Client') as ui:
            self.assertEqual(engine.resume(key,recorded,request,s),raw)
            verify.assert_called_once_with(raw,native);ui.assert_not_called()
            native['sales'][0]['REMARK']='Oraforge:another-sale'
            with self.assertRaisesRegex(ValueError,'another POS reference'):engine.resume(key,recorded,request,s)
            native['sales'][0]['REMARK']='';pdf.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'missing or changed'):engine.resume(key,recorded,request,s)
            ui.assert_not_called()
    def test_recovery_rejects_changed_snapshot_before_ui(self):
        from engine import Engine
        s=sale();key=self.store.create(s)['id'];ledger=self.home/'ledger.json'
        ledger.write_text(json.dumps({'invoice_id':4,'request':{'pos_sale_digest':'different'}}))
        engine=Engine.__new__(Engine);engine.store=self.store
        with patch('engine.workflow.ledger_path',return_value=ledger),patch('engine.workflow.issue') as issue:
            with self.assertRaisesRegex(ValueError,'immutable'):engine.run(key)
            issue.assert_not_called()
    def test_stale_lock_requires_matching_sale_and_dead_owner(self):
        import session_lock
        lock=self.home/'active-run.lock';lock.write_text(json.dumps({'request_id':'same','pid':12}))
        with patch.object(session_lock,'HOME',self.home),patch.object(session_lock,'process_alive',return_value=True):
            with self.assertRaises(ValueError):session_lock.reclaim_dead_lock('same')
        with patch.object(session_lock,'HOME',self.home),patch.object(session_lock,'process_alive',return_value=False):
            with self.assertRaises(ValueError):session_lock.reclaim_dead_lock('other')
            self.assertTrue(lock.exists());session_lock.reclaim_dead_lock('same');self.assertFalse(lock.exists())

if __name__=='__main__':unittest.main()
