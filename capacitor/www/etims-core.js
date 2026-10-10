/* Shared fiscal contract. No fiscal identifiers or QR codes are generated here. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OraforgeEtimsCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  function text(value, max = 240) {
    const result = String(value ?? '').trim();
    if (result.length > max || /[\u0000-\u001f]/.test(result)) throw Error('Invalid invoice field.');
    return result;
  }
  function cents(value) {
    if (!Number.isSafeInteger(value) || value < 0) throw Error('Invoice amounts must be non-negative integer cents.');
    return value;
  }
  function customer(input = {}) {
    const pin = text(input.pin || input.customer_kra_pin, 11).toUpperCase();
    if (pin && !/^[A-Z]\d{9}[A-Z]$/.test(pin)) throw Error('Enter a valid customer KRA PIN or leave it blank.');
    const email = text(input.email || input.customer_email, 120);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Error('Enter a valid customer email.');
    return {pin, phone: text(input.phone || input.customer_phone, 40), email,
      billing_address: text(input.billing_address || input.customer_billing_address, 240)};
  }
  function snapshot(order, shopId, settings = {}, details = {}) {
    if (order.status !== 'paid' || order.is_quote || order.order_type === 'quote') throw Error('Only completed sales can be invoiced.');
    if (!Number.isSafeInteger(Number(order.id)) || Number(order.id) <= 0 || !order.ticket_no) throw Error('Missing POS receipt identity.');
    const items = (order.items || []).map(item => {
      const qty = Number(item.qty), price = cents(Number(item.unit_price_cents));
      const total = cents(Number(item.line_total_cents));
      if (!Number.isFinite(qty) || qty <= 0 || !item.name || Math.round(qty * price) !== total) throw Error('Sale line amounts do not reconcile.');
      return {name: text(item.name), description: [item.description, item.variant_info, item.note, item.batch_no && 'Batch: '+item.batch_no].filter(Boolean).join(' · ').slice(0,1000),
        quantity: qty, unit_price_cents: price, line_total_cents: total};
    });
    if (!items.length) throw Error('The sale has no items.');
    const subtotal = cents(Number(order.subtotal_cents)), discount = cents(Number(order.discount_cents || 0));
    const total = cents(Number(order.total_cents)), tax = cents(Number(order.tax_cents || 0));
    if (items.reduce((sum, item) => sum + item.line_total_cents, 0) !== subtotal || subtotal - discount !== total || tax > total) throw Error('Invoice total does not match the POS sale.');
    const type = order.discount_type || 'fixed', value = Number(order.discount_value || 0);
    if (!['percent','fixed'].includes(type) || !Number.isFinite(value) || value < 0 ||
        Math.min(subtotal, Math.round(type === 'percent' ? subtotal * value / 100 : value * 100)) !== discount) throw Error('Discount does not reconcile with the sale.');
    return {version: 1, shop_id: text(shopId, 140), sale_id: Number(order.id), receipt_no: text(order.ticket_no, 100),
      seller_pin: text(order.etims_seller_pin ?? settings.kra_pin, 20).toUpperCase(), customer: customer({...order, ...details}), items,
      subtotal_cents: subtotal, discount: {type, value, amount_cents: discount}, total_cents: total,
      tax_cents: tax, tax_rate: Number(order.tax_rate || 0), currency: 'KES',
      payment_method: text(order.payment_method, 40), payment_ref: text(order.payment_ref, 100), paid_at: order.paid_at};
  }
  function qr(value) {
    if (!value) return '';
    const str = String(value);
    if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(str) && str.length < 500000) return str;
    let url;
    try { url = new URL(str); } catch (_) { throw Error('Invalid official QR image.'); }
    if (url.protocol !== 'https:' || !(url.hostname === 'kra.go.ke' || url.hostname.endsWith('.kra.go.ke')) || url.username || url.password) throw Error('QR image must come from KRA.');
    return url.href;
  }
  function fiscal(input = {}, source = 'manual') {
    const result = {};
    for (const key of ['cu_invoice_number','scu_id','receipt_signature','invoice_number','invoice_date']) result[key] = text(input[key], 160);
    if (!result.cu_invoice_number || !/^[A-Za-z0-9][A-Za-z0-9/_ .:-]{2,159}$/.test(result.cu_invoice_number)) throw Error('Enter the genuine CU Invoice Number shown by KRA.');
    result.qr_image = qr(input.qr_image);
    if (source === 'portal' && (!result.scu_id || !result.receipt_signature || !result.invoice_date || !result.invoice_number || !result.qr_image)) throw Error('The KRA invoice is incomplete. Open the official invoice or enter its details manually.');
    result.source = source;
    return result;
  }
  function transition(record, action, now) {
    if (!record) throw Error('Invoice request not found.');
    const next = {...record, updated_at: now, history: [...(record.history || [])]};
    const generated = record.status === 'generated' || Boolean(record.fiscal?.cu_invoice_number);
    if (action.type === 'start') {
      if (generated) throw Error('This sale already has a CU Invoice Number. Duplicate generation is blocked.');
      if (record.status !== 'pending') throw Error('Check the existing KRA invoice before attempting another.');
      next.status = 'review_required'; next.attempt_id = action.attempt_id;
      next.history.push({at:now, event:'popup_requested', attempt_id:action.attempt_id});
    } else if (action.type === 'checked_absent') {
      if (generated) throw Error('Generated invoices cannot be reset.');
      if (record.status !== 'review_required' || !text(action.reason,500)) throw Error('Record the existing invoice check before retrying.');
      next.status = 'pending'; next.attempt_id = null;
      next.history.push({at:now, event:'checked_absent', reason:action.reason, actor:action.actor});
    } else if (action.type === 'capture') {
      const value = fiscal(action.fiscal, action.source);
      if (generated && record.fiscal.cu_invoice_number !== value.cu_invoice_number) throw Error('A different CU Invoice Number is already saved.');
      if (action.source === 'portal' && (action.attempt_id !== record.attempt_id || action.digest !== record.digest || action.total_cents !== record.snapshot.total_cents)) throw Error('KRA confirmation does not match this sale attempt.');
      next.status = 'generated';
      // A late automatic result may complete a manually saved CU, without erasing it.
      next.fiscal = {...record.fiscal, ...Object.fromEntries(Object.entries(value).filter(([,v]) => v !== ''))};
      next.history.push({at:now, event:'invoice_saved', source:action.source, actor:action.actor});
    } else throw Error('Unsupported invoice action.');
    return next;
  }
  function receipt(record) {
    if (!record) return '';
    const f = record.fiscal;
    if (!f?.cu_invoice_number) return `<section class="receipt-etims"><p>eTIMS: ${record.status === 'pending' ? 'Pending' : 'Check existing KRA invoice'}</p></section>`;
    const rows = [['CU Invoice Number',f.cu_invoice_number],['SCU ID',f.scu_id],['Receipt Signature',f.receipt_signature],['Invoice Number',f.invoice_number],['Invoice Date',f.invoice_date]];
    return `<section class="receipt-etims"><p><strong>KRA eTIMS</strong>${f.source === 'manual' ? ' · Manually recorded' : ''}</p>${rows.filter(([,v])=>v).map(([k,v])=>`<div class="receipt-line"><span>${k}</span><span>${escape(v)}</span></div>`).join('')}${f.qr_image ? `<img class="receipt-kra-qr" alt="Official KRA QR code" src="${escape(qr(f.qr_image))}">` : '<p>Official QR not captured. Refer to the KRA invoice.</p>'}</section>`;
  }
  return {escape, customer, snapshot, fiscal, transition, receipt, qr};
});
