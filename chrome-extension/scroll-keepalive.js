/* Scroll-only experiment. No credentials, form writes, clicks or network calls. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (root.window === root.top && root.OraforgeKraSites?.allowed(root.location.href)) {
    api.create(root, root.chrome).start();
    root.addEventListener('pageshow',event=>{if(event.persisted)api.create(root, root.chrome).start();});
  }
})(globalThis, function () {
  'use strict';
  const SETTING = 'oraforgeScrollKeepAliveEnabled', INTERVAL = 60000;
  function visible(win, el) {
    if (!el?.isConnected) return false;
    for (let node=el; node?.nodeType===1; node=node.parentElement) {
      if (node.hidden || node.hasAttribute('inert') || node.getAttribute('aria-hidden')==='true') return false;
      const style=win.getComputedStyle(node);
      if (style.display==='none' || style.visibility==='hidden') return false;
    }
    return true;
  }
  function sessionState(win) {
    const doc=win.document;
    if (/(^|\/)(login|logout|sign-in|signin|otp|verify-otp)(\/|$)/i.test(win.location.pathname)) return 'logged_out';
    if ([...doc.querySelectorAll('input[type=password], input[autocomplete=one-time-code]')].some(el=>visible(win,el))) return 'logged_out';
    const headings=[...doc.querySelectorAll('h1,h2,h3,[role=alert]')].filter(el=>visible(win,el));
    if (headings.some(el=>/\b(sign in|log in|one.time password|session (?:has )?expired|session timed out|logged out|verify (?:your )?otp)\b/i.test(el.textContent))) return 'logged_out';
    // The supplied KRA TopNav contains this exact accessible user-menu label.
    if ([...doc.querySelectorAll('button[aria-label="Open user menu"], button .sr-only')].some(el=>visible(win,el) && (el.getAttribute('aria-label')==='Open user menu' || el.textContent.trim()==='Open user menu'))) return 'authenticated';
    // Invoice controls are also evidence when a compact layout hides TopNav.
    if (headings.some(el=>/^create sales invoice$/i.test(el.textContent.trim())) &&
        [...doc.querySelectorAll('input[type=email]')].some(el=>visible(win,el)) &&
        [...doc.querySelectorAll('button')].some(el=>visible(win,el) && /^add item$/i.test(el.textContent.trim()))) return 'authenticated';
    return 'unknown';
  }
  // Prefer the document, but modern SPA pages often scroll inside an overflow container.
  // Never scroll an input, a modal or the companion controls.
  function scrollTarget(win) {
    const doc=win.document, root=doc.scrollingElement;
    const rootMax=root ? Math.max(0,root.scrollHeight-root.clientHeight) : 0;
    if (rootMax>=4) return {
      kind:'page', max:rootMax, read:()=>win.scrollY,
      move:y=>win.scrollTo({left:win.scrollX,top:y,behavior:'instant'})
    };
    let best=null, bestArea=0;
    for (const el of doc.querySelectorAll('main, [role="main"], section, div')) {
      if (el.closest('[data-oraforge-companion]') || el.clientHeight<120 ||
          el.scrollHeight-el.clientHeight<4 || !visible(win,el)) continue;
      const style=win.getComputedStyle(el);
      if (!/^(auto|scroll|overlay)$/.test(style.overflowY)) continue;
      const rect=el.getBoundingClientRect();
      if (rect.height<100 || rect.width<120 || rect.bottom<=0 || rect.top>=win.innerHeight) continue;
      const area=Math.min(rect.height,win.innerHeight)*Math.min(rect.width,win.innerWidth);
      if (area>bestArea) {
        bestArea=area;
        best={kind:'container',max:el.scrollHeight-el.clientHeight,
          read:()=>el.scrollTop,move:y=>{el.scrollTop=y;}};
      }
    }
    return best;
  }
  function create(win, chrome) {
    let enabled=false, auth='unknown', timer=null, restoreTimer=null, restorePending=null, observer, debounce=null, stopped=false, started=false;
    let observedAt=0, cycles=0, lastActivity=-Infinity, settingRevision=0;
    const pageId=win.crypto.randomUUID();
    function log(event, detail={}) {
      const data={event, enabled, page_id:pageId, visible:!win.document.hidden,
        observed_ms:observedAt ? Math.max(0,Date.now()-observedAt) : 0, cycles, ...detail};
      win.console.info('[Oraforge scroll experiment]', event, data);
      try {
        Promise.resolve(chrome.runtime.sendMessage({role:'scroll_keepalive',action:'log',data})).then(response=>{
          if (response?.error) stop();
        }).catch(()=>stop());
      } catch (_) { stop(); }
    }
    function cancelTimer() { if (timer!==null) win.clearTimeout(timer); timer=null; }
    function schedule() {
      if (!stopped && enabled && auth==='authenticated' && timer===null) timer=win.setTimeout(tick,INTERVAL);
    }
    function checkSession() {
      if (stopped) return;
      const next=sessionState(win);
      if (next!==auth) {
        auth=next;
        if (next==='authenticated') { observedAt=Date.now();cycles=0;log('session_detected'); }
        else { log(next==='logged_out'?'logged_out':'waiting_for_login'); observedAt=0; }
      }
      if (!enabled || auth!=='authenticated') cancelTimer();
      else schedule();
    }
    function tick() {
      timer=null;
      checkSession(); // Also schedules the next 60-second check.
      if (stopped || !enabled || auth!=='authenticated') return;
      if (win.navigator.onLine===false) {log('skipped',{reason:'offline'});return;}
      if (Date.now()-lastActivity<5000) {log('skipped',{reason:'cashier_active'});return;}
      const openControls=win.document.querySelectorAll('[role=dialog], dialog[open], [role=listbox], [role=menu], [role=combobox][aria-expanded=true], .absolute input[type=search]');
      if ([...openControls].some(el=>visible(win,el))) {log('skipped',{reason:'popup_or_dropdown_open'});return;}
      const target=scrollTarget(win);
      if (!target) {log('skipped',{reason:'page_not_scrollable'});return;}

      const initial=target.read(), destination=initial<target.max
        ? Math.min(initial+12,target.max) : Math.max(initial-12,0);
      let moved=0, eventObserved=false;
      const onScroll=()=>{eventObserved=true;};
      win.addEventListener('scroll',onScroll,true);
      try {
        target.move(destination);
        moved=target.read()-initial;
        if (!moved) {
          win.removeEventListener('scroll',onScroll,true);
          log('skipped',{reason:'scroll_not_moved'});return;
        }
      } catch (_) {
        win.removeEventListener('scroll',onScroll,true);
        log('scroll_error',{reason:'scroll_failed',restored:false});return;
      }
      // IMPORTANT: do not reverse the scroll in the same JS task. Browsers
      // coalesce scroll events and can discard the down-and-back completely.
      // Keep the tiny displacement for 220ms so it is observable, then restore.
      restorePending=()=>{
        win.removeEventListener('scroll',onScroll,true);
        let restored=false, reason;
        try {
          // If a real user scrolled while waiting, leave their position alone.
          if (Math.abs(target.read()-(initial+moved))<=1) {
            target.move(initial);
            restored=Math.abs(target.read()-initial)<=1;
          } else reason='cashier_moved_scroll';
        } catch (_) {reason='scroll_failed';}
        cycles++;
        log('scroll_cycle',{delta:moved,restored,target:target.kind,event_observed:eventObserved,...(reason?{reason}:{})});
      };
      restoreTimer=win.setTimeout(()=>{
        restoreTimer=null;
        const restore=restorePending;restorePending=null;
        restore?.();
      },220);
    }
    function activity(event) { if (event.isTrusted) lastActivity=Date.now(); }
    const activityEvents=['pointerdown','keydown','input','wheel','touchstart'];
    function changed(changes, area) {
      if (area!=='local' || !changes[SETTING] || stopped) return;
      settingRevision++;
      enabled=changes[SETTING].newValue===true;
      log(enabled?'enabled':'disabled');checkSession();
    }
    function refresh() {
      if (debounce!==null) return;
      debounce=win.setTimeout(()=>{debounce=null;checkSession();},200);
    }
    function leave() { log('page_left');stop(); }
    function stop() {
      if (stopped) return;
      stopped=true;cancelTimer();win.clearTimeout(debounce);observer?.disconnect();
      if (restoreTimer!==null) win.clearTimeout(restoreTimer);
      restoreTimer=null;
      const restore=restorePending;restorePending=null;
      restore?.();
      chrome.storage.onChanged.removeListener(changed);
      activityEvents.forEach(type=>win.removeEventListener(type,activity,true));
      win.removeEventListener('popstate',refresh);win.removeEventListener('hashchange',refresh);
      win.removeEventListener('pagehide',leave);
    }
    async function start() {
      if (started || stopped) return;
      started=true;
      chrome.storage.onChanged.addListener(changed);
      activityEvents.forEach(type=>win.addEventListener(type,activity,{capture:true,passive:true}));
      win.addEventListener('popstate',refresh);win.addEventListener('hashchange',refresh);
      win.addEventListener('pagehide',leave);
      observer=new win.MutationObserver(refresh);
      observer.observe(win.document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','aria-hidden','inert','style','class']});
      try {
        const revision=settingRevision;
        const settings=await chrome.storage.local.get(SETTING);
        if (stopped) return;
        if (revision===settingRevision) enabled=settings[SETTING]===true;
        log(enabled?'enabled':'disabled');checkSession();
      } catch (_) { stop(); }
    }
    return {start,stop};
  }
  return {create,sessionState,INTERVAL,SETTING};
});
