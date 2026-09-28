const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const https=require('https');
const {validate,normalize}=require('../swifta-contract');
test('Swifta validation, accepted/error/unknown responses',()=>{
 assert.equal(validate({phone:'+254713574168',amount:290,accountReference:'R001'}).phone,'0713574168');
 assert.throws(()=>validate({phone:'123',amount:290,accountReference:'R001'}));
 assert.equal(normalize({ResponseCode:'0',CheckoutRequestID:'abc'}).data.reference,'abc');
 assert.equal(normalize({success:true,data:{ResponseCode:'1',errorMessage:'Rejected'}}).status,false);
 assert.equal(normalize({}).status,false);
});
test('web proxy uses Swifta header, text-file key and KES amount',async()=>{
 const original=https.request;let sent;
 https.request=(url,opts,callback)=>{
  assert.equal(url,'https://app.swifta.co.ke/stkpush');assert.ok(opts.headers['x-api-key']);assert.equal(opts.headers.Authorization,undefined);
  const upstream=new EventEmitter();upstream.setTimeout=()=>{};upstream.end=body=>{sent=JSON.parse(body);const res=new EventEmitter();res.statusCode=200;callback(res);res.emit('data',JSON.stringify({ResponseCode:'0',CheckoutRequestID:'accepted-id'}));res.emit('end');};return upstream;
 };
 try {
  const req=new EventEmitter();const result=await new Promise(resolve=>{require('../swifta').handle(req,{writeHead(){},end:body=>resolve(JSON.parse(body))});req.emit('data',JSON.stringify({phone:'+254713574168',amount:290,accountReference:'ORAFORGE-R001',description:'POS payment'}));req.emit('end');});
  assert.equal(sent.amount,290);assert.equal(sent.phone,'0713574168');assert.equal(sent.accountReference,'ORAFORGE-R001');assert.equal(result.status,true);assert.equal(result.data.reference,'accepted-id');
 } finally {https.request=original;}
});
