const editor=document.getElementById('selectors'), status=document.getElementById('status');
chrome.storage.local.get(['portalSelectors','portalUrls']).then(data=>{
  editor.value=JSON.stringify(data.portalSelectors || {},null,2);
  document.getElementById('create-url').value=data.portalUrls?.create || '';
  document.getElementById('list-url').value=data.portalUrls?.list || '';
});
document.getElementById('save').onclick=async()=>{
  try {
    const config=JSON.parse(editor.value);
    if (!config || Array.isArray(config) || typeof config!=='object') throw Error('Enter a JSON object.');
    for (const value of Object.values(config)) {if (typeof value!=='string' || value.length>1000) throw Error('Selectors must be strings.');document.querySelector(value);}
    const portalUrls={};
    for (const key of ['create','list']) {
      const input=document.getElementById(key+'-url').value.trim();
      if (input) {
        const url=new URL(globalThis.OraforgeKraSites.destination(input));
        if ([...url.searchParams.keys()].some(k=>/token|code|secret|password|session/i.test(k))) throw Error('Use an invoice URL without authentication tokens.');
        portalUrls[key]=url.href;
      }
    }
    await chrome.storage.local.set({portalSelectors:config,portalUrls});status.textContent='Saved. Reload the linked KRA popup to apply field mappings. URLs apply to new popup windows.';
  } catch(error) {status.textContent=error.message;}
};
