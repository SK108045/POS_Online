(() => {
  'use strict';
  let job, adapter, armed=false, consumed=false, busy=false, captured=false, root, notice, reportList, observer, timer;
  let lastAutoForm=null, generation=0;
  const send = async (action, data={}) => {
    const response=await chrome.runtime.sendMessage({role:'portal',action,data:{attempt_id:job?.record.attempt_id,digest:job?.record.digest,...data}});
    if (response?.error) throw Error(response.error);
    return response?.result;
  };
  const message = text => { if (notice && notice.textContent!==text) notice.textContent=text; };
  function stop(event) { event.preventDefault(); event.stopImmediatePropagation(); }
  function gate(event) {
    // Authentication, PIN validation and invoice-list filters remain usable.
    const issue=adapter?.issuanceControl(event.type==='submit'?event.submitter:event.target);
    if (!issue && !adapter?.detect().ready) return;
    const itemModal=adapter?.itemDialog();
    if (event.type==='submit' && itemModal && !issue && event.target.closest('[role="dialog"]')===itemModal) return;
    if (event.type==='submit' && adapter && !issue && !adapter.rows().some(row=>event.target.contains(row))) return;
    if (!job || !adapter || captured || job.generated) {
      if (job && (event.type==='submit' || adapter?.issuanceControl(event.target))) {stop(event); message('Invoice already captured. Duplicate generation is blocked.');}
      return;
    }
    if (event.type!=='submit' && !adapter.issuanceControl(event.target)) return;
    const errors=adapter.verify(job.record.snapshot);
    if (!armed || consumed || job.recovery || !event.isTrusted || errors.length) {
      stop(event); message(errors.length?errors.join('. '):'Review the invoice and use “Enable KRA Generate” in the Oraforge panel first.'); return;
    }
    // Only the cashier's trusted native KRA click/submit can proceed. No scripted
    // click, form.submit(), portal fetch or invoice-creation API is used here.
    consumed=true; armed=false;
    message('Awaiting the official invoice. If confirmation is lost, check existing invoices before retrying.');
    // Permit the default submit produced synchronously by this same trusted click.
    if (event.type==='click') {
      pendingNativeClick=true; setTimeout(()=>{pendingNativeClick=false;},0);
    }
  }
  let pendingNativeClick=false;
  function submitGate(event) {
    if (pendingNativeClick && event.isTrusted && !adapter.verify(job.record.snapshot).length) { pendingNativeClick=false; return; }
    gate(event);
  }
  window.addEventListener('click',gate,true);
  window.addEventListener('submit',submitGate,true);
  async function prepare() {
    if (busy || !job || job.recovery || job.armed || consumed || captured) return;
    busy=true;
    const currentGeneration=generation;
    const fillButton=root?.shadowRoot.querySelector('[data-fill]');
    if (fillButton) fillButton.disabled=true;
    try {
      const detection=adapter.detect();
      if (!detection.ready) {
        message('Invoice form not detected at '+detection.url+'. Missing: '+detection.missing.join(', ')+'. Open the sales invoice form in this linked popup, then click Fill POS sale.');return;
      }
      message('Filling POS sale. Each item popup will be filled and added to the invoice table. No invoice will be submitted.');
      const report=await adapter.fillSale(job.record.snapshot,{onProgress:showReport,active:()=>generation===currentGeneration && !job.recovery && !consumed && !captured});
      const failed=report.filter(r=>r.status==='failed');
      message(failed.length?'Filling finished with '+failed.length+' field(s) needing attention. Review the details below. No invoice submitted.':'POS data filled and total matched. Review the KRA form. No invoice submitted.');
    } catch(error) {message(error.message);}
    finally {busy=false;if(fillButton && !job.recovery && !job.armed && !captured && !consumed)fillButton.disabled=false;}
  }
  function showReport(report) {
    if (!reportList) return;
    reportList.replaceChildren();
    for (const row of report) {
      const li=document.createElement('li');li.dataset.status=row.status;
      const title=document.createElement('strong');title.textContent=(row.status==='filled'?'✓ ':row.status==='failed'?'✕ ':'– ')+row.field;
      const detail=document.createElement('div');detail.textContent=row.detail;
      li.append(title,detail);reportList.append(li);
    }
  }
  async function scan() {
    if (!job || !adapter || busy || captured) return;
    busy=true;
    try {
      const fiscal=await adapter.capture(job.record.snapshot);
      if (fiscal) {
        await send('capture',{fiscal,total_cents:job.record.snapshot.total_cents,receipt_no:job.record.receipt_no});
        captured=true; armed=false; message('Official KRA invoice captured. Return to Oraforge to print the updated receipt.');
      }
    } catch(error) {message(error.message);}
    finally {busy=false;}
  }
  function panel() {
    root?.remove(); root=document.createElement('aside'); root.dataset.oraforgeCompanion='';
    const shadow=root.attachShadow({mode:'open'});
    shadow.innerHTML='<style>:host{position:fixed;bottom:12px;right:12px;z-index:2147483647;font:13px/1.5 system-ui;color:#173b29}section{width:320px;max-height:65vh;overflow:auto;padding:16px;background:#f5ffe9;border:2px solid #27523d;border-radius:12px;box-shadow:0 4px 24px #0004}h3{margin:0 0 8px}button{padding:8px;margin:5px 0;width:100%;background:#173b29;color:white;border:0;border-radius:6px;cursor:pointer}button:disabled{opacity:.5}label{display:block;margin:10px 0}ul{padding:0;list-style:none}li{padding:7px 0;border-bottom:1px solid #ccd8bd}li div{font-size:12px}li[data-status=failed]{color:#a32020}li[data-status=skipped]{color:#65705d}</style><section><h3>Oraforge eTIMS</h3><div data-sale></div><p role="status"></p><button data-fill>Fill POS sale</button><ul data-report aria-label="Form filling results"></ul><details><summary>Invoice issuance controls</summary><label><input type="checkbox" data-review> I checked the seller, customer PIN validation, all items, discounts, payment, tax and total.</label><button data-arm>Enable KRA Generate</button></details><button data-capture>Read existing official invoice</button></section>';
    shadow.querySelector('[data-sale]').textContent=job.record.receipt_no+' · KES '+(job.record.snapshot.total_cents/100).toFixed(2);
    notice=shadow.querySelector('[role=status]');
    reportList=shadow.querySelector('[data-report]');
    shadow.querySelector('[data-fill]').onclick=prepare;
    shadow.querySelector('[data-capture]').onclick=scan;
    shadow.querySelector('[data-arm]').onclick=async event=>{
      if (!event.isTrusted || !shadow.querySelector('[data-review]').checked) {message('Check the invoice in KRA, then confirm the review checkbox.');return;}
      const errors=adapter.verify(job.record.snapshot);
      if (errors.length) {message(errors.join('. '));return;}
      try {
        await send('arm',{total_cents:job.record.snapshot.total_cents,receipt_no:job.record.receipt_no});
        armed=true; event.target.disabled=true;
        message('Now click KRA’s own Generate/Submit button once to issue the invoice.');
      } catch(error) {message(error.message);}
    };
    if (job.recovery || job.armed || job.generated) {
      shadow.querySelector('[data-arm]').disabled=true; shadow.querySelector('[data-fill]').disabled=true;
      message('Check the existing KRA invoice for this receipt and amount. New generation is blocked. Open its official invoice to capture it, or enter its CU in Oraforge.');
    }
    document.documentElement.append(root);
  }
  async function boot() {
    try {
      const next=await send('job');
      if (!next) return;
      generation++;lastAutoForm=null;
      job=next;adapter=window.OraforgeKraAdapter.adapter(document,job.config);
      panel(); await refresh();
      observer?.disconnect(); observer=new MutationObserver(records=>{
        if (records.every(r=>root?.contains(r.target))) return;
        clearTimeout(timer);timer=setTimeout(refresh,300);
      });
      observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['style','hidden','disabled']});
    } catch(error) {message(error.message);}
  }
  chrome.runtime.onMessage.addListener(m=>{
    if (m.action==='revoked') {generation++;armed=false;consumed=true;if(job)job.recovery=true;message('This invoice has been recorded or revoked in Oraforge. Generation is blocked.');}
    if (m.action==='reload_job') {armed=false; boot();}
  });
  async function refresh() {
    if (!job || !adapter || busy || captured) return;
    const detection=adapter.detect(), form=adapter.find('email');
    if (detection.ready && form!==lastAutoForm && !job.recovery && !job.armed && !consumed) {
      lastAutoForm=form;await prepare();
    } else if (!detection.ready && !lastAutoForm) message('Waiting for the KRA sales invoice form at '+detection.url+'. Missing: '+detection.missing.join(', ')+'.');
    await scan();
  }
  window.addEventListener('popstate',refresh);
  window.addEventListener('hashchange',refresh);
  boot();
})();
