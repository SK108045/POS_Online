const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const serverPath = process.env.POS_TEST_SERVER || path.resolve(__dirname,'../capacitor/dev-server.js');

test('desktop server readiness, fixed port, packaged assets, external data and stop', async () => {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(),'pos-desktop-'));
 const reservation = net.createServer(); reservation.listen(0,'127.0.0.1'); await once(reservation,'listening');
 const port = reservation.address().port; await new Promise(r=>reservation.close(r));
 const env = {...process.env,POS_DESKTOP:'1',PORT:String(port),POS_INSTANCE:'test-instance',POS_BUILD:'test-build',POS_DATA_DIR:dir,POS_BACKUP_DIR:path.join(dir,'backups')};
 await fs.writeFile(path.join(dir,'swifta.txt'),'test-key-12345');
 await fs.writeFile(path.join(dir,'sozuri-config.json'),JSON.stringify({apiKey:'test-key',project:'test',from:'test'}));
 const server = spawn(process.execPath,[serverPath],{env,stdio:'ignore'});
 const exited = once(server,'exit');
 const base = `http://127.0.0.1:${port}`;
 try {
  let ready;
  for(let i=0;i<80;i++) { try {ready=await fetch(base+'/api/local/health'); if(ready.ok)break;}catch{} await new Promise(r=>setTimeout(r,50)); }
  assert.ok(ready?.ok,'server starts');
  const health = await ready.json(); assert.equal(health.instance,'test-instance'); assert.equal(health.build,'test-build');
  for(const route of ['/pos','/admin.html']) {
   const html = await (await fetch(base+route)).text(); assert.ok(html.includes('/auto-backup.js')); assert.ok(!html.includes('__dev_live_reload'));
  }
  assert.equal((await fetch(base+'/sqlite-bridge.js')).status,200);
  assert.equal((await (await fetch(base+'/api/admin/sms/config')).json()).configured,true);
  assert.equal((await (await fetch(base+'/api/local/swifta-key')).json()).configured,true);
  const data={format:'oraforge-pos-backup',version:1,records:[['shop:test:settings',{}]],preferences:{}};
  const save=()=>fetch(base+'/api/local/daily-backup',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(data)});
  assert.equal((await save()).status,200);
  data.records.push(['shop:test:orders',[{id:1,status:'paid'}]]);
  assert.equal((await save()).status,200);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'backups/latest.json'))).records,data.records);
  const collision = spawn(process.execPath,[serverPath],{env,stdio:'ignore'});
  const timer=setTimeout(()=>collision.kill(),3000);
  const [code]=await once(collision,'exit');clearTimeout(timer);assert.equal(code,1,'does not silently change ports');
  assert.equal((await fetch(base+'/api/local/stop',{method:'POST'})).status,403);
  assert.equal((await fetch(base+'/api/local/stop',{method:'POST',headers:{'X-POS-Instance':'test-instance'}})).status,200);
  await exited;
 } finally { if(server.exitCode===null) {server.kill();await exited;} await fs.rm(dir,{recursive:true,force:true}); }
});
