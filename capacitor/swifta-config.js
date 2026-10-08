'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const OVERRIDE=process.env.SWIFTA_LOCAL_KEY_PATH || path.join(__dirname,'../.swifta-api-key.local');
function readKey() {
  try {
    const key=fs.readFileSync(OVERRIDE,'utf8').trim();
    if(key) return key;
  } catch(e) { if(e.code!=='ENOENT') throw e; }
  return String(process.env.SWIFTA_API_KEY||'').trim() ||
    fs.readFileSync(path.join(__dirname,'../swifta.txt'),'utf8').trim();
}
function respond(res,status,obj) {
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(obj));
}
function authorized(req) {
  const ip=String(req.socket?.remoteAddress||'');
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip)) return false;
  const host=String(req.headers.host||'').toLowerCase();
  if(!/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(host)) return false;
  const origin=String(req.headers.origin||'');
  if(origin && origin!== 'http://'+host) return false;
  const expected=String(process.env.SWIFTA_SETUP_TOKEN||'');
  const actual=String(req.headers['x-swifta-setup-token']||'');
  if(expected.length<20 || expected.length!==actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(actual));
}
async function handle(req,res) {
  if(!authorized(req)) return respond(res,403,{ok:false,message:'Local setup token required. Open this page on the same computer as your POS server.'});
  if(req.method==='GET') {
    let configured=false;
    try { configured=Boolean(readKey()); } catch (_) {}
    return respond(res,200,{ok:true,configured});
  }
  if(req.method!=='POST') return respond(res,405,{ok:false,message:'Method not supported.'});
  if(!String(req.headers['content-type']||'').startsWith('application/json'))return respond(res,415,{ok:false,message:'JSON required.'});
  let raw='';
  try {
    for await(const chunk of req) {
      raw+=chunk;
      if(raw.length>4096)throw Error('Too large');
    }
    const data=JSON.parse(raw);
    const key=String(data.apiKey||'').trim();
    if(!/^[\x21-\x7e]{10,256}$/.test(key))return respond(res,400,{ok:false,message:'Enter a valid Swifta key without spaces (10–256 characters).'});
    const tmp=OVERRIDE+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';
    try {
      fs.writeFileSync(tmp,key+'\n',{flag:'wx',mode:0o600});
      fs.renameSync(tmp,OVERRIDE);
      fs.chmodSync(OVERRIDE,0o600);
    } finally { try{fs.unlinkSync(tmp)}catch(_){} }
    return respond(res,200,{ok:true,message:'Swifta payment key updated on this computer.'});
  } catch(e) {
    return respond(res,400,{ok:false,message:'Could not save the key. Check the local server and file permissions.'});
  }
}
module.exports={readKey,handle};
