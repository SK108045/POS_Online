'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const {validate, normalize} = require('./swifta-contract');
const {readKey} = require('./swifta-config');

const STORE_PATH = process.env.SWIFTA_ATTEMPTS_PATH || path.join(__dirname, '../data/swifta-attempts.json');
const BASE = 'https://app.swifta.co.ke';
const attempts = new Map();
try {
  for (const entry of JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'))) {
    if (entry && /^[a-f0-9]{32}$/.test(entry.id)) attempts.set(entry.id, entry);
  }
} catch (error) {
  if (error.code !== 'ENOENT') console.warn('Unable to restore Swifta attempt journal:', error.message);
}
function save() {
  const dir = path.dirname(STORE_PATH);
  fs.mkdirSync(dir, {recursive:true});
  const temp = STORE_PATH + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, JSON.stringify([...attempts.values()]), {mode:0o600});
  fs.renameSync(temp, STORE_PATH);
}
function reply(res, code, body) {
  res.writeHead(code, {'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(body));
}
function read(req) {
  return new Promise((resolve, reject) => {
    let text = '';
    req.on('data', chunk => {text += chunk; if(text.length > 16000) reject(new Error('Request too large'));});
    req.on('end', () => resolve(text));
    req.on('error', reject);
  });
}
function secureEqual(a,b) {
  const x=Buffer.from(String(a||'')), y=Buffer.from(String(b||''));
  return x.length===y.length && x.length>0 && crypto.timingSafeEqual(x,y);
}
function normalizePhone(v) {
  const s=String(v||'').replace(/\D/g,'');
  return s.startsWith('254') && s.length===12 ? '0'+s.slice(3) : s;
}
function normalizedAmountCents(value) {
  const n=Number(value);
  return Number.isFinite(n) && n>0 ? Math.round(n*100) : null;
}
function paymentData(payload) {
  const data=payload && typeof payload === 'object' ? payload : {};
  const nested=data.transaction || data.data || data.Body?.stkCallback || data.stkCallback || data;
  const values=Array.isArray(nested.CallbackMetadata?.Item) ? Object.fromEntries(nested.CallbackMetadata.Item.map(x=>[x.Name,x.Value])) : {};
  return {data,nested,values};
}
function verifyAndApply(entry, payload, signed) {
  const {data,nested,values}=paymentData(payload);
  const event=String(data.event||'').toLowerCase();
  const status=String(nested.status || data.status || '').toLowerCase();
  const code=nested.ResultCode ?? nested.resultCode ?? nested.result_code;
  const failure=event==='payment.failed'||event==='stk.timeout'||['failed','cancelled','canceled','timeout'].includes(status)|| (code!==undefined && String(code)!=='0');
  const success=event==='payment.success'||status==='success'||status==='completed'||status==='paid'||(code!==undefined&&String(code)==='0');
  // No inferred successful payments from an STK request acceptance.
  if (!success && !failure) return entry.state;
  const checkout=String(nested.CheckoutRequestID||nested.checkoutRequestId||nested.checkout_request_id||data.CheckoutRequestID||'');
  if(checkout && entry.checkoutId && checkout!==entry.checkoutId) return 'mismatch';
  const ref=String(nested.accountReference||nested.account_reference||nested.reference||nested.external_reference||data.accountReference||'');
  if(ref && ref!==entry.accountReference) return 'mismatch';
  if(entry.state==='success') return 'success'; // Never undo a paid transaction.
  if(failure) {
    entry.state='failed';
    entry.updatedAt=Date.now();
    save();
    return 'failed';
  }
  const receipt=String(values.MpesaReceiptNumber||values.TransactionReceipt||nested.mpesaReceiptNumber||nested.MpesaReceiptNumber||nested.transactionReceipt||nested.TransactionReceipt||nested.receipt||data.mpesaReceiptNumber||'').trim().toUpperCase();
  if(!/^[A-Z0-9]{8,30}$/.test(receipt)) return 'unverified';
  const rawAmount=values.Amount??nested.amount??nested.TransactionAmount??data.amount;
  const amount=rawAmount==null ? null : normalizedAmountCents(rawAmount);
  if(amount!=null && amount!==entry.amountCents) return 'mismatch';
  // Signed callbacks must prove amount; for authenticated GET /poll the
  // checkout ID was stored when Swifta accepted this exact amount.
  if(signed && amount===null) return 'unverified';
  const phone=normalizePhone(values.PhoneNumber||values.Msisdn||nested.phone||nested.phoneNumber||nested.Msisdn||data.phone);
  if(phone && phone!==entry.phone) return 'mismatch';
  for(const other of attempts.values()) if(other.id!==entry.id && other.state==='success' && other.receipt===receipt) return 'mismatch';
  entry.state='success';
  entry.receipt=receipt;
  entry.updatedAt=Date.now();
  save();
  return 'success';
}
function upstreamJSON(url, method='GET', body=null, headers={}) {
  return new Promise((resolve,reject)=>{
    const req=https.request(url,{method,headers:{Accept:'application/json',...headers,...(body?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}:{})}},response=>{
      let raw='';
      response.on('data',c=>{raw+=c;if(raw.length>20000){req.destroy();reject(new Error('Provider reply is too large'));}});
      response.on('end',()=>{try{resolve({code:response.statusCode,body:JSON.parse(raw)})}catch{reject(new Error('Provider returned an unreadable response'));}});
    });
    req.setTimeout(25000,()=>req.destroy(new Error('Provider request timed out')));
    req.on('error',reject);
    req.end(body||undefined);
  });
}
async function handle(req,res) {
  try {
    const input=JSON.parse(await read(req));
    const payload=validate(input);
    if(!/^ORAFORGE-[\w.-]{1,80}$/.test(payload.accountReference)) return reply(res,400,{status:false,message:'Invalid POS payment reference.'});
    const amountCents=normalizedAmountCents(payload.amount);
    if(!Number.isSafeInteger(amountCents)||amountCents<=0||Math.abs(payload.amount*100-amountCents)>0.001) return reply(res,400,{status:false,message:'Invalid payment amount.'});
    const key=readKey();
    if(!key) throw Error('Swifta credentials are not configured.');
    // Prevent repeated clicks generating multiple prompts for the same order.
    const shopId=String(input.shop_id||'');
    const orderId=String(input.order_id||'');
    if(!shopId || !orderId || shopId.length>100 || !/^\d+$/.test(orderId)) return reply(res,400,{status:false,message:'Missing shop or order identifier.'});
    const matching=[...attempts.values()].find(a=>a.shopId===shopId&&a.orderId===orderId&&['pending','uncertain'].includes(a.state));
    if(matching && (!matching.checkoutId || matching.state==='uncertain')) return reply(res,409,{status:false,message:'An earlier STK attempt has an uncertain outcome. Check Swifta before requesting another payment.'});
    if(matching) return reply(res,200,{status:true,message:'Existing M-Pesa request is still pending.',data:{status:'pay_offline',reference:matching.checkoutId,attempt_id:matching.id}});
    const id=crypto.randomBytes(16).toString('hex');
    const entry={id,shopId,orderId,phone:payload.phone,amountCents,accountReference:payload.accountReference,checkoutId:'',state:'pending',receipt:'',createdAt:Date.now(),updatedAt:Date.now()};
    attempts.set(id,entry);save();
    let result;
    try {
      result=await upstreamJSON(BASE+'/stkpush','POST',JSON.stringify(payload),{'x-api-key':key});
    } catch(err) {
      // Ambiguous network errors must not provoke an automatic second charge.
      entry.state='uncertain';entry.updatedAt=Date.now();save();
      return reply(res,502,{status:false,message:'STK submission could not be confirmed. Check Swifta before retrying.'});
    }
    const parsed=normalize(result.body);
    if(result.code>=400 || !parsed.status){
      entry.state='failed';entry.updatedAt=Date.now();save();
      return reply(res,result.code>=400?result.code:502,{status:false,message:parsed.message});
    }
    entry.checkoutId=String(parsed.data?.reference||'');
    if(!entry.checkoutId || entry.checkoutId.length>200){
      entry.state='uncertain';entry.updatedAt=Date.now();save();
      return reply(res,502,{status:false,message:'Swifta accepted the request without a checkout ID. Check Swifta before retrying.'});
    }
    entry.updatedAt=Date.now();save();
    return reply(res,200,{status:true,message:'STK prompt sent. Awaiting payment verification.',data:{status:'pay_offline',reference:entry.checkoutId,attempt_id:id}});
  } catch(err){
    return reply(res,503,{status:false,message:'Swifta payment service is unavailable: '+(err.code==='ENOENT'?'API key is missing.':'Please try again later.')});
  }
}
async function status(req,res,url) {
  const id=url.searchParams.get('attempt')||'';
  const entry=attempts.get(id);
  if(!/^[a-f0-9]{32}$/.test(id)||!entry) return reply(res,404,{status:'unknown',message:'Unknown payment attempt.'});
  if(entry.state==='pending' && entry.checkoutId) {
    try {
      const response=await upstreamJSON(BASE+'/poll/'+encodeURIComponent(entry.checkoutId));
      if(response.code===200) verifyAndApply(entry,response.body,false);
    } catch(_) { /* Keep pending; an unavailable check is not proof of payment. */ }
  }
  return reply(res,200,{status:entry.state,attempt_id:entry.id,checkout_id:entry.checkoutId,
    shop_id:entry.shopId,order_id:entry.orderId,amount_cents:entry.amountCents,
    payment_ref:entry.state==='success'?entry.receipt:null,
    message:entry.state==='success'?'M-Pesa payment verified.':entry.state==='failed'?'M-Pesa payment was not completed.':'Waiting for verified M-Pesa confirmation.'});
}
async function callback(req,res,url,signed) {
  try {
    const raw=await read(req);
    if(signed) {
      const secret=process.env.SWIFTA_WEBHOOK_SECRET||'';
      if(!secret) return reply(res,503,{ok:false,message:'Webhook signing secret not configured.'});
      const headerName=String(process.env.SWIFTA_WEBHOOK_SIGNATURE_HEADER||'x-swifta-signature').toLowerCase();
      const supplied=String(req.headers[headerName]||'').replace(/^sha256=/i,'').trim().toLowerCase();
      const expected=crypto.createHmac('sha256',secret).update(raw).digest('hex');
      if(!secureEqual(supplied,expected)) return reply(res,401,{ok:false,message:'Invalid webhook signature.'});
    } else {
      const secret=process.env.SWIFTA_CALLBACK_TOKEN||'';
      if(!secret) return reply(res,503,{ok:false,message:'Callback token not configured.'});
      if(!secureEqual(req.headers['x-webhook-secret']||url.searchParams.get('token'),secret)) return reply(res,401,{ok:false,message:'Invalid callback token.'});
    }
    const payload=JSON.parse(raw),{data,nested}=paymentData(payload);
    const checkout=String(nested.CheckoutRequestID||nested.checkoutRequestId||nested.checkout_request_id||data.CheckoutRequestID||'');
    const reference=String(nested.accountReference||nested.account_reference||nested.reference||nested.external_reference||data.accountReference||'');
    // Never guess which shop was paid when a ticket reference is reused.
    // Prefer the provider checkout ID; a reference-only callback must be unique.
    const matches=[...attempts.values()].filter(a=> checkout
      ? a.checkoutId===checkout
      : reference && a.accountReference===reference);
    const entry=matches.length===1 ? matches[0] : null;
    if(!entry) return reply(res,200,{ok:true,status:'ignored'}); // Unknown or ambiguous callback.
    const applied=verifyAndApply(entry,payload,true);
    return reply(res,200,{ok:true,status:applied});
  } catch(_) {
    return reply(res,400,{ok:false,message:'Invalid payment callback.'});
  }
}
module.exports={handle,status,callback};
