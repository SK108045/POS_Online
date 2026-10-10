/* Semantic DOM adapter. Adjust selectors in Options after testing the live portal.
 * Never selects a tax category, changes prices to force totals, or submits forms. */
(function(root, factory) {
  const api = factory();
  if (typeof module==='object' && module.exports) module.exports=api;
  else root.OraforgeKraAdapter=api;
})(globalThis, function() {
  'use strict';
  const labels = {
    pin:/^(customer|buyer)? ?(kra )?pin( number)?$/i,
    phone:/^(customer|buyer)? ?(phone|mobile)( number)?$/i,
    email:/^(customer|buyer)? ?e?mail( address)?$/i,
    billing_address:/^(customer )?(billing )?address$/i,
    reference:/^(pos |receipt |customer |external |invoice )?(reference|reference number|receipt number|receipt no)$/i,
    payment_method:/^payment (method|mode|type)$/i,
    discount_type:/^discount type$/i, discount_value:/^(discount|discount value|discount amount|discount percentage)$/i,
    item_name:/^(item|product)( name)?$/i, item_description:/^(item |product )?description$/i,
    item_quantity:/^(quantity|qty)$/i, item_price:/^(unit |selling |unit selling )?price$/i,
    total:/^(grand total|total( amount| payable)?|invoice total)$/i,
    cu_invoice_number:/^(e ?tims )?cu (invoice )?(number|no)$/i,
    scu_id:/^(scu id|scu number|control unit id)$/i,
    receipt_signature:/^(receipt )?signature$/i,
    invoice_number:/^invoice (number|no)$/i, invoice_date:/^(invoice date|date issued|date\/time|date time)$/i,
    seller_pin:/^(seller|supplier|business) (kra )?pin$/i
  };
  const selectors = {
    pin:'[name="customer_pin"], [name="buyer_pin"], #customer_pin, #buyer_pin',
    phone:'[name="customer_phone"], [name="phone"]', email:'[name="customer_email"], [name="email"]',
    billing_address:'[name="billing_address"]', reference:'[name="reference"], [name="receipt_no"], [name="external_reference"]',
    payment_method:'[name="payment_method"], [name="payment_mode"]',
    discount_type:'[name="discount_type"]', discount_value:'[name="discount"], [name="discount_value"], [name="discount_amount"]',
    rows:'[data-invoice-item], [data-etims-item], .invoice-item-row, .invoice-item, tr:has(input[name*="quantity"]), tr:has(input[name*="qty"])',
    add_item:'[data-action="add-item"], #add-item, #addItem',
    item_name:'[name$="[name]"], [name$="[item_name]"], [name="item_name"]',
    item_description:'[name$="[description]"], [name="description"]',
    item_quantity:'[name$="[quantity]"], [name$="[qty]"], [name="quantity"], [name="qty"]',
    item_price:'[name$="[unit_price]"], [name$="[price]"], [name="unit_price"]',
    total:'[name="total"], [data-total], #grand-total',
    qr:'img[alt*="QR" i], img[id*="qr" i], [data-etims-field="qr"] img, canvas[data-qr], svg[data-qr], [id*="qr" i] svg'
  };
  const clean = s => String(s || '').replace(/[_:.*]/g,' ').replace(/\s+/g,' ').trim();
  const norm = str => String(str).toLowerCase().replace(/%/g,'percent').replace(/[^a-z0-9]/g,'');
  const aliases = {mpesa:['mpesa','mobilemoney'],cash:['cash'],percent:['percent','percentage','%'],fixed:['fixed','amount','fixedamount']};
  function money(value) {
    const text=String(value ?? '').replace(/KES|KSHS?\.?/ig,'').replace(/,/g,'').trim();
    if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
    const amount=Math.round(Number(text)*100);
    return Number.isSafeInteger(amount)?amount:null;
  }
  function adapter(doc, config={}) {
    const visible = el => el && !el.closest('[data-oraforge-companion], [hidden]') && doc.defaultView.getComputedStyle(el).display!=='none';
    const query = (sel, context=doc) => { try { return [...context.querySelectorAll(sel)].filter(visible); } catch (_) { throw Error('Invalid portal selector: '+sel); } };
    function find(key, context=doc) {
      if (config[key]) return query(config[key],context)[0];
      let el = query(`[data-etims-field="${key}"]`,context)[0] || (selectors[key] && query(selectors[key],context)[0]);
      if (el || !labels[key]) return el;
      for (const field of query('input, textarea, select',context)) {
        const label = field.labels?.[0]?.textContent || field.getAttribute('aria-label') || field.getAttribute('placeholder') || field.name || field.id;
        if (labels[key].test(clean(label))) return field;
      }
      for (const label of query('dt, th, label, [data-label], td, p, span, strong',context)) {
        const content=label.textContent.trim(), colon=content.indexOf(':');
        if (colon>0 && labels[key].test(clean(content.slice(0,colon))) && content.slice(colon+1).trim() && content.length<350) return label;
        if (!labels[key].test(clean(content))) continue;
        const target = label.htmlFor && doc.getElementById(label.htmlFor);
        if (target && visible(target)) return target;
        const next = label.nextElementSibling;
        if (next && visible(next)) return next;
      }
      return null;
    }
    const value = el => el ? String('value' in el ? el.value : el.textContent).trim() : '';
    const read = (key, context=doc) => {
      const el=find(key,context), raw=value(el), colon=raw.indexOf(':');
      return el && !('value' in el) && colon>0 && labels[key]?.test(clean(raw.slice(0,colon))) ? raw.slice(colon+1).trim() : raw;
    };
    function set(key, input, context=doc) {
      const el = find(key,context);
      if (!el || el.disabled || el.readOnly || !('value' in el)) return false;
      let val = String(input);
      if (el.tagName==='SELECT') {
        const allowed = aliases[val] || [val];
        const option = [...el.options].find(o=>allowed.some(a=>norm(o.value)===norm(a) || norm(o.textContent)===norm(a)));
        if (!option) return false;
        val=option.value;
      }
      const proto = el.tagName==='SELECT' ? doc.defaultView.HTMLSelectElement.prototype : el.tagName==='TEXTAREA'?doc.defaultView.HTMLTextAreaElement.prototype:doc.defaultView.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(el,val);
      el.dispatchEvent(new doc.defaultView.Event('input',{bubbles:true}));
      el.dispatchEvent(new doc.defaultView.Event('change',{bubbles:true}));
      el.dispatchEvent(new doc.defaultView.Event('blur',{bubbles:true}));
      return value(el)===val;
    }
    const rows = () => query(config.rows || selectors.rows);
    function addItem() {
      const button=(config.add_item?query(config.add_item)[0]:query(selectors.add_item)[0]) || query('button, [role=button]').find(b=>/^add (an? )?(item|product|line)$/i.test(clean(b.textContent)));
      if (!button || button.disabled || button.type==='submit') return false;
      button.click(); return true;
    }
    function fill(payload) {
      const missing=[];
      for (const [key,val] of Object.entries({...payload.customer, reference:payload.receipt_no,payment_method:payload.payment_method})) {
        if (val && !set(key,val)) missing.push(key);
      }
      const elements=rows();
      if (elements.length !== payload.items.length) missing.push('item rows');
      payload.items.forEach((item,i)=>{
        if (!elements[i]) return;
        for (const [key,val] of Object.entries({item_name:item.name,item_description:item.description,item_quantity:item.quantity,item_price:(item.unit_price_cents/100).toFixed(2)})) {
          if (val!=='' && !set(key,val,elements[i])) missing.push(`${key} ${i+1}`);
        }
      });
      if (payload.discount.amount_cents || find('discount_value')) {
        if (!set('discount_type',payload.discount.type)) missing.push('discount_type');
        if (!set('discount_value',payload.discount.value)) missing.push('discount_value');
      }
      return missing;
    }
    function verify(payload, invoice=false) {
      const errors=[];
      if (money(read('total'))!==payload.total_cents) errors.push('KRA total must match KES '+(payload.total_cents/100).toFixed(2));
      if (read('reference')!==payload.receipt_no) errors.push('POS receipt reference is missing or different');
      const seller=read('seller_pin');
      if (payload.seller_pin && seller.toUpperCase()!==payload.seller_pin) errors.push('Confirm that the KRA seller PIN matches your shop');
      if (!invoice) {
        const elements=rows();
        if (elements.length!==payload.items.length) errors.push('Item count differs from the POS sale');
        payload.items.forEach((item,i)=>{
          const row=elements[i]; if (!row) return;
          if (value(find('item_name',row))!==item.name || Number(value(find('item_quantity',row)))!==item.quantity || money(value(find('item_price',row)))!==item.unit_price_cents) errors.push('Item '+(i+1)+' differs from the POS sale');
          if (item.description && value(find('item_description',row))!==item.description) errors.push('Item '+(i+1)+' description is missing or different');
        });
        for (const [key,val] of Object.entries(payload.customer)) {
          if (val && (key==='pin'?read(key).toUpperCase():read(key))!==val) errors.push('Customer '+key+' is missing or different');
        }
        function selectionMatches(key, expected) {
          const el=find(key), allowed=aliases[expected] || [expected];
          return allowed.some(v=>norm(read(key))===norm(v) || (el?.tagName==='SELECT' && norm(el.selectedOptions[0]?.textContent)===norm(v)));
        }
        if (!selectionMatches('payment_method',payload.payment_method)) errors.push('Payment method differs from the POS sale');
        if ((payload.discount.amount_cents || find('discount_value')) && (Number(read('discount_value'))!==payload.discount.value || !selectionMatches('discount_type',payload.discount.type))) errors.push('Discount differs from the POS sale');
        // A displayed zero total is valid for a fully discounted sale.
      }
      return errors;
    }
    function issuanceControl(target) {
      const el=target?.closest('button, input[type=submit], [role=button], a');
      if (!el || el.closest('[data-oraforge-companion]')) return false;
      if (config.generate) { try { if (el.matches(config.generate)) return true; } catch (_) {} }
      return /\b(generate|issue|submit|finali[sz]e|create invoice|save invoice|confirm invoice)\b/i.test(clean(el.textContent || el.value));
    }
    async function captureQr(el=find('qr')) {
      if (!el) return '';
      if (el.tagName==='CANVAS') { try {return el.toDataURL('image/png');} catch (_) {return '';} }
      if (el.tagName?.toLowerCase()==='svg') {
        // Rasterize KRA's existing vector, preserving its official modules.
        // This does not construct a QR from a CU number or other POS data.
        try {
          const blob=new Blob([new XMLSerializer().serializeToString(el)],{type:'image/svg+xml'});
          const url=URL.createObjectURL(blob), img=new Image();
          try {
            await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});
            const canvas=doc.createElement('canvas');canvas.width=canvas.height=512;
            canvas.getContext('2d').drawImage(img,0,0,512,512);return canvas.toDataURL('image/png');
          } finally {URL.revokeObjectURL(url);}
        } catch (_) {return '';}
      }
      if (el.tagName!=='IMG') return '';
      const src=el.currentSrc || el.src;
      if (/^data:image\/(png|jpeg|webp);base64,/.test(src)) return src;
      try {
        await el.decode();
        if (el.naturalWidth && el.naturalHeight && el.naturalWidth<=2048 && el.naturalHeight<=2048) {
          const canvas=doc.createElement('canvas');canvas.width=el.naturalWidth;canvas.height=el.naturalHeight;
          canvas.getContext('2d').drawImage(el,0,0);const png=canvas.toDataURL('image/png');
          if (png.length<500000) return png;
        }
      } catch (_) {}
      // Snapshot the official image bytes so receipt reprints do not need a KRA session.
      try {
        const url=new URL(src,doc.location.href);
        if (url.origin!==doc.location.origin && url.protocol!=='blob:') return '';
        const response=await fetch(url.href,{credentials:'same-origin'});
        if (!response.ok) return '';
        const blob=await response.blob();
        if (!['image/png','image/jpeg','image/webp'].includes(blob.type) || blob.size>350000) return '';
        return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
      } catch (_) { return ''; }
    }
    async function capture(payload) {
      // A complete official invoice must echo both the POS reference and total.
      // Read them from the issued invoice, never from the stale creation form.
      const cu=find('cu_invoice_number');
      const context=config.invoice_root ? query(config.invoice_root)[0] : cu?.closest('[data-official-invoice], .invoice-preview, .fiscal-receipt, .receipt, article, section, dl, table');
      if (!context || context.matches('form') || money(read('total',context))!==payload.total_cents || read('reference',context)!==payload.receipt_no) return null;
      if (payload.seller_pin && read('seller_pin',context).toUpperCase()!==payload.seller_pin) return null;
      const fields={};
      for (const k of ['cu_invoice_number','scu_id','receipt_signature','invoice_number','invoice_date']) fields[k]=read(k,context);
      if (Object.values(fields).some(v=>!v)) return null;
      // Scope QR selection to the same official invoice container.
      const qrElement=find('qr',context);
      if (!qrElement) return null;
      fields.qr_image=await captureQr(qrElement);
      return fields.qr_image ? fields : null;
    }
    return {find,read,set,rows,addItem,fill,verify,issuanceControl,capture};
  }
  return {adapter, money, labels};
});
