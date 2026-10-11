'use strict';
const setting='oraforgeScrollKeepAliveEnabled', logKey='oraforgeScrollKeepAliveLog';
const toggle=document.getElementById('keepalive-toggle'), keepaliveStatus=document.getElementById('keepalive-status');
const logView=document.getElementById('keepalive-log');
const modeKey='oraforgeKeepAliveMode', modeSelect=document.getElementById('keepalive-mode');
let logEntries=[];
function renderActivityStatus() {keepaliveStatus.textContent=toggle.checked?'ON · '+(modeSelect.value==='scroll'?'Scroll':'Mouse activity')+' every 60 seconds. Session renewal is unverified.':'OFF · Automatic activity is disabled.';}
function render(data) {
  if (Object.hasOwn(data,setting)) {
    toggle.checked=data[setting]===true;toggle.disabled=false;
    renderActivityStatus();
  }
  if (Object.hasOwn(data,modeKey)) {modeSelect.value=data[modeKey]==='scroll'?'scroll':'mouse';modeSelect.disabled=false;renderActivityStatus();}
  if (Object.hasOwn(data,logKey)) {
    logEntries=Array.isArray(data[logKey])?data[logKey]:[];
    if (logView) logView.textContent=logEntries.slice(-30).reverse().map(entry=>{
      const details=[entry.reason,entry.mode?`mode=${entry.mode}`:'',entry.event==='mouse_cycle'?'synthetic mousemove dispatched; renewal UNVERIFIED':'',entry.gap_ms?`timer gap=${Math.round(entry.gap_ms/1000)}s`:'',entry.source,entry.event==='scroll_cycle'?`target=${entry.target||'unknown'}; delta=${entry.delta}px; event seen=${entry.event_observed===true}; restored=${entry.restored}`:'',`observed=${Math.round(entry.observed_ms/1000)}s; cycles=${entry.cycles}`,`toggle=${entry.enabled?'ON':'OFF'}; ${entry.visible?'visible':'background'}`].filter(Boolean).join(' · ');
      return `${entry.at} · tab ${entry.tab_id} · ${entry.origin}\n${entry.event} · ${details}`;
    }).join('\n\n') || 'No activity yet.';
  }
}
chrome.storage.local.get([setting,logKey,modeKey]).then(data=>render({[setting]:false,[logKey]:[],[modeKey]:'mouse',...data})).catch(()=>{keepaliveStatus.textContent='Could not read settings. Reload the extension.';});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==='local')render(Object.fromEntries(Object.entries(changes).map(([key,value])=>[key,value.newValue])));
});
modeSelect.onchange=async()=>{
  modeSelect.disabled=true;
  try {await chrome.storage.local.set({[modeKey]:modeSelect.value});renderActivityStatus();}
  catch (_) {keepaliveStatus.textContent='Could not save activity mode.';}
  finally {modeSelect.disabled=false;}
};
toggle.onchange=async()=>{
  toggle.disabled=true;
  try {await chrome.storage.local.set({[setting]:toggle.checked});render({[setting]:toggle.checked});}
  catch (_) {keepaliveStatus.textContent='Could not save. Reload the extension.';toggle.disabled=false;}
};
document.getElementById('clear-log')?.addEventListener('click',async()=>{
  try {await chrome.storage.local.set({[logKey]:[]});} catch (_) {keepaliveStatus.textContent='Could not clear logs.';}
});
document.getElementById('download-log')?.addEventListener('click',()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify({experiment:'synthetic activity; session renewal unverified',interval_ms:60000,entries:logEntries},null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='oraforge-activity-experiment.json';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});

