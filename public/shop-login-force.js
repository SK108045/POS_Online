(() => {
  function forceRegisteredLogin() {
    if (localStorage.getItem('pos_logged_in') === 'true') return;
    const current = document.querySelector('#posLoginScreen');
    if (current && current.querySelector('#registerNewShopBtn')) return;
    if (typeof showLoginScreen === 'function' && window.OraforgeShops) {
      try { showLoginScreen(); } catch (err) { console.error('Registered shop login sync failed', err); }
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    forceRegisteredLogin();
    setTimeout(forceRegisteredLogin, 100);
    setTimeout(forceRegisteredLogin, 500);
    setTimeout(forceRegisteredLogin, 1200);
  });
})();
