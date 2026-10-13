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
        for action in ('Click','Text','File'):
            with patch('offline.require_offline',side_effect=ValueError('Internet blocking missing')),patch('workflow.ps') as execute:
                with self.assertRaisesRegex(ValueError,'Internet blocking'):
                    workflow.Ui(123).send({'action':action})
                execute.assert_not_called()
    def test_recovery_of_ledger_never_calls_fresh_issue(self):
        from engine import Engine
        s=sale();key=self.store.create(s)['id'];ledger=self.home/'ledger.json'
        ledger.write_text(json.dumps({'invoice_id':4,'request':{'pos_sale_digest':digest(s)}}))
        engine=Engine.__new__(Engine);engine.store=self.store
        with patch('engine.workflow.ledger_path',return_value=ledger),patch.object(engine,'resume',return_value={'verified':True}) as resume,patch.object(engine,'result',return_value={'local_invoice_id':4}),patch('engine.workflow.issue') as issue:
            engine.run(key);resume.assert_called_once();issue.assert_not_called()
        self.assertEqual(self.store.get(key)['state'],'complete')
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
