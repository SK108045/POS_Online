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
  function create(win, chrome) {
    let enabled=false, auth='unknown', timer=null, observer, debounce=null, stopped=false, started=false;
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
      timer=null;checkSession();
      if (stopped || !enabled || auth!=='authenticated') return;
      if (win.navigator.onLine===false) {log('skipped',{reason:'offline'});return;}
      if (Date.now()-lastActivity<5000) {log('skipped',{reason:'cashier_active'});return;}
      const openControls=win.document.querySelectorAll('[role=dialog], dialog[open], [role=listbox], [role=menu], [role=combobox][aria-expanded=true], .absolute input[type=search]');
      if ([...openControls].some(el=>visible(win,el))) {log('skipped',{reason:'popup_or_dropdown_open'});return;}
      const scroller=win.document.scrollingElement;
      const max=scroller ? scroller.scrollHeight-scroller.clientHeight : 0;
      if (max<=0) {log('skipped',{reason:'page_not_scrollable'});return;}
      const x=win.scrollX, y=win.scrollY, target=y<max ? Math.min(y+2,max) : Math.max(y-2,0);
      let delta=0, restored=false;
      try {
        // Both operations run in the same task, without animation or focus changes.
        // At the bottom, move up then return instead of attempting a clamped down.
        try { win.scrollTo({left:x,top:target,behavior:'instant'});delta=win.scrollY-y; }
        finally { win.scrollTo({left:x,top:y,behavior:'instant'}); }
        restored=win.scrollX===x && win.scrollY===y;
        cycles++;log('scroll_cycle',{delta,restored});
      } catch (_) { log('scroll_error',{reason:'scroll_failed',restored}); }
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
