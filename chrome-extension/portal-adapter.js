/* KRA DOM adapter. The eCitizen mappings come from the supplied live HTML and
 * public InvoiceCreate-526bbef2.js. No page internals, tokens or invoice APIs. */
(function(root, factory) {
  const api = factory();
  if (typeof module==='object' && module.exports) module.exports=api;
  else root.OraforgeKraAdapter=api;
})(globalThis, function() {
  'use strict';
  const labels = {
    pin:/^((customer|buyer)? ?(kra )?pin( number)?|pin of customer|enter pin)$/i,
    phone:/^(customer|buyer)? ?(phone|mobile)( number)?$/i,
    email:/^(customer|buyer)? ?e?mail( address)?$/i,
    billing_address:/^(customer )?(billing )?address( information)?$/i,
    note:/^(add )?note$/i,
    reference:/^(pos |receipt |customer |external |invoice )?(reference|reference number|receipt number|receipt no)$/i,
    payment_method:/^payment (method|mode|type|option)$/i,
    discount_type:/^discount type$/i, discount_value:/^(discount|discount value|discount amount|discount percentage)$/i,
    item_name:/^((item|product)( name)?|name of item)$/i,
    item_description:/^(item |product )?description$/i,
    item_quantity:/^(quantity|qty)$/i, item_price:/^(unit |selling |unit selling |sale )?price( KES)?$/i,
    total:/^(grand total|total( amount| payable)?|invoice total)$/i,
    cu_invoice_number:/^(e ?tims )?cu (invoice )?(number|no)$/i,
    scu_id:/^(scu id|scu number|control unit id)$/i,
    receipt_signature:/^(receipt )?signature$/i,
    invoice_number:/^invoice (number|no)$/i, invoice_date:/^(invoice date|date issued|date\/time|date time)$/i,
    seller_pin:/^(seller|supplier|business) (kra )?pin$/i
  };
  const selectors = {
    pin:'[name="customer_pin"], [name="buyer_pin"], #customer_pin, #buyer_pin, input[placeholder="Enter PIN"]',
    phone:'input[type="tel"], [name="customer_phone"], [name="phone"]',
    email:'input[type="email"], [name="customer_email"], [name="email"]',
    billing_address:'textarea[placeholder="Enter full billing address"], [name="billing_address"]',
    note:'textarea[name="note "]',
    reference:'[name="reference"], [name="receipt_no"], [name="external_reference"]',
    payment_method:'[name="payment_method"], [name="payment_mode"]',
    discount_type:'[name="discount_type"]', discount_value:'[name="discount"], [name="discount_value"], [name="discount_amount"]',
    rows:'[data-invoice-item], [data-etims-item], .invoice-item-row, .invoice-item, tr:has(input[name*="quantity"]), tr:has(input[name*="qty"])',
    add_item:'[data-action="add-item"], #add-item, #addItem',
    item_name:'#item_name, [name$="[name]"], [name$="[item_name]"], [name="item_name"]',
    item_description:'#desc, [name$="[description]"], [name="description"]',
    item_quantity:'[id="quantity-i"], [name$="[quantity]"], [name$="[qty]"], [name="quantity"], [name="qty"]',
    item_price:'input[id="u_c"], [name$="[unit_price]"], [name$="[price]"], [name="unit_price"]',
    total:'[name="total"], [data-total], #grand-total',
    qr:'img[alt*="QR" i], img[id*="qr" i], [data-etims-field="qr"] img, canvas[data-qr], svg[data-qr], [id*="qr" i] svg'
  };
  const clean = s => String(s || '').replace(/[_:.*]/g,' ').replace(/\s+/g,' ').trim();
  const norm = str => String(str || '').toLowerCase().replace(/%/g,'percent').replace(/[^a-z0-9]/g,'');
  const aliases = {mpesa:['mpesa','mobilemoney'],cash:['cash'],card:['card','creditcard','debitcard'],percent:['percent','percentage','Percentage %','%'],fixed:['fixed','amount','fixedamount','fixed_amount','Fixed Amount']};
  function money(value) {
    const text=String(value ?? '').replace(/KES|KSHS?\.?/ig,'').replace(/,/g,'').trim();
    if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
    const amount=Math.round(Number(text)*100);
    return Number.isSafeInteger(amount)?amount:null;
  }
  // KRA's current screen exposes discounts per line. Allocate the existing POS
  // discount in integer cents, keeping percentages when their rounding reconciles.
  function lineDiscounts(payload) {
    const discount=payload.discount;
    const rounded=payload.items.map(i=>Math.round(i.line_total_cents*discount.value/100));
    if (discount.type==='percent' && rounded.reduce((s,n)=>s+n,0)===discount.amount_cents)
      return rounded.map(amount=>({type:'percent',value:discount.value,amount_cents:amount}));
    const parts=payload.items.map((i,index)=>{
      const numerator=BigInt(i.line_total_cents)*BigInt(discount.amount_cents);
      const denominator=BigInt(payload.subtotal_cents || 1);
      return {index,amount:Number(numerator/denominator),remainder:numerator%denominator};
    });
    let left=discount.amount_cents-parts.reduce((s,p)=>s+p.amount,0);
    const sorted=[...parts].sort((a,b)=>a.remainder===b.remainder?a.index-b.index:a.remainder>b.remainder?-1:1);
    for (const p of sorted) { if (left--<=0) break; p.amount++; }
    return parts.map(p=>({type:'fixed',value:p.amount/100,amount_cents:p.amount}));
  }
  function adapter(doc, config={}) {
    const win=doc.defaultView, controls='input:not([type="hidden"]):not([type="file"]), textarea, select';
    let fillActive=false, uncertainItem=null;
    const visible = el => {
      if (!el || !el.isConnected || el.closest('[data-oraforge-companion], [hidden], [aria-hidden="true"]')) return false;
      for (let p=el; p && p.nodeType===1; p=p.parentElement) {
        const style=win.getComputedStyle(p);
        if (style.display==='none' || style.visibility==='hidden') return false;
      }
      return true;
    };
    function query(sel, context=doc, includeHidden=false) {
      try { return [...context.querySelectorAll(sel)].filter(el=>includeHidden || visible(el)); }
      catch (_) { throw Error('Invalid portal selector: '+sel); }
    }
    const value = el => el ? String(/^(INPUT|TEXTAREA|SELECT|OPTION)$/.test(el.tagName) ? el.value : el.textContent).trim() : '';
    const textMatches = (key,text) => labels[key]?.test(clean(text));
    function labelledControl(label,key,context) {
      const target=label.htmlFor && doc.getElementById(label.htmlFor);
      if (target && context.contains(target) && visible(target)) return target;
      for (let p=label; p && p!==context.parentElement; p=p.parentElement) {
        if (p!==label && query('label',p).some(other=>other!==label && !textMatches(key,other.textContent))) break;
        let fields=query(controls,p).filter(el=>!['radio','checkbox','search'].includes(el.type));
        if (key==='phone') fields=fields.filter(el=>el.type==='tel');
        if (key==='item_price' || key==='discount_value') fields=fields.filter(el=>el.tagName!=='SELECT');
        if (key==='discount_type') fields=fields.filter(el=>el.tagName==='SELECT');
        if (fields.length===1) return fields[0];
        if (p===context) break;
      }
      return null;
    }
    function find(key,context=doc) {
      if (config[key]) return query(config[key],context)[0];
      const direct=query('[data-etims-field="'+key+'"]',context)[0] || (selectors[key] && query(selectors[key],context)[0]);
      if (direct || !labels[key]) return direct;
      for (const field of query(controls,context)) {
        const names=[...(field.labels || [])].map(l=>l.textContent).concat(field.getAttribute('aria-label'),field.getAttribute('placeholder'),field.name,field.id);
        if (names.some(name=>textMatches(key,name))) return field;
      }
      for (const label of query('dt, th, label, [data-label], td, p, span, strong',context)) {
        const content=value(label), colon=content.indexOf(':');
        if (colon>0 && textMatches(key,content.slice(0,colon)) && content.slice(colon+1).trim() && content.length<350) return label;
        if (!textMatches(key,content)) continue;
        if (label.tagName==='LABEL') {
          const field=labelledControl(label,key,context);
          if (field) return field;
        }
        const next=label.nextElementSibling;
        if (next && visible(next)) {
          const fields=query(controls,next);
          if (fields.length===1) return fields[0];
          if (!fields.length && !query('button',next).length) return next;
        }
      }
      // The popup labels its discount select simply "Discount".
      if (key==='discount_type') {
        const input=find('discount_value',context);
        for (let p=input?.parentElement; p && p!==context.parentElement; p=p.parentElement) {
          const options=query('select',p).filter(s=>[...s.options].some(o=>o.value==='percentage') && [...s.options].some(o=>o.value==='fixed_amount'));
          if (options.length===1) return options[0];
          if (p===context) break;
        }
      }
      return null;
    }
    function read(key,context=doc) {
      const el=find(key,context), raw=value(el), colon=raw.indexOf(':');
      return el && !('value' in el) && colon>0 && textMatches(key,raw.slice(0,colon)) ? raw.slice(colon+1).trim() : raw;
    }
    function setElement(el,input) {
      if (!el || !visible(el) || el.disabled || el.readOnly || !('value' in el)) return false;
      let val=String(input);
      if (el.tagName==='SELECT') {
        const allowed=aliases[val] || [val];
        const option=[...el.options].find(o=>!o.disabled && allowed.some(a=>norm(o.value)===norm(a) || norm(o.textContent)===norm(a)));
        if (!option) return false;
        val=option.value;
      }
      const proto=el.tagName==='SELECT'?win.HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?win.HTMLTextAreaElement.prototype:win.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(el,val);
      el.dispatchEvent(new win.Event('input',{bubbles:true}));
      el.dispatchEvent(new win.Event('change',{bubbles:true}));
      el.dispatchEvent(new win.Event('blur',{bubbles:true}));
      return value(el)===val || (el.type==='tel' && phoneMatches(value(el),val));
    }
    const set=(key,input,context=doc)=>setElement(find(key,context),input);
    const buttons=(context=doc)=>query('button, [role="button"]',context);
    function itemDialog() {
      if (config.item_modal) return query(config.item_modal)[0];
      return query('[role="dialog"], [aria-modal="true"]').find(el=>query('h1,h2,h3',el).some(h=>/^add item details$/i.test(clean(h.textContent))));
    }
    function invoiceTable() {
      return query('table').find(table=>{
        const heads=query('thead th',table).map(h=>clean(h.textContent));
        return heads.some(h=>labels.item_quantity.test(h)) && heads.some(h=>labels.item_price.test(h)) && !table.closest('[role="dialog"]');
      });
    }
    function rows() {
      if (config.rows) return query(config.rows);
      const direct=query(selectors.rows).filter(row=>!row.closest('[role="dialog"], [aria-modal="true"]'));
      if (direct.length) return direct;
      const table=invoiceTable();
      return table?query('tbody tr',table).filter(row=>row.children.length>=5 && !row.querySelector('[colspan]')):[];
    }
    function lineRead(key,row) {
      if (!row) return '';
      if (row.tagName!=='TR' || query(controls,row).length) return read(key,row);
      const heads=query('thead th',row.closest('table'));
      const pattern=key==='item_name'?/^(name|item|item name|name of item)$/i:key==='discount_value'?/^discount( KES)?$/i:key==='total'?/^(amount|total)( KES)?$/i:labels[key];
      const index=heads.findIndex(h=>pattern?.test(clean(h.textContent)));
      return index<0?'':value(row.children[index]);
    }
    function addItemControl() {
      return (config.add_item?query(config.add_item)[0]:query(selectors.add_item)[0]) ||
        buttons().find(b=>/^add (an? )?(item|product|line)$/i.test(clean(b.textContent)) && !b.closest('[role="dialog"]'));
    }
    function addItem() {
      const button=addItemControl();
      if (!button || button.disabled || (button.type==='submit' && button.form)) return false;
      button.click(); return true;
    }
    function customerSection() {
      const email=find('email');
      for (let p=email?.parentElement; p; p=p.parentElement) {
        if (query('input[type="tel"]',p).length && query('p',p).some(el=>/^customer$/i.test(clean(el.textContent)))) return p;
      }
      return null;
    }
    function sectionByHeading(pattern) {
      const heading=query('p,h2,h3,label').find(el=>pattern.test(clean(el.textContent)));
      for (let p=heading?.parentElement; p && p!==doc.body; p=p.parentElement) {
        if (query('button',p).length) return p;
      }
      return null;
    }
    function dropdown(searchPattern) {
      // KRA uses plain buttons and v-show menus, without combobox ARIA roles.
      const input=query('input[type="search"]',doc,true).find(el=>searchPattern.test(el.placeholder));
      for (let p=input?.parentElement; p && p!==doc.body; p=p.parentElement) {
        const trigger=[...p.children].find(el=>el.tagName==='BUTTON');
        if (trigger) return {container:p,trigger,input};
      }
      return null;
    }
    function customerIdentity(expected) {
      const scope=customerSection();
      if (!scope) return false;
      const paragraphs=query('p',scope).filter(p=>!p.closest('button') && !p.closest('[style*="display: none"]'));
      return paragraphs.some(p=>norm(value(p))===norm(expected));
    }
    function paymentState() {
      const section=sectionByHeading(/^payment option$/i);
      if (!section) return '';
      const selected=query('p > span',section).find(el=>!el.closest('button'));
      return value(selected);
    }
    const channelMatches=(actual,expected)=>{
      const channel=String(actual || '').split(/\s+[-:]\s+|:/)[0];
      return (aliases[expected] || [expected]).some(a=>norm(channel)===norm(a));
    };
    function totalValue() {
      const table=invoiceTable();
      if (table) {
        const label=query('td',table).find(td=>/^total$/i.test(clean(td.textContent)));
        return money(value(label?.nextElementSibling));
      }
      const el=find('total');
      return el?.closest('[role="dialog"]')?null:money(read('total'));
    }
    function detect() {
      const hasItems=!!(addItemControl() || rows().length || itemDialog());
      const customer=!!(find('pin') || customerSection() || dropdown(/Search by name or PIN or Phone number/i));
      const heading=query('h1,h2').map(h=>clean(h.textContent)).join(' ');
      const other=/proforma|quotation|credit note|purchase invoice/i.test(heading);
      const ready=hasItems && customer && !!find('email') && !other;
      return {ready,kind:customerSection()?'kra-vue':'labelled-form',url:doc.location.origin+doc.location.pathname,
        missing:[!hasItems && 'Add Item control / invoice item table',!customer && 'customer control',!find('email') && 'customer email control',other && 'open a sales invoice, not this document type'].filter(Boolean)};
    }
    function issuanceControl(target) {
      const el=target?.closest('button, input[type=submit], [role=button], a');
      if (!el || el.closest('[data-oraforge-companion]')) return false;
      // Add inside the verified item dialog only inserts a local invoice line.
      if (el.closest('[role="dialog"]')===itemDialog() && /^(add|update|cancel|add new|add from inventory)$/i.test(clean(value(el)))) return false;
      if (config.generate) { try { if (el.matches(config.generate)) return true; } catch (_) {} }
      return /\b(generate|issue|submit|finali[sz]e|create invoice|save invoice|confirm invoice|save draft)\b/i.test(clean(el.textContent || el.value));
    }
    function fill(payload) {
      // Synchronous compatibility for the older inline-row form.
      const missing=[];
      for (const [key,val] of Object.entries({...payload.customer,reference:payload.receipt_no,payment_method:payload.payment_method}))
        if (val && !set(key,val)) missing.push(key);
      const elements=rows();
      if (elements.length!==payload.items.length) missing.push('item rows');
      payload.items.forEach((item,i)=>{
        if (!elements[i]) return;
        const fields={item_name:item.name,item_description:item.description,item_quantity:item.quantity,item_price:(item.unit_price_cents/100).toFixed(2)};
        for (const [key,val] of Object.entries(fields)) if (val!=='' && !set(key,val,elements[i])) missing.push(key+' '+(i+1));
      });
      if (payload.discount.amount_cents || find('discount_value')) {
        if (!set('discount_type',payload.discount.type)) missing.push('discount_type');
        if (!set('discount_value',payload.discount.value)) missing.push('discount_value');
      }
      return missing;
    }
    function matchesLine(item,row,discount) {
      return lineRead('item_name',row)===item.name &&
        Number(lineRead('item_quantity',row))===item.quantity && money(lineRead('item_price',row))===item.unit_price_cents &&
        (!item.description || lineRead('item_description',row)===item.description) &&
        (!discount || money(lineRead('discount_value',row))===discount.amount_cents);
    }
    function referenceMatches(payload) {
      if (read('reference')===payload.receipt_no) return true;
      return read('note').split('\n').includes('POS Receipt: '+payload.receipt_no);
    }
    function verify(payload,invoice=false) {
      const errors=[];
      if (totalValue()!==payload.total_cents) errors.push('KRA total must match KES '+(payload.total_cents/100).toFixed(2));
      if (!referenceMatches(payload)) errors.push('POS receipt reference is missing or different');
      const seller=read('seller_pin');
      if (payload.seller_pin && seller.toUpperCase()!==payload.seller_pin) errors.push('Confirm that the KRA seller PIN matches your shop');
      if (!invoice) {
        const elements=rows(), isTable=!!invoiceTable(), discounts=isTable?lineDiscounts(payload):null;
        if (elements.length!==payload.items.length) errors.push('Item count differs from the POS sale');
        payload.items.forEach((item,i)=>{if (!matchesLine(item,elements[i],discounts?.[i])) errors.push('Item '+(i+1)+' differs from the POS sale');});
        for (const [key,val] of Object.entries(payload.customer)) {
          if (!val) continue;
          const actual=read(key);
          const matches=key==='pin'?(actual.toUpperCase()===val || customerIdentity(val)):key==='phone'?phoneMatches(actual,val):actual===val;
          if (!matches) errors.push('Customer '+key+' is missing or different');
        }
        const method=find('payment_method');
        if (!(method?.tagName==='SELECT'?channelMatches(method.selectedOptions[0]?.textContent,payload.payment_method):channelMatches(paymentState() || read('payment_method'),payload.payment_method))) errors.push('Payment method differs from the POS sale');
        if (!isTable && (payload.discount.amount_cents || find('discount_value'))) {
          const type=find('discount_type'), allowed=aliases[payload.discount.type] || [];
          if (Number(read('discount_value'))!==payload.discount.value || !allowed.some(a=>norm(value(type))===norm(a) || norm(type?.selectedOptions?.[0]?.textContent)===norm(a))) errors.push('Discount differs from the POS sale');
        }
      }
      return errors;
    }
    function phoneMatches(a,b) {
      const canonical=p=>String(p || '').replace(/\D/g,'').replace(/^254/,'0');
      return canonical(a)===canonical(b);
    }
    async function fillSale(payload,{onProgress=()=>{},active=()=>true,timeout=6000}={}) {
      if (fillActive) throw Error('Filling this sale is already in progress.');
      fillActive=true;
      const report=[];
      const emit=(field,ok,detail='')=>{
        const existing=report.find(r=>r.field===field), row={field,status:ok?'filled':'failed',detail};
        if (existing) Object.assign(existing,row); else report.push(row);
        onProgress([...report]); return ok;
      };
      const wait=async predicate=>{
        const deadline=Date.now()+timeout;
        do { if (!active()) throw Error('Filling stopped because this sale is no longer active.'); const result=predicate(); if (result) return result; await new Promise(resolve=>win.setTimeout(resolve,80)); } while (Date.now()<deadline);
        return null;
      };
      const tick=()=>new Promise(resolve=>win.setTimeout(resolve,0));
      const checkActive=()=>{if(!active())throw Error('Filling stopped because this sale is no longer active.');};
      const write=async(key,val,context=doc)=>{
        checkActive();
        const ok=set(key,val,context); await tick();checkActive();const actual=read(key,context);
        const matches=key==='phone'?phoneMatches(actual,val):key==='item_price'?money(actual)===money(val):['item_quantity','discount_value'].includes(key)?Number(actual)===Number(val):actual===String(val);
        return ok && matches;
      };
      try {
        checkActive();
        const detection=detect();
        if (!detection.ready) {emit('Invoice form',false,'Not detected at '+detection.url+'. Missing: '+detection.missing.join(', '));return report;}
        emit('Invoice form',true,detection.url);
        if (query('[role="dialog"], [aria-modal="true"]').length) {
          emit('Open KRA dialog',false,'Complete or cancel the existing dialog before filling. The extension will not change fields behind it.');return report;
        }
        if (!invoiceTable() && query('table').some(t=>query('thead th',t).some(h=>/^(quantity|qty|sale price KES)$/i.test(clean(value(h)))))) {
          emit('Products',false,'An existing item table is present but its columns could not be verified. Inspect its headers before adding anything.');return report;
        }
        const reference=read('reference'), markers=read('note').split('\n').filter(line=>line.startsWith('POS Receipt: '));
        if ((reference && reference!==payload.receipt_no) || markers.some(line=>line!=='POS Receipt: '+payload.receipt_no)) {
          emit('POS receipt reference',false,'This KRA form belongs to another POS receipt. Reopen the selected sale from Oraforge; no fields were changed.');return report;
        }
        if (invoiceTable()) {
          const existing=rows(), discounts=lineDiscounts(payload);
          if (existing.length>payload.items.length || existing.some((row,i)=>!matchesLine(payload.items[i],row,discounts[i]))) {
            emit('Products',false,'Existing KRA items differ from this POS sale. Reopen the selected sale from Oraforge; no fields were changed.');return report;
          }
        }
        const identity=payload.customer.pin || payload.customer.phone;
        if (payload.customer.pin && find('pin') && !find('pin').closest('[role="dialog"]')) {
          emit('Customer PIN',await write('pin',payload.customer.pin),'KRA must resolve the name.');
        } else if (identity) {
          let ambiguousCustomer=false;
          if (!customerIdentity(identity)) {
            const menu=dropdown(/Search by name or PIN or Phone number/i);
            if (menu) {
              menu.trigger.click();
              if (await wait(()=>visible(menu.input))) {
                setElement(menu.input,identity);
                menu.input.dispatchEvent(new win.KeyboardEvent('keypress',{key:'Enter',code:'Enter',bubbles:true}));
                const options=await wait(()=>{
                  const matches=buttons(menu.container).filter(b=>b!==menu.trigger && query('p',b).some(p=>payload.customer.pin?value(p).toUpperCase()===identity.toUpperCase():phoneMatches(value(p),identity)));
                  return matches.length?matches:null;
                });
                ambiguousCustomer=!!options && options.length>1;
                if (options?.length===1) {options[0].click();await wait(()=>customerIdentity(identity));}
                else if (visible(menu.input)) menu.trigger.click();
              }
            }
          }
          if (!customerIdentity(identity) && payload.customer.pin && !ambiguousCustomer) {
            const addNew=buttons(customerSection() || doc).find(b=>/^add new$/i.test(clean(value(b))));
            if (addNew) {
              addNew.click();
              const modal=await wait(()=>query('[role="dialog"]').find(el=>query('h3',el).some(h=>/^new customer$/i.test(clean(value(h))))));
              if (modal) {
                // KRA's own customer dialog validates the PIN and resolves the
                // name. Never enter a customer name or call a private KRA API.
                if (payload.customer.pin.startsWith('P')) {
                  const business=query('label',modal).find(l=>/^non individual$/i.test(clean(value(l))));
                  const radio=business?.htmlFor && doc.getElementById(business.htmlFor);
                  (radio || business)?.click();await tick();
                }
                const pinOk=await write('pin',payload.customer.pin,modal);
                emit('Customer PIN validation',pinOk,'PIN entered in KRA Add New customer dialog.');
                const validate=buttons(modal).find(b=>/^validate$/i.test(clean(value(b))));
                if (pinOk && validate && !validate.disabled) {
                  validate.click();
                  const validated=await wait(()=>query('p',modal).some(p=>value(p).toUpperCase()===payload.customer.pin) && !!find('email',modal));
                  emit('Customer PIN validation',!!validated,validated?'KRA resolved the customer name.':'KRA did not confirm this PIN. Review its validation message.');
                  if (validated) {
                    let contactOk=true;
                    for (const key of ['phone','email']) {
                      const ok=!!payload.customer[key] && await write(key,payload.customer[key],modal);
                      emit('New customer '+key,ok,ok?'Copied from POS.':'KRA requires this value; it is missing from POS or could not be filled.');
                      contactOk=ok && contactOk;
                    }
                    const add=buttons(modal).find(b=>/^add$/i.test(clean(value(b))));
                    if (contactOk && add && !add.disabled) {add.click();await wait(()=>customerIdentity(identity));}
                  }
                }
              }
            }
          }
          emit(payload.customer.pin?'Customer PIN':'Customer selection',customerIdentity(identity),customerIdentity(identity)?'KRA customer selected by '+(payload.customer.pin?'PIN':'phone')+'. Name supplied by KRA.':ambiguousCustomer?'Multiple KRA customers match this PIN/phone. Choose the correct customer yourself.':'Customer was not selected. Review the KRA customer dropdown/dialog; no name was invented.');
          if (query('[role="dialog"]').some(el=>el!==itemDialog())) {
            emit('Products',false,'Complete or cancel the open KRA customer dialog, then click Fill POS sale again.');return report;
          }
        } else emit('Customer selection',false,'POS has no PIN or phone to match a saved KRA customer. Select the customer yourself.');
        // Selection updates these inputs in Vue; fill contact fields afterwards.
        for (const [key,title] of [['phone','Customer phone'],['email','Customer email'],['billing_address','Billing address']]) {
          if (payload.customer[key]) emit(title,await write(key,payload.customer[key]),'Copied from POS.');
          else report.push({field:title,status:'skipped',detail:'Not provided in POS.'});
        }
        if (find('reference')) emit('POS receipt reference',await write('reference',payload.receipt_no));
        else if (find('note')) {
          const existing=read('note'), marker='POS Receipt: '+payload.receipt_no;
          const next=existing.split('\n').includes(marker)?existing:[existing,marker].filter(Boolean).join('\n');
          emit('POS receipt reference',await write('note',next),'Added to KRA Add note; this screen has no separate reference input.');
        } else emit('POS receipt reference',false,'No reference or Add note input is available.');
        const method=find('payment_method');
        if (method?.tagName==='SELECT') emit('Payment option',set('payment_method',payload.payment_method));
        else if (channelMatches(paymentState(),payload.payment_method)) emit('Payment option',true,'Existing '+paymentState()+' option matches POS; account unchanged.');
        else {
          const section=sectionByHeading(/^payment option$/i), trigger=section && buttons(section).find(b=>/^select\s*\.{0,3}$/i.test(value(b)));
          if (trigger) {
            trigger.click();
            await wait(()=>buttons(section).some(b=>b!==trigger));
            const options=buttons(section).filter(b=>b!==trigger && channelMatches(value(b),payload.payment_method));
            if (options.length===1) {options[0].click();await wait(()=>channelMatches(paymentState(),payload.payment_method));}
            else trigger.click();
            emit('Payment option',channelMatches(paymentState(),payload.payment_method),options.length>1?'Multiple matching KRA payment accounts; choose the account yourself.':options.length===0?'POS payment method is not configured among KRA payment options.':'Selected matching KRA payment option.');
          } else emit('Payment option',false,'Payment dropdown was not found.');
        }
        if (uncertainItem && !itemDialog() && matchesLine(uncertainItem.item,rows()[uncertainItem.index],uncertainItem.discount)) uncertainItem=null;
        if (uncertainItem) {emit('Products',false,'A previous Add was not confirmed in the table. Inspect the items before retrying; automatic adding is blocked.');return report;}
        // Inline forms remain supported. The real eCitizen screen has a read-only
        // table and a separate role=dialog, so it takes the sequential popup path.
        if (rows().some(row=>query(controls,row).length)) {
          while (rows().length<payload.items.length) {
            const count=rows().length;
            if (!addItem() || !await wait(()=>rows().length>count || itemDialog())) break;
            if (itemDialog()) break;
          }
          if (!itemDialog()) {
            const missing=fill(payload);
            for (const [i,item] of payload.items.entries()) emit('Item '+(i+1),matchesLine(item,rows()[i]),item.name);
            emit('Discount',!missing.some(k=>k.startsWith('discount')),payload.discount.type+' '+payload.discount.value);
          }
        } else {
          const discounts=lineDiscounts(payload), existing=rows();
          if (existing.length>payload.items.length || existing.some((row,i)=>!matchesLine(payload.items[i],row,discounts[i]))) {
            emit('Products',false,'Existing KRA items differ from this POS sale. Clear or reconcile them yourself; nothing was removed.');return report;
          }
          for (let i=existing.length; i<payload.items.length; i++) {
            if (!active()) throw Error('Filling stopped because this sale is no longer active.');
            const item=payload.items[i], prefix='Item '+(i+1)+' · ', discount=discounts[i];
            if (itemDialog()) {emit(prefix+'popup',false,'An item popup is already open. Review/cancel it before filling.');break;}
            if (!addItem()) {emit(prefix+'popup',false,'Add Item control is missing or disabled.');break;}
            const modal=await wait(itemDialog);
            if (!modal) {emit(prefix+'popup',false,'Add item details popup did not appear.');break;}
            // Do not search inventory and replace the POS sale with catalogue data.
            // Add New switches only the local popup into manual entry mode.
            const addNew=buttons(modal).find(b=>/^add new$/i.test(clean(value(b))));
            if (addNew) {addNew.click();await tick();}
            const fields={item_name:item.name,item_description:item.description || item.name,item_quantity:item.quantity,item_price:(item.unit_price_cents/100).toFixed(2)};
            let good=true;
            for (const [key,val] of Object.entries(fields)) {
              const ok=await write(key,val,modal);
              emit(prefix+key.replace('item_',''),ok,key==='item_description' && !item.description?'POS description empty; POS item name used as description.':'Copied from POS.');
              good=ok && good;
            }
            const typeOk=set('discount_type',discount.type,modal); await tick();
            const discountOk=await write('discount_value',discount.value,modal);
            emit(prefix+'discount',typeOk && discountOk,discount.type+' '+discount.value+'; KES '+(discount.amount_cents/100).toFixed(2));
            const expected=item.line_total_cents-discount.amount_cents;
            const totalOk=await wait(()=>money(read('total',modal))===expected);
            emit(prefix+'total',!!totalOk,'Expected KES '+(expected/100).toFixed(2)+'; KRA calculates this value.');
            if (!good || !typeOk || !discountOk || !totalOk) break;
            const add=config.item_submit?query(config.item_submit,modal)[0]:buttons(modal).find(b=>/^add$/i.test(clean(value(b))));
            if (!add || add.disabled || issuanceControl(add)) {emit(prefix+'added',false,'The popup Add button is missing or disabled. Review KRA validation messages.');break;}
            checkActive();
            uncertainItem={index:i,item,discount}; add.click();
            const confirmed=await wait(()=>!itemDialog() && rows().length===i+1 && matchesLine(item,rows()[i],discount));
            emit(prefix+'added',!!confirmed,confirmed?'Confirmed in the KRA invoice table.':'Add could not be confirmed. Stopped to prevent duplicate lines.');
            if (!confirmed) break;
            uncertainItem=null;
          }
          existing.forEach((row,i)=>emit('Item '+(i+1)+' · added',true,'Already matches POS; not added again.'));
          emit('Discount',rows().length===payload.items.length && rows().every((row,i)=>matchesLine(payload.items[i],row,discounts[i])),
            payload.discount.type==='percent' && discounts.some(d=>d.type==='fixed')?'POS percentage allocated as fixed cents per line to preserve exact total.':'POS discount allocated across the item popups.');
        }
        const totalOk=await wait(()=>totalValue()===payload.total_cents);
        emit('Invoice total',!!totalOk,'POS KES '+(payload.total_cents/100).toFixed(2)+'; KRA '+(totalValue()===null?'not found':'KES '+(totalValue()/100).toFixed(2))+'. Total is checked, never overwritten.');
        return report;
      } finally { fillActive=false; onProgress([...report]); }
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
    return {find,read,set,rows,addItem,fill,fillSale,detect,itemDialog,verify,issuanceControl,capture};
  }
  return {adapter, money, labels, lineDiscounts};
});
