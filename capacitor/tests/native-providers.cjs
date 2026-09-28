const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname,'../src/native-providers.js'),'utf8')
  .replace("import swifta from '../swifta-contract';", '')
  .replace("import config from './provider-config.json';", "const config = {swifta:'test-swifta', sozuri:{apiKey:'test-sms',project:'sk10',from:'Sozuri',channel:'sms',type:'promotional'}};")
  .replace('export function', 'function');
const ctx = vm.createContext({URLSearchParams,swifta:require('../swifta-contract')});
vm.runInContext(source,ctx);
test('native STK uses HTTPS provider endpoint and preserves request',async()=>{
  let request;
  const provider = ctx.createNativeProviders({request:async value=>{request=value;return {data:{ResponseCode:'0',CheckoutRequestID:'test-checkout'}}}});
  const result = await provider.charge({amount:60,phone:'+254713574168',accountReference:'ORAFORGE-R001'});
  assert.equal(request.url,'https://app.swifta.co.ke/stkpush');
  assert.equal(request.data.amount,60);
  assert.equal(request.headers['x-api-key'],'test-swifta');
  assert.equal(result.data.status,'pay_offline');
});
test('SMS normalizes and deduplicates Airtel recipients and encodes message',async()=>{
  let request;
  const provider = ctx.createNativeProviders({request:async value=>{request=value;return {data:JSON.stringify({recipients:[{statusCode:'11',to:'254756205063'}]})}}});
  const result = await provider.sms('/api/admin/sms/send',{message:'Hello & welcome + thanks',recipients:['0756205063','+254756205063']});
  assert.equal(request.url,'https://sozuri.net/api/v1/messaging');
  const form = request.data;
  assert.equal(form.to,'+254756205063');
  assert.equal(form.message,'Hello & welcome + thanks');
  assert.equal(result.sent,1);assert.equal(result.total,1);
});
test('invalid recipients do not send; provider rejections propagate',async()=>{
  let calls=0;
  const provider = ctx.createNativeProviders({request:async()=>{calls++;throw new Error('Authentication invalid')}});
  await assert.rejects(provider.sms('/api/admin/sms/send',{message:'Hello',recipients:['123']}),/invalid Kenyan/);
  assert.equal(calls,0);
  await assert.rejects(provider.charge({amount:1,phone:'0713574168',accountReference:'TEST'}),/Authentication invalid/);
  assert.equal(calls,1);
});

test('Sozuri partial failures are not reported as complete success',async()=>{
 const provider=ctx.createNativeProviders({request:async()=>({data:{recipients:[{to:'254756205063',statusCode:'11'},{to:'254713574168',statusCode:'12',status:'unsupported_number'}]}})});
 const r=await provider.sms('/api/admin/sms/send',{message:'test',recipients:['0756205063','0713574168']});
 assert.equal(r.sent,1);assert.equal(r.failed,1);assert.equal(r.results[1].number,'254713574168');
});
