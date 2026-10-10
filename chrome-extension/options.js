const editor=document.getElementById('selectors'), status=document.getElementById('status');
chrome.storage.local.get('portalSelectors').then(data=>editor.value=JSON.stringify(data.portalSelectors || {},null,2));
document.getElementById('save').onclick=async()=>{
  try {
    const config=JSON.parse(editor.value);
    if (!config || Array.isArray(config) || typeof config!=='object') throw Error('Enter a JSON object.');
    for (const value of Object.values(config)) {if (typeof value!=='string' || value.length>1000) throw Error('Selectors must be strings.');document.querySelector(value);}
    await chrome.storage.local.set({portalSelectors:config});status.textContent='Saved. Reload the KRA popup to apply.';
  } catch(error) {status.textContent=error.message;}
};
