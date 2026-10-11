#!/usr/bin/env node
/* Read-only HTML proof: run the REAL showReceiptModal() and REAL etims-core receipt() in a tiny DOM shim. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const [input,output]=process.argv.slice(2);
if(!input||!output){console.error('Usage: node tools/etims_pdf_receipt_demo.cjs invoice-data.json preview.html');process.exit(2);}
const data=JSON.parse(fs.readFileSync(input,'utf8'));
const core=require(path.join(root,'capacitor/www/etims-core.js'));
const fiscal=core.fiscal(data,'portal'); // Validate official fields and QR. No POS capture occurs.
fiscal.source='pdf-demo';
const order={id:1,ticket_no:'PDF-DEMO-ONLY',status:'paid',order_type:'walk-in',
  customer_name:data.buyer_name,created_at:Math.floor(Date.parse(data.invoice_date.replace(' ','T')+'+03:00')/1000),
  total_cents:data.total_cents,subtotal_cents:data.subtotal_cents,discount_cents:data.discount_cents,
  tax_cents:data.tax_cents,tax_rate:0,discount_type:'fixed',discount_value:0,payment_method:data.payment_method,
  items:data.items.map(i=>({name:i.name,qty:i.quantity,unit_price_cents:i.unit_price_cents,line_total_cents:i.line_total_cents}))};
const source=fs.readFileSync(path.join(root,'capacitor/www/app.js'),'utf8');
const start=source.indexOf('function showReceiptModal(order, isKot = false) {');
const end=source.indexOf('// ── UI Utilities',start);
if(start<0||end<start)throw Error('Cannot locate original POS receipt renderer; preview not generated.');
let modal=null;
const noop=()=>{};
const doc={getElementById:id=>id==='receiptModal'?null:{addEventListener:noop},
  createElement:()=>({innerHTML:'',dataset:{},classList:{add:noop},addEventListener:noop}),
  body:{appendChild:el=>{modal=el;}},addEventListener:noop};
const context={document:doc,window:{OraforgeEtims:{mountReceipt(overlay){
  const marker='<div data-etims-receipt></div>';
  if(!overlay.innerHTML.includes(marker))throw Error('Original POS receipt no longer contains the eTIMS slot.');
  overlay.innerHTML=overlay.innerHTML.replace(marker,core.receipt({status:'generated',fiscal}));
  overlay.etimsReady=Promise.resolve();
}}},state:{settings:{business_name:data.seller_name,kra_pin:data.seller_pin,receipt_footer:'PDF EXTRACTION TEST ONLY - No POS sale linked'}},
  moneyRaw:value=>(value/100).toFixed(2),
  receiptEscape:core.escape,Date,console,Promise,toast:noop};
vm.runInNewContext(source.slice(start,end),context,{filename:'app.js receipt excerpt'});
context.showReceiptModal(order);
if(!modal?.innerHTML.includes(data.cu_invoice_number)||!modal?.innerHTML.includes('receipt-kra-qr'))throw Error('Original POS receipt did not render KRA fiscal data.');
const style=fs.readFileSync(path.join(root,'capacitor/www/styles.css'),'utf8');
const etims=fs.readFileSync(path.join(root,'capacitor/www/etims-integration.css'),'utf8');
const extra='body{background:#eef2ef!important;margin:0!important}.demo-heading{position:relative;z-index:12;text-align:center;background:#163829;color:white;padding:14px;font:700 14px system-ui}.receipt-modal-overlay{position:relative!important;inset:auto!important;z-index:1!important;background:transparent!important;min-height:auto!important;padding:20px!important;display:flex!important}.receipt-modal{position:relative!important;max-height:none!important;overflow:visible!important;min-width:0!important}.receipt-modal-print-area{overflow:visible!important}.receipt-kra-qr{image-rendering:pixelated}@media print{.demo-heading{display:none!important}.receipt-modal-overlay{padding:0!important;min-height:0!important}.receipt-modal{border:0!important;box-shadow:none!important}.receipt-modal-close,#receiptPrintBtn{display:none!important}}';
const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Oraforge original POS receipt - KRA PDF TEST</title><style>'+style+'\n'+etims+'\n'+extra+'</style></head><body><div class="demo-heading">PDF EXTRACTION TEST · HISTORICAL KRA INVOICE · NOT LINKED TO A POS SALE</div>'+modal.innerHTML+'</body></html>';
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);
console.log('Rendered using the original POS showReceiptModal() and eTIMS receipt() functions:',output);
