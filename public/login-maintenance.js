/* Device maintenance dialogs for the registered-shop login screen. */
(() => {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const $ = id => document.getElementById(id);
  let modal=null;

  function close() {
    if (modal) modal.remove();
    modal=null;
  }
  function shell(heading,body) {
    close();
    modal=document.createElement('div');
    modal.className='shop-delete-overlay login-maintenance-overlay';
    modal.innerHTML='<div class="shop-delete-card login-maintenance-card" role="dialog" aria-modal="true">' +
      '<h2>'+esc(heading)+'</h2>'+body+'</div>';
    document.body.appendChild(modal);
    modal.addEventListener('click',e=>{if(e.target===modal)close()});
    return modal;
  }
  async function showShops() {
    const container=shell('Manage registered shops', '<p>Shops on this device only. Deleting a shop permanently removes its products, sales, customers and settings. Back up anything important first.</p>'+
      '<div id="maintenanceShopRows" class="maintenance-shop-rows"></div><p id="maintenanceNote" role="status"></p>'+
      '<button class="shop-delete-cancel" type="button" id="maintenanceExit">Close</button>');
    container.querySelector('#maintenanceExit').onclick=close;
    const rows=container.querySelector('#maintenanceShopRows');
    async function refresh() {
      const shops=await window.OraforgeShops.list();
      rows.innerHTML=shops.length?shops.map(shop=>
        '<div class="maintenance-shop-row"><span><strong>'+esc(shop.name)+'</strong><small>'+esc(shop.category_name||shop.business_type||'Shop')+
        '</small></span><button type="button" class="shop-delete-confirm" data-id="'+esc(shop.id)+'">Delete</button></div>'
      ).join(''):'<p>No shops are currently registered on this device.</p>';
    }
    rows.addEventListener('click',async event=>{
      const button=event.target.closest('button[data-id]');
      if(!button)return;
      const shop=(await window.OraforgeShops.list()).find(s=>s.id===button.dataset.id);
      if(!shop)return;
      if(!window.confirm('Permanently delete "'+shop.name+'" and all its local data? This cannot be undone.'))return;
      button.disabled=true;
      try {
        await window.OraforgeShops.deleteShopMaintenance(shop.id,'0713969647');
        // A deleted active shop must never remain selected for the next login.
        const selected=window.OraforgeShops.activeShopId();
        if(!selected) localStorage.removeItem('pos_logged_in');
        // Recreate the registered-shop chooser while keeping this maintenance
        // popup open, so the removed shop disappears from login immediately.
        if (typeof showLoginScreen === 'function') showLoginScreen();
        container.querySelector('#maintenanceNote').textContent=shop.name+' deleted. Other shops are unchanged.';
        await refresh();
      } catch(err) {
        container.querySelector('#maintenanceNote').textContent=err.message || 'Could not delete shop.';
      } finally {button.disabled=false;}
    });
    try {await refresh()}catch(err){rows.textContent=err.message || 'Could not load shops.'}
  }
  function showSwifta() {
    const node=shell('Update Swifta API key','<p>Paste the replacement key. Saving will overwrite the existing swifta.txt file on this POS computer and immediately use it for new M-Pesa STK requests.</p>'+
      '<form id="swiftaMaintenanceForm" autocomplete="off">'+
      '<label>New Swifta API key<input type="password" name="apiKey" required minlength="10" maxlength="256" autocomplete="new-password" placeholder="Paste new key"></label>'+
      '<p id="swiftaMaintenanceNote" role="status"></p>'+
      '<div class="shop-delete-actions"><button type="button" class="shop-delete-cancel" id="swiftaExit">Cancel</button>'+
      '<button type="submit" class="register-shop-link" id="swiftaSave">Save Key</button></div></form>');
    const form=node.querySelector('form'),button=form.querySelector('#swiftaSave'),note=form.querySelector('#swiftaMaintenanceNote');
    node.querySelector('#swiftaExit').onclick=close;
    form.onsubmit=async event=>{
      event.preventDefault();
      button.disabled=true;
      note.textContent='Saving on the local server…';
      try {
        const response=await fetch('/api/local/swifta-key',{
          method:'POST',cache:'no-store',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({apiKey:form.elements.apiKey.value})
        });
        const result=await response.json();
        if(!response.ok||!result.ok)throw Error(result.message || 'Key update failed.');
        form.elements.apiKey.value='';
        note.textContent='swifta.txt overwritten successfully. Future STK requests will use the new key.';
      }catch(err){note.textContent=err.message || 'Could not update Swifta key.'}
      finally{button.disabled=false}
    };
    form.elements.apiKey.focus();
  }
  function run(code) {
    if(code==='0713969647'){showShops();return true}
    if(code==='0788778450'){showSwifta();return true}
    return false;
  }
  const special=v=>v==='0713969647'||v==='0788778450';
  document.addEventListener('input',event=>{
    if(event.target?.id!=='loginPinInput'||!special(event.target.value))return;
    const code=event.target.value;
    event.target.value='';
    run(code);
  },true);
  document.addEventListener('click',event=>{
    const input=$('loginPinInput');
    if(!input||!event.target?.closest('#loginPinPad button'))return;
    const key=event.target.closest('button')?.dataset.key;
    if(key==='enter' && special(input.value)){
      event.preventDefault();event.stopImmediatePropagation();
      const code=input.value;input.value='';run(code);return;
    }
    if(key==='clear')return;
    // Keypad buttons set the value in their click handler; inspect it after.
    queueMicrotask(()=>{
      if(input.isConnected && special(input.value)){
        const code=input.value;input.value='';run(code);
      }
    });
  },true);
  document.addEventListener('keydown',event=>{
    const input=$('loginPinInput');
    if(event.key==='Enter'&&event.target===input&&special(input.value)){
      event.preventDefault();event.stopImmediatePropagation();
      const code=input.value;input.value='';run(code);
    }
    if(event.key==='Escape' && modal)close();
  },true);
})();
