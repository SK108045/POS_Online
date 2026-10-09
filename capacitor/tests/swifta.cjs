const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const https=require('https');
const fs=require('fs');
const os=require('os');
const path=require('path');
const crypto=require('crypto');
const {validate,normalize}=require('../swifta-contract');

test('Swifta validation and response shapes',()=>{
  assert.equal(validate({phone:'+254713574168',amount:290,accountReference:'R001'}).phone,'0713574168');
  assert.throws(()=>validate({phone:'123',amount:290,accountReference:'R001'}));
  assert.equal(normalize({ResponseCode:'0',CheckoutRequestID:'abc'}).data.reference,'abc');
  assert.equal(normalize({success:true,mpesaResponse:{ResponseCode:'0',CheckoutRequestID:'abc2'}}).data.reference,'abc2');
  assert.equal(normalize({success:true,data:{ResponseCode:'1',errorMessage:'Rejected'}}).status,false);
  assert.equal(normalize({}).status,false);
});

test('signed Swifta verification automatically confirms the correct order only',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oraforge-swifta-test-'));
  process.env.POS_DATA_DIR=dir;
  fs.writeFileSync(path.join(dir,'swifta.txt'),'test-key\n');
  process.env.SWIFTA_WEBHOOK_SECRET='test-signing-secret';
  process.env.SWIFTA_ATTEMPTS_PATH=path.join(dir,'attempts.json');
  const swifta=require('../swifta');
  const previous=https.request;
  let seen=null, pollResult={status:'pending'};
  https.request=(url,opts,callback)=>{
    const upstream=new EventEmitter();
    upstream.setTimeout=()=>{};
    upstream.end=body=>{
      if(url.endsWith('/stkpush')) {
        seen=JSON.parse(body);
        assert.equal(opts.headers['x-api-key'],'test-key');
        assert.equal(opts.headers.Authorization,undefined);
      }
      const response=new EventEmitter();response.statusCode=200;callback(response);
      response.emit('data',JSON.stringify(url.endsWith('/stkpush')
        ? {ResponseCode:'0',CheckoutRequestID:'accepted-id-123'}
        : pollResult));
      response.emit('end');
    };
    return upstream;
  };
  function fakeReq(body,headers={}) {
    const req=new EventEmitter();
    req.headers=headers;
    req.send=()=>{req.emit('data',JSON.stringify(body));req.emit('end')};
    return req;
  }
  async function post(fn,body,headers={}) {
    const req=fakeReq(body,headers);
    const result=new Promise(resolve=>fn(req,{writeHead(code){this.code=code},end(text){resolve(JSON.parse(text))}}));
    req.send();
    return result;
  }
  async function getStatus(attempt) {
    return new Promise(resolve=>swifta.status({}, {writeHead(){},end(text){resolve(JSON.parse(text))}},new URL('http://localhost/api/swifta/status?attempt='+attempt)));
  }
  try{
    const start=await post((req,res)=>swifta.handle(req,res),{
      phone:'+254713574168',amount:290,accountReference:'ORAFORGE-R001',description:'POS payment',
      shop_id:'toy-shop',order_id:'1'
    });
    assert.equal(start.status,true);
    assert.equal(start.data.reference,'accepted-id-123');
    assert.ok(/^[a-f0-9]{32}$/.test(start.data.attempt_id));
    assert.equal(seen.amount,290);
    assert.equal(seen.phone,'0713574168');
    assert.equal(await fs.promises.stat(process.env.SWIFTA_ATTEMPTS_PATH).then(x=>x.isFile()),true);

    const pending=await getStatus(start.data.attempt_id);
    assert.equal(pending.status,'pending');
    assert.equal(pending.payment_ref,null);

    // Provider result with an incorrect amount must not mark an order paid.
    pollResult={transaction:{status:'success',mpesaReceiptNumber:'QJL9999999',amount:291,phone:'0713574168'}};
    assert.equal((await getStatus(start.data.attempt_id)).status,'pending');

    // Invalid webhook signature cannot finalize the sale.
    const event={event:'payment.success',data:{CheckoutRequestID:'accepted-id-123',amount:290,MpesaReceiptNumber:'QJL12345678',phone:'0713574168'}};
    let unauth;
    const badReq=fakeReq(event,{'x-swifta-signature':'bad'});
    const rejected=new Promise(resolve=>swifta.callback(badReq,{writeHead(code){unauth=code},end(t){resolve(JSON.parse(t))}},new URL('http://localhost/api/swifta/webhook'),true));
    badReq.send();await rejected;
    assert.equal(unauth,401);

    // Exact signed payment succeeds, and repeat delivery is idempotent.
    const signature=crypto.createHmac('sha256','test-signing-secret').update(JSON.stringify(event)).digest('hex');
    const signed=await post((req,res)=>swifta.callback(req,res,new URL('http://localhost/api/swifta/webhook'),true),event,{'x-swifta-signature':signature});
    assert.equal(signed.status,'success');
    const verified=await getStatus(start.data.attempt_id);
    assert.equal(verified.status,'success');
    assert.equal(verified.payment_ref,'QJL12345678');
    assert.equal(verified.amount_cents,29000);
    assert.equal(verified.shop_id,'toy-shop');
    assert.equal(verified.order_id,'1');
    assert.equal((await post((req,res)=>swifta.callback(req,res,new URL('http://localhost/api/swifta/webhook'),true),event,{'x-swifta-signature':signature})).status,'success');

    // Payment cannot be reused to settle a second pending attempt.
    const next=await post((req,res)=>swifta.handle(req,res),{
      phone:'+254713574168',amount:290,accountReference:'ORAFORGE-R002',shop_id:'toy-shop',order_id:'2'
    });
    assert.equal(next.status,true);
    pollResult={transaction:{status:'success',mpesaReceiptNumber:'QJL12345678',amount:290,phone:'0713574168'}};
    assert.equal((await getStatus(next.data.attempt_id)).status,'pending');
  } finally {
    https.request=previous;
    fs.rmSync(dir,{recursive:true,force:true});
    delete process.env.POS_DATA_DIR;
    delete process.env.SWIFTA_WEBHOOK_SECRET;
    delete process.env.SWIFTA_ATTEMPTS_PATH;
  }
});
