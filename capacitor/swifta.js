const fs=require('fs');
const path=require('path');
const https=require('https');
const {validate,normalize}=require('./swifta-contract');
module.exports.handle=(req,res)=>{
  let replied=false;
  const reply=(code,data)=>{if(replied)return;replied=true;res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  let raw='';
  req.on('data',chunk=>{raw+=chunk;if(raw.length>16000){reply(413,{status:false,message:'Request too large'});req.destroy();}});
  req.on('end',()=>{
    if(replied)return;
    let body,key;
    try {body=JSON.stringify(validate(JSON.parse(raw)));}catch(e){reply(400,{status:false,message:e.message});return;}
    try {key=fs.readFileSync(path.join(__dirname,'../swifta.txt'),'utf8').trim();if(!key)throw Error();}catch{reply(503,{status:false,message:'Swifta key is missing from swifta.txt'});return;}
    const upstream=https.request('https://app.swifta.co.ke/stkpush',{method:'POST',headers:{'x-api-key':key,'Content-Type':'application/json','Accept':'application/json','Content-Length':Buffer.byteLength(body)}},response=>{
      let text='';response.on('data',c=>text+=c);response.on('end',()=>{
        try {const result=normalize(JSON.parse(text));if(response.statusCode>=400)result.status=false;result.message=result.message.split(key).join('[redacted]');reply(response.statusCode||502,result);}
        catch {reply(502,{status:false,message:'Swifta returned an unreadable response. Check payment status before retrying.'});}
      });
    });
    upstream.setTimeout(30000,()=>upstream.destroy());
    upstream.on('error',()=>reply(502,{status:false,message:'Could not confirm the Swifta request. Check payment status before retrying.'}));
    upstream.end(body);
  });
};
