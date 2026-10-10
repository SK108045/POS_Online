(() => {
  'use strict';
  let job, adapter, armed=false, consumed=false, busy=false, captured=false, root, notice, observer, timer;
  const send = async (action, data={}) => {
    const response=await chrome.runtime.sendMessage({role:'portal',action,data:{attempt_id:job?.record.attempt_id,digest:job?.record.digest,...data}});
    if (response?.error) throw Error(response.error);
    return response?.result;
  };
  const message = text => { if (notice && notice.textContent!==text) notice.textContent=text; };
  function stop(event) { event.preventDefault(); event.stopImmediatePropagation(); }
  function gate(event) {
    // Authentication, PIN validation and invoice-list filters remain usable.
    if (!location.pathname.includes('/etims/sale/create')) return;
    if (event.type==='submit' && adapter && !adapter.issuanceControl(event.submitter) && !adapter.rows().some(row=>event.target.contains(row))) return;
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
    if (busy || job.recovery || job.armed || consumed || captured) return;
    busy=true;
    try {
      if (!location.pathname.includes('/etims/sale/create')) {message('Sign in, select the correct business, then open Create Sales Invoice.');return;}
      // Add only recognized item-row controls. Never touch KRA's generate button.
      for (let i=adapter.rows().length; i<job.record.snapshot.items.length; i++) {
        if (!adapter.addItem()) break;
        await new Promise(resolve=>setTimeout(resolve,150));
      }
      const missing=adapter.fill(job.record.snapshot);
      message(missing.length ? 'Complete these fields in KRA: '+[...new Set(missing)].join(', ')+'. Then review every line, discount, payment and tax setting.' : 'Sale filled. Validate the PIN in KRA and review every line, discount, payment and tax setting.');
    } catch(error) {message(error.message);}
    finally {busy=false;}
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
    shadow.innerHTML='<style>:host{position:fixed;bottom:12px;right:12px;z-index:2147483647;font:13px/1.5 system-ui;color:#173b29}section{width:320px;max-height:65vh;overflow:auto;padding:16px;background:#f5ffe9;border:2px solid #27523d;border-radius:12px;box-shadow:0 4px 24px #0004}h3{margin:0 0 8px}button{padding:8px;margin:5px 0;width:100%;background:#173b29;color:white;border:0;border-radius:6px;cursor:pointer}button:disabled{opacity:.5}label{display:block;margin:10px 0}</style><section><h3>Oraforge eTIMS</h3><div data-sale></div><p role="status"></p><button data-fill>Fill POS sale</button><label><input type="checkbox" data-review> I checked the seller, customer PIN validation, all items, discounts, payment, tax and total.</label><button data-arm>Enable KRA Generate</button><button data-capture>Read existing official invoice</button></section>';
    shadow.querySelector('[data-sale]').textContent=job.record.receipt_no+' · KES '+(job.record.snapshot.total_cents/100).toFixed(2);
    notice=shadow.querySelector('[role=status]');
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
      job=next;adapter=window.OraforgeKraAdapter.adapter(document,job.config);
      panel(); await prepare(); await scan();
      observer?.disconnect(); observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(scan,400);});
      observer.observe(document.body,{subtree:true,childList:true,characterData:true});
    } catch(error) {message(error.message);}
  }
  chrome.runtime.onMessage.addListener(m=>{
    if (m.action==='revoked') {armed=false;consumed=true;if(job)job.recovery=true;message('This invoice has been recorded or revoked in Oraforge. Generation is blocked.');}
    if (m.action==='reload_job') {armed=false; boot();}
  });
  boot();
  // SPAs may render their form after document_idle; fill it once fields exist.
  let attempts=0;
  const ready=setInterval(()=>{
    if (++attempts>30 || captured || consumed) {clearInterval(ready);return;}
    if (job && !job.recovery && !job.armed && adapter?.rows().length && !root?.dataset.filled) {root.dataset.filled='yes';prepare();}
    scan();
  },1000);
})();
