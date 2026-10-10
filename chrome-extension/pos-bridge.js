(() => {
  const channel = 'oraforge-etims-v1';
  const actions = new Set(['ping','start','recover','results','ack','recorded','checked_absent']);
  window.addEventListener('message', async event => {
    const m = event.data;
    if (event.source !== window || event.origin !== location.origin || m?.channel !== channel || m.direction !== 'pos' || !actions.has(m.action) || typeof m.request_id !== 'string') return;
    let response;
    try { response = await chrome.runtime.sendMessage({role:'pos', action:m.action, data:m.data}); }
    catch (_) { response = {error:'Reload the POS page after installing or updating the eTIMS extension.'}; }
    window.postMessage({channel, direction:'extension', request_id:m.request_id, ...response}, location.origin);
  });
  chrome.runtime.onMessage.addListener(message => {
    if (message.action === 'result_available') window.postMessage({channel,direction:'extension',action:'result_available'},location.origin);
  });
})();
