"""Serialized, durable POS -> native eTIMS -> original fiscal PDF workflow."""
import base64
import hashlib
import json
from pathlib import Path
import queue
import threading
from contracts import validate, job_id, to_request
from settings import HOME, require_identity
from store import Store
from products import plan, workbook
import workflow
from client import Client
from session_lock import exclusive_client, reclaim_dead_lock
from offline import require_offline
from windows_access import require_ui_access
from timing import record_run, timed, span

def verify_device(state, config):
    registered={(str(row['TIN']),str(row['BHF_ID'])) for row in state.get('registered_devices',[])}
    if registered!={(config['taxpayer_pin'],config['branch_id'])}:
        raise ValueError('Configured seller and branch do not uniquely match this installed eTIMS device')

def progress_state(stage):
    # workflow.complete means PDF capture completed. The public job becomes
    # complete only after Engine.result has attached every fiscal field and QR.
    return 'invoice_captured' if stage=='complete' else stage.replace(' ','_')

class Engine:
    def __init__(self, store=None):
        self.store = store or Store(HOME/'companion.sqlite3')
        self.queue = queue.Queue()
        self.queued = set()
        self.lock = threading.Lock()
        # A crash never triggers a fresh invoice automatically.
        for job in self.store.interrupted():
            self.store.update(job['id'],'review_required',error='Helper restarted. Recover this same sale; no new invoice was submitted.')
        threading.Thread(target=self.worker,daemon=True,name='etims-ui-worker').start()
    @timed('prepare')
    def prepare(self,sale,details=None):
        validate(sale)
        config=require_identity()
        require_offline(config)
        if sale.get('seller_pin') and sale['seller_pin']!=config['taxpayer_pin']:
            raise ValueError('POS seller PIN differs from the registered eTIMS device')
        binary=Path(config['installation_dir'])/'bin/EBM2x.dll'
        if hashlib.sha256(binary.read_bytes()).hexdigest()!=workflow.CLIENT_HASH:
            raise ValueError('Installed eTIMS build differs from the verified UI profile')
        state=workflow.read_state(sale['customer']['pin'])
        verify_device(state,config)
        if len(state['process_ids'])!=1:
            raise ValueError('Open one eTIMS Windows client and log in normally')
        require_ui_access(state['process_ids'][0])
        if state['default_printer']!=['Microsoft Print to PDF']:
            raise ValueError('Set the existing default Windows printer to Microsoft Print to PDF for original invoice capture')
        if state['customers'] and (len(state['customers'])!=1 or state['customers'][0]['CUST_NM']!=sale['customer']['name']):
            raise ValueError('Buyer PIN is registered with a different customer name')
        registration=plan(sale,details or {},state,self.store,config)
        return config,state,registration
    def preflight(self,sale,details=None):
        config,state,registration=self.prepare(sale,details)
        return dict(requirements=registration['requirements'],
                    registered_products=len(registration['codes'])-len(registration['missing']),
                    products_to_register=len(registration['missing']),
                    stock_adjustments=registration['adjustments'],
                    codes=state['codes'],classes=state['classes'],
                    ready=not registration['requirements'])
    def submit(self,sale,details=None):
        validate(sale)
        job=self.store.create(sale,details)
        if job['state']=='needs_details' and details is not None:
            job=self.store.update(job['id'],'queued',details=details)
        if job['state']=='queued':self.enqueue(job['id'])
        return self.public(job)
    def enqueue(self,key):
        with self.lock:
            if key not in self.queued:
                self.queued.add(key);self.queue.put(key)
    def recover(self,key):
        job=self.store.get(key)
        if not job:raise ValueError('Unknown companion sale')
        if job['state']=='complete':return self.public(job)
        if job['state'] not in ('review_required','failed','needs_details'):
            return self.public(job)
        self.store.update(key,'recovering')
        self.enqueue(key)
        return self.public(self.store.get(key))
    def public(self,job):
        # The immutable request, buyer details and diagnostic paths stay local.
        return {k:job.get(k) for k in ('id','state','result','error','updated_at')}
    def worker(self):
        while True:
            key=self.queue.get()
            try:
                with record_run(HOME/'timings'/(key+'.json')), exclusive_client():
                    require_offline()
                    reclaim_dead_lock(key)
                    self.run(key)
            except Exception as error:
                self.store.update(key,'review_required',error=self.safe_error(error))
            finally:
                with self.lock:self.queued.discard(key)
                self.queue.task_done()
    @staticmethod
    def safe_error(error):
        if isinstance(error,(ValueError,RuntimeError)):
            return str(error)[:600]
        return type(error).__name__+': Windows operation stopped. Review the same sale before retrying.'
    def result(self,raw,sale):
        image=Path(raw['qr_code']['image'])
        import mimetypes
        mime=mimetypes.guess_type(str(image))[0]
        if mime not in ('image/png','image/jpeg','image/webp'):
            raise ValueError('Original QR image has an unsupported format')
        fiscal={k:raw[k] for k in ('cu_invoice_number','scu_id','receipt_signature','invoice_number','invoice_date')}
        fiscal.update(qr_image='data:'+mime+';base64,'+base64.b64encode(image.read_bytes()).decode(),
                      qr_payload=raw['qr_code']['payload'],source='windows',
                      local_issuance_status='issued',kra_acceptance_status='unverified',
                      original_pdf_sha256=raw['pdf_sha256'],original_qr_sha256=raw['qr_code'].get('sha256'))
        return dict(fiscal=fiscal,total_cents=sale['total_cents'],local_invoice_id=raw['local_invoice_id'],
                    local_issuance_status='issued',kra_acceptance_status='unverified')
    def run(self,key):
        job=self.store.get(key)
        if job['state']=='complete':return
        sale=job['payload']
        ledger=workflow.ledger_path(key)
        if ledger.exists():
            recorded=json.loads(ledger.read_text(encoding='utf-8'))
            request=recorded['request']
            from contracts import digest
            if request.get('pos_sale_digest')!=digest(sale):
                raise ValueError('Interrupted invoice request differs from the immutable POS sale')
            # Recover only this exact POS identity and stored invoice, never issue anew.
            raw=self.resume(key,recorded,request,sale)
            self.store.update(key,'complete',result=self.result(raw,sale))
            return
        config,state,registration=self.prepare(sale,job['details'])
        if registration['requirements']:
            self.store.update(key,'needs_details',result={'requirements':registration['requirements']})
            return
        client=Client(state['process_ids'][0]);client.normalize()
        screen=client.detect()
        # A prior owned import/customer save may have succeeded before a crash.
        # Re-plan from actual records above; never repeat an importer blindly.
        if job['state']=='recovering' and screen in ('import-success','saved'):
            client.click(screen,885,530)
            screen=client.detect()
        if job['state']=='recovering' and screen in ('item-management','customer','stock-status','stock-adjustment'):
            client.navigate('sales')
            screen=client.detect()
        if screen=='printed':
            client.click('printed',885,530);screen=client.detect()
        if screen in ('print','detail'):
            point=(330,324) if screen=='print' else (240,216)
            displayed=int(client.value(screen,*point))
            owned=self.store.completed_invoice(displayed)
            native=workflow.read_state('',displayed)
            if not owned or len(native['receipts'])!=1 or native['receipts'][0]['CU_INVOICE_NUMBER']!=owned['fiscal']['cu_invoice_number']:
                raise ValueError('The open native invoice is not a verified completed POS invoice; finish its view before continuing')
            client.finish_invoice(displayed);screen=client.detect()
        if screen not in ('menu','sales'):
            raise ValueError('Finish the unrelated open eTIMS form once, then recover this same POS sale')
        def checkpoint(stage):self.store.update(key,stage)
        self.store.update(key,'preparing')
        # Persist intended codes BEFORE invoking an importer. Recovery discovers
        # already imported records using the same mapping rather than re-importing.
        for mapping_key,mapping in registration['mappings'].items():
            self.store.map(mapping_key,mapping['code'],mapping['metadata'])
        if registration['missing']:
            import time
            path=workbook(registration['missing'],HOME/'imports'/key/str(time.time_ns()),config['branch_id'])
            client.register_products(path,registration['missing'],sale['customer']['pin'],checkpoint)
        for code,adjustment in registration['adjustments'].items():
            client.adjust_stock(code,adjustment,sale['customer']['pin'],checkpoint)
        client.ensure_customer(sale['customer'],checkpoint)
        client.navigate('sales')
        request=to_request(sale,registration['codes'])
        raw=workflow.issue(request,request['buyer_pin'],request['buyer_name'],request['payment_code'],key,True,
                           lambda stage:self.store.update(key,progress_state(stage)))
        self.store.update(key,'complete',result=self.result(raw,sale))
        try:
            with span('cleanup'):client.finish_invoice(raw['local_invoice_id'])
        except Exception:pass # Fiscal completion remains valid if read-only view cleanup is unavailable.
    def finish(self,key):
        job=self.store.get(key)
        if not job or job['state']!='complete':
            raise ValueError('Only a completed, verified invoice can close its native views')
        with exclusive_client():
            require_offline()
            recorded=json.loads(workflow.ledger_path(key).read_text(encoding='utf-8'))
            from contracts import digest
            if recorded['request'].get('pos_sale_digest')!=digest(job['payload']):
                raise ValueError('The stored invoice differs from this POS sale')
            raw=self.resume(key,recorded,recorded['request'],job['payload'])
            state=workflow.read_state('',raw['local_invoice_id'])
            if len(state['process_ids'])!=1:raise ValueError('Open one eTIMS client')
            require_ui_access(state['process_ids'][0])
            client=Client(state['process_ids'][0]);client.normalize()
            client.finish_invoice(raw['local_invoice_id'])
        return self.public(job)
    def resume(self,key,recorded,request,sale):
        invoice=recorded.get('invoice_id')
        if invoice is None:
            raise ValueError('An earlier invoice attempt stopped before its identity was recorded. Review the client before resubmitting.')
        state=workflow.read_state(request['buyer_pin'],invoice)
        verify_device(state,require_identity())
        if len(state['sales'])!=1:
            raise ValueError('The recorded draft is not stored. Review its open form; no fresh invoice was submitted.')
        approved=state['sales'][0]['SALES_STTS_CD']=='02'
        workflow.verify_sale(state,request,approved=approved)
        if recorded.get('result') and Path(recorded['result']).exists():
            raw=json.loads(Path(recorded['result']).read_text(encoding='utf-8'))
            # Early builds wrote the reference before item selection refreshed
            # the header. An already captured, approved invoice can still be
            # recovered using its immutable ledger, exact sale and genuine PDF.
            if not approved or raw.get('request_id')!=key or raw.get('local_invoice_id')!=invoice:
                raise ValueError('Captured invoice identity differs from this POS sale')
            marker=state['sales'][0].get('REMARK')
            if marker not in ('Oraforge:'+key,'',None):
                raise ValueError('The stored invoice belongs to another POS reference')
            original=Path(raw['pdf'])
            if not original.is_file() or hashlib.sha256(original.read_bytes()).hexdigest()!=raw['pdf_sha256']:
                raise ValueError('Original captured invoice PDF is missing or changed')
            workflow.verify_pdf(raw,state)
            return raw
        if state['sales'][0].get('REMARK')!='Oraforge:'+key:
            raise ValueError('The stored invoice is not bound to this POS sale reference')
        if len(state['process_ids'])!=1:
            raise ValueError('Open one eTIMS Windows client and log in normally')
        require_ui_access(state['process_ids'][0])
        client=Client(state['process_ids'][0]);client.normalize()
        client.navigate('sales')
        client.text('sales',600,179,str(invoice));client.click('sales',1070,179)
        client.click('sales',410,262);client.click('sales',1194,560)
        client.expect('detail',240,216,str(invoice));client.expect('detail',240,252,request['buyer_pin'])
        if not approved:
            client.click('detail',70,179);client.click('approve-confirm',705,530)
            client.wait_screen('payment');client.expect('payment',100,216,request['buyer_pin'])
            recorded['stage']='approval_requested';workflow.write_ledger(workflow.ledger_path(key),recorded)
            points={'01':(84,307),'02':(236,307),'03':(390,307),'04':(540,379),'05':(236,379),'06':(390,379),'07':(540,307)}
            client.click('payment',*points[request['payment_code']])
            state=workflow.wait_database(request['buyer_pin'],invoice,True)
            workflow.verify_sale(state,request,True)
            client.wait_screen('print')
        else:
            # Printing an existing approved invoice creates no second fiscal record.
            client.click('detail',1194,89);client.wait_screen('print')
        folder=HOME/'output'/workflow.ledger_path(key).stem
        folder.mkdir(parents=True,exist_ok=True)
        import time
        result_pdf=folder/('recovered-'+str(time.time_ns())+'.pdf')
        client.click('print',390,198)
        workflow.choose_print_path(client,result_pdf)
        workflow.wait_pdf(result_pdf)
        with span('pdf_extract'):
            raw=workflow.extract(result_pdf,folder/('capture-'+str(time.time_ns())))
        with span('fiscal_verification'):
            workflow.verify_pdf(raw,state)
        raw.update(local_invoice_id=invoice,request_id=key,extraction_only=False,local_database_verified=True)
        result_path=folder/'result.json';result_path.write_text(json.dumps(raw,indent=2),encoding='utf-8')
        recorded.update(stage='complete',result=str(result_path));workflow.write_ledger(workflow.ledger_path(key),recorded)
        return raw
