/* Oraforge eTIMS workspace: Invoices are issued by the local eTIMS Windows client. */
(() => {
  const markup = `
  <style id="etims-launch-portal">
  .etims-launch{position:relative;overflow:hidden;isolation:isolate;padding:clamp(24px,4vw,48px);margin:0 0 26px;border-radius:24px;color:#f2fff2;background:linear-gradient(126deg,#0a2e29 0%,#174b3d 62%,#0a302b 100%);box-shadow:0 14px 40px rgba(4,35,28,.14)}
  .etims-launch:before{content:'';position:absolute;right:-95px;top:-155px;width:435px;height:435px;border:1px solid rgba(215,244,164,.26);border-radius:50%;box-shadow:0 0 0 68px rgba(222,248,187,.035),0 0 0 145px rgba(222,248,187,.025);pointer-events:none;z-index:-1}
  .etims-launch:after{content:'';position:absolute;right:12%;bottom:-180px;width:480px;height:280px;background:radial-gradient(ellipse,rgba(177,230,145,.16),transparent 70%);pointer-events:none;z-index:-1}
  .etims-launch-top{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:15px;margin-bottom:27px}
  .etims-launch-brand{display:flex;align-items:center;gap:12px;min-width:0}
  .etims-launch-brand img{width:92px;height:72px;object-fit:contain;padding:5px;border-radius:13px;background:#fff}
  .etims-launch-brand-label{display:flex;flex-direction:column;gap:2px}
  .etims-launch-brand-label strong{color:#fff;font-size:15px;letter-spacing:.02em}
  .etims-launch-brand-label span{color:#c7e2d6;font-size:12px}
  .etims-launch-kra{display:flex;align-items:center;gap:10px;padding:9px 13px;background:#fff;border:1px solid rgba(255,255,255,.25);border-radius:13px}
  .etims-launch-kra img{width:187px;max-width:100%;height:53px;object-fit:contain}
  .etims-launch-eyebrow{display:inline-flex;gap:9px;align-items:center;padding:7px 12px;background:rgba(220,247,181,.12);border:1px solid rgba(220,247,181,.23);border-radius:99px;color:#d9f6af;font-size:12px;font-weight:700;letter-spacing:.045em;text-transform:uppercase}
  .etims-launch h2{font-size:clamp(30px,4vw,47px);font-weight:800;line-height:1.07;color:#fff;margin:15px 0 14px;letter-spacing:-.035em}
  .etims-launch h2 span{color:#d7f29e}
  .etims-launch-description{max-width:600px;color:#deeee5;font-size:15px;line-height:1.65;margin:0 0 24px}
  .etims-launch-bottom{display:flex;gap:20px;flex-wrap:wrap;align-items:center}
  .etims-launch-open{border:0;min-height:52px;display:inline-flex;align-items:center;justify-content:center;gap:13px;border-radius:13px;background:#d8f2a4;color:#173b29;font-weight:800;font-size:15px;padding:13px 24px;cursor:pointer;box-shadow:0 8px 26px rgba(0,0,0,.12);transition:transform .15s,background .15s}
  .etims-launch-open:hover{background:#edffc6;transform:translateY(-1px)}
  .etims-launch-open:focus-visible{outline:3px solid #fff;outline-offset:3px}
  .etims-launch-note{font-size:12px;line-height:1.5;max-width:340px;color:#cde1d4}
  @media(max-width:640px){.etims-launch{padding:22px;border-radius:17px}.etims-launch-kra img{width:145px;height:42px}.etims-launch-brand img{height:62px;width:76px}.etims-launch h2{font-size:31px}.etims-launch-open{width:100%}}
  </style><section class="etims-launch" aria-labelledby="oraforge-etims-title">
  <div class="etims-launch-top"><div class="etims-launch-brand"><img src="data:image/png;base64,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" alt="Oraforge Technologies logo"><div class="etims-launch-brand-label"><strong>ORAFORGE POS</strong><span>Powered by Oraforge Technologies</span></div></div><div class="etims-launch-kra"><img src="data:image/png;base64,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" alt="Kenya Revenue Authority logo"></div></div>
  <span class="etims-launch-eyebrow">✦ Digital Invoicing Workspace</span>
  <h2 id="oraforge-etims-title">eTIMS <span>Invoice Workspace.</span></h2>
  <p class="etims-launch-description">Manage your store in Oraforge and access official KRA invoicing from one convenient workspace.</p>
  <div class="etims-launch-bottom"><button type="button" id="etimsLaunchOpen" class="etims-launch-open">Open eTIMS <span aria-hidden="true">↗</span></button><span class="etims-launch-note">Registers missing products and issues invoices through your installed eTIMS Windows client. Local issuance and KRA upload acceptance are tracked separately.</span></div>
</section>`;
  window.renderEtims = function () {
    const root = document.getElementById('sec-etims');
    if (!root) return;
    root.innerHTML = markup;
    const openButton = root.querySelector('#etimsLaunchOpen');
    openButton.textContent='Check Windows helper';
    openButton.addEventListener('click',async()=>{
      openButton.disabled=true;
      try {await window.OraforgeEtims.bridge('ping');window.alert('Windows eTIMS helper is running. Select a POS sale below, or use Generate eTIMS Invoice at checkout.');}
      catch(error){window.alert(error.message);}finally{openButton.disabled=false;}
    });
  };

  const launch = window.renderEtims;
  let filter = 'all', rendering = false;
  async function populate() {
    const host = document.querySelector('#sec-etims [data-invoice-workspace]');
    if (!host || rendering) return;
    rendering = true;
    const e = window.OraforgeEtimsCore.escape;
    try {
      // Recover requests if the browser closed after payment but before queue creation.
      const orders = await LocalAdmin.get('orders', []);
      const settings = await LocalAdmin.settings();
      for (const order of orders.filter(o => o.status === 'paid' && o.etims_requested)) {
        if (!await window.OraforgeEtims.get(order)) await window.OraforgeEtims.queue(order, order.etims_customer, settings);
      }
      const all = await window.OraforgeEtims.list();
      const rows = all.filter(r => filter === 'all' || r.status === filter);
      host.innerHTML = `<h2>POS eTIMS invoices</h2><p>${all.filter(r=>r.status==='pending').length} pending · ${all.filter(r=>r.status==='generated').length} generated · ${all.filter(r=>r.status==='review_required').length} require checking</p>
        <label>Show <select data-filter><option value="all">All invoices</option><option value="pending">Pending</option><option value="generated">Generated</option><option value="review_required">Check existing invoice</option></select></label>
        <button type="button" data-sync>Refresh Windows helper</button><p role="status" data-status></p>
        <table><thead><tr><th>POS receipt</th><th>Total</th><th>Status</th><th>CU Invoice Number</th><th>Actions</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${e(r.receipt_no)}</td><td>KES ${(r.snapshot.total_cents/100).toFixed(2)}</td><td>${e(r.helper_state || r.status)}${r.fiscal?.source==='windows'?'<br>KRA upload '+e(r.fiscal.kra_acceptance_status):''}${r.helper_error?'<br>'+e(r.helper_error):''}</td><td>${e(r.fiscal?.cu_invoice_number || '—')}</td><td>
          ${r.status==='pending'?`<button data-action="start" data-id="${e(r.id)}">Issue with Windows helper</button>`:''}
          ${r.status==='review_required' && r.snapshot.version===2?`<button data-action="recover" data-id="${e(r.id)}">Recover this sale</button>`:''}
          <button data-action="manual" data-id="${e(r.id)}">${r.status==='generated'?'Complete KRA details':'Enter CU manually'}</button>
          <button data-action="reprint" data-id="${e(r.id)}">Reprint receipt</button></td></tr>`).join('') || '<tr><td colspan="5">No invoices in this view. Select Generate eTIMS Invoice at checkout, or manage eTIMS from a paid receipt.</td></tr>'}</tbody></table>`;
      host.querySelector('[data-filter]').value = filter;
      host.querySelector('[data-filter]').onchange = event => { filter=event.target.value; populate(); };
      host.querySelector('[data-sync]').onclick = async () => {
        try { await window.OraforgeEtims.sync(); await populate(); }
        catch(error) { host.querySelector('[data-status]').textContent=error.message; }
      };
      host.querySelectorAll('[data-action]').forEach(button => button.onclick = async () => {
        button.disabled = true;
        const r = all.find(r=>r.id===button.dataset.id);
        try {
          if (button.dataset.action === 'start') await window.OraforgeEtims.start(r.id);
          if (button.dataset.action === 'resume') await window.OraforgeEtims.start(r.id,'resume');
          if (button.dataset.action === 'recover') await window.OraforgeEtims.start(r.id,true);
          if (button.dataset.action === 'manual') await window.OraforgeEtims.manual(r);
          if (button.dataset.action === 'absent') await window.OraforgeEtims.checkedAbsent(r);
          if (button.dataset.action === 'reprint') {
            const order = orders.find(o=>Number(o.id)===Number(r.sale_id) && o.ticket_no===r.receipt_no);
            if (!order) throw Error('Original sale is unavailable in this shop.');
            showAdminSalesReceipt(order);
          }
        } catch(error) { host.querySelector('[data-status]').textContent=error.message; }
        finally { button.disabled=false; }
      });
    } catch(error) { host.textContent = error.message; }
    finally { rendering=false; }
  }
  window.renderEtims = function() {
    launch();
    const root=document.getElementById('sec-etims');
    if (!root) return;
    const host=document.createElement('section'); host.className='etims-workspace'; host.dataset.invoiceWorkspace=''; root.append(host);
    populate();
  };
  window.addEventListener('oraforge-etims-changed', () => { setTimeout(populate,0); });
})();
