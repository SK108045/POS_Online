(() => {
  if (!window.OraforgeShops || typeof LocalPOS === 'undefined') return;

  const demoProfiles = (typeof SHOP_PROFILES !== 'undefined' && Array.isArray(SHOP_PROFILES))
    ? SHOP_PROFILES
    : Object.values(window.OraforgeShops.PROFILE_META || {});

  const originalShopKey = LocalPOS.shopKey.bind(LocalPOS);
  const originalSwitchProfile = LocalPOS.switchProfile.bind(LocalPOS);

  LocalPOS.shopKey = function(name, btype = null) {
    if (window.OraforgeShops.activeShopId()) return window.OraforgeShops.key(name, btype);
    return originalShopKey(name, btype);
  };

  LocalPOS.switchProfile = async function(btype) {
    if (window.OraforgeShops.activeShopId()) {
      const type = (typeof LOCAL_PROFILES_DATA !== 'undefined' && LOCAL_PROFILES_DATA.profiles?.[btype]) ? btype : 'retail';
      localStorage.setItem('pos_active_business_type', type);
      return type;
    }
    return originalSwitchProfile(btype);
  };

  function profileForType(type, categoryName = '') {
    const p = demoProfiles.find(x => x.id === type) || window.OraforgeShops.PROFILE_META[type] || window.OraforgeShops.PROFILE_META.retail;
    if (!categoryName || categoryName === p.name) return p;
    return { ...p, name: categoryName, tagline: `${categoryName} POS` };
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  }

  function setThemeButton(btn) {
    if (!btn) return;
    const sync = () => {
      const theme = document.documentElement.getAttribute('data-theme') || 'light';
      btn.textContent = theme === 'dark' ? '☀️' : '🌙';
      btn.title = theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme';
    };
    sync();
    btn.onclick = () => {
      const next = (document.documentElement.getAttribute('data-theme') === 'dark') ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('pos_theme', next);
      sync();
    };
  }

  function showRegistrationScreen() {
    document.querySelector('#posLoginScreen')?.remove();
    document.querySelector('#shopRegistrationScreen')?.remove();

    const screen = document.createElement('div');
    screen.id = 'shopRegistrationScreen';
    screen.className = 'registration-screen login-body registration-body';
    screen.innerHTML = `
      <div class="registration-theme-toggle"><button id="registrationThemeToggle" class="theme-toggle-btn">☀️</button></div>
      <form class="login-panel registration-panel" id="localShopRegistrationForm" autocomplete="on">
        <button type="button" class="reg-back-link" id="registrationBackBtn">← Back to registered shops</button>
        <div>
          <h1>Register your shop</h1>
          <p>Set up an isolated workspace for your business with its own catalog, owner login and sales terminal.</p>
        </div>
        <div id="registrationError" class="form-alert-error" style="display:none"></div>

        <div class="form-section-title"><span>1. Business Details</span></div>
        <label class="form-label-group">
          <span class="label-text">Shop name</span>
          <input class="form-input" name="shop_name" required minlength="2" maxlength="80" autocomplete="organization" placeholder="e.g. Kamau’s Butchery, Glory Salon, City Supermarket">
        </label>
        <label class="form-label-group">
          <span class="label-text">Business category</span>
          <select class="form-select" name="business_type" id="registrationBusinessType" required>
            <option value="">Choose your business type</option>
            ${Object.values(window.OraforgeShops.PROFILE_META).map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
            <option value="custom">Custom Category / Other…</option>
          </select>
        </label>
        <div id="registrationCustomCategory" class="custom-category-box" style="display:none">
          <label class="form-label-group">
            <span class="label-text">Custom category name</span>
            <input class="form-input" name="custom_category" id="registrationCustomInput" maxlength="50" placeholder="e.g. Bakery, Salon, Electronics, Bookshop">
          </label>
        </div>

        <div class="form-section-title"><span>2. Owner / Manager Account</span><small>Access to Admin portal</small></div>
        <div class="form-row-2col">
          <label class="form-label-group">
            <span class="label-text">Your full name</span>
            <input class="form-input" name="owner_name" required minlength="2" maxlength="80" autocomplete="name" placeholder="Full name">
          </label>
          <label class="form-label-group">
            <span class="label-text">Owner username</span>
            <input class="form-input" name="username" required minlength="3" maxlength="40" pattern="[A-Za-z0-9_.\\-]+" autocomplete="username" placeholder="e.g. manager, admin">
          </label>
        </div>
        <div class="form-row-2col">
          <label class="form-label-group">
            <span class="label-text">Owner password</span>
            <input class="form-input" name="password" type="password" required minlength="8" maxlength="128" autocomplete="new-password" placeholder="At least 8 characters">
          </label>
          <label class="form-label-group">
            <span class="label-text">Confirm password</span>
            <input class="form-input" name="confirm_password" type="password" required minlength="8" maxlength="128" autocomplete="new-password" placeholder="Repeat password">
          </label>
        </div>

        <div class="form-section-title"><span>3. Sales Terminal</span><small>For cashier checkout</small></div>
        <label class="form-label-group">
          <span class="label-text">Staff PIN (Keypad login)</span>
          <input class="form-input" name="pin" type="password" required pattern="[0-9]{4,6}" minlength="4" maxlength="6" inputmode="numeric" autocomplete="new-password" placeholder="4–6 numeric digits">
        </label>
        <small class="registration-help">Use the owner account for the Admin portal. Use the staff PIN for fast checkout on the sales screen.</small>
        <button type="submit" class="register-submit-btn" id="registrationSubmitBtn">Create shop & continue to sign in</button>
      </form>`;
    document.body.appendChild(screen);

    setThemeButton(screen.querySelector('#registrationThemeToggle'));
    screen.querySelector('#registrationBackBtn').onclick = () => showLoginScreen();
    const select = screen.querySelector('#registrationBusinessType');
    const custom = screen.querySelector('#registrationCustomCategory');
    const customInput = screen.querySelector('#registrationCustomInput');
    select.onchange = () => {
      const visible = select.value === 'custom';
      custom.style.display = visible ? 'grid' : 'none';
      customInput.required = visible;
      if (visible) customInput.focus();
    };

    screen.querySelector('#localShopRegistrationForm').onsubmit = async event => {
      event.preventDefault();
      const error = screen.querySelector('#registrationError');
      const button = screen.querySelector('#registrationSubmitBtn');
      error.style.display = 'none';
      button.disabled = true;
      button.textContent = 'Creating shop…';
      try {
        const data = Object.fromEntries(new FormData(event.currentTarget));
        const shop = await window.OraforgeShops.register(data);
        await window.OraforgeShops.activate(shop);
        screen.remove();
        showLoginScreen(`✓ ${shop.name} was registered. Enter the staff PIN to start selling.`);
      } catch (err) {
        error.innerHTML = `<span>⚠️</span><span>${escapeHtml(err.message)}</span>`;
        error.style.display = 'flex';
        button.disabled = false;
        button.textContent = 'Create shop & continue to sign in';
      }
    };
  }

  showLoginScreen = function(message = '') {
    document.querySelector('#shopRegistrationScreen')?.remove();
    document.querySelector('#posLoginScreen')?.remove();

    const screen = document.createElement('div');
    screen.id = 'posLoginScreen';
    screen.className = 'login-body registered-login-screen';
    screen.innerHTML = `
      <div class="login-theme-floating"><button id="loginThemeToggle" class="theme-toggle-btn">☀️</button></div>
      <div class="login-panel registered-login-panel">
        <div class="registered-login-brand">
          <div id="loginHeaderIcon" class="registered-login-icon">🏪</div>
          <div>
            <h1 id="loginHeaderTitle">Oraforge POS</h1>
            <p id="loginHeaderTag">Choose a registered shop to continue</p>
          </div>
        </div>

        <div id="registeredShopSection" class="registered-shop-section">
          <div class="registered-section-head"><span>🏢 Registered Shops</span><small>Choose your shop</small></div>
          <div id="registeredShopGrid" class="registered-shop-grid"><div class="registered-shop-loading">Loading shops…</div></div>
        </div>

        <button type="button" class="register-shop-link" id="registerNewShopBtn">＋ Register a new shop</button>
        <button type="button" class="demo-shop-toggle" id="demoShopToggle" hidden style="display:none">Use demo / existing categories</button>
        <div id="demoShopSection" class="demo-shop-section" hidden>
          <div class="registered-section-head"><span>Demo categories</span><small>PIN 1234</small></div>
          <div id="demoShopGrid" class="registered-shop-grid"></div>
        </div>

        <div id="loginNotice" class="login-success-notice" style="${message ? '' : 'display:none'}">${escapeHtml(message)}</div>
        <div id="loginErrorMsg" class="login-error-msg" style="display:none"></div>

        <div id="loginDivider" class="login-divider"><span></span><small>enter staff PIN</small><span></span></div>
        <input id="loginPinInput" class="registered-pin-input" type="password" inputmode="numeric" pattern="[0-9]*" placeholder="Staff PIN" autocomplete="off">
        <div class="pin-pad registered-pin-pad" id="loginPinPad">
          ${['1','2','3','4','5','6','7','8','9'].map(k => `<button type="button" data-key="${k}">${k}</button>`).join('')}
          <button type="button" data-key="clear">Clear</button><button type="button" data-key="0">0</button><button type="button" data-key="enter">Enter</button>
        </div>
        <div class="registered-login-footer">
          <small id="loginPinHint">Select a registered shop first</small>
          <a href="admin.html" id="registeredAdminLink"><span>👑</span> Owner / admin sign in →</a>
        </div>
      </div>`;
    document.body.appendChild(screen);
    setThemeButton(screen.querySelector('#loginThemeToggle'));

    let selectedShopId = window.OraforgeShops.activeShopId();
    let selectedDemoType = selectedShopId ? '' : (localStorage.getItem('pos_active_business_type') || 'retail');
    let shopsCache = [];

    const updateHeader = (shop = null, demoType = '') => {
      let p;
      let title;
      let tagline;
      if (shop) {
        p = profileForType(shop.business_type, shop.category_name);
        title = shop.name;
        tagline = shop.category_name || p.name;
      } else {
        p = profileForType(demoType || 'retail');
        title = `${p.name} POS`;
        tagline = `${p.tagline} · Demo`;
      }
      screen.querySelector('#loginHeaderIcon').textContent = p.icon || '🏪';
      screen.querySelector('#loginHeaderTitle').textContent = title;
      screen.querySelector('#loginHeaderTag').textContent = tagline;
      screen.querySelector('#loginPinHint').textContent = shop ? `Staff login · ${shop.name}` : 'Demo staff PIN: 1234';
    };

    const renderRegistered = () => {
      const grid = screen.querySelector('#registeredShopGrid');
      if (!shopsCache.length) {
        grid.innerHTML = `<div class="registered-empty">No shops registered on this device yet.<br><strong>Register your first shop below.</strong></div>`;
        return;
      }
      grid.innerHTML = shopsCache.map(shop => {
        const p = profileForType(shop.business_type, shop.category_name);
        const active = shop.id === selectedShopId;
        return `<button type="button" class="registered-shop-chip ${active ? 'active' : ''}" data-shop-id="${escapeHtml(shop.id)}">
          <span class="shop-chip-icon">${p.icon || '🏪'}</span>
          <span class="shop-chip-copy"><strong>${escapeHtml(shop.name)}</strong><small>${escapeHtml(shop.category_name || p.name)}</small></span>
          ${active ? '<span class="shop-chip-check">✓</span>' : ''}
        </button>`;
      }).join('');
      grid.querySelectorAll('[data-shop-id]').forEach(btn => btn.onclick = async () => {
        selectedShopId = btn.dataset.shopId;
        selectedDemoType = '';
        const shop = shopsCache.find(s => s.id === selectedShopId);
        renderRegistered();
        updateHeader(shop);
        screen.querySelector('#loginErrorMsg').style.display = 'none';
        screen.querySelector('#loginPinInput').focus();
      });
    };

    const renderDemo = () => {
      const grid = screen.querySelector('#demoShopGrid');
      grid.innerHTML = demoProfiles.map(p => `<button type="button" class="registered-shop-chip demo ${!selectedShopId && selectedDemoType === p.id ? 'active' : ''}" data-demo-type="${p.id}">
        <span class="shop-chip-icon">${p.icon}</span><span class="shop-chip-copy"><strong>${escapeHtml(p.name)}</strong><small>Demo workspace</small></span>
      </button>`).join('');
      grid.querySelectorAll('[data-demo-type]').forEach(btn => btn.onclick = () => {
        selectedShopId = '';
        selectedDemoType = btn.dataset.demoType;
        window.OraforgeShops.clearActiveShop();
        localStorage.setItem('pos_active_business_type', selectedDemoType);
        renderRegistered();
        renderDemo();
        updateHeader(null, selectedDemoType);
        screen.querySelector('#loginPinInput').focus();
      });
    };

    screen.querySelector('#registerNewShopBtn').onclick = showRegistrationScreen;
    screen.querySelector('#demoShopToggle').onclick = () => {
      const section = screen.querySelector('#demoShopSection');
      section.hidden = !section.hidden;
    };

    const pinInput = screen.querySelector('#loginPinInput');
    let demoUnlocked = false;
    const revealDemo = () => {
      if (pinInput.value !== '0713574168') return false;
      demoUnlocked = true;
      const toggle = screen.querySelector('#demoShopToggle');
      toggle.hidden = false;
      toggle.style.removeProperty('display');
      pinInput.value = '';
      screen.querySelector('#loginErrorMsg').style.display = 'none';
      return true;
    };
    pinInput.addEventListener('input', revealDemo);
    const doLogin = async pin => {
      if (revealDemo()) return;
      const error = screen.querySelector('#loginErrorMsg');
      error.style.display = 'none';
      try {
        if (selectedShopId) {
          const ok = await window.OraforgeShops.verifyStaffPin(selectedShopId, pin);
          if (!ok) throw new Error('Invalid staff PIN for this shop.');
          const shop = shopsCache.find(s => s.id === selectedShopId) || await window.OraforgeShops.find(selectedShopId);
          await window.OraforgeShops.activate(shop);
          await LocalPOS.switchProfile(shop.business_type);
        } else {
          if (!demoUnlocked) throw new Error('Select a registered shop first.');
          if (String(pin) !== '1234') throw new Error('Invalid demo PIN. Use 1234.');
          window.OraforgeShops.clearActiveShop();
          localStorage.setItem('pos_active_business_type', selectedDemoType || 'retail');
          await LocalPOS.switchProfile(selectedDemoType || 'retail');
        }
        localStorage.setItem('pos_logged_in', 'true');
        screen.remove();
        await bootstrap();
        bootstrapped = true;
        updateHeaderAndNav();
        posLayout();
        initSPARouter();
        const label = selectedShopId ? (shopsCache.find(s => s.id === selectedShopId)?.name || 'shop') : profileForType(selectedDemoType).name;
        toast(`Logged into ${label}!`, 'success');
      } catch (err) {
        error.textContent = err.message;
        error.style.display = 'block';
        pinInput.select();
      }
    };

    screen.querySelectorAll('#loginPinPad button').forEach(btn => btn.onclick = () => {
      const key = btn.dataset.key;
      if (key === 'clear') pinInput.value = '';
      else if (key === 'enter') doLogin(pinInput.value);
      else if (pinInput.value.length < 10) { pinInput.value += key; revealDemo(); }
      pinInput.focus();
    });
    pinInput.onkeydown = event => {
      if (event.key === 'Enter') { event.preventDefault(); doLogin(pinInput.value); }
    };

    screen.querySelector('#registeredAdminLink').onclick = async event => {
      if (selectedShopId) {
        event.preventDefault();
        const shop = shopsCache.find(s => s.id === selectedShopId);
        if (shop) await window.OraforgeShops.activate(shop);
        location.href = 'admin.html';
      }
    };

    (async () => {
      shopsCache = await window.OraforgeShops.list();
      if (selectedShopId && !shopsCache.some(s => s.id === selectedShopId)) selectedShopId = '';
      if (!selectedShopId && shopsCache.length) {
        selectedShopId = shopsCache[0].id;
      }
      renderRegistered();
      renderDemo();
      if (selectedShopId) updateHeader(shopsCache.find(s => s.id === selectedShopId));
      else updateHeader(null, selectedDemoType);
    })();
  };

  // app.js renders its old login before this compatibility layer loads; replace it.
  if (localStorage.getItem('pos_logged_in') !== 'true') {
    showLoginScreen();
  } else if (window.OraforgeShops.activeShopId()) {
    // Registered-shop sessions are intentionally re-authenticated when the APK is reopened.
    // This avoids ever bootstrapping a registered shop with the legacy category namespace.
    localStorage.removeItem('pos_logged_in');
    showLoginScreen();
  }
})();
