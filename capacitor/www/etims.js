/* Offline demonstration invoices; no KRA submission or verification. */
(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const amount = cents => (Number(cents)/100).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
  const date = value => new Date(value).toLocaleString('en-GB',{timeZone:'Africa/Nairobi',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).replace(',', '');
  const sheetCSS = `*{box-sizing:border-box}body{margin:0;background:white;color:#111;font:14px 'Times New Roman',serif}.sheet{padding:6mm;width:210mm;margin:auto}.brand{font:bold 64px Arial;border-bottom:4px solid #d71920;width:max-content;margin-bottom:12px}.brand i{color:#d71920}.demo{font:12px Arial;color:#9b2020;text-align:right;margin-bottom:10px}.boxes{display:grid;grid-template-columns:1fr 1fr 1.15fr;gap:18px;margin-bottom:20px}.box{border:1px solid;padding:8px;overflow-wrap:anywhere;line-height:1.4}.items{height:135mm;width:100%;border-collapse:collapse;table-layout:fixed}.items th,.items td{border:1px solid;padding:8px;vertical-align:top;overflow-wrap:anywhere}.items th{background:#e5e5e5;text-align:left}.items .space td{height:auto;border-top:0}.items tbody tr:not(.space){height:1px}.items tbody tr:not(.space) td{border-bottom:0}.bottom{font-size:13px;display:grid;grid-template-columns:45% 53%;gap:2%;margin-top:16px;break-inside:avoid}.scu-heading{font-size:15px;font-weight:bold;border-bottom:1.5px solid #111;padding-bottom:6px;margin-bottom:10px;width:78%}.scu{overflow-wrap:anywhere;display:grid;grid-template-columns:minmax(0,1fr) 100px;gap:10px;line-height:1.2;font-size:14px}.scu p{margin:0 0 8px}.scu .scu-date{margin-bottom:0}.scu .scu-number{margin-top:16px;margin-bottom:12px}.scu img{width:100px;align-self:start;margin-top:24px}.scu-divider{border:0;border-top:1px dashed #111;margin:10px 0 8px}.scu-powered{font-size:15px}.summary{width:100%;border-collapse:collapse}.summary td,.summary th{border:1px solid;padding:8px;text-align:left}.summary th{background:#e5e5e5}.summary tr:last-child th{background:white}.items th,.summary th{-webkit-print-color-adjust:exact;print-color-adjust:exact}p{margin:5px 0}@page{size:A4;margin:6mm}@media print{html,body{width:198mm;margin:0!important;zoom:1!important}.sheet{width:198mm;padding:0;margin:0;min-height:0}.brand{font-size:64px}.bottom{break-inside:avoid;page-break-inside:avoid}.items thead{display:table-header-group}tr{break-inside:avoid}}`;
  const signature = id => 'LOCAL-' + id.replace(/-/g,'').toUpperCase().match(/.{1,4}/g).slice(0,4).join('-');
  function documentHTML(invoice, qr) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(invoice.number.replace(/^DEMO-/, 'INV-'))}</title><style>${sheetCSS}</style></head><body><article class="sheet"><div class="brand" style="font-size:34px;border-color:#215747">Oraforge Sample</div><p class="demo" style="font-size:16px;font-weight:bold">DEMONSTRATION ONLY — NOT A KRA TAX INVOICE</p><div class="boxes"><div class="box">INVOICE FROM<br>PIN: ${escape(invoice.sellerPin || '—')}<br>NAME: ${escape(invoice.seller)}</div><div class="box">INVOICE TO<br>PIN: ${escape(invoice.buyerPin || '—')}<br>NAME: ${escape(invoice.buyer)}</div><div class="box">INVOICE NO: ${escape(invoice.number.replace(/^DEMO-/, 'INV-'))}<br>Date: ${escape(date(invoice.created))}<br><br>NonVAT Invoice</div></div><table class="items"><colgroup><col style="width:15%"><col style="width:20%"><col style="width:15%"><col style="width:7%"><col style="width:15%"><col style="width:13%"><col style="width:15%"></colgroup><thead><tr>${['Item Code','Item Description','Qty x Unit Price','Rate','Amt excl. Tax','Tax Amt','Amt incl. Tax'].map(s=>`<th>${s}</th>`).join('')}</tr></thead><tbody>${invoice.items.map(row=>`<tr><td>${escape(row.code)}</td><td>${escape(row.name)}</td><td>${escape(row.qty)} x ${amount(row.unit)}</td><td>NV</td><td>${amount(row.total)}</td><td>0.00</td><td>${amount(row.total)}</td></tr>`).join('')}<tr class="space">${'<td></td>'.repeat(7)}</tr></tbody></table><div class="bottom"><div><div class="scu-heading">SCU INFORMATION</div><div class="scu"><div><p class="scu-date">Date : ${escape(date(invoice.created))}</p><p>KRA SCU ID : None (local preview)</p><p class="scu-number">Local preview reference :<br>${escape(invoice.number.replace(/^DEMO-/, 'INV-'))}</p><p>Internal Data : ${escape(invoice.id.toUpperCase())}</p><p>Local draft signature : ${escape((invoice.signature || signature(invoice.id)).replace(/^DEMO-/, 'LOCAL-'))}</p><hr class="scu-divider"><p class="scu-powered">Prepared locally in Oraforge</p></div><span class="demo">No KRA verification QR</span></div></div><div>TAX SUMMARY<table class="summary"><tr><th>Tax Rate</th><th>Taxable Amt</th><th>Tax Amt</th><th>Total Amt</th></tr><tr><td>Non Vat</td><td>KSh ${amount(invoice.total)}</td><td>KSh 0.00</td><td>KSh ${amount(invoice.total)}</td></tr><tr><th>Totals</th><th>KSh ${amount(invoice.total)}</th><th>KSh 0.00</th><th>KSh ${amount(invoice.total)}</th></tr></table></div></div></article></body></html>`;
  }
  window.renderEtims = async function() {
    const root = document.getElementById('sec-etims');
    try {
      const [orders, saved, settings, defaults, products] = await Promise.all([LocalAdmin.get('orders',[]),LocalAdmin.get('etims_demo_invoices',[]),LocalAdmin.settings(),LocalAdmin.get('etims_demo_seller',{}),LocalAdmin.get('items',[])]);
      const sales = orders.filter(o=>o.status==='paid').sort((a,b)=>Number(b.id)-Number(a.id));
      root.innerHTML = `
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
  .etims-local-note{padding:13px 16px;background:var(--panel);color:var(--muted);border:1px solid var(--line);border-radius:12px;margin-bottom:16px;font-size:13px;line-height:1.55}
  @media(max-width:640px){.etims-launch{padding:22px;border-radius:17px}.etims-launch-kra img{width:145px;height:42px}.etims-launch-brand img{height:62px;width:76px}.etims-launch h2{font-size:31px}.etims-launch-open{width:100%}}
  </style><section class="etims-launch" aria-labelledby="oraforge-etims-title">
  <div class="etims-launch-top"><div class="etims-launch-brand"><img src="data:image/png;base64,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" alt="Oraforge Technologies logo"><div class="etims-launch-brand-label"><strong>ORAFORGE POS</strong><span>Powered by Oraforge Technologies</span></div></div><div class="etims-launch-kra"><img src="data:image/png;base64,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" alt="Kenya Revenue Authority logo"></div></div>
  <span class="etims-launch-eyebrow">✦ Digital Invoicing Workspace</span>
  <h2 id="oraforge-etims-title">eTIMS <span>Invoice Workspace.</span></h2>
  <p class="etims-launch-description">Manage your store in Oraforge and access official KRA invoicing from one convenient workspace.</p>
  <div class="etims-launch-bottom"><button type="button" id="etimsLaunchOpen" class="etims-launch-open">Open eTIMS <span aria-hidden="true">↗</span></button><span class="etims-launch-note">Opens official KRA invoicing in a separate secure window. Automatic submission from Oraforge is not yet connected.</span></div>
</section><div class="etims-local-note"><strong>Local invoice previews:</strong> The tools below create internal previews only. They are not issued to or verified by KRA.</div>` + `<div class="page-header"><div><h1>Local invoice previews</h1><p>Prepare practice documents from completed sales.</p></div></div><div class="panel"><div class="panel-body"><form id="etimsForm"><div class="form-grid-2" style="display:grid;gap:16px"><label>Completed sale<select required class="form-input" name="sale"><option value="">Select a sale</option>${sales.map(o=>`<option value="${Number(o.id)}">${escape(o.ticket_no || o.id)} · KES ${amount(o.total_cents)}</option>`).join('')}</select></label><label>Seller name<input required class="form-input" name="seller" value="${escape(defaults.name || settings.business_name)}"></label><label>Seller PIN<input class="form-input" name="sellerPin" value="${escape(defaults.pin || '')}"></label><label>Buyer name<input required class="form-input" name="buyer" value="Walk-in customer"></label><label>Buyer PIN (optional)<input class="form-input" name="buyerPin"></label></div><div id="etimsDraftItems"></div><p id="etimsError" role="alert" style="color:#b91c1c"></p><button class="btn btn-primary" ${sales.length?'':'disabled'}>Create local preview</button>${sales.length?'':'<p>Complete a POS sale to create your first invoice.</p>'}</form></div></div><div class="panel" style="margin-top:20px"><div class="panel-header"><div class="panel-title">Saved local previews</div></div><div class="panel-body"><input class="form-input" id="etimsSearch" placeholder="Search invoice, buyer, or sale" aria-label="Search invoices"><label style="display:block;margin:12px 0"><input type="checkbox" id="etimsDeleted"> Show deleted invoices</label><div id="etimsHistory" aria-live="polite"></div></div></div><div id="etimsPreview"></div>`;
      const openEtims = root.querySelector('#etimsLaunchOpen');
      openEtims.addEventListener('click', () => {
        const target='https://ecitizen.kra.go.ke/individual/etims/sale/create';
        const popup=window.open(target,'oraforge-etims-window','popup=yes,width=1150,height=790,scrollbars=yes,resizable=yes');
        if(popup) popup.focus();
        else window.alert('Please allow pop-up windows for Oraforge to open eTIMS.');
      });
      let invoices = saved;
      const error = e => { root.querySelector('#etimsError').textContent=e.message; };
      const persist = async next => { await LocalAdmin.set('etims_demo_invoices',next); invoices=next; history(); };
      const duplicates = sale => invoices.filter(i=>!i.deletedAt && (String(i.saleId || '')===String(sale.id) || String(i.ticket)===String(sale.ticket_no || sale.id)));
      const history = () => {
        const box=root.querySelector('#etimsHistory');
        const query=root.querySelector('#etimsSearch').value.toLowerCase();
        const deleted=root.querySelector('#etimsDeleted').checked;
        const list=invoices.filter(i=>Boolean(i.deletedAt)===deleted && [i.number,i.buyer,i.ticket].join(' ').toLowerCase().includes(query));
        box.innerHTML = list.length ? list.map(i=>`<div class="promo-queue-row"><div><strong>${escape(i.number.replace(/^DEMO-/, 'INV-'))}</strong><p>${escape(i.buyer)} · KES ${amount(i.total)}</p><small>${escape(date(i.created))} · Sale ${escape(i.ticket)} · Revision ${i.revision || 1}${i.deletedAt?' · Deleted':''}</small></div><div style="display:flex;gap:8px;flex-wrap:wrap">${i.deletedAt ? `<button class="btn" data-restore="${escape(i.id)}">Restore</button>` : `<button class="btn" data-invoice="${escape(i.id)}">Open invoice</button><button class="btn" data-edit="${escape(i.id)}">Edit</button><button class="btn" data-delete="${escape(i.id)}" style="color:#b91c1c">Delete</button>`}</div></div>`).join('') : '<p>No matching local previews.</p>';
        box.querySelectorAll('[data-invoice]').forEach(btn=>btn.onclick=()=>preview(invoices.find(i=>i.id===btn.dataset.invoice)).catch(error));
        box.querySelectorAll('[data-edit]').forEach(btn=>btn.onclick=()=>edit(invoices.find(i=>i.id===btn.dataset.edit)));
        box.querySelectorAll('[data-delete]').forEach(btn=>btn.onclick=async()=>{
          const invoice=invoices.find(i=>i.id===btn.dataset.delete);
          if (!confirm(`Delete ${invoice.number}? You can restore it from deleted invoices.`)) return;
          try { await persist(invoices.map(i=>i.id===invoice.id?{...i,deletedAt:new Date().toISOString()}:i));root.querySelector('#etimsPreview').innerHTML=''; } catch(e) {error(e);}
        });
        box.querySelectorAll('[data-restore]').forEach(btn=>btn.onclick=async()=>{
          const invoice=invoices.find(i=>i.id===btn.dataset.restore);
          const existing=invoices.find(i=>!i.deletedAt && String(i.ticket)===String(invoice.ticket));
          if (existing && !confirm(`Sale already has ${existing.number}. Restore this additional invoice?`)) return;
          try {await persist(invoices.map(i=>i.id===invoice.id?{...i,deletedAt:null}:i));} catch(e){error(e);}
        });
      };
      root.querySelector('#etimsSearch').oninput=history;
      root.querySelector('#etimsDeleted').onchange=history;
      let draftItems=[];
      const createForm=root.querySelector('#etimsForm');
      const readDraft=()=>draftItems.map((r,n)=>({...r,
        code:createForm.elements['draft_code_'+n].value.trim(),
        name:createForm.elements['draft_name_'+n].value.trim(),
        qty:Number(createForm.elements['draft_qty_'+n].value),
        unit:Math.round(Number(createForm.elements['draft_unit_'+n].value)*100)
      })).map(r=>({...r,total:Math.round(r.qty*r.unit)}));
      function loadDraft(sale) {
        draftItems=(sale?.items||[]).map(row=>({code:row.sku || products.find(p=>Number(p.id)===Number(row.menu_item_id))?.sku || String(row.menu_item_id || ''),name:row.name,qty:Number(row.qty),unit:Number(row.unit_price_cents)}));
        const box=root.querySelector('#etimsDraftItems');
        box.innerHTML=draftItems.length?`<h3 style="margin-top:20px">Invoice items</h3><div style="overflow:auto"><table class="data-table"><thead><tr><th>Code</th><th>Description</th><th>Qty</th><th>Unit price (KES)</th></tr></thead><tbody>${draftItems.map((r,n)=>`<tr>${[['code',r.code,'text'],['name',r.name,'text'],['qty',r.qty,'number'],['unit',(r.unit/100).toFixed(2),'number']].map(([key,value,type])=>`<td><input class="form-input" aria-label="${key} ${n+1}" name="draft_${key}_${n}" type="${type}" ${type==='number'?'min="'+(key==='qty'?'0.001':'0')+'" step="'+(key==='qty'?'0.001':'0.01')+'"':''} required value="${escape(value)}" style="min-width:${key==='name'?'190':'90'}px"></td>`).join('')}</tr>`).join('')}</tbody></table></div><p id="etimsDraftTotal" aria-live="polite"></p>`:'';
        const updateTotal=()=>{if(draftItems.length) root.querySelector('#etimsDraftTotal').textContent='Invoice total: KES '+amount(readDraft().reduce((sum,r)=>sum+r.total,0));};
        box.oninput=updateTotal;updateTotal();
      }
      root.querySelector('[name="sale"]').onchange=event=>{
        const sale=sales.find(o=>String(o.id)===event.target.value);
        loadDraft(sale);
        const existing=sale ? duplicates(sale) : [];
        root.querySelector('#etimsError').textContent=existing.length?`Already invoiced: ${existing.map(i=>i.number).join(', ')}. Open or edit the existing receipt below.`:'';
      };
      function edit(invoice) {
        const box=root.querySelector('#etimsPreview');
        box.innerHTML=`<div class="panel" style="margin-top:20px"><div class="panel-body"><h2>Edit ${escape(invoice.number.replace(/^DEMO-/, 'INV-'))}</h2><p>Changes apply to this invoice only. The POS sale is unchanged.</p><form id="etimsEditForm"><div class="form-grid-2" style="display:grid;gap:12px">${[['seller','Seller name'],['sellerPin','Seller PIN'],['buyer','Buyer name'],['buyerPin','Buyer PIN']].map(([key,label])=>`<label>${label}<input class="form-input" name="${key}" value="${escape(invoice[key])}" ${key==='seller'||key==='buyer'?'required':''}></label>`).join('')}</div><div style="overflow:auto;margin-top:16px"><table class="data-table"><thead><tr><th>Code</th><th>Description</th><th>Qty</th><th>Unit price (KES)</th></tr></thead><tbody>${invoice.items.map((r,n)=>`<tr>${[['code',r.code,'text'],['name',r.name,'text'],['qty',r.qty,'number'],['unit',(r.unit/100).toFixed(2),'number']].map(([key,value,type])=>`<td><input aria-label="${key} ${n+1}" class="form-input" name="${key}_${n}" type="${type}" ${type==='number'?'min="'+(key==='qty'?'0.001':'0')+'" step="'+(key==='qty'?'0.001':'0.01')+'"':''} required value="${escape(value)}" style="min-width:${key==='name'?'190':'90'}px"></td>`).join('')}</tr>`).join('')}</tbody></table></div><p id="etimsEditTotal"></p><p role="alert" id="etimsEditError" style="color:#b91c1c"></p><button class="btn btn-primary">Save & preview</button> <button type="button" class="btn" id="etimsEditCancel">Cancel</button></form></div></div>`;
        const form=box.querySelector('form');
        const readItems=()=>invoice.items.map((r,n)=>({...r,code:form.elements['code_'+n].value.trim(),name:form.elements['name_'+n].value.trim(),qty:Number(form.elements['qty_'+n].value),unit:Math.round(Number(form.elements['unit_'+n].value)*100)})).map(r=>({...r,total:Math.round(r.qty*r.unit)}));
        const total=()=>readItems().reduce((sum,r)=>sum+r.total,0);
        form.oninput=()=>{box.querySelector('#etimsEditTotal').textContent='Invoice total: KES '+amount(total());};form.oninput();
        box.querySelector('#etimsEditCancel').onclick=()=>preview(invoice).catch(error);
        form.onsubmit=async event=>{
          event.preventDefault();const button=form.querySelector('button');button.disabled=true;
          try {
            const fields=new FormData(form);const items=readItems();
            if (!items.every(r=>r.name && r.qty>0 && Number.isSafeInteger(r.unit) && r.unit>=0 && Number.isSafeInteger(r.total))) throw new Error('Check quantities, descriptions and prices.');
            if (!fields.get('seller').trim() || !fields.get('buyer').trim()) throw new Error('Seller and buyer names are required.');
            const updated={...invoice,items,total:total(),revision:(invoice.revision||1)+1,updatedAt:new Date().toISOString(),signature:invoice.signature||signature(invoice.id),changes:[...(invoice.changes||[]),{at:new Date().toISOString(),reason:'Invoice updated',previous:{seller:invoice.seller,buyer:invoice.buyer,sellerPin:invoice.sellerPin,buyerPin:invoice.buyerPin,items:invoice.items,total:invoice.total}}]};
            for(const key of ['seller','sellerPin','buyer','buyerPin']) updated[key]=fields.get(key).trim();
            await persist(invoices.map(i=>i.id===invoice.id?updated:i));await preview(updated);
          } catch(e) {box.querySelector('#etimsEditError').textContent=e.message;button.disabled=false;}
        };
        box.scrollIntoView({behavior:'smooth'});
      }
      async function preview(invoice) {
        const response = await fetch('etims-demo-qr.svg');
        if (!response.ok) throw new Error('Receipt QR asset could not be loaded.');
        const qr='data:image/svg+xml;base64,'+btoa(await response.text());
        const html=documentHTML(invoice,qr);
        const box=root.querySelector('#etimsPreview');
        box.innerHTML='<div class="panel" style="margin-top:20px"><div class="panel-header" style="flex-wrap:wrap;gap:10px"><strong>Invoice preview</strong><div><button class="btn" id="etimsPreviewEdit">Edit invoice</button> <button class="btn" id="etimsDownload">Download HTML</button> <button class="btn btn-primary" id="etimsPrint">Print / Save PDF</button></div></div><div style="overflow:auto"><iframe title="Invoice preview" style="width:810px;height:1150px;border:0;background:white"></iframe></div></div>';
        if (invoice.changes?.length) {
          const audit=document.createElement('details');
          audit.style.cssText='padding:16px;';
          audit.innerHTML='<summary>Edit history</summary>'+invoice.changes.map(change=>`<p>${escape(date(change.at))} — ${escape(change.reason)}</p>`).join('');
          box.prepend(audit);
        }
        box.querySelector('#etimsPreviewEdit').onclick=()=>edit(invoice);
        const frame = box.querySelector('iframe');
        frame.srcdoc=html;
        frame.onload=()=>{
          const scale=Math.min(1, box.clientWidth / 810);
          frame.style.width='100%';
          frame.style.height=(1150*scale)+'px';
          const style=frame.contentDocument.createElement('style');
          style.textContent='@media screen {body {zoom:'+scale+'}}';
          frame.contentDocument.head.appendChild(style);
        };
        box.querySelector('#etimsPrint').onclick=()=>box.querySelector('iframe').contentWindow.print();
        box.querySelector('#etimsDownload').onclick=()=>{const url=URL.createObjectURL(new Blob([html],{type:'text/html'}));const a=document.createElement('a');a.href=url;a.download=invoice.number+'.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};
        box.scrollIntoView({behavior:'smooth',block:'start'});
      }
      root.querySelector('form').onsubmit=async event=>{
        event.preventDefault();const form=event.currentTarget;const button=form.querySelector('button');button.disabled=true;
        try {
          const fields=new FormData(form);const sale=sales.find(o=>String(o.id)===fields.get('sale'));
          if (sale && duplicates(sale).length) { const existing=duplicates(sale)[0]; await preview(existing); throw new Error(`Already created ${existing.number} for this sale. Edit or print that receipt instead.`); }
          if (!sale?.items?.length) throw new Error('This sale has no invoice items.');
          if (Number(sale.tax_cents || 0)!==0) throw new Error('This template supports NonVAT sales only.');
          const items=readDraft();
          const total=items.reduce((sum,r)=>sum+r.total,0);
          if (!items.length || !items.every(r=>r.code && r.name && Number.isFinite(r.qty) && r.qty>0 && Number.isSafeInteger(r.unit) && r.unit>=0 && Number.isSafeInteger(r.total)) || !Number.isSafeInteger(total)) throw new Error('Check item codes, descriptions, quantities and prices.');
          if (!fields.get('seller').trim() || !fields.get('buyer').trim()) throw new Error('Seller and buyer names are required.');
          const sequence=Math.max(Number(await LocalAdmin.get('etims_demo_sequence',0)),...invoices.map(i=>Number(i.number.replace(/^(DEMO|INV)-/,''))||0))+1;
          await LocalAdmin.set('etims_demo_sequence',sequence);
          const id=crypto.randomUUID();const invoice={id,signature:signature(id),saleId:sale.id,revision:1,number:'INV-'+String(sequence).padStart(6,'0'),created:new Date().toISOString(),seller:fields.get('seller').trim(),sellerPin:fields.get('sellerPin').trim(),buyer:fields.get('buyer').trim(),buyerPin:fields.get('buyerPin').trim(),ticket:sale.ticket_no || sale.id,items,total};
          await LocalAdmin.set('etims_demo_invoices',[invoice,...invoices]);invoices=[invoice,...invoices];
          await LocalAdmin.set('etims_demo_seller',{name:invoice.seller,pin:invoice.sellerPin});history();await preview(invoice);
        } catch(error) {root.querySelector('#etimsError').textContent=error.message;} finally {button.disabled=false;}
      };
      history();
    } catch(error) {root.textContent='Could not open eTIMS: '+error.message;}
  };
})();
