/* Same-origin POS proxy to the authenticated Windows loopback companion. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
const home=()=>process.env.ORAFORGE_ETIMS_HOME || path.join(process.env.LOCALAPPDATA || process.env.HOME || '.', 'OraforgePOS','etims');
let starting=null;
const HELPER_BUILD='20261013.7';
function config(){try{return JSON.parse(fs.readFileSync(path.join(home(),'config.json'),'utf8').replace(/^\uFEFF/,''));}catch{return {};}}
function launchTarget(){
  const exe=process.env.ORAFORGE_ETIMS_EXE || config().helper_exe || path.resolve(__dirname,'../../runtime/etims/OraforgeEtims/OraforgeEtims.exe');
  const source=path.resolve(__dirname,'../windows/etims-helper/server.py');
  return fs.existsSync(exe)?{command:exe,args:[],entry:exe,mode:'frozen'}:
    {command:process.env.ORAFORGE_ETIMS_PYTHON || 'python',args:[source],entry:source,mode:'source'};
}
function verifyHealth(health,target=launchTarget()){
  const samePath=value=>typeof value==='string' && path.resolve(value).toLowerCase()===path.resolve(target.entry).toLowerCase();
  if(health.app!=='oraforge-etims-helper' || health.version!==2 || health.build!==HELPER_BUILD ||
     health.runtime_mode!==target.mode || !samePath(health.runtime_entry) ||
     (target.mode==='frozen' && !samePath(health.runtime_executable))){
    const error=Error('The active eTIMS helper differs from the installed build. Restart the Windows helper, then recover this same sale.');
    error.code='ETIMS_HELPER_MISMATCH';throw error;
  }
  return health;
}
function call(route,method='GET',body,timeout=30000){
  return new Promise((resolve,reject)=>{
    let token='';if(route!=='/health')try{token=fs.readFileSync(path.join(home(),'helper.token'),'utf8').trim();}catch{return reject(Error('Windows eTIMS helper has not started.'));}
    const raw=body===undefined?null:Buffer.from(JSON.stringify(body));
    const req=http.request({hostname:'127.0.0.1',port:config().port || 17383,path:route,method,timeout,
      headers:{...(token?{Authorization:'Bearer '+token}:{}),...(raw?{'Content-Type':'application/json','Content-Length':raw.length}:{})}},res=>{
      let chunks=[],size=0;res.on('data',chunk=>{size+=chunk.length;if(size>2_000_000){req.destroy(Error('Companion response exceeds limit'));return;}chunks.push(chunk);});
      res.on('end',()=>{try{const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(res.statusCode>=400){const error=Error(result.error || 'Windows companion stopped');error.status=res.statusCode;reject(error);}else resolve(result);}catch(e){reject(e);}});
    });
    req.on('error',reject);req.on('timeout',()=>req.destroy(Error('Windows companion timed out. Recover the same sale before retrying.')));
    if(raw)req.write(raw);req.end();
  });
}
async function ensure(){
  try{return verifyHealth(await call('/health','GET',undefined,800));}catch(error){
    if(error.code==='ETIMS_HELPER_MISMATCH')throw error;
    if(process.platform!=='win32')throw Error('Invoice issuance requires Oraforge on the Windows eTIMS computer.');
    if(starting)return starting;
    starting=(async()=>{
      const {command,args}=launchTarget();
      const child=spawn(command,args,{windowsHide:true,detached:true,stdio:'ignore',env:{...process.env,ORAFORGE_ETIMS_HOME:home()}});
      let failed=false;child.on('error',()=>{failed=true;});child.unref();
      for(let i=0;i<40;i++){
        await new Promise(resolve=>setTimeout(resolve,250));
        if(failed)break;
        try{return verifyHealth(await call('/health','GET',undefined,600));}catch(error){if(error.code==='ETIMS_HELPER_MISMATCH')throw error;}
      }
      throw Error('Start the Windows eTIMS helper. Install its Python dependencies or use the packaged Windows build.');
    })().finally(()=>{starting=null;});
    return starting;
  }
}
function local(req){
  const remote=req.socket.remoteAddress;
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote))return false;
  const host=req.headers.host || '';
  if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))return false;
  if(req.headers['sec-fetch-site']==='cross-site')return false;
  if(req.headers.origin){try{const origin=new URL(req.headers.origin);if(origin.protocol!=='http:' || origin.host!==host)return false;}catch{return false;}}
  return true;
}
async function handle(req,res){
  const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  if(!local(req))return send(403,{error:'Use Oraforge on this Windows computer.'});
  if(req.method==='OPTIONS')return send(403,{error:'Same-origin Windows IPC only.'});
  const route=new URL(req.url,'http://localhost').pathname.replace(/^\/api\/etims/,'');
  if(!['/health','/preflight','/jobs'].includes(route) && !/^\/jobs\/[0-9a-f]{64}(\/recover|\/details)?$/.test(route))return send(404,{error:'Unknown eTIMS operation'});
  try{
    let body;
    if(req.method==='POST'){
      if(req.headers['content-type']?.split(';')[0]!=='application/json' || req.headers['x-oraforge-etims']!=='2')return send(400,{error:'Structured POS request required'});
      let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>1_000_000)return send(413,{error:'Sale request too large'});chunks.push(chunk);}
      body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }else if(req.method!=='GET')return send(405,{error:'Unsupported method'});
    await ensure();
    const result=await call(route,req.method,body);
    send(req.method==='POST' && route.includes('/jobs')?202:200,result);
  }catch(error){send(error.status || 503,{error:error.message});}
}
module.exports={handle,ensure,local,verifyHealth,HELPER_BUILD};
