(() => {
  'use strict';
  let job, adapter, armed=false, consumed=false, busy=false, captured=false, root, notice, reportList, observer, timer;
  let lastAutoForm=null, generation=0, minimized=false, loading=false, networkGeneration=0, reconnectPending=false;
  let fillTask=Promise.resolve();
  const send = async (action, data={}) => {
    const response=await chrome.runtime.sendMessage({role:'portal',action,data:{attempt_id:job?.record.attempt_id,digest:job?.record.digest,...data}});
    if (response?.error) throw Error(response.error);
    return response?.result;
  };
  const message = text => { if (notice && notice.textContent!==text) notice.textContent=text; };
  function restriction() {
    if (captured || job?.generated) return 'Official invoice already recorded. Duplicate generation is blocked. Return to Oraforge to reprint the receipt.';
    if (job?.armed || consumed) return 'Generation was enabled for this receipt. Check the existing KRA invoice before retrying; filling and new generation are blocked.';
    if (job?.recovery) return job.can_resume
      ? 'Checking existing invoices. To continue this unarmed sale, return to Oraforge and choose Resume filling in KRA for this receipt.'
      : 'Check the existing KRA invoice for this receipt and amount. If none was issued, record Checked: no invoice issued in Oraforge before preparing again.';
    return '';
  }
  function syncControls() {
    const shadow=root?.shadowRoot;
    if (!shadow) return;
    const blocked=loading || busy || !job || !!restriction() || navigator.onLine===false;
    shadow.querySelector('[data-fill]').disabled=blocked || armed;
    shadow.querySelector('[data-arm]').disabled=blocked || armed;
    shadow.querySelector('[data-capture]').disabled=loading || busy || !job;
  }
  function scheduleRefresh() {clearTimeout(timer);timer=setTimeout(refresh,300);}
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
    if (loading || navigator.onLine===false || !armed || consumed || job.recovery || !event.isTrusted || errors.length) {
      stop(event); message(errors.length?errors.join('. '):'Review the invoice and use “Enable KRA Generate” in the Oraforge panel first.'); return;
    }
    // Only the cashier's trusted native KRA click/submit can proceed. No scripted
    // click, form.submit(), portal fetch or invoice-creation API is used here.
    consumed=true; armed=false;
    syncControls();
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
  function prepare() {fillTask=fillCurrentSale();return fillTask;}
  async function fillCurrentSale() {
    if (busy || loading || armed || !job || restriction()) return;
    if (navigator.onLine===false) {message('Connection lost. This POS sale is saved. Reconnect, then click Fill POS sale.');return;}
    busy=true;
    const currentGeneration=generation, currentNetwork=networkGeneration, currentJob=job, currentAdapter=adapter;
    const active=()=>generation===currentGeneration && networkGeneration===currentNetwork && !loading && navigator.onLine!==false && job===currentJob && !restriction();
    syncControls();
    try {
      const detection=currentAdapter.detect();
      if (!detection.ready) {
        message('Invoice form not detected at '+detection.url+'. Missing: '+detection.missing.join(', ')+'. Open the sales invoice form in this linked popup, then click Fill POS sale.');return;
      }
      message('Filling POS sale. Each item popup will be filled and added to the invoice table. No invoice will be submitted.');
      const report=await currentAdapter.fillSale(currentJob.record.snapshot,{onProgress:report=>{if(active())showReport(report);},active});
      if (!active()) return;
      const failed=report.filter(r=>r.status==='failed');
      message(failed.length?'Filling finished with '+failed.length+' field(s) needing attention. Review the details below. No invoice submitted.':'POS data filled and total matched. Review the KRA form. No invoice submitted.');
    } catch(error) {if(generation===currentGeneration && networkGeneration===currentNetwork)message(error.message);}
    finally {
      if (generation===currentGeneration) {
        busy=false;syncControls();
        if (reconnectPending && navigator.onLine!==false) {reconnectPending=false;lastAutoForm=null;scheduleRefresh();}
      }
    }
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
    if (!job || !adapter || loading || busy || captured) return;
    busy=true;
    const currentGeneration=generation, currentJob=job, currentAdapter=adapter;
    syncControls();
    try {
      const fiscal=await currentAdapter.capture(currentJob.record.snapshot);
      if (generation!==currentGeneration || job!==currentJob) return;
      if (fiscal) {
        await send('capture',{fiscal,total_cents:currentJob.record.snapshot.total_cents,receipt_no:currentJob.record.receipt_no,attempt_id:currentJob.record.attempt_id,digest:currentJob.record.digest});
        if (generation!==currentGeneration || job!==currentJob) return;
        captured=true; armed=false; message('Official KRA invoice captured. Return to Oraforge to print the updated receipt.');
      }
    } catch(error) {if(generation===currentGeneration)message(error.message);}
    finally {if(generation===currentGeneration){busy=false;syncControls();}}
  }
  function panel() {
    root?.remove(); root=document.createElement('aside'); root.dataset.oraforgeCompanion='';
    const shadow=root.attachShadow({mode:'open'});
    shadow.innerHTML=`<style>
      :host{position:fixed;bottom:12px;right:12px;z-index:2147483647;font:13px/1.5 system-ui;color:#173b29}
      [hidden]{display:none!important}
      section{box-sizing:border-box;width:356px;max-width:calc(100vw - 24px);max-height:65vh;overflow:auto;padding:16px;background:#f5ffe9;border:2px solid #27523d;border-radius:12px;box-shadow:0 4px 24px #0004}
      header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}
      h3{margin:0}
      button{padding:8px;margin:5px 0;width:100%;background:#173b29;color:white;border:0;border-radius:6px;cursor:pointer}
      button:focus-visible{outline:3px solid #53836b;outline-offset:3px}
      button:disabled{opacity:.5}
      [data-minimize]{display:grid;place-items:center;flex:none;width:32px;height:32px;padding:0;margin:0}
      [data-restore]{width:auto;margin:0;padding:10px 16px;border-radius:20px;box-shadow:0 4px 16px #0004;font:inherit;font-weight:600}
      label{display:block;margin:10px 0}ul{padding:0;list-style:none}
      li{padding:7px 0;border-bottom:1px solid #ccd8bd}li div{font-size:12px}
      li[data-status=failed]{color:#a32020}li[data-status=skipped]{color:#65705d}
    </style>
    <section id="companion-panel" aria-label="Oraforge eTIMS">
      <header><h3>Oraforge eTIMS</h3><button type="button" data-minimize aria-label="Minimize Oraforge eTIMS" aria-controls="companion-panel" title="Minimize panel"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></header>
      <div data-sale></div><p role="status"></p><button data-fill>Fill POS sale</button>
      <ul data-report aria-label="Form filling results"></ul>
      <details data-issuance-controls><summary>Invoice issuance controls</summary><label><input type="checkbox" data-review> I checked the seller, customer PIN validation, all items, discounts, payment, tax and total.</label><button data-arm>Enable KRA Generate</button></details>
      <button data-capture>Read existing official invoice</button>
      <details data-scroll-controls><summary>Scroll keep-alive · Experimental</summary><label><input type="checkbox" data-scroll-toggle disabled> Enable tiny scroll every 60 seconds</label><p data-scroll-status>Loading scroll setting…</p><button type="button" data-scroll-logs>Activity logs and experiment details</button></details>
    </section>
    <button type="button" data-restore hidden aria-label="Restore Oraforge eTIMS" aria-controls="companion-panel" aria-expanded="false" title="Restore panel">Oraforge eTIMS</button>`;
    const panelSection=shadow.querySelector('section');
    const minimizeButton=shadow.querySelector('[data-minimize]');
    const restoreButton=shadow.querySelector('[data-restore]');
    function setMinimized(value, moveFocus=false) {
      minimized=value;
      panelSection.hidden=value;
      restoreButton.hidden=!value;
      restoreButton.setAttribute('aria-expanded',String(!value));
      if (moveFocus) (value?restoreButton:minimizeButton).focus({preventScroll:true});
    }
    minimizeButton.onclick=()=>setMinimized(true,true);
    restoreButton.onclick=()=>setMinimized(false,true);
    setMinimized(minimized);
    shadow.querySelector('[data-sale]').textContent=job.record.receipt_no+' · KES '+(job.record.snapshot.total_cents/100).toFixed(2);
    notice=shadow.querySelector('[role=status]');
    reportList=shadow.querySelector('[data-report]');
    shadow.querySelector('[data-fill]').onclick=prepare;
    shadow.querySelector('[data-capture]').onclick=scan;
    const scrollSetting='oraforgeScrollKeepAliveEnabled', scrollToggle=shadow.querySelector('[data-scroll-toggle]');
    if (chrome.storage?.local) {
      chrome.storage.local.get(scrollSetting).then(data=>renderScrollSetting(data[scrollSetting]===true)).catch(()=>{shadow.querySelector('[data-scroll-status]').textContent='Reload the extension to read the scroll setting.';});
      scrollToggle.onchange=async()=>{
        scrollToggle.disabled=true;
        try {await chrome.storage.local.set({[scrollSetting]:scrollToggle.checked});renderScrollSetting(scrollToggle.checked);}
        catch (_) {shadow.querySelector('[data-scroll-status]').textContent='Could not save. Reload the extension.';}
        finally {scrollToggle.disabled=false;}
      };
      shadow.querySelector('[data-scroll-logs]').onclick=async()=>{
        try {
          const response=await chrome.runtime.sendMessage({role:'scroll_keepalive',action:'open_logs'});
          if(response?.error)throw Error(response.error);
        } catch (_) {shadow.querySelector('[data-scroll-status]').textContent='Reload the extension to open activity logs.';}
      };
    } else shadow.querySelector('[data-scroll-status]').textContent='Scroll settings unavailable. Reload the extension.';
    shadow.querySelector('[data-arm]').onclick=async event=>{
      if (loading || busy || restriction() || navigator.onLine===false) return;
      if (!event.isTrusted || !shadow.querySelector('[data-review]').checked) {message('Check the invoice in KRA, then confirm the review checkbox.');return;}
      const errors=adapter.verify(job.record.snapshot);
      if (errors.length) {message(errors.join('. '));return;}
      const currentGeneration=generation;
      busy=true;syncControls();
      try {
        await send('arm',{total_cents:job.record.snapshot.total_cents,receipt_no:job.record.receipt_no});
        if (generation!==currentGeneration) return;
        armed=true; event.target.disabled=true;
        message('Now click KRA’s own Generate/Submit button once to issue the invoice.');
      } catch(error) {if(generation===currentGeneration)message(error.message);}
      finally {if(generation===currentGeneration){busy=false;syncControls();}}
    };
    if (restriction()) message(restriction());
    syncControls();
    document.documentElement.append(root);
  }
  function renderScrollSetting(enabled) {
    const shadow=root?.shadowRoot, toggle=shadow?.querySelector('[data-scroll-toggle]');
    if(!toggle)return;
    toggle.checked=enabled;toggle.disabled=false;
    shadow.querySelector('[data-scroll-status]').textContent=enabled?'ON · Scroll only; logout prevention is unverified. Stops on detected login/OTP screens.':'OFF · Enable to test whether scrolling affects inactivity logout.';
  }
  chrome.storage?.onChanged?.addListener((changes,area)=>{
    if(area==='local' && changes.oraforgeScrollKeepAliveEnabled)renderScrollSetting(changes.oraforgeScrollKeepAliveEnabled.newValue===true);
  });
  async function boot() {
    const currentGeneration=++generation, pendingFill=fillTask;
    loading=true;armed=false;pendingNativeClick=false;syncControls();
    observer?.disconnect();clearTimeout(timer);
    try {
      const next=await send('job');
      await pendingFill;
      if (generation!==currentGeneration) return;
      if (!next) {job=null;root?.remove();root=notice=reportList=null;busy=false;loading=false;return;}
      const same=job?.record.id===next.record.id && job?.record.attempt_id===next.record.attempt_id && job?.record.digest===next.record.digest;
      consumed=same && consumed;captured=!!next.generated || (same && captured);
      job=next;
      // Keep unconfirmed item-Add protection when refreshing the same attempt.
      if (!same || !adapter) adapter=window.OraforgeKraAdapter.adapter(document,job.config);
      lastAutoForm=null;busy=false;loading=false;panel();
      observer=new MutationObserver(records=>{
        if (records.every(r=>root?.contains(r.target))) return;
        scheduleRefresh();
      });
      observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['style','class','hidden','aria-hidden','inert','disabled']});
      await refresh();
    } catch(error) {if(generation===currentGeneration){loading=false;busy=false;message(error.message);syncControls();}}
  }
  chrome.runtime.onMessage.addListener((m,sender,reply)=>{
    if (m.action==='revoked' || m.action==='detached') {
      generation++;armed=false;consumed=true;pendingNativeClick=false;loading=m.action==='detached';
      if(job)job.recovery=true;
      syncControls();
      message(m.action==='detached'?'Loading the receipt selected in Oraforge. This previous sale is no longer active in this popup.':'This invoice has been recorded or revoked in Oraforge. Generation is blocked.');
      reply?.({received:true});
    }
    if (m.action==='reload_job') {boot();reply?.({received:true});}
  });
  async function refresh() {
    if (!job || !adapter || loading || busy) return;
    if (!root?.isConnected) document.documentElement.append(root);
    if (restriction()) {message(restriction());await scan();return;}
    if (navigator.onLine===false) {message('Connection lost. This POS sale is saved. Reconnect, then click Fill POS sale.');syncControls();return;}
    const detection=adapter.detect(), form=adapter.find('email');
    if (detection.ready && form!==lastAutoForm && !job.recovery && !job.armed && !consumed) {
      lastAutoForm=form;await prepare();
    } else if (!detection.ready && !lastAutoForm) message('Waiting for the KRA sales invoice form at '+detection.url+'. Missing: '+detection.missing.join(', ')+'.');
    await scan();
  }
  window.addEventListener('popstate',refresh);
  window.addEventListener('hashchange',refresh);
  window.addEventListener('offline',()=>{
    networkGeneration++;reconnectPending=true;lastAutoForm=null;syncControls();
    if (!restriction()) message('Connection lost. This POS sale is saved. Reconnect, then click Fill POS sale.');
  });
  window.addEventListener('online',()=>{lastAutoForm=null;scheduleRefresh();});
  window.addEventListener('focus',scheduleRefresh);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)scheduleRefresh();});
  boot();
})();
