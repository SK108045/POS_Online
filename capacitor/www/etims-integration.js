/* POS side of the Chrome bridge. The durable POS ledger is authoritative. */
(() => {
  'use strict';
  const core = window.OraforgeEtimsCore, ledgerKey = 'oraforge:etims:v1';
  const channel = 'oraforge-etims-v1';
  const scope = () => window.OraforgeShops?.activeShopId() || localStorage.getItem('pos_active_business_type') || 'retail';
  const identity = (order, shop = scope()) => JSON.stringify([shop, Number(order.id), String(order.ticket_no)]);
  const now = () => new Date().toISOString();
  async function db() {
    await window.OraforgeDBReady;
    if (!window.OraforgeDB?.update) throw Error('Update the POS database bridge to save eTIMS records safely.');
    return window.OraforgeDB;
  }
  async function ledger() { return (await db()).get(ledgerKey, {}); }
  async function update(fn) {
    const value = await (await db()).update(ledgerKey, fn, {});
    window.dispatchEvent(new CustomEvent('oraforge-etims-changed'));
    window.OraforgeAutoBackup?.check();
    return value;
  }
  function bridge(action, data = {}, timeout = 12000) {
    return new Promise((resolve, reject) => {
      const request_id = crypto.randomUUID();
      const timer = setTimeout(() => { window.removeEventListener('message', receive); reject(Error('eTIMS extension is unavailable. Install or reload it, then use the eTIMS workspace.')); }, timeout);
      function receive(event) {
        if (event.source !== window || event.origin !== location.origin || event.data?.channel !== channel || event.data?.direction !== 'extension' || event.data?.request_id !== request_id) return;
        clearTimeout(timer); window.removeEventListener('message', receive);
        if (event.data.error) reject(Error(event.data.error)); else resolve(event.data.result);
      }
      window.addEventListener('message', receive);
      window.postMessage({channel, direction:'pos', request_id, action, data}, location.origin);
    });
  }
  async function queue(order, details = {}, settings = {}, shop = order.etims_shop_id || scope()) {
    if (order.etims_shop_id && shop !== order.etims_shop_id) throw Error('This invoice belongs to another shop.');
    const payload = core.snapshot(order, shop, settings, details);
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
    const digest = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join('');
    const id = identity(order, shop);
    const rows = await update(rows => {
      if (rows[id] && rows[id].digest!==digest) throw Error('This sale differs from its saved fiscal snapshot. Check the original transaction before invoicing.');
      if (!rows[id]) rows[id] = {id, shop_id:shop, sale_id:order.id, receipt_no:order.ticket_no, snapshot:payload, digest, status:'pending', created_at:now(), updated_at:now(), history:[]};
      return rows;
    });
    return rows[id];
  }
  async function get(order) { return (await ledger())[identity(order)] || null; }
  async function attach(orders) {
    // Read-only join: sales APIs expose the linked invoice without rewriting sales.
    try {
      const records=await ledger();
      return orders.map(order=>records[identity(order)] ? {...order,etims:records[identity(order)]} : order);
    } catch(error) { console.warn('eTIMS sale details unavailable:',error.message); return orders; }
  }
  async function change(id, action) {
    const rows = await update(rows => {
      const next = core.transition(rows[id], action, now());
      const cu = next.fiscal?.cu_invoice_number?.toUpperCase();
      if (cu && Object.values(rows).some(r => r.id !== id && r.fiscal?.cu_invoice_number?.toUpperCase() === cu)) throw Error('This CU Invoice Number is already assigned to another POS sale.');
      rows[id] = next;
      return rows;
    });
    return rows[id];
  }
  async function start(id, recovery = false, options = {}) {
    const action = recovery===true?'recover':recovery==='resume'?'resume':'start';
    let record = (await ledger())[id];
    if (!record || record.shop_id !== scope()) throw Error('Select the original shop before opening this invoice.');
    if (record.fiscal?.cu_invoice_number || record.status==='generated') throw Error('This sale already has a CU Invoice Number. Duplicate generation is blocked.');
    if (action!=='recover') {
      const orders=await (await db()).get(`shop:${record.shop_id}:orders`, []);
      const sale=orders.find(o=>Number(o.id)===Number(record.sale_id) && o.ticket_no===record.receipt_no);
      if (!sale || JSON.stringify(core.snapshot(sale,record.shop_id,{kra_pin:record.snapshot.seller_pin},record.snapshot.customer))!==JSON.stringify(record.snapshot)) throw Error('The original sale differs from its fiscal snapshot. Check the transaction before invoicing.');
    }
    // Ping first: an absent extension must leave a genuinely pending invoice pending.
    await bridge('ping', {}, 1500);
    if (action==='start') record = await change(id, {type:'start', attempt_id:crypto.randomUUID()});
    if (action!=='start' && (!record.attempt_id || record.status!=='review_required')) throw Error('No previous portal attempt to resume or check. Prepare the pending sale in KRA first.');
    await bridge(action, {record, new_popup:action==='start' && options.newPopup===true});
    return record;
  }
  async function sync() {
    const current=await ledger();
    const known=Object.fromEntries(Object.values(current).filter(r=>r.fiscal?.source==='portal').map(r=>[r.id,{cu:r.fiscal.cu_invoice_number,digest:r.digest,attempt_id:r.attempt_id}]));
    const results = await bridge('results', {ids:Object.keys(current),known}, 1800);
    for (const result of results || []) {
      const record = (await ledger())[result.id];
      if (!record) continue;
      try {
        if (record.fiscal?.source === 'portal' && Object.entries(result.fiscal).every(([k,v]) => record.fiscal[k] === v)) continue;
        // Restore may contain an older pending record. A durable extension result
        // can recover it only when the original sale snapshot still matches.
        if (record.status === 'pending' && record.digest === result.digest) {
          await update(rows => {
            const r=rows[result.id];
            if (r.status==='pending' && r.digest===result.digest) rows[result.id]={...r,status:'review_required',attempt_id:result.attempt_id};
            return rows;
          });
        }
        await change(result.id, {type:'capture', source:'portal', fiscal:result.fiscal,
          attempt_id:result.attempt_id, digest:result.digest, total_cents:result.total_cents});
        await bridge('ack', {id:result.id, attempt_id:result.attempt_id});
      } catch (error) { console.warn('eTIMS result retained for review:', error.message); }
    }
  }
  async function afterPayment(order, settings) {
    if (!order.etims_requested) return;
    try {
      const record = await queue(order, order.etims_customer, settings);
      // A completed checkout must bring up its own KRA window immediately,
      // even when a previous receipt's companion is still open or minimized.
      await start(record.id, false, {newPopup:true});
    } catch (error) {
      window.alert('Sale paid successfully. eTIMS: '+error.message+' Your normal receipt is available; continue from Admin → eTIMS.');
    }
  }
  async function manual(record) {
    const f = record.fiscal || {}, e = core.escape;
    const overlay = document.createElement('div'); overlay.className = 'qty-popup-overlay etims-dialog-overlay';
    overlay.innerHTML = `<form class="qty-popup etims-dialog"><h3>Record official KRA invoice</h3><p>POS receipt ${e(record.receipt_no)}. Copy only genuine details from the official invoice. Saving a CU blocks duplicate generation.</p>${[['cu_invoice_number','CU Invoice Number (required)'],['scu_id','SCU ID'],['receipt_signature','Receipt Signature'],['invoice_number','Invoice Number'],['invoice_date','Invoice Date']].map(([k,label])=>`<label>${label}<input name="${k}" class="field" maxlength="160" value="${e(f[k])}" ${k==='cu_invoice_number'?'required':''}></label>`).join('')}<label>Official QR image (PNG / JPEG / WebP)<input name="qr" type="file" accept="image/png,image/jpeg,image/webp"></label><p>Optional fields can be completed later. A CU entered manually is marked as manually recorded.</p><p role="status" data-msg></p><div class="qty-popup-actions"><button type="button" class="ghost" data-close>Cancel</button><button class="primary" type="submit">Save KRA details</button></div></form>`;
    document.body.append(overlay);
    overlay.querySelector('[data-close]').onclick = () => overlay.remove();
    overlay.querySelector('form').onsubmit = async event => {
      event.preventDefault(); const form = event.target, button = form.querySelector('[type=submit]');
      button.disabled = true;
      try {
        const data = Object.fromEntries(new FormData(form)); delete data.qr;
        const file = form.elements.qr.files[0];
        if (file) {
          if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 350000) throw Error('Choose a QR image smaller than 350 KB.');
          data.qr_image = await new Promise((resolve,reject) => { const reader=new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=reject; reader.readAsDataURL(file); });
        } else data.qr_image = f.qr_image || '';
        await change(record.id, {type:'capture', source:'manual', fiscal:data, actor:localStorage.getItem('pos_employee_id') || 'cashier'});
        // The extension also keeps a duplicate block, including after a stale POS restore.
        try { await bridge('recorded', {record:(await ledger())[record.id]}, 1500); } catch (_) {}
        overlay.remove();
      } catch (error) { form.querySelector('[data-msg]').textContent = error.message; }
      finally { button.disabled = false; }
    };
  }
  async function checkedAbsent(record) {
    const reason = window.prompt('First search KRA’s existing invoices for this receipt, amount and customer. If no invoice was issued, describe what you checked. This allows a new attempt.');
    if (!reason?.trim()) return;
    // Revoke the old job and close its portal window BEFORE allowing a new attempt.
    await bridge('checked_absent', {id:record.id, attempt_id:record.attempt_id, reason});
    await change(record.id, {type:'checked_absent', reason, actor:localStorage.getItem('pos_employee_id') || 'cashier'});
  }
  async function list() { return Object.values(await ledger()).filter(r=>r.shop_id===scope()).sort((a,b)=>b.created_at.localeCompare(a.created_at)); }
  function checkoutMarkup() {
    return `<fieldset class="etims-checkout"><label><input type="checkbox" id="generateEtims"> Generate eTIMS Invoice</label><div id="etimsCustomerFields" hidden><p>All customer details are optional. KRA resolves the official customer name when a valid PIN is selected; the name below is saved to the POS receipt.</p><label>Customer name (optional)<input id="etimsName" class="field" type="text" maxlength="120" placeholder="e.g. Jane Wanjiku" autocomplete="name"></label><label>Phone number (optional)<input id="etimsPhone" class="field" type="tel" maxlength="40" placeholder="e.g. 0712345678" autocomplete="tel"></label><label>Customer KRA PIN (optional)<input id="etimsPin" class="field" maxlength="11" placeholder="A123456789B" autocapitalize="characters"></label><label>Customer email (optional)<input id="etimsEmail" class="field" type="email" maxlength="120" autocomplete="email"></label><label>Billing address (optional)<input id="etimsAddress" class="field" maxlength="240" autocomplete="street-address"></label></div></fieldset>`;
  }
  async function refreshReceipt() {
    const overlay = document.getElementById('receiptModal');
    if (!overlay?.dataset.etimsId) return;
    const record = (await ledger())[overlay.dataset.etimsId];
    const target = overlay.querySelector('[data-etims-receipt]');
    if (target) target.innerHTML = core.receipt(record);
    // A paid sale is NOT a completed KRA invoice. Wait until the actual issued
    // invoice, all its official fields and original QR are linked to this sale.
    if (overlay.dataset.etimsRequested === 'true' || record) {
      const fiscal = record?.fiscal;
      const ready = record?.status === 'generated' && fiscal?.source === 'portal' &&
        ['cu_invoice_number','scu_id','receipt_signature','invoice_number','invoice_date','qr_image'].every(key => Boolean(fiscal[key]));
      overlay.dataset.etimsConfirmed = String(ready);
      const button = overlay.querySelector('#receiptPrintBtn');
      if (button) {
        button.disabled = !ready;
        button.textContent = ready ? 'Print final KRA receipt' : 'Waiting for KRA invoice…';
        button.title = ready ? 'Official KRA details and QR captured.' : 'The POS payment is saved. Finish the invoice in KRA first.';
      }
    }
  }
  function mountReceipt(overlay, order) {
    overlay.dataset.etimsId = identity(order);
    overlay.dataset.etimsRequested = String(Boolean(order.etims_requested || order.etims?.status));
    if (overlay.dataset.etimsRequested === 'true') {
      const button = overlay.querySelector('#receiptPrintBtn');
      if (button) { button.disabled = true; button.textContent = 'Waiting for KRA invoice…'; }
    }
    overlay.etimsReady = refreshReceipt().catch(error => {
      if (order.etims_requested) overlay.querySelector('[data-etims-receipt]').textContent = 'eTIMS details unavailable. Open the eTIMS workspace before reprinting.';
      console.warn(error);
    });
    if (order.status === 'paid') {
      const button=document.createElement('button'); button.type='button';button.className='etims-manage-receipt';button.textContent='Manage eTIMS invoice';
      button.onclick=()=>manage(order).catch(error=>window.alert(error.message));
      overlay.querySelector('.receipt-modal').append(button);
    }
  }
  async function manage(order) {
    const settings = await (await db()).get(`shop:${scope()}:settings`, {});
    const record = await get(order) || await queue(order, order.etims_customer, settings);
    const overlay=document.createElement('div'); overlay.className='qty-popup-overlay etims-dialog-overlay';
    overlay.innerHTML=`<section class="qty-popup etims-dialog"><h3>eTIMS · ${core.escape(record.receipt_no)}</h3><p>${record.status==='generated'?'Generated · '+core.escape(record.fiscal.cu_invoice_number):record.status==='pending'?'Pending':'Resume filling if generation was never enabled. Otherwise check the existing KRA invoice before retrying.'}</p><p data-msg role="status"></p><div class="qty-popup-actions" style="flex-wrap:wrap">${record.status==='pending'?'<button data-action="start" class="primary">Prepare in KRA</button>':''}${record.status==='review_required'?'<button data-action="resume" class="primary">Resume filling in KRA</button><button data-action="recover" class="ghost">Check existing in KRA</button><button data-action="absent" class="ghost">Checked: no invoice issued</button>':''}<button data-action="manual" class="ghost">${record.status==='generated'?'Complete KRA details':'Enter CU manually'}</button><button data-action="close" class="ghost">Close</button></div></section>`;
    document.body.append(overlay);
    overlay.querySelectorAll('[data-action]').forEach(button=>button.onclick=async()=>{
      button.disabled=true;
      try {
        if (button.dataset.action==='start') await start(record.id);
        if (button.dataset.action==='resume') await start(record.id,'resume');
        if (button.dataset.action==='recover') await start(record.id,true);
        if (button.dataset.action==='manual') await manual(record);
        if (button.dataset.action==='absent') await checkedAbsent(record);
        overlay.remove();
      } catch(error) {overlay.querySelector('[data-msg]').textContent=error.message;button.disabled=false;}
    });
  }
  window.addEventListener('oraforge-etims-changed', () => { refreshReceipt().catch(console.warn); });
  window.OraforgeEtims = {scope, identity, queue, get, attach, list, start, sync, manual, checkedAbsent, checkoutMarkup, afterPayment, bridge, mountReceipt, manage};
  let syncing = false;
  const refresh = async (force = false) => {
    if (syncing || (!force && document.visibilityState === 'hidden')) return;
    syncing = true; try { await sync(); } catch (_) {} finally { syncing = false; }
  };
  window.addEventListener('focus', () => refresh());
  window.addEventListener('message', event => {
    // The KRA popup is focused when the invoice arrives, so POS may be
    // backgrounded. Do NOT ignore a trusted extension result notification.
    if (event.source===window && event.origin===location.origin && event.data?.channel===channel && event.data?.direction==='extension' && event.data?.action==='result_available') refresh(true);
  });
  setInterval(() => refresh(), 15000);
  setTimeout(() => refresh(), 1000);
})();
