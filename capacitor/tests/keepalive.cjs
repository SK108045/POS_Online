const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const {sessionState,INTERVAL,SETTING,MODE}=require('../../chrome-extension/scroll-keepalive');
const source=fs.readFileSync(path.join(__dirname,'../../chrome-extension/scroll-keepalive.js'),'utf8');
const html='<button><span class="sr-only">Open user menu</span></button><h1>Create Sales Invoice</h1><form><input type="email" value="fixture@example.test"><textarea>Retain this description</textarea><button>Add Item</button><button>Create Invoice</button></form>';

async function harness(enabled=false, height=2000, mode='scroll') {
  const dom=new JSDOM(html,{url:'https://ecitizen.kra.go.ke/individual/etims/sale/create',runScripts:'outside-only'}),win=dom.window;
  let now=100000,seq=0,change,wake,requests=0,clicks=0,submits=0;
  const tasks=new Map(),logs=[],scrolls=[],listeners=new Map();
  win.Date.now=()=>now;
  win.setTimeout=(fn,ms)=>{const id=++seq;tasks.set(id,{at:now+ms,fn});return id;};
  win.clearTimeout=id=>tasks.delete(id);
  const realAdd=win.addEventListener.bind(win);
  win.addEventListener=(type,fn,opts)=>{listeners.set(type,fn);realAdd(type,fn,opts);};
  Object.defineProperty(win.document,'scrollingElement',{value:win.document.documentElement});
  Object.defineProperties(win.document.documentElement,{scrollHeight:{value:height},clientHeight:{value:800}});
  win.scrollTo=({left,top})=>{win.scrollX=left;win.scrollY=top;scrolls.push([left,top]);};
  win.fetch=()=>{requests++;};win.XMLHttpRequest=class{constructor(){requests++;}};
  win.document.addEventListener('click',()=>clicks++);
  win.document.addEventListener('submit',()=>submits++);
  win.console.info=()=>{};
  const chrome={storage:{local:{get:async()=>({[SETTING]:enabled,[MODE]:mode})},onChanged:{addListener:fn=>change=fn,removeListener:()=>{change=null;}}},runtime:{id:'fixture',onMessage:{addListener:fn=>wake=fn,removeListener:()=>wake=null},sendMessage:async m=>{logs.push(m.data);return {result:{logged:true}};}}};
  win.module={exports:{}};win.eval(source);
  const controller=win.module.exports.create(win,chrome);await controller.start();
  const advance=async ms=>{
    const end=now+ms;
    while (true) {
      const ready=[...tasks.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if (!ready) break;
      tasks.delete(ready[0]);now=ready[1].at;ready[1].fn();await Promise.resolve();
    }
    now=end;await Promise.resolve();
  };
  return {win,logs,scrolls,listeners,advance,enable:value=>change({[SETTING]:{newValue:value}},'local'),
    jump:ms=>{now+=ms;},wake:()=>wake({action:'oraforge_activity_tick'},{id:'fixture'},()=>{}),
    mode:value=>change({[MODE]:{newValue:value}},'local'),
    effects:()=>({requests,clicks,submits}),close:()=>{controller.stop();dom.window.close();}};
}
test('scroll experiment is off by default and does not run on sign-in, OTP, expired or unknown screens',async()=>{
  const h=await harness();await h.advance(INTERVAL*3);assert.deepEqual(h.scrolls,[]);
  const w=h.win;
  w.document.body.innerHTML='<h1>Sign in</h1><input type="password">';assert.equal(sessionState(w),'logged_out');
  w.document.body.innerHTML='<h1>Enter code</h1><input autocomplete="one-time-code">';assert.equal(sessionState(w),'logged_out');
  w.document.body.innerHTML='<h1>Session expired</h1>'+html;assert.equal(sessionState(w),'logged_out');
  w.document.body.innerHTML='<h1>Loading</h1>';assert.equal(sessionState(w),'unknown');
  w.history.replaceState({},'', '/logout');w.document.body.innerHTML=html;assert.equal(sessionState(w),'logged_out');
  h.close();
});
test('every 60 seconds scrolls by 12px, holds briefly, and restores position without changing form, focus or issuing requests',async()=>{
  const h=await harness(true),w=h.win;
  w.scrollY=100;w.document.querySelector('textarea').focus();
  const form=w.document.querySelector('form').outerHTML,focused=w.document.activeElement;
  await h.advance(59999);assert.equal(h.scrolls.length,0);
  await h.advance(1);assert.deepEqual(h.scrolls,[[0,112]]);
  await h.advance(220);assert.deepEqual(h.scrolls,[[0,112],[0,100]]);
  assert.equal(w.document.querySelector('form').outerHTML,form);assert.equal(w.document.activeElement,focused);
  assert.deepEqual(h.effects(),{requests:0,clicks:0,submits:0});
  const log=h.logs.find(l=>l.event==='scroll_cycle');assert.equal(log.delta,12);assert.equal(log.restored,true);assert.equal(log.cycles,1);
  assert.equal(log.target,'page');assert.equal(log.event_observed,false);
  await h.advance(INTERVAL);assert.equal(h.logs.filter(l=>l.event==='scroll_cycle').length,2);
  w.scrollY=1200;await h.advance(INTERVAL);assert.deepEqual(h.scrolls.slice(-2),[[0,1188],[0,1200]]);
  h.close();
});
test('turning off cancels future ticks and logging out stops even with the toggle still on',async()=>{
  const h=await harness(true);
  await h.advance(INTERVAL+220);h.enable(false);await h.advance(INTERVAL*2);
  assert.equal(h.logs.filter(l=>l.event==='scroll_cycle').length,1);
  h.enable(true);await h.advance(INTERVAL+220);assert.equal(h.logs.filter(l=>l.event==='scroll_cycle').length,2);
  h.win.document.body.innerHTML='<h1>Verify your OTP</h1><input autocomplete="one-time-code">';
  await Promise.resolve();await h.advance(200);await h.advance(INTERVAL*3);
  assert.equal(h.logs.filter(l=>l.event==='scroll_cycle').length,2);assert.ok(h.logs.some(l=>l.event==='logged_out' && l.enabled));
  h.win.document.body.innerHTML=html;await Promise.resolve();await h.advance(200);await h.advance(INTERVAL+220);
  assert.equal(h.logs.filter(l=>l.event==='scroll_cycle').length,3);
  h.close();
});
test('scrolling pauses for item dialogs, active dropdowns, recent cashier activity and offline pages',async()=>{
  const h=await harness(true),w=h.win;
  w.document.body.insertAdjacentHTML('beforeend','<div role="dialog">Add item details</div>');
  await h.advance(INTERVAL);assert.equal(h.logs.at(-1).reason,'popup_or_dropdown_open');
  w.document.querySelector('[role=dialog]').remove();
  w.document.body.insertAdjacentHTML('beforeend','<div class="absolute"><input type="search"></div>');
  await h.advance(INTERVAL);assert.equal(h.logs.at(-1).reason,'popup_or_dropdown_open');
  w.document.querySelector('input[type=search]').parentElement.hidden=true;
  await h.advance(INTERVAL-1000);h.listeners.get('keydown')({isTrusted:true});await h.advance(1000);
  assert.equal(h.logs.at(-1).reason,'cashier_active');
  Object.defineProperty(w.navigator,'onLine',{value:false,configurable:true});
  await h.advance(INTERVAL);assert.equal(h.logs.at(-1).reason,'offline');
  Object.defineProperty(w.navigator,'onLine',{value:true,configurable:true});
  await h.advance(INTERVAL+220);assert.equal(h.logs.at(-1).event,'scroll_cycle');
  w.document.body.insertAdjacentHTML('beforeend','<input type="search" placeholder="Persistent invoice-list search">');
  await h.advance(INTERVAL);assert.equal(h.logs.at(-1).event,'scroll_cycle');
  h.close();
});
test('a page without a scroll range reports a skipped experiment instead of claiming activity',async()=>{
  const h=await harness(true,800);await h.advance(INTERVAL);
  assert.deepEqual(h.scrolls,[]);assert.equal(h.logs.at(-1).reason,'page_not_scrollable');h.close();
});

test('scrollable SPA container is used when the document cannot scroll',async()=>{
  const h=await harness(true,800), w=h.win;
  const scroller=w.document.createElement('main');
  scroller.style.overflowY='auto';
  scroller.innerHTML='<p>Invoice page content</p>';
  w.document.body.append(scroller);
  Object.defineProperties(scroller,{
    clientHeight:{value:400},scrollHeight:{value:900},
    getBoundingClientRect:{value:()=>({top:0,bottom:400,height:400,width:700})}
  });
  await h.advance(INTERVAL);
  assert.equal(scroller.scrollTop,12);
  await h.advance(220);
  assert.equal(scroller.scrollTop,0);
  const logged=h.logs.find(l=>l.event==='scroll_cycle');
  assert.equal(logged.target,'container');
  assert.equal(logged.delta,12);
  assert.equal(logged.restored,true);
  assert.deepEqual(h.effects(),{requests:0,clicks:0,submits:0});
  h.close();
});


test('mouse activity bubbles to portal document/window listeners on non-scrollable pages without modifying the form',async()=>{
  const h=await harness(true,800,'mouse'),w=h.win;
  const observed=[];
  w.document.addEventListener('mousemove',e=>observed.push({trusted:e.isTrusted,x:e.clientX}));
  const form=w.document.querySelector('form').outerHTML;
  w.document.querySelector('textarea').focus();const focus=w.document.activeElement;
  // An open item dialog prevents scrolling but should not block neutral mouse activity.
  w.document.body.insertAdjacentHTML('beforeend','<div role="dialog"><input value="unchanged"></div>');
  await h.advance(INTERVAL);
  assert.deepEqual(observed,[{trusted:false,x:1},{trusted:false,x:2}]);
  assert.equal(h.logs.at(-1).event,'mouse_cycle');
  assert.equal(h.logs.at(-1).session_evidence,'page_only');
  assert.equal(w.document.activeElement,focus);assert.equal(w.document.querySelector('form').outerHTML,form);
  assert.deepEqual(h.scrolls,[]);assert.deepEqual(h.effects(),{requests:0,clicks:0,submits:0});
  h.wake();assert.equal(observed.length,2,'background alarm must not double-fire the cycle');
  h.enable(false);await h.advance(INTERVAL);h.wake();assert.equal(observed.length,2);
  h.close();
});
test('mouse mode can be changed to scroll and stops at detected logout',async()=>{
  const h=await harness(true,2000,'mouse');
  await h.advance(INTERVAL);assert.equal(h.logs.at(-1).event,'mouse_cycle');
  h.mode('scroll');await h.advance(INTERVAL+220);assert.equal(h.logs.at(-1).event,'scroll_cycle');
  h.mode('mouse');h.win.document.body.innerHTML='<h1>Session expired</h1>';
  h.wake();await h.advance(INTERVAL*2);
  assert.equal(h.logs.filter(e=>e.event==='mouse_cycle').length,1);
  h.close();
});

test('background alarm runs activity when page timers are delayed and reports the gap',async()=>{
  const h=await harness(true,800,'mouse');
  await h.advance(INTERVAL);
  h.jump(180000);h.wake();
  assert.equal(h.logs.filter(e=>e.event==='mouse_cycle').length,2);
  assert.equal(h.logs.at(-1).source,'background_alarm');
  assert.equal(h.logs.find(e=>e.event==='timer_delayed').gap_ms,180000);
  h.wake();assert.equal(h.logs.filter(e=>e.event==='mouse_cycle').length,2);
  h.close();
});
