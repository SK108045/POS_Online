/* Offline demonstration invoices; no KRA submission or verification. */
(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const amount = cents => (Number(cents)/100).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
  const date = value => new Date(value).toLocaleString('en-GB',{timeZone:'Africa/Nairobi',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).replace(',', '');
  const sheetCSS = `*{box-sizing:border-box}body{margin:0;background:white;color:#111;font:14px 'Times New Roman',serif}.sheet{padding:6mm;width:210mm;margin:auto}.brand{font:bold 64px Arial;border-bottom:4px solid #d71920;width:max-content;margin-bottom:12px}.brand i{color:#d71920}.demo{font:12px Arial;color:#9b2020;text-align:right;margin-bottom:10px}.boxes{display:grid;grid-template-columns:1fr 1fr 1.15fr;gap:18px;margin-bottom:20px}.box{border:1px solid;padding:8px;overflow-wrap:anywhere;line-height:1.4}.items{height:135mm;width:100%;border-collapse:collapse;table-layout:fixed}.items th,.items td{border:1px solid;padding:8px;vertical-align:top;overflow-wrap:anywhere}.items th{background:#e5e5e5;text-align:left}.items .space td{height:auto;border-top:0}.items tbody tr:not(.space){height:1px}.items tbody tr:not(.space) td{border-bottom:0}.bottom{font-size:13px;display:grid;grid-template-columns:45% 53%;gap:2%;margin-top:16px;break-inside:avoid}.scu-heading{font-size:15px;font-weight:bold;border-bottom:1.5px solid #111;padding-bottom:6px;margin-bottom:10px;width:78%}.scu{overflow-wrap:anywhere;display:grid;grid-template-columns:minmax(0,1fr) 100px;gap:10px;line-height:1.2;font-size:14px}.scu p{margin:0 0 8px}.scu .scu-date{margin-bottom:0}.scu .scu-number{margin-top:16px;margin-bottom:12px}.scu img{width:100px;align-self:start;margin-top:24px}.scu-divider{border:0;border-top:1px dashed #111;margin:10px 0 8px}.scu-powered{font-size:15px}.summary{width:100%;border-collapse:collapse}.summary td,.summary th{border:1px solid;padding:8px;text-align:left}.summary th{background:#e5e5e5}.summary tr:last-child th{background:white}.items th,.summary th{-webkit-print-color-adjust:exact;print-color-adjust:exact}p{margin:5px 0}@page{size:A4;margin:6mm}@media print{html,body{width:198mm;margin:0!important;zoom:1!important}.sheet{width:198mm;padding:0;margin:0;min-height:0}.brand{font-size:64px}.bottom{break-inside:avoid;page-break-inside:avoid}.items thead{display:table-header-group}tr{break-inside:avoid}}`;
  const signature = id => 'LOCAL-' + id.replace(/-/g,'').toUpperCase().match(/.{1,4}/g).slice(0,4).join('-');
  function documentHTML(invoice, qr) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(invoice.number.replace(/^DEMO-/, 'INV-'))}</title><style>${sheetCSS}</style></head><body><article class="sheet"><div class="brand">eT<i>i</i>MS</div><div class="boxes"><div class="box">INVOICE FROM<br>PIN: ${escape(invoice.sellerPin || '—')}<br>NAME: ${escape(invoice.seller)}</div><div class="box">INVOICE TO<br>PIN: ${escape(invoice.buyerPin || '—')}<br>NAME: ${escape(invoice.buyer)}</div><div class="box">INVOICE NO: ${escape(invoice.number.replace(/^DEMO-/, 'INV-'))}<br>Date: ${escape(date(invoice.created))}<br><br>NonVAT Invoice</div></div><table class="items"><colgroup><col style="width:15%"><col style="width:20%"><col style="width:15%"><col style="width:7%"><col style="width:15%"><col style="width:13%"><col style="width:15%"></colgroup><thead><tr>${['Item Code','Item Description','Qty x Unit Price','Rate','Amt excl. Tax','Tax Amt','Amt incl. Tax'].map(s=>`<th>${s}</th>`).join('')}</tr></thead><tbody>${invoice.items.map(row=>`<tr><td>${escape(row.code)}</td><td>${escape(row.name)}</td><td>${escape(row.qty)} x ${amount(row.unit)}</td><td>NV</td><td>${amount(row.total)}</td><td>0.00</td><td>${amount(row.total)}</td></tr>`).join('')}<tr class="space">${'<td></td>'.repeat(7)}</tr></tbody></table><div class="bottom"><div><div class="scu-heading">SCU INFORMATION</div><div class="scu"><div><p class="scu-date">Date : ${escape(date(invoice.created))}</p><p>SCU ID : Not assigned</p><p class="scu-number">CU INVOICE NO. :<br>${escape(invoice.number.replace(/^DEMO-/, 'INV-'))}</p><p>Internal Data : ${escape(invoice.id.toUpperCase())}</p><p>Receipt Signature : ${escape((invoice.signature || signature(invoice.id)).replace(/^DEMO-/, 'LOCAL-'))}</p><hr class="scu-divider"><p class="scu-powered">Powered by eTIMS</p></div><img src="${qr}" alt="Receipt QR code"></div></div><div>TAX SUMMARY<table class="summary"><tr><th>Tax Rate</th><th>Taxable Amt</th><th>Tax Amt</th><th>Total Amt</th></tr><tr><td>Non Vat</td><td>KSh ${amount(invoice.total)}</td><td>KSh 0.00</td><td>KSh ${amount(invoice.total)}</td></tr><tr><th>Totals</th><th>KSh ${amount(invoice.total)}</th><th>KSh 0.00</th><th>KSh ${amount(invoice.total)}</th></tr></table></div></div></article></body></html>`;
  }
  window.renderEtims = async function() {
    const root = document.getElementById('sec-etims');
    try {
      const [orders, saved, settings, defaults, products] = await Promise.all([LocalAdmin.get('orders',[]),LocalAdmin.get('etims_demo_invoices',[]),LocalAdmin.settings(),LocalAdmin.get('etims_demo_seller',{}),LocalAdmin.get('items',[])]);
      const sales = orders.filter(o=>o.status==='paid').sort((a,b)=>Number(b.id)-Number(a.id));
      root.innerHTML = `<div class="page-header"><div><h1>eTIMS</h1><p>Create and file invoices from completed sales.</p></div></div><div class="panel"><div class="panel-body"><form id="etimsForm"><div class="form-grid-2" style="display:grid;gap:16px"><label>Completed sale<select required class="form-input" name="sale"><option value="">Select a sale</option>${sales.map(o=>`<option value="${Number(o.id)}">${escape(o.ticket_no || o.id)} · KES ${amount(o.total_cents)}</option>`).join('')}</select></label><label>Seller name<input required class="form-input" name="seller" value="${escape(defaults.name || settings.business_name)}"></label><label>Seller PIN<input class="form-input" name="sellerPin" value="${escape(defaults.pin || '')}"></label><label>Buyer name<input required class="form-input" name="buyer" value="Walk-in customer"></label><label>Buyer PIN (optional)<input class="form-input" name="buyerPin"></label></div><div id="etimsDraftItems"></div><p id="etimsError" role="alert" style="color:#b91c1c"></p><button class="btn btn-primary" ${sales.length?'':'disabled'}>Create invoice</button>${sales.length?'':'<p>Complete a POS sale to create your first invoice.</p>'}</form></div></div><div class="panel" style="margin-top:20px"><div class="panel-header"><div class="panel-title">Filed invoices</div></div><div class="panel-body"><input class="form-input" id="etimsSearch" placeholder="Search invoice, buyer, or sale" aria-label="Search invoices"><label style="display:block;margin:12px 0"><input type="checkbox" id="etimsDeleted"> Show deleted invoices</label><div id="etimsHistory" aria-live="polite"></div></div></div><div id="etimsPreview"></div>`;
      let invoices = saved;
      const error = e => { root.querySelector('#etimsError').textContent=e.message; };
      const persist = async next => { await LocalAdmin.set('etims_demo_invoices',next); invoices=next; history(); };
      const duplicates = sale => invoices.filter(i=>!i.deletedAt && (String(i.saleId || '')===String(sale.id) || String(i.ticket)===String(sale.ticket_no || sale.id)));
      const history = () => {
        const box=root.querySelector('#etimsHistory');
        const query=root.querySelector('#etimsSearch').value.toLowerCase();
        const deleted=root.querySelector('#etimsDeleted').checked;
        const list=invoices.filter(i=>Boolean(i.deletedAt)===deleted && [i.number,i.buyer,i.ticket].join(' ').toLowerCase().includes(query));
        box.innerHTML = list.length ? list.map(i=>`<div class="promo-queue-row"><div><strong>${escape(i.number.replace(/^DEMO-/, 'INV-'))}</strong><p>${escape(i.buyer)} · KES ${amount(i.total)}</p><small>${escape(date(i.created))} · Sale ${escape(i.ticket)} · Revision ${i.revision || 1}${i.deletedAt?' · Deleted':''}</small></div><div style="display:flex;gap:8px;flex-wrap:wrap">${i.deletedAt ? `<button class="btn" data-restore="${escape(i.id)}">Restore</button>` : `<button class="btn" data-invoice="${escape(i.id)}">Open invoice</button><button class="btn" data-edit="${escape(i.id)}">Edit</button><button class="btn" data-delete="${escape(i.id)}" style="color:#b91c1c">Delete</button>`}</div></div>`).join('') : '<p>No matching invoices.</p>';
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
