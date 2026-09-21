const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const https=require('https');
const sms=require('../sms');
test('local Sozuri proxy sends JSON and preserves partial failure counts',async()=>{
 const original=https.request;let requestBody;
 https.request=(url,opts,callback)=>{
  assert.equal(url,'https://sozuri.net/api/v1/messaging');assert.equal(opts.headers['Content-Type'],'application/json');
  const upstream=new EventEmitter();upstream.setTimeout=()=>{};
  upstream.end=body=>{requestBody=JSON.parse(body);const response=new EventEmitter();response.statusCode=200;callback(response);response.emit('data',JSON.stringify({recipients:[{to:'254756205063',statusCode:'11',status:'sent'},{to:'254713574168',statusCode:'12',status:'unsupported_number'}]}));response.emit('end');};return upstream;
 };
 try {
  const req=new EventEmitter();req.method='POST';let status;
  const result=await new Promise(resolve=>{sms.handle(req,{writeHead:code=>status=code,end:body=>resolve(JSON.parse(body))},'/api/admin/sms/send');req.emit('data',JSON.stringify({message:'Hello & welcome',recipients:['0756205063','+254756205063','0713574168']}));req.emit('end');});
  assert.equal(status,200);assert.equal(requestBody.to,'+254756205063,+254713574168');assert.equal(requestBody.channel,'sms');assert.equal(requestBody.type,'promotional');assert.equal(requestBody.message,'Hello & welcome');assert.equal(result.sent,1);assert.equal(result.total,2);assert.equal(result.failed,1);
 } finally {https.request=original;}
});
