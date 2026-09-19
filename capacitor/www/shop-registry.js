(() => {
  const PROFILE_META = {
    retail: { id:'retail', name:'Retail / Mini-Mart', icon:'🛒', tagline:'Supermarket, Grocery & General Retail POS' },
    pharmacy: { id:'pharmacy', name:'Pharmacy', icon:'💊', tagline:'Pharmacy & Chemist POS' },
    restaurant: { id:'restaurant', name:'Restaurant / Café', icon:'🍽️', tagline:'Food, Dining & Kitchen POS' },
    hardware: { id:'hardware', name:'Hardware', icon:'🔧', tagline:'Hardware, Building Materials & Tools POS' },
    boutique: { id:'boutique', name:'Boutique / Cosmetics', icon:'👗', tagline:'Fashion, Beauty & Cosmetics POS' },
    bar: { id:'bar', name:'Bar / Nightclub', icon:'🍸', tagline:'Bar, Lounge & Club POS' },
    butchery: { id:'butchery', name:'Butchery', icon:'🥩', tagline:'Fresh Meat & Butchery POS' },
  };

  const REGISTRY_KEY = 'oraforge:registered_shops';
  const FALLBACK_KEY = 'fallback_' + REGISTRY_KEY;

  async function dbReady() {
    try {
      if (window.OraforgeDBReady) await window.OraforgeDBReady;
    } catch (_) {}
  }

  async function getGlobal(key, fallback) {
    await dbReady();
    try {
      if (window.OraforgeDB) return await window.OraforgeDB.get(key, fallback);
    } catch (err) {
      console.warn('Shop registry DB read fallback', err);
    }
    try {
      const raw = localStorage.getItem('fallback_' + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  async function setGlobal(key, value) {
    await dbReady();
    try {
      if (window.OraforgeDB) {
        await window.OraforgeDB.set(key, value);
        return;
      }
    } catch (err) {
      console.warn('Shop registry DB write fallback', err);
    }
    localStorage.setItem('fallback_' + key, JSON.stringify(value));
  }

  function bytesToHex(bytes) {
    return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function randomHex(bytes = 16) {
    const arr = new Uint8Array(bytes);
    if (crypto?.getRandomValues) crypto.getRandomValues(arr);
    else for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
    return [...arr].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function hashSecret(secret, salt = null) {
    const actualSalt = salt || randomHex(16);
    try {
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey('raw', enc.encode(String(secret)), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: enc.encode(actualSalt),
        iterations: 120000,
      }, key, 256);
      return `${actualSalt}$${bytesToHex(bits)}`;
    } catch (_) {
      const text = `${actualSalt}:${String(secret)}`;
      let hash = 2166136261;
      for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return `${actualSalt}$fallback_${(hash >>> 0).toString(16)}`;
    }
  }

  async function verifySecret(secret, stored) {
    if (!stored || !stored.includes('$')) return false;
    const salt = stored.split('$', 1)[0];
    return (await hashSecret(secret, salt)) === stored;
  }

  function slugify(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'shop';
  }

  function activeShopId() {
    return localStorage.getItem('pos_active_shop_id') || '';
  }

  function namespace(btype = null) {
    const active = activeShopId();
    if (active) return active;
    return btype || localStorage.getItem('pos_active_business_type') || 'retail';
  }

  function key(name, btype = null) {
    return `shop:${namespace(btype)}:${name}`;
  }

  async function list() {
    const rows = await getGlobal(REGISTRY_KEY, []);
    return Array.isArray(rows) ? rows : [];
  }

  async function find(id) {
    if (!id) return null;
    return (await list()).find(s => s.id === id) || null;
  }

  function activeMeta() {
    const id = activeShopId();
    if (!id) return null;
    return {
      id,
      name: localStorage.getItem('pos_active_shop_name') || '',
      business_type: localStorage.getItem('pos_active_business_type') || 'retail',
      category_name: localStorage.getItem('pos_active_shop_category') || '',
      owner_name: localStorage.getItem('pos_active_shop_owner') || '',
    };
  }

  async function activate(shopOrId) {
    const shop = typeof shopOrId === 'string' ? await find(shopOrId) : shopOrId;
    if (!shop) throw new Error('Registered shop not found.');
    localStorage.setItem('pos_active_shop_id', shop.id);
    localStorage.setItem('pos_active_business_type', shop.business_type || 'retail');
    localStorage.setItem('pos_active_shop_name', shop.name || '');
    localStorage.setItem('pos_active_shop_category', shop.category_name || PROFILE_META[shop.business_type]?.name || 'Business');
    localStorage.setItem('pos_active_shop_owner', shop.owner_name || '');
    return shop;
  }

  function clearActiveShop() {
    localStorage.removeItem('pos_active_shop_id');
    localStorage.removeItem('pos_active_shop_name');
    localStorage.removeItem('pos_active_shop_category');
    localStorage.removeItem('pos_active_shop_owner');
  }

  async function initializeShopStorage(shop) {
    const p = PROFILE_META[shop.business_type] || PROFILE_META.retail;
    const prefix = name => `shop:${shop.id}:${name}`;
    const categories = shop.business_type === 'butchery'
      ? ['Beef', 'Goat & Mutton', 'Chicken', 'Other Meat']
      : shop.is_custom
        ? [shop.category_name, 'General']
        : ['General'];

    const categoryRows = categories.map((name, idx) => ({ id: idx + 1, name, sort_order: idx, business_type: shop.business_type }));
    const settings = {
      business_type: shop.business_type,
      business_name: shop.name,
      business_tagline: shop.is_custom ? `${shop.category_name} POS` : p.tagline,
      theme: localStorage.getItem('pos_theme') || 'light',
      phone: '',
      address: '',
      logo_url: '',
      receipt_header: `Welcome to ${shop.name}`,
      receipt_footer: 'Thank you for your business!\nPowered by Oraforge POS\n------- END OF RECEIPT -------',
      currency: 'KES',
      tax_rate: '16.0',
    };
    const users = [
      { id: 1, username: 'terminal', full_name: 'POS Terminal', role: 'cashier', active: 1, password_hash: shop.staff_pin_hash },
      { id: 2, username: shop.owner_username, full_name: shop.owner_name, role: 'manager', active: 1, password_hash: shop.owner_password_hash },
    ];

    const initial = {
      settings,
      categories: categoryRows,
      items: [],
      orders: [],
      customers: [{ id: 1, name: 'Walk-In Customer', phone: '' }],
      suppliers: [],
      users,
      seeded: true,
    };
    for (const [name, value] of Object.entries(initial)) await setGlobal(prefix(name), value);
  }

  async function register(data) {
    const name = String(data.shop_name || '').trim();
    const ownerName = String(data.owner_name || '').trim();
    const ownerUsername = String(data.username || '').trim();
    const password = String(data.password || '');
    const confirm = String(data.confirm_password || '');
    const pin = String(data.pin || '').trim();
    const rawType = String(data.business_type || '').trim();
    const customCategory = String(data.custom_category || '').trim();

    if (name.length < 2 || name.length > 80 || ownerName.length < 2 || ownerName.length > 80) {
      throw new Error('Enter a shop name and your full name (2–80 characters each).');
    }
    if (!/^[A-Za-z0-9_.-]{3,40}$/.test(ownerUsername) || ownerUsername.toLowerCase() === 'terminal') {
      throw new Error('Use 3–40 letters, numbers, dots, underscores or hyphens for the owner username.');
    }
    if (password.length < 8 || password.length > 128) throw new Error('Choose an owner password with at least 8 characters.');
    if (password !== confirm) throw new Error('The owner passwords do not match.');
    if (!/^\d{4,6}$/.test(pin)) throw new Error('Choose a staff PIN with 4–6 digits.');

    let businessType = rawType;
    let categoryName = PROFILE_META[rawType]?.name || '';
    let isCustom = false;
    if (rawType === 'custom') {
      if (customCategory.length < 2 || customCategory.length > 50) throw new Error('Enter a custom category name (2–50 characters).');
      businessType = 'retail';
      categoryName = customCategory;
      isCustom = true;
    } else if (!PROFILE_META[rawType]) {
      throw new Error('Choose a business category.');
    }

    const shops = await list();
    if (shops.some(s => String(s.name || '').trim().toLowerCase() === name.toLowerCase())) {
      throw new Error('A shop with that name is already registered.');
    }

    const shop = {
      id: `shop_${Date.now().toString(36)}_${randomHex(5)}`,
      name,
      owner_name: ownerName,
      owner_username: ownerUsername,
      owner_password_hash: await hashSecret(password),
      staff_pin_hash: await hashSecret(pin),
      business_type: businessType,
      category_name: categoryName,
      is_custom: isCustom,
      custom_slug: isCustom ? slugify(customCategory) : '',
      created_at: Date.now(),
    };

    await initializeShopStorage(shop);
    shops.push(shop);
    await setGlobal(REGISTRY_KEY, shops);
    return shop;
  }

  async function verifyStaffPin(shopId, pin) {
    const shop = await find(shopId);
    return !!shop && await verifySecret(String(pin || ''), shop.staff_pin_hash);
  }

  async function verifyOwner(shopId, username, password) {
    const shop = await find(shopId);
    if (!shop || String(shop.owner_username).toLowerCase() !== String(username || '').trim().toLowerCase()) return false;
    return await verifySecret(String(password || ''), shop.owner_password_hash);
  }

  window.OraforgeShops = {
    PROFILE_META,
    key,
    namespace,
    list,
    find,
    register,
    activate,
    clearActiveShop,
    activeShopId,
    activeMeta,
    verifyStaffPin,
    verifyOwner,
    getGlobal,
    setGlobal,
  };
})();
