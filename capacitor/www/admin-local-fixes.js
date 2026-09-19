(() => {
  if (typeof LocalAdmin === 'undefined') return;

  const originalHandle = LocalAdmin.handle.bind(LocalAdmin);

  const toEpochSeconds = value => {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric);
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
  };

  const dayKey = value => {
    const ts = toEpochSeconds(value);
    if (!ts) return '';
    return new Date(ts * 1000).toISOString().slice(0, 10);
  };

  async function localSummary() {
    const itemRows = await LocalAdmin.get('items', []);
    const orderRows = await LocalAdmin.get('orders', []);
    const userRows = await LocalAdmin.get('users', [
      { id: 1, username: 'terminal', full_name: 'POS Terminal', role: 'cashier', active: 1 },
      { id: 2, username: 'admin', full_name: 'The Owner', role: 'manager', active: 1 },
    ]);
    const supplierRows = await LocalAdmin.get('suppliers', []);

    const paidRows = (Array.isArray(orderRows) ? orderRows : []).filter(order => order?.status === 'paid');
    const today = new Date().toISOString().slice(0, 10);
    const paidToday = paidRows.filter(order => dayKey(order.paid_at || order.updated_at || order.created_at) === today);
    const salesToday = paidToday.reduce((sum, order) => sum + Number(order.total_cents || 0), 0);
    const weekStart = Math.floor((Date.now() - (6 * 86400000)) / 1000);
    const paidWeek = paidRows.filter(order => toEpochSeconds(order.paid_at || order.updated_at || order.created_at) >= weekStart);
    const salesWeek = paidWeek.reduce((sum, order) => sum + Number(order.total_cents || 0), 0);

    const employeeMap = new Map();
    const methodMap = new Map();
    const itemMap = new Map();

    for (const order of paidWeek) {
      const employee = order.employee_name || 'POS Terminal';
      const employeeRow = employeeMap.get(employee) || { employee, orders: 0, sales: 0 };
      employeeRow.orders += 1;
      employeeRow.sales += Number(order.total_cents || 0);
      employeeMap.set(employee, employeeRow);

      const method = order.payment_method || 'cash';
      const methodRow = methodMap.get(method) || { method, count: 0, sales: 0 };
      methodRow.count += 1;
      methodRow.sales += Number(order.total_cents || 0);
      methodMap.set(method, methodRow);

      for (const row of (order.items || [])) {
        const key = Number(row.menu_item_id || row.id || 0) || row.name;
        const itemRow = itemMap.get(key) || { name: row.name || 'Product', qty: 0, sales: 0 };
        itemRow.qty += Number(row.qty || 0);
        itemRow.sales += Number(row.line_total_cents || 0);
        itemMap.set(key, itemRow);
      }
    }

    const salesTrend = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - offset);
      const key = date.toISOString().slice(0, 10);
      salesTrend.push({
        day: key,
        sales: paidWeek
          .filter(order => dayKey(order.paid_at || order.updated_at || order.created_at) === key)
          .reduce((sum, order) => sum + Number(order.total_cents || 0), 0),
      });
    }

    const openRows = (Array.isArray(orderRows) ? orderRows : []).filter(order => order?.status === 'open');
    return {
      totals: {
        paid_today: paidToday.length,
        sales_today: salesToday,
        unpaid_orders: openRows.length,
        unpaid_total: openRows.reduce((sum, order) => sum + Number(order.total_cents || 0), 0),
        sales_week: salesWeek,
      },
      counts: {
        active_users: (userRows || []).filter(user => Number(user.active ?? 1)).length,
        active_items: (itemRows || []).filter(item => Number(item.active ?? 1)).length,
        active_suppliers: (supplierRows || []).filter(supplier => Number(supplier.active ?? 1)).length,
      },
      by_employee: [...employeeMap.values()].sort((a, b) => b.sales - a.sales),
      by_method: [...methodMap.values()],
      top_items: [...itemMap.values()].sort((a, b) => b.sales - a.sales).slice(0, 5),
      sales_trend: salesTrend,
    };
  }

  const PROFILE_SAMPLE_SKU_PREFIXES = {
    pharmacy: 'PHARM-',
    hardware: 'HDW-',
    boutique: 'BTQ-',
    retail: 'RET-',
    restaurant: 'REST-',
    bar: ['BE-', 'CO-', 'SP-', 'WI-', 'SD-', 'SN-']
  };

  function sanitizeAdminItems(items, profileId) {
    if (!Array.isArray(items) || !profileId) return items;
    const foreignPrefixes = [];
    for (const [p, prefixes] of Object.entries(PROFILE_SAMPLE_SKU_PREFIXES)) {
      if (p !== profileId) {
        if (Array.isArray(prefixes)) foreignPrefixes.push(...prefixes);
        else foreignPrefixes.push(prefixes);
      }
    }
    return items.filter(item => {
      const sku = String(item.sku || '').toUpperCase();
      return !foreignPrefixes.some(fp => sku.startsWith(fp));
    });
  }

  async function menuPayload() {
    const categories = await LocalAdmin.get('categories', []);
    let items = await LocalAdmin.get('items', []);
    const isRegisteredShop = window.OraforgeShops && window.OraforgeShops.activeShopId();
    if (!isRegisteredShop) {
      const btype = LocalAdmin.type();
      const cleanItems = sanitizeAdminItems(items, btype);
      if (cleanItems.length !== items.length) {
        items = cleanItems;
        await LocalAdmin.set('items', items);
      }
    }
    return {
      categories: Array.isArray(categories) ? categories : [],
      items: Array.isArray(items) ? items : [],
    };
  }

  async function saveMenuItem(body = {}) {
    const menu = await menuPayload();
    const products = [...menu.items];
    let product = body.id ? products.find(row => Number(row.id) === Number(body.id)) : null;
    if (!product) {
      product = { id: LocalAdmin.nextId(products), active: 1 };
      products.push(product);
    }

    const pendingImage = window.__adminProductPendingImage || '';
    const chosenImage = body.image_base64 || body.image_url || pendingImage || product.image_url || '';

    Object.assign(product, {
      category_id: Number(body.category_id || product.category_id || menu.categories[0]?.id || 1),
      name: String(body.name || product.name || 'Product').trim(),
      price_cents: Math.round(Number(body.price ?? (Number(product.price_cents || 0) / 100)) * 100),
      cost_cents: Math.round(Number(body.cost ?? (Number(product.cost_cents || 0) / 100)) * 100),
      stock_qty: Number(body.stock_qty ?? product.stock_qty ?? 0),
      sku: String(body.sku ?? product.sku ?? ''),
      barcode: String(body.barcode ?? product.barcode ?? ''),
      color: body.color || product.color || '#334155',
      active: Number(body.active ?? product.active ?? 1),
      unit: String(body.unit ?? product.unit ?? 'pcs'),
      image_url: chosenImage,
      reorder_level: Number(body.reorder_level ?? product.reorder_level ?? 5),
      variants_json: body.variants_json !== undefined ? body.variants_json : (product.variants_json || ''),
      decimal_qty_enabled: body.decimal_qty_enabled !== undefined ? (body.decimal_qty_enabled ? 1 : 0) : (product.decimal_qty_enabled ? 1 : 0),
      wholesale_price_cents: body.wholesale_price !== undefined ? Math.round(Number(body.wholesale_price) * 100) : (product.wholesale_price_cents || 0),
      batch_no: body.batch_no !== undefined ? String(body.batch_no) : (product.batch_no || ''),
      expiry_date: body.expiry_date !== undefined ? String(body.expiry_date) : (product.expiry_date || ''),
      manufacturer: body.manufacturer !== undefined ? String(body.manufacturer) : (product.manufacturer || ''),
      strength: body.strength !== undefined ? String(body.strength) : (product.strength || ''),
    });

    await LocalAdmin.set('items', products);
    window.__adminProductPendingImage = '';
    return { categories: menu.categories, items: products };
  }

  LocalAdmin.handle = async function patchedLocalAdminHandle(path, opts = {}) {
    const url = new URL(path, 'https://local.pos');
    const cleanPath = url.pathname.replace(/\/$/, '') || '/';
    const method = String(opts.method || 'GET').toUpperCase();
    const body = opts.body
      ? (typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body)
      : {};

    if (cleanPath === '/api/admin/summary') return localSummary();
    if ((cleanPath === '/api/menu' || cleanPath === '/api/admin/menu') && method === 'GET') return menuPayload();
    if (cleanPath === '/api/menu/item' && method === 'POST') return saveMenuItem(body);

    return originalHandle(path, opts);
  };
})();
