/* Read-only KRA issued-invoice parser. Based on supplied live invoice-print DOM.
 * Never calls issuance APIs, clicks KRA controls or modifies invoice data. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.OraforgeKraInvoicePrint=api;
})(globalThis,function(){
  'use strict';
  const clean=x=>String(x||'').replace(/\s+/g,' ').trim();
  const norm=x=>clean(x).toLowerCase();
  const cents=x=>{const v=clean(x).replace(/(?:KES|KSHS?)\s*/gi,'').replace(/,/g,'');return /^\d+(?:\.\d{1,2})?$/.test(v)?Math.round(Number(v)*100):null;};
  const pathMatches=x=>/\/etims\/sale\/[^/]+\/invoice-print\/?$/.test(x||'');
  const ps=root=>[...root.querySelectorAll('p')];
  const exact=(root,label)=>ps(root).find(p=>norm(p.textContent)===norm(label));
  function label(root,label){
    const re=new RegExp('^'+label+'\\s*:\\s*(.*)$','i');
    const p=ps(root).find(p=>re.test(clean(p.textContent)));
    if(!p)return '';
    return clean(clean(p.textContent).match(re)[1])||clean(p.nextElementSibling?.textContent);
  }
  function invoiceRoot(doc){
    if(!pathMatches(doc.location.pathname))return null;
    // The printable KRA component is a large table containing the QR canvas
    // and nested tables for issued IDs, items and totals.
    return [...doc.querySelectorAll('table')].find(t=>{
      const v=clean(t.textContent);
      return !!t.querySelector('canvas') && v.includes('CU Invoice Number:') &&
        v.includes('Receipt Signature:') && v.includes('Invoice total') && v.includes('Date Created:');
    })||null;
  }
  function amountRow(root,labelText){
    const p=exact(root,labelText),tr=p?.closest('tr');
    if(!tr)return null;
    const cols=[...tr.children].filter(c=>c.tagName==='TD');
    return cols.length>=2?cents(cols.at(-1).textContent):null;
  }
  function party(root,labelText){
    const td=exact(root,labelText)?.closest('td');if(!td)return null;
    const list=ps(td).map(p=>clean(p.textContent));
    const i=list.findIndex(x=>norm(x)===norm(labelText));
    return {name:list[i+1]||'',pin:(list.find(x=>/^PIN:/i.test(x))||'').replace(/^PIN:\s*/i,'').toUpperCase(),
      phone:list.find(x=>/^\+?\d{9,15}$/.test(x))||''};
  }
  function lines(root){
    const header=['item','qty','price','tax type','tax','discount','total'];
    const cells=row=>[...row.children].filter(c=>['TD','TH'].includes(c.tagName)).map(c=>clean(c.textContent));
    for(const table of root.querySelectorAll('table')){
      const rows=[...table.querySelectorAll('tr')].filter(r=>r.closest('table')===table);
      if(!rows.length||cells(rows[0]).map(norm).join('|')!==header.join('|'))continue;
      const out=[];
      for(const row of rows.slice(1)){
        const a=cells(row);
        if(a.length!==7)continue; // KRA footer: Number of items
        if(!/^\d+(?:\.\d+)?$/.test(a[1]))return null;
        const item={name:a[0],quantity:Number(a[1]),price_cents:cents(a[2]),
          tax_cents:cents(a[4]),discount_cents:cents(a[5]),total_cents:cents(a[6])};
        if(Object.values(item).some(x=>x===null))return null;
        out.push(item);
      }
      return out.length?out:null;
    }
    return null;
  }
  function originalQr(root){
    const c=[...root.querySelectorAll('canvas')].find(c=>c.width>=50 && c.height>=50 && c.width<=1024 && c.height<=1024);
    if(!c)return '';
    try{
      const ctx=c.getContext('2d',{willReadFrequently:true});
      if(!ctx)return '';
      const rgba=ctx.getImageData(0,0,c.width,c.height).data;
      let dark=0,light=0;
      for(let i=0;i<rgba.length;i+=4){
        if(rgba[i+3]<128)continue;
        const v=(rgba[i]+rgba[i+1]+rgba[i+2])/3;
        if(v<100)dark++;else if(v>180)light++;
      }
      // Reject transparent/blank canvases before the QR component has painted.
      if(dark<c.width*c.height*.06||light<c.width*c.height*.06)return '';
      const png=c.toDataURL('image/png');
      return /^data:image\/png;base64,[a-z0-9+/=]+$/i.test(png)&&png.length<500000?png:'';
    }catch(_){return '';}
  }
  function inspect(doc,snapshot){
    if(!pathMatches(doc.location.pathname))return {reason:'Not an issued invoice-print page.'};
    const root=invoiceRoot(doc);
    if(!root)return {reason:'Waiting for KRA to render the issued invoice.'};
    const seller=party(root,'sale from:'),buyer=party(root,'sale to:');
    if(!seller||!buyer)return {reason:'Seller/buyer section missing on official invoice.'};
    if(snapshot.seller_pin&&norm(seller.pin)!==norm(snapshot.seller_pin))
      return {reason:'Seller PIN differs from the selected POS shop.'};
    const digits=x=>String(x).replace(/\D/g,'').replace(/^(254|0)/,'');
    const matchingPhone=Boolean(snapshot.customer?.phone && buyer.phone &&
      digits(snapshot.customer.phone)===digits(buyer.phone));
    // KRA sometimes leaves buyer PIN blank on the printable invoice even
    // after validation. In that case require a matching buyer phone.
    if(snapshot.customer?.pin && (buyer.pin ? norm(buyer.pin)!==norm(snapshot.customer.pin) : !matchingPhone))
      return {reason:'Buyer PIN not confirmed; the printed invoice must match the POS customer PIN or phone.'};
    if(snapshot.customer?.phone && buyer.phone && !matchingPhone)
      return {reason:'Buyer phone differs from the POS customer.'};
    const method=label(root,'Payment Method');
    if(norm(snapshot.payment_method)==='mpesa' && norm(method)!=='mpesa')
      return {reason:'Issued invoice payment method differs from POS M-Pesa.'};
    const note=label(root,'Note');
    const reference=note.match(/POS Receipt:\s*([A-Za-z0-9_-]+)/i);
    if(reference && reference[1]!==snapshot.receipt_no)
      return {reason:'Issued invoice note contains a different POS receipt reference.'};
    if(amountRow(root,'Invoice total')!==snapshot.total_cents)
      return {reason:'Official invoice total differs from the POS receipt.'};
    const items=lines(root);
    if(!items||items.length!==snapshot.items.length)
      return {reason:'Official invoice line count differs from the POS sale.'};
    let gross=0,net=0,discount=0;
    for(let i=0;i<items.length;i++){
      const a=items[i],b=snapshot.items[i];
      if(norm(a.name)!==norm(b.name)||Math.abs(a.quantity-b.quantity)>0.001||
        a.price_cents!==b.unit_price_cents||
        Math.round(a.quantity*a.price_cents)!==b.line_total_cents||
        a.total_cents!==b.line_total_cents-a.discount_cents)
        return {reason:'Official invoice item '+(i+1)+' differs from the POS sale.'};
      gross+=b.line_total_cents;net+=a.total_cents;discount+=a.discount_cents;
    }
    if(gross!==snapshot.subtotal_cents||net!==snapshot.total_cents||discount!==snapshot.discount.amount_cents)
      return {reason:'Official invoice item totals/discounts do not reconcile.'};
    const fiscal={cu_invoice_number:label(root,'CU Invoice Number'),
      scu_id:label(root,'SCU ID'),receipt_signature:label(root,'Receipt Signature'),
      invoice_number:label(root,'Invoice No'),invoice_date:label(root,'Date Created')};
    if(Object.values(fiscal).some(v=>!v)||!/^[a-z0-9_-]+\/\d+$/i.test(fiscal.cu_invoice_number))
      return {reason:'Official invoice identifiers are incomplete.'};
    if(fiscal.cu_invoice_number.split('/')[0]!==fiscal.scu_id)
      return {reason:'CU Invoice Number and SCU ID do not match.'};
    fiscal.qr_image=originalQr(root);
    return fiscal.qr_image?{fiscal,reason:''}:{reason:'Waiting for KRA to draw the official QR canvas.'};
  }
  return {pathMatches,inspect};
});
