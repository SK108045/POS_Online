/* All attempts survive service-worker suspension. No credentials are stored. */
'use strict';
importScripts('portal-sites.js');
const sites = globalThis.OraforgeKraSites;
const STORE = 'oraforgeJobsV1';
let serial = Promise.resolve();
const jobs = async () => (await chrome.storage.local.get(STORE))[STORE] || {};
const key = (origin, id) => JSON.stringify([origin,id]);
const isPos = sender => { try { const u = new URL(sender.url); return ['localhost','127.0.0.1'].includes(u.hostname) && u.protocol==='http:' && sender.frameId===0; } catch (_) { return false; } };
const isPortal = sender => sites.allowed(sender.url) && sender.frameId===0;
async function validRecord(r) {
  if (!r || typeof r.id!=='string' || !/^[a-f0-9]{64}$/.test(r.digest) || !r.snapshot || r.snapshot.currency!=='KES' || !Number.isSafeInteger(r.snapshot.total_cents) || r.snapshot.total_cents<0 || !Array.isArray(r.snapshot.items) || r.snapshot.items.length>500) throw Error('Invalid POS invoice request.');
  const p=r.snapshot, amount=v=>Number.isSafeInteger(v) && v>=0;
  if (r.id!==JSON.stringify([r.shop_id,Number(r.sale_id),String(r.receipt_no)]) || p.shop_id!==r.shop_id || p.sale_id!==r.sale_id || p.receipt_no!==r.receipt_no || !p.items.length ||
      !amount(p.subtotal_cents) || !amount(p.discount?.amount_cents) || !amount(p.tax_cents) || p.tax_cents>p.total_cents ||
      p.items.some(i=>typeof i.name!=='string' || !i.name || !Number.isFinite(i.quantity) || i.quantity<=0 || !amount(i.unit_price_cents) || !amount(i.line_total_cents) || Math.round(i.quantity*i.unit_price_cents)!==i.line_total_cents) ||
      p.items.reduce((sum,i)=>sum+i.line_total_cents,0)!==p.subtotal_cents || p.subtotal_cents-p.discount.amount_cents!==p.total_cents) throw Error('POS sale amounts or identity do not reconcile.');
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(p)));
  const digest=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  if (digest!==r.digest) throw Error('POS sale snapshot changed.');
}
async function open(job, all, navigate=false, newPopup=false) {
  const settings = await chrome.storage.local.get('portalUrls');
  const urls = settings.portalUrls || {};
  const url = job.recovery ? sites.destination(urls.list, sites.list) : sites.destination(urls.create, sites.create);
  // Checkout opens a fresh, focused popup. Manual receipt selection can reuse
  // an unarmed popup, navigating when its receipt changes. Armed windows keep
  // their binding. Choosing a new window never bypasses attempt validation.
  const candidates = newPopup ? [] : [job,...Object.values(all).filter(j=>j!==job && j.origin===job.origin && j.tab_id && !j.revoked && !j.armed && !j.generated && !j.result)
    .sort((a,b)=>String(b.opened_at || b.created_at).localeCompare(String(a.opened_at || a.created_at)))];
  for (const candidate of candidates) {
    if (!candidate.tab_id) continue;
    try {
      const tab = await chrome.tabs.get(candidate.tab_id);
      if (!sites.allowed(tab.url)) continue;
      if (Object.values(all).some(j=>j!==candidate && j!==job && j.tab_id===tab.id && !j.revoked && (j.armed || j.generated || j.result))) continue;
      const fresh = candidate!==job || navigate || Object.values(all).some(j=>j!==job && j.tab_id===tab.id && !j.revoked);
      if (fresh) await chrome.tabs.sendMessage(tab.id,{action:'detached'}).catch(()=>{});
      for (const other of Object.values(all)) if (other!==job && other.tab_id===tab.id) {other.tab_id=null;other.window_id=null;}
      job.tab_id=tab.id;job.window_id=tab.windowId;
      await chrome.storage.local.set({[STORE]:all});
      await chrome.windows.update(tab.windowId,{focused:true});
      if (fresh) await chrome.tabs.update(tab.id,{url,active:true});
      else {
        await chrome.tabs.update(tab.id,{active:true});
        // An extension reload/network error may leave no live content script.
        try { await chrome.tabs.sendMessage(tab.id,{action:'reload_job'}); }
        catch (_) { await chrome.tabs.update(tab.id,{url:tab.url,active:true}); }
      }
      return;
    } catch (_) { /* A closed popup can be reopened from its saved snapshot. */ }
  }
  const popup = await chrome.windows.create({url,type:'popup',width:820,height:600,focused:true});
  job.tab_id = popup.tabs[0].id; job.window_id = popup.id;
  for (const other of Object.values(all)) if (other!==job && other.tab_id===job.tab_id) {other.tab_id=null;other.window_id=null;}
}
async function handle(m, sender) {
  const data = m.data || {};
  if (m.role==='scroll_keepalive') {
    if (!isPortal(sender)) throw Error('Untrusted scroll experiment message.');
    if (m.action==='open_logs') {
      await chrome.tabs.create({url:chrome.runtime.getURL('keepalive.html'),active:true});
      return {opened:true};
    }
    if (m.action!=='log') throw Error('Unsupported scroll experiment action.');
    const events=['enabled','disabled','session_detected','logged_out','waiting_for_login','scroll_cycle','skipped','scroll_error','page_left','mouse_cycle','timer_delayed','activity_error'];
    const reasons=['offline','cashier_active','popup_or_dropdown_open','page_not_scrollable','scroll_not_moved','scroll_failed','cashier_moved_scroll','page_not_ready','dispatch_failed'];
    if (!events.includes(data.event) || (data.reason && !reasons.includes(data.reason))) throw Error('Invalid scroll experiment event.');
    const count=value=>Number.isSafeInteger(value) && value>=0 ? Math.min(value,Number.MAX_SAFE_INTEGER) : 0;
    // Whitelist metadata only: never retain URL paths, form values or credentials.
    const entry={at:new Date().toISOString(),origin:new URL(sender.url).origin,tab_id:sender.tab.id,
      page_id:/^[a-f0-9-]{36}$/i.test(data.page_id || '')?data.page_id:'',event:data.event,
      enabled:data.enabled===true,visible:data.visible===true,observed_ms:count(data.observed_ms),cycles:count(data.cycles)};
    entry.mode=['mouse','scroll','both'].includes(data.mode)?data.mode:'mouse';
    entry.session_evidence='page_only';
    if (['page_timer','background_alarm'].includes(data.source)) entry.source=data.source;
    if (data.event==='mouse_cycle') entry.synthetic=true;
    if (data.event==='timer_delayed') entry.gap_ms=count(data.gap_ms);
    if (data.reason) entry.reason=data.reason;
    if (data.event==='scroll_cycle' || data.event==='scroll_error') {entry.delta=Number.isFinite(data.delta)?Math.max(-12,Math.min(12,data.delta)):0;entry.restored=data.restored===true;entry.target=['page','container'].includes(data.target)?data.target:'unknown';entry.event_observed=data.event_observed===true;}
    const logKey='oraforgeScrollKeepAliveLog', saved=(await chrome.storage.local.get(logKey))[logKey];
    await chrome.storage.local.set({[logKey]:[...(Array.isArray(saved)?saved:[]).slice(-199),entry]});
    return {logged:true};
  }
  const all = await jobs();
  if (m.role === 'pos') {
    if (!isPos(sender)) throw Error('This POS origin is not permitted.');
    const origin = new URL(sender.url).origin;
    if (m.action==='ping') return {version:1};
    if (m.action==='results') return Object.values(all).filter(j=>{
      const known=data.known?.[j.record.id];
      return j.origin===origin && j.result && (!Array.isArray(data.ids) || data.ids.includes(j.record.id)) &&
        (!known || known.cu!==j.result.cu_invoice_number || known.digest!==j.record.digest || known.attempt_id!==j.record.attempt_id);
    }).slice(0,25).map(j=>({id:j.record.id,attempt_id:j.record.attempt_id,digest:j.record.digest,total_cents:j.record.snapshot.total_cents,fiscal:j.result}));
    const id = data.record?.id || data.id, k = key(origin,id), previous = all[k];
    if (['start','resume','recover','recorded'].includes(m.action)) await validRecord(data.record);
    if (['start','resume','recover'].includes(m.action)) {
      const r=data.record;
      if (!r.attempt_id || r.status!=='review_required') throw Error('POS must claim the invoice before opening KRA.');
      if (previous?.generated || previous?.result || r.fiscal?.cu_invoice_number) throw Error('An invoice is already recorded. Duplicate generation is blocked; refresh the POS.');
      if (previous && previous.record.attempt_id !== r.attempt_id && !previous.revoked) throw Error('Check the previous invoice attempt before retrying.');
      if (previous && !previous.revoked && previous.record.digest!==r.digest) throw Error('The saved POS sale differs from this attempt.');
      if (m.action==='start' && previous && !previous.revoked) throw Error('This attempt is already open. Use Check existing invoice.');
      if (m.action==='resume' && (!previous || previous.revoked || previous.armed || previous.resume_allowed===false)) throw Error('This attempt cannot safely resume filling. Check existing KRA invoices, then use Checked: no invoice issued if none was issued.');
      const job = previous && !previous.revoked ? previous : {origin,record:r,created_at:new Date().toISOString()};
      const modeChanged=!!job.recovery !== (m.action==='recover');
      // Existing unarmed jobs from older extension versions remain resumable.
      // A recovery job created without the original worker record is uncertain.
      job.resume_allowed=m.action==='start' || (!!previous && !previous.revoked && previous.resume_allowed!==false && !previous.armed);
      job.pos_tab_id=sender.tab.id; job.recovery = m.action==='recover';
      job.opened_at=new Date().toISOString();
      // Save uncertainty BEFORE creating the popup, including if Chrome crashes here.
      all[k]=job; await chrome.storage.local.set({[STORE]:all});
      await open(job,all,modeChanged,m.action==='start' && data.new_popup===true); await chrome.storage.local.set({[STORE]:all});
      return {opened:true,receipt_no:r.receipt_no,mode:job.recovery?'recovery':'fill'};
    }
    if (m.action==='ack') {
      if (previous?.record.attempt_id===data.attempt_id) {previous.ack=true; await chrome.storage.local.set({[STORE]:all});}
      return {saved:true};
    }
    if (m.action==='recorded') {
      if (!data.record.fiscal?.cu_invoice_number) throw Error('Missing CU Invoice Number.');
      all[k] = {...previous,origin,record:data.record,generated:true,revoked:true};
      await chrome.storage.local.set({[STORE]:all});
      if (previous?.tab_id) await chrome.tabs.sendMessage(previous.tab_id,{action:'revoked'}).catch(()=>{});
      return {saved:true};
    }
    if (m.action==='checked_absent') {
      if (!previous || previous.record.attempt_id!==data.attempt_id || previous.generated || previous.result) throw Error('Cannot reset this attempt. Refresh and check the existing KRA invoice.');
      if (!String(data.reason||'').trim()) throw Error('Describe the existing invoice check.');
      // Close the original tab so a stale, already-filled form cannot still issue.
      if (previous.tab_id) {
        try { await chrome.tabs.get(previous.tab_id); }
        catch (_) { previous.tab_id=null; }
        if (previous.tab_id) await chrome.tabs.remove(previous.tab_id);
      }
      previous.revoked=true; previous.checked_absent={at:new Date().toISOString(),reason:String(data.reason).slice(0,500)};
      await chrome.storage.local.set({[STORE]:all}); return {reset:true};
    }
    throw Error('Unsupported POS action.');
  }
  if (m.role !== 'portal' || !isPortal(sender)) throw Error('Untrusted portal message.');
  const bound = Object.values(all).filter(j=>j.tab_id===sender.tab.id && !j.revoked);
  if (bound.length>1) throw Error('This popup has conflicting sale bindings. Select the receipt in Oraforge and reopen it.');
  const job = bound[0];
  if (m.action==='job') {
    const config=(await chrome.storage.local.get('portalSelectors')).portalSelectors || {};
    return job ? {record:job.record,recovery:job.recovery,can_resume:!!job.resume_allowed && !job.armed,armed:!!job.armed,generated:!!(job.generated || job.result),config} : null;
  }
  if (!job || data.attempt_id!==job.record.attempt_id || data.digest!==job.record.digest) throw Error('No matching active POS sale in this popup.');
  if (m.action==='arm') {
    if (job.recovery || job.armed || job.result || job.generated) throw Error('Check existing invoices before any new generation.');
    if (data.total_cents!==job.record.snapshot.total_cents || data.receipt_no!==job.record.receipt_no) throw Error('Portal total or POS reference does not match.');
    job.armed=true; job.confirmed_at=new Date().toISOString();
    await chrome.storage.local.set({[STORE]:all}); return {armed:true};
  }
  if (m.action==='capture') {
    const f=data.fiscal;
    if ((!job.armed && !job.recovery) || !f?.cu_invoice_number || !f.scu_id || !f.receipt_signature || !f.qr_image || !f.invoice_number || !f.invoice_date || data.total_cents!==job.record.snapshot.total_cents || data.receipt_no!==job.record.receipt_no) throw Error('Official invoice is incomplete or does not match the POS sale.');
    if (['cu_invoice_number','scu_id','receipt_signature','invoice_number','invoice_date'].some(k=>typeof f[k]!=='string' || f[k].length>160 || /[\u0000-\u001f]/.test(f[k])) ||
        !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(f.qr_image) || f.qr_image.length>500000) throw Error('Invalid official invoice fields or QR image.');
    if (job.result && JSON.stringify(job.result)!==JSON.stringify(f)) throw Error('A different invoice is already captured.');
    if (Object.values(all).some(j=>j!==job && j.origin===job.origin && (j.result?.cu_invoice_number || j.record.fiscal?.cu_invoice_number)?.toUpperCase()===f.cu_invoice_number.toUpperCase())) throw Error('This CU is already linked to another sale.');
    job.result=f; job.generated=true; job.ack=false; job.captured_at=new Date().toISOString();
    await chrome.storage.local.set({[STORE]:all});
    if (job.pos_tab_id) await chrome.tabs.sendMessage(job.pos_tab_id,{action:'result_available'}).catch(()=>{});
    return {captured:true};
  }
  throw Error('Unsupported portal action.');
}
chrome.runtime.onMessage.addListener((message,sender,reply) => {
  serial=serial.then(()=>handle(message,sender)).then(result=>reply({result})).catch(error=>reply({error:error.message}));
  return true;
});
// Clicking Options never triggers invoice submission or requests authentication.


// Alarms wake the worker when a background page's JS timer runs late.
// They cannot wake a sleeping computer or revive a discarded/logged-out tab.
const ACTIVITY_ALARM='oraforge_activity_tick';
let alarmSerial=Promise.resolve();
function syncActivityAlarm() {
  alarmSerial=alarmSerial.catch(()=>{}).then(async()=>{
    const settings=await chrome.storage.local.get('oraforgeScrollKeepAliveEnabled');
    if (settings.oraforgeScrollKeepAliveEnabled!==true) {
      await chrome.alarms.clear(ACTIVITY_ALARM);return;
    }
    if (!await chrome.alarms.get(ACTIVITY_ALARM)) {
      await chrome.alarms.create(ACTIVITY_ALARM,{periodInMinutes:1});
    }
  });
  return alarmSerial;
}
chrome.alarms.onAlarm.addListener(async alarm=>{
  if (alarm.name!==ACTIVITY_ALARM) return;
  const settings=await chrome.storage.local.get('oraforgeScrollKeepAliveEnabled');
  if (settings.oraforgeScrollKeepAliveEnabled!==true) return;
  const tabs=await chrome.tabs.query({url:[
    'https://ecitizen.kra.go.ke/*','https://kra.ecitizen.go.ke/*','https://etims.kra.go.ke/*'
  ]});
  await Promise.allSettled(tabs.filter(tab=>!tab.discarded && sites.allowed(tab.url)).map(tab=>
    chrome.tabs.sendMessage(tab.id,{action:ACTIVITY_ALARM},{frameId:0})
  ));
});
chrome.storage.onChanged.addListener((changes,area)=>{
  if (area==='local' && changes.oraforgeScrollKeepAliveEnabled) syncActivityAlarm().catch(()=>{});
});
syncActivityAlarm().catch(()=>{});
