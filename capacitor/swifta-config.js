'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
// The same local file used for STK payments is edited in place.
const KEY_FILE=path.join(__dirname,'../swifta.txt');
function readKey() {
  return fs.readFileSync(KEY_FILE,'utf8').trim();
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
  // Keep this password-free setup action local to the POS laptop/browser.
  // Cross-site POSTs must not be able to modify a device's payment key.
  const fetchSite=String(req.headers['sec-fetch-site']||'');
  if(fetchSite && !['same-origin','none'].includes(fetchSite)) return false;
  if(req.method==='POST' && origin !== 'http://'+host) return false;
  return true;
}
async function handle(req,res) {
  if(!authorized(req)) return respond(res,403,{ok:false,message:'This key can only be changed from the POS on this computer.'});
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
    const tmp=KEY_FILE+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';
    try {
      fs.writeFileSync(tmp,key+'\n',{flag:'wx',mode:0o600});
      fs.renameSync(tmp,KEY_FILE);
      fs.chmodSync(KEY_FILE,0o600);
    } finally { try{fs.unlinkSync(tmp)}catch(_){} }
    return respond(res,200,{ok:true,message:'swifta.txt updated. The next STK payment will use this key.'});
  } catch(e) {
    return respond(res,400,{ok:false,message:'Could not save the key. Check the local server and file permissions.'});
  }
}
module.exports={readKey,handle};
