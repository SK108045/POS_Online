const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const money = c => `KES ${(c/100).toLocaleString('en-KE', {minimumFractionDigits:2})}`;
const fmt = n => Number(n).toLocaleString('en-KE');

// ── STATE ──
let state = { user: null, summary: null, users: [], suppliers: [], menu: null };

// ── API ──
// ── LOCAL ADMIN FALLBACK ──
const LocalAdmin = {
  get(k, def) {
    try {
      const v = localStorage.getItem('pos_local_' + k);
      return v ? JSON.parse(v) : def;
    } catch(e) { return def; }
  },
  handle(path, opts = {}) {
    const cleanPath = path.split('?')[0];
    const orders = this.get('orders', []).filter(o => o.status === 'paid');
    const items = this.get('items', []);
    const cats = this.get('categories', []);
    const totalSales = orders.reduce((s, o) => s + (o.total_cents || 0), 0);

    if (cleanPath === '/api/admin/summary') {
      return {
        totals: {
          paid_today: orders.length,
          sales_today: totalSales,
          unpaid_orders: 0,
          unpaid_total: 0,
          sales_week: totalSales
        },
        counts: {
          active_users: 2,
          active_items: items.length,
          active_suppliers: 2
        },
        by_employee: [{ employee: "POS Terminal", orders: orders.length, sales: totalSales }],
        by_method: [
          { method: "cash", count: orders.filter(o => o.payment_method === 'cash').length, sales: orders.filter(o => o.payment_method === 'cash').reduce((s,o)=>s+o.total_cents,0) },
          { method: "mpesa", count: orders.filter(o => o.payment_method === 'mpesa').length, sales: orders.filter(o => o.payment_method === 'mpesa').reduce((s,o)=>s+o.total_cents,0) }
        ],
        top_items: items.slice(0, 5).map(i => ({ name: i.name, qty: 10, sales: (i.price_cents || 0) * 10 })),
        sales_trend: [{ day: new Date().toISOString().split('T')[0], sales: totalSales }]
      };
    }

    if (cleanPath === '/api/admin/users') {
      return [
        { id: 1, username: "terminal", full_name: "POS Terminal", role: "cashier", active: 1 },
        { id: 2, username: "admin", full_name: "The Owner", role: "manager", active: 1 }
      ];
    }

    if (cleanPath === '/api/admin/menu') {
      return { categories: cats, items: items };
    }

    if (cleanPath === '/api/admin/suppliers') {
      return this.get('suppliers', [
        { id: 1, name: "East African Breweries Ltd", phone: "+254 700 111 000", email: "orders@eabl.co.ke", active: 1 },
        { id: 2, name: "Coca-Cola Beverages Africa", phone: "+254 722 222 111", email: "supply@ccba.co.ke", active: 1 }
      ]);
    }

    if (cleanPath === '/api/admin/customers') {
      return this.get('customers', []);
    }

    if (cleanPath === '/api/admin/promotions') {
      return { promotions: [], campaigns: [] };
    }

    if (cleanPath === '/api/admin/stock') {
      return { items: items };
    }

    return {};
  }
};

async function api(path, opts = {}) {
  const init = { headers: {'Content-Type':'application/json'}, ...opts };
  if (init.body && typeof init.body !== 'string') init.body = JSON.stringify(init.body);
  try {
    const res = await fetch(path, init);
    if (res.ok) return await res.json();
    if (res.status === 401 || res.status === 403) {
      return LocalAdmin.handle(path, opts);
    }
  } catch (err) {
    return LocalAdmin.handle(path, opts);
  }
  return LocalAdmin.handle(path, opts);
}

// ── TOAST ──
function toast(msg, type = 'success') {
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]||'•'}</span><span>${msg}</span>`;
  $('#toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── MODAL ──
function openModal(html, onOpen) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-box">${html}</div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  if (onOpen) onOpen(overlay);
  return overlay;
}

// ── NAV ──
function navigate(section) {
  if (section === 'pos') { location.href = 'index.html'; return; }
  $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.section === section));
  $$('.content-section').forEach(el => el.classList.toggle('active', el.id === `sec-${section}`));
  if (section === 'dashboard') renderDashboard();
  if (section === 'users') renderUsers();
  if (section === 'menu') renderMenu();
  if (section === 'suppliers') renderSuppliers();
  if (section === 'customers') renderCustomers();
  if (section === 'promotions') renderPromotions();
  if (section === 'stock') renderStockAdmin();
}

// ── DASHBOARD ──
async function renderDashboard() {
  const sec = $('#sec-dashboard');
  sec.innerHTML = `<div class="loading-overlay"><div class="loading-spinner"></div> Loading analytics…</div>`;
  try {
    state.summary = await api('/api/admin/summary');
    buildDashboard(state.summary);
  } catch(e) { sec.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><p>${e.message}</p></div>`; }
}

function generateLineChart(data) {
  if (!data || data.length === 0) return '<div class="empty-state"><p>No sales data yet</p></div>';
  const width = 800;
  const height = 150;
  const padding = 20;
  const maxVal = Math.max(...data.map(d => d.sales), 1);
  const minVal = 0;
  
  const stepX = (width - padding * 2) / Math.max(data.length - 1, 1);
  
  const points = data.map((d, i) => {
    const x = padding + i * stepX;
    const y = height - padding - ((d.sales - minVal) / (maxVal - minVal)) * (height - padding * 2);
    return `${x},${y}`;
  }).join(' ');
  
  const areaPath = `M ${padding},${height - padding} L ${points} L ${padding + (data.length - 1) * stepX},${height - padding} Z`;
  
  const labels = data.map((d, i) => {
    const x = padding + i * stepX;
    const date = new Date(d.day).toLocaleDateString('en-US', {weekday:'short'});
    return `<text x="${x}" y="${height - 2}" font-size="10" fill="var(--muted)" text-anchor="middle">${date}</text>`;
  }).join('');
  
  const circles = data.map((d, i) => {
    const x = padding + i * stepX;
    const y = height - padding - ((d.sales - minVal) / (maxVal - minVal)) * (height - padding * 2);
    return `<circle cx="${x}" cy="${y}" r="4" fill="white" stroke="var(--primary)" stroke-width="2"><title>${d.day}: ${money(d.sales)}</title></circle>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" style="width:100%; height:auto; overflow:visible; display:block">
      <defs>
        <linearGradient id="chartGradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.3" />
          <stop offset="100%" stop-color="var(--primary)" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path d="${areaPath}" fill="url(#chartGradient)" />
      <polyline points="${points}" fill="none" stroke="var(--primary)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      ${circles}
      ${labels}
    </svg>
  `;
}

function buildDashboard(s) {
  const t = s.totals, c = s.counts;
  const sec = $('#sec-dashboard');
  sec.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1>Dashboard</h1>
        <p><strong>${state.profile?.icon || '🏪'} ${state.profile?.name || 'Business'} Workspace</strong> · Only this shop category's sales and customers are shown here.</p>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="renderDashboard()">Refresh</button>
    </div>

    <div class="stats-grid">
      <div class="stat-card primary">
        <div class="stat-label">Today's Sales</div>
        <div class="stat-value">${money(t.sales_today)}</div>
        <div class="stat-sub">${fmt(t.paid_today)} paid orders</div>
      </div>
      <div class="stat-card success">
        <div class="stat-label">Week Revenue</div>
        <div class="stat-value">${money(t.sales_week)}</div>
        <div class="stat-sub">Last 7 days</div>
      </div>

      <div class="stat-card info">
        <div class="stat-label">Active Staff</div>
        <div class="stat-value">${fmt(c.active_users)}</div>
        <div class="stat-sub">${fmt(c.active_users)} users · ${fmt(c.active_items)} products · ${fmt(c.active_suppliers)} suppliers</div>
      </div>
    </div>

    <div class="panel" style="margin-bottom:20px">
      <div class="panel-header">
        <div>
          <div class="panel-title">Revenue Trend</div>
          <div class="panel-subtitle">Daily sales over the last 7 days</div>
        </div>
      </div>
      <div class="panel-body" style="padding-top:20px; padding-bottom:10px;">
        ${generateLineChart(s.sales_trend)}
      </div>
    </div>

    <div class="two-col">
      <div class="panel">
        <div class="panel-header">
          <div>
            <div class="panel-title">Top Selling Items</div>
            <div class="panel-subtitle">By revenue — last 7 days</div>
          </div>
        </div>
        <div class="panel-body" id="topItemsArea"></div>
      </div>
      <div class="panel">
        <div class="panel-header">
          <div>
            <div class="panel-title">Staff Performance</div>
            <div class="panel-subtitle">Sales by employee — last 7 days</div>
          </div>
        </div>
        <div class="panel-body" id="employeeArea"></div>
      </div>
    </div>

    <div class="panel" style="margin-bottom:20px">
      <div class="panel-header">
        <div>
          <div class="panel-title">Payment Methods</div>
          <div class="panel-subtitle">Last 7 days breakdown</div>
        </div>
      </div>
      <div class="panel-body" id="methodArea"></div>
    </div>
  `;

  // Top items chart
  const maxSales = Math.max(...s.top_items.map(i=>i.sales), 1);
  $('#topItemsArea').innerHTML = s.top_items.length ? `
    <div class="chart-area" id="barChart"></div>
    <div style="display:flex;justify-content:space-between;margin-top:8px;gap:4px;align-items:flex-start;">
      ${s.top_items.map(i=>`<div style="flex:1;text-align:center;font-size:11px;font-weight:700;color:var(--ink);word-wrap:break-word;line-height:1.3;">${i.name}</div>`).join('')}
    </div>
  ` : `<div class="empty-state"><p>No sales data yet</p></div>`;

  if (s.top_items.length) {
    const chart = $('#barChart');
    const colors = [
      'linear-gradient(to top, #0f766e, #14b8a6)', // Teal (primary)
      'linear-gradient(to top, #ea580c, #f97316)', // Orange
      'linear-gradient(to top, #2563eb, #3b82f6)', // Blue
      'linear-gradient(to top, #475569, #64748b)', // Slate / Grey
      'linear-gradient(to top, #db2777, #ec4899)', // Pink
      'linear-gradient(to top, #059669, #10b981)', // Emerald
      'linear-gradient(to top, #d97706, #f59e0b)', // Amber
      'linear-gradient(to top, #4f46e5, #6366f1)', // Indigo
    ];
    chart.innerHTML = s.top_items.map((i, idx) => {
      const pct = Math.round((i.sales / maxSales) * 100);
      const bg = colors[idx % colors.length];
      return `
        <div class="chart-bar-wrap" title="${i.name} — ${i.qty} sold" onclick="this.classList.toggle('show-val')">
          <div class="chart-val">${money(i.sales)}</div>
          <div class="chart-bar" style="height:${Math.max(pct,4)}%; background:${bg}"></div>
        </div>`;
    }).join('');
  }

  // Employees leaderboard
  $('#employeeArea').innerHTML = s.by_employee.length ? s.by_employee.map((e,i)=>`
    <div class="leaderboard-row">
      <div class="leaderboard-rank ${i===0?'gold':''}">${i+1}</div>
      <div>
        <div class="leaderboard-name">${e.employee}</div>
        <div class="leaderboard-sub">${fmt(e.orders)} orders</div>
      </div>
      <div class="leaderboard-val">${money(e.sales)}</div>
    </div>
  `).join('') : `<div class="empty-state"><p>No employee sales yet</p></div>`;

  // Payment methods
  const maxMethod = Math.max(...s.by_method.map(m=>m.sales), 1);
  $('#methodArea').innerHTML = s.by_method.length ? `<div class="method-grid">${s.by_method.map(m=>`
    <div class="method-row">
      <div class="method-label">${m.method}</div>
      <div class="method-bar-track">
        <div class="method-bar-fill" style="width:${Math.round(m.sales/maxMethod*100)}%"></div>
      </div>
      <div class="method-val">${money(m.sales)}</div>
    </div>
  `).join('')}</div>` : `<div class="empty-state"><p>No payment data yet</p></div>`;
}

// ── USERS ──
async function renderUsers() {
  const sec = $('#sec-users');
  sec.innerHTML = `<div class="loading-overlay"><div class="loading-spinner"></div> Loading…</div>`;
  try {
    state.users = await api('/api/admin/users');
    buildUsers();
  } catch(e) { sec.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
}

function buildUsers() {
  const roleBadge = r => `<span class="badge badge-${r}">${r}</span>`;
  const sec = $('#sec-users');
  sec.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1>Staff Management</h1>
        <p>${state.users.length} total accounts</p>
      </div>
      <button class="btn btn-primary" id="addUserBtn">Add Staff</button>
    </div>
    <div class="toolbar">
      <div class="search-wrap">
        <span class="search-icon">🔍</span>
        <input class="form-input" id="userSearch" placeholder="Search name or username…">
      </div>
      <select class="form-select" id="roleFilter" style="width:140px">
        <option value="">All Roles</option>
        <option value="manager">Manager</option>
        <option value="cashier">Cashier</option>
        <option value="staff">Staff</option>
      </select>
    </div>
    <div class="panel">
      <table class="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Username</th>
            <th>Role</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="userTableBody"></tbody>
      </table>
    </div>
  `;
  const renderRows = (filter='', role='') => {
    const rows = state.users.filter(u =>
      (!filter || u.full_name.toLowerCase().includes(filter) || u.username.toLowerCase().includes(filter)) &&
      (!role || u.role === role)
    );
    $('#userTableBody').innerHTML = rows.length ? rows.map(u=>`
      <tr>
        <td><strong>${u.full_name}</strong></td>
        <td style="color:var(--muted);font-family:monospace">${u.username}</td>
        <td>${roleBadge(u.role)}</td>
        <td><span class="badge badge-${u.active?'active':'inactive'}">${u.active?'Active':'Inactive'}</span></td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="editUser(${u.id})">Edit</button>
        </td>
      </tr>
    `).join('') : `<tr><td colspan="5"><div class="empty-state"><p>No staff found</p></div></td></tr>`;
  };
  renderRows();
  $('#userSearch').addEventListener('input', e => renderRows(e.target.value.toLowerCase(), $('#roleFilter').value));
  $('#roleFilter').addEventListener('change', e => renderRows($('#userSearch').value.toLowerCase(), e.target.value));
  $('#addUserBtn').addEventListener('click', () => openUserModal(null));
}

function editUser(id) {
  const u = state.users.find(x => x.id === id);
  if (u) openUserModal(u);
}

function openUserModal(user) {
  const isNew = !user;
  const overlay = openModal(`
    <div class="modal-header">
      <div class="modal-title">${isNew ? 'Add Staff Member' : 'Edit Staff'}</div>
      <button class="modal-close" id="modalClose">✕</button>
    </div>
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">Full Name</label>
        <input class="form-input" id="mFullName" value="${user?.full_name||''}" placeholder="e.g. Jane Mwangi" required>
      </div>
      <div class="form-group">
        <label class="form-label">Username</label>
        <input class="form-input" id="mUsername" value="${user?.username||''}" placeholder="e.g. waiter7" required>
      </div>
      <div class="form-group">
        <label class="form-label">Role</label>
        <select class="form-select" id="mRole">
          <option value="staff" ${user?.role==='staff'?'selected':''}>Staff</option>
          <option value="cashier" ${user?.role==='cashier'?'selected':''}>Cashier</option>
          <option value="manager" ${user?.role==='manager'?'selected':''}>Manager</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Status</label>
        <select class="form-select" id="mActive">
          <option value="1" ${(!user||user.active)?'selected':''}>Active</option>
          <option value="0" ${user&&!user.active?'selected':''}>Inactive</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">${isNew ? 'Password / PIN' : 'New Password (leave blank to keep)'}</label>
        <input class="form-input" id="mPassword" type="password" placeholder="${isNew?'Default: 1234 or admin123':'Leave blank to keep current'}">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="mCancel">Cancel</button>
      <button class="btn btn-primary" id="mSave">Save</button>
    </div>
  `);
  overlay.querySelector('#modalClose').onclick = () => overlay.remove();
  overlay.querySelector('#mCancel').onclick = () => overlay.remove();
  overlay.querySelector('#mSave').onclick = async () => {
    const payload = {
      full_name: overlay.querySelector('#mFullName').value.trim(),
      username: overlay.querySelector('#mUsername').value.trim(),
      role: overlay.querySelector('#mRole').value,
      active: overlay.querySelector('#mActive').value,
      password: overlay.querySelector('#mPassword').value,
    };
    if (user) payload.id = user.id;
    try {
      state.users = await api('/api/admin/user', { method: 'POST', body: payload });
      toast(`Staff ${isNew ? 'added' : 'updated'} successfully`);
      overlay.remove();
      buildUsers();
    } catch(e) { toast(e.message, 'error'); }
  };
}

// ── MENU ──
async function renderMenu() {
  const sec = $('#sec-menu');
  sec.innerHTML = `<div class="loading-overlay"><div class="loading-spinner"></div> Loading…</div>`;
  try {
    state.menu = await api('/api/menu');
    buildMenu();
  } catch(e) { sec.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
}

function buildMenu() {
  const cats = state.menu.categories;
  const items = state.menu.items;
  const catName = id => cats.find(c=>c.id===id)?.name || '?';
  const sec = $('#sec-menu');
  sec.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1>Products</h1>
        <p>${items.length} active products across ${cats.length} categories</p>
      </div>
      <button class="btn btn-primary" id="addItemBtn">Add Product</button>
    </div>
    <div class="toolbar">
      <div class="search-wrap">
        <span class="search-icon">🔍</span>
        <input class="form-input" id="menuSearch" placeholder="Search products or SKU…">
      </div>
      <select class="form-select" id="catFilter" style="width:160px">
        <option value="">All Categories</option>
        ${cats.map(c=>`<option value="${c.id}">${c.name}</option>`).join('')}
      </select>
    </div>
    <div class="panel">
      <table class="data-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Category</th>
            <th>SKU</th>
            <th>Price</th>
            <th>Stock</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="menuTableBody"></tbody>
      </table>
    </div>
  `;
  const renderRows = (filter='', catId='') => {
    const filtered = items.filter(i =>
      (!filter || i.name.toLowerCase().includes(filter) || (i.sku||'').toLowerCase().includes(filter)) &&
      (!catId || i.category_id === Number(catId))
    );
    $('#menuTableBody').innerHTML = filtered.length ? filtered.map(i=>`
      <tr>
        <td>
          <span class="color-swatch" style="background:${i.color}"></span>
          <strong>${i.name}</strong>
        </td>
        <td style="color:var(--muted)">${catName(i.category_id)}</td>
        <td style="color:var(--muted);font-family:monospace">${i.sku||'—'}</td>
        <td style="font-weight:700">${money(i.price_cents)}</td>
        <td><span class="badge" style="${(i.stock_qty||0)<=5?'background:#fee2e2;color:#dc2626':'background:#dcfce7;color:#16a34a'}">${i.stock_qty||0} ${i.unit||'pcs'}</span></td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="editItem(${i.id})">Edit</button>
        </td>
      </tr>
    `).join('') : `<tr><td colspan="6"><div class="empty-state"><p>No products found</p></div></td></tr>`;
  };
  renderRows();
  $('#menuSearch').addEventListener('input', e => renderRows(e.target.value.toLowerCase(), $('#catFilter').value));
  $('#catFilter').addEventListener('change', e => renderRows($('#menuSearch').value.toLowerCase(), e.target.value));
  $('#addItemBtn').addEventListener('click', () => openItemModal(null));
}

function editItem(id) {
  const all = [...state.menu.items];
  const item = all.find(i => i.id === id);
  if (item) openItemModal(item);
}

function openItemModal(item) {
  const cats = state.menu.categories;
  const isNew = !item;
  let defaultSku = '';
  if (isNew) {
    const skus = state.menu.items.map(i => parseInt(i.sku) || 0);
    const maxSku = skus.length > 0 ? Math.max(...skus) : 0;
    defaultSku = maxSku + 1;
  }
  const overlay = openModal(`
    <div class="modal-header">
      <div class="modal-title">${isNew ? 'Add Product' : 'Edit Product'}</div>
      <button class="modal-close" id="modalClose">✕</button>
    </div>
    <div class="form-grid form-grid-2">
      <div class="form-group" style="grid-column:1/-1">
        <label class="form-label">Product Name</label>
        <input class="form-input" id="mName" value="${item?.name||''}" placeholder="e.g. 13A Socket" required>
      </div>
      <div class="form-group">
        <label class="form-label">Category</label>
        <select class="form-select" id="mCat">
          ${cats.map(c=>`<option value="${c.id}" ${item?.category_id===c.id?'selected':''}>${c.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">SKU</label>
        <input class="form-input" id="mSku" value="${item?.sku || defaultSku}" placeholder="e.g. 17">
      </div>
      <div class="form-group">
        <label class="form-label">Price (KES)</label>
        <input class="form-input" id="mPrice" type="number" min="0" step="1" value="${item?item.price_cents/100:''}" placeholder="e.g. 350">
      </div>
      <div class="form-group">
        <label class="form-label">Cost Price (KES)</label>
        <input class="form-input" id="mCost" type="number" min="0" step="1" value="${item?item.cost_cents/100:''}" placeholder="e.g. 200">
      </div>
      <div class="form-group">
        <label class="form-label">Unit</label>
        <input class="form-input" id="mUnit" value="${item?.unit||'pcs'}" placeholder="pcs / kg / m / box">
      </div>
      <div class="form-group">
        <label class="form-label">Barcode</label>
        <input class="form-input" id="mBarcode" value="${item?.barcode||''}" placeholder="Optional barcode">
      </div>
      <div class="form-group">
        <label class="form-label">Button Color</label>
        <input class="form-input" id="mColor" type="color" value="${item?.color||'#334155'}" style="height:44px;padding:4px 8px;cursor:pointer">
      </div>
      <div class="form-group">
        <label class="form-label">Status</label>
        <select class="form-select" id="mActive">
          <option value="1" ${(!item||item.active)?'selected':''}>Active</option>
          <option value="0" ${item&&!item.active?'selected':''}>Hidden</option>
        </select>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="mCancel">Cancel</button>
      <button class="btn btn-primary" id="mSave">Save Product</button>
    </div>
  `);
  overlay.querySelector('#modalClose').onclick = () => overlay.remove();
  overlay.querySelector('#mCancel').onclick = () => overlay.remove();
  overlay.querySelector('#mSave').onclick = async () => {
    const payload = {
      name: overlay.querySelector('#mName').value.trim(),
      category_id: overlay.querySelector('#mCat').value,
      price: overlay.querySelector('#mPrice').value,
      cost: overlay.querySelector('#mCost')?.value || '0',
      sku: overlay.querySelector('#mSku')?.value || '',
      barcode: overlay.querySelector('#mBarcode')?.value || '',
      unit: overlay.querySelector('#mUnit')?.value || 'pcs',
      color: overlay.querySelector('#mColor').value,
      active: overlay.querySelector('#mActive').value,
    };
    if (item) payload.id = item.id;
    try {
      const updated = await api('/api/menu/item', { method:'POST', body: payload });
      state.menu = updated;
      toast(`Item ${isNew?'added':'updated'} successfully`);
      overlay.remove();
      buildMenu();
    } catch(e) { toast(e.message, 'error'); }
  };
}

// ── SUPPLIERS (replaces TABLES) ──
async function renderSuppliers() {
  const sec = $('#sec-suppliers');
  sec.innerHTML = `<div class="loading-overlay"><div class="loading-spinner"></div> Loading…</div>`;
  try {
    state.suppliers = await api('/api/admin/suppliers');
    buildSuppliers();
  } catch(e) { sec.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
}

function buildSuppliers() {
  const sec = $('#sec-suppliers');
  sec.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1>Suppliers</h1>
        <p>${state.suppliers.length} suppliers on record</p>
      </div>
      <button class="btn btn-primary" id="addSupplierBtn">Add Supplier</button>
    </div>
    <div class="panel">
      <table class="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Phone</th>
            <th>Email</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${state.suppliers.map(s=>`
            <tr>
              <td><strong>${s.name}</strong></td>
              <td style="color:var(--muted)">${s.phone||'—'}</td>
              <td style="color:var(--muted)">${s.email||'—'}</td>
              <td><span class="badge badge-${s.active?'active':'inactive'}">${s.active?'Active':'Disabled'}</span></td>
              <td>
                <button class="btn btn-ghost btn-sm" onclick="editSupplier(${s.id})">Edit</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  $('#addSupplierBtn').addEventListener('click', () => openSupplierModal(null));
}

function editSupplier(id) {
  const s = state.suppliers.find(x => x.id === id);
  if (s) openSupplierModal(s);
}

function openSupplierModal(supplier) {
  const isNew = !supplier;
  const overlay = openModal(`
    <div class="modal-header">
      <div class="modal-title">${isNew ? 'Add Supplier' : 'Edit Supplier'}</div>
      <button class="modal-close" id="modalClose">✕</button>
    </div>
    <div class="form-grid form-grid-2">
      <div class="form-group" style="grid-column:1/-1">
        <label class="form-label">Supplier Name</label>
        <input class="form-input" id="mName" value="${supplier?.name||''}" placeholder="e.g. Crown Paints Kenya">
      </div>
      <div class="form-group">
        <label class="form-label">Phone</label>
        <input class="form-input" id="mPhone" value="${supplier?.phone||''}" placeholder="+254 700 000 000">
      </div>
      <div class="form-group">
        <label class="form-label">Email</label>
        <input class="form-input" id="mEmail" type="email" value="${supplier?.email||''}" placeholder="orders@supplier.com">
      </div>
      <div class="form-group" style="grid-column:1/-1">
        <label class="form-label">Address</label>
        <input class="form-input" id="mAddress" value="${supplier?.address||''}" placeholder="Physical address">
      </div>
      <div class="form-group">
        <label class="form-label">Status</label>
        <select class="form-select" id="mActive">
          <option value="1" ${(!supplier||supplier.active)?'selected':''}>Active</option>
          <option value="0" ${supplier&&!supplier.active?'selected':''}>Disabled</option>
        </select>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="mCancel">Cancel</button>
      <button class="btn btn-primary" id="mSave">Save</button>
    </div>
  `);
  overlay.querySelector('#modalClose').onclick = () => overlay.remove();
  overlay.querySelector('#mCancel').onclick = () => overlay.remove();
  overlay.querySelector('#mSave').onclick = async () => {
    const payload = {
      name: overlay.querySelector('#mName').value.trim(),
      phone: overlay.querySelector('#mPhone').value.trim(),
      email: overlay.querySelector('#mEmail').value.trim(),
      address: overlay.querySelector('#mAddress').value.trim(),
      active: overlay.querySelector('#mActive').value,
    };
    if (supplier) payload.id = supplier.id;
    try {
      state.suppliers = await api('/api/admin/supplier', { method:'POST', body: payload });
      toast(`Supplier ${isNew?'added':'updated'}`);
      overlay.remove();
      buildSuppliers();
    } catch(e) { toast(e.message, 'error'); }
  };
}

// ── STOCK ADMIN ──
async function renderStockAdmin() {
  const sec = $('#sec-stock');
  sec.innerHTML = `<div class="loading-overlay"><div class="loading-spinner"></div> Loading…</div>`;
  try {
    const items = await api('/api/stock');
    buildStockAdmin(items);
  } catch(e) { sec.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
}

function buildStockAdmin(items) {
  const sec = $('#sec-stock');
  const low = items.filter(i => i.stock_qty <= 5);
  sec.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1>Stock Management</h1>
        <p>${items.length} products · <span style="color:#dc2626">${low.length} low stock</span></p>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="renderStockAdmin()">Refresh</button>
    </div>
    <div class="panel">
      <table class="data-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>SKU</th>
            <th>Stock</th>
            <th>Unit</th>
            <th>Adjust</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(i => {
            const isLow = i.stock_qty <= 5;
            return `
              <tr style="${isLow?'background:#fff5f5':''}}">
                <td><strong>${i.name}</strong></td>
                <td style="color:var(--muted);font-family:monospace">${i.sku||'—'}</td>
                <td><span class="badge" style="${isLow?'background:#fee2e2;color:#dc2626':'background:#dcfce7;color:#16a34a'}">${i.stock_qty}</span></td>
                <td style="color:var(--muted)">${i.unit}</td>
                <td>
                  <div style="display:flex;gap:6px;align-items:center">
                    <input type="number" class="form-input" id="adj_${i.id}" value="1" min="-9999" style="width:70px;padding:6px 8px">
                    <button class="btn btn-primary btn-sm" onclick="adjustStock(${i.id},'add')">+Add</button>
                    <button class="btn btn-ghost btn-sm" onclick="adjustStock(${i.id},'remove')">−Sub</button>
                  </div>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function adjustStock(productId, direction) {
  const inp = $(`#adj_${productId}`);
  const qty = Math.abs(parseInt(inp.value) || 1);
  const qty_change = direction === 'add' ? qty : -qty;
  try {
    await api('/api/stock/adjust', { method:'POST', body: { product_id: productId, qty_change, reason: 'manual' } });
    toast(`Stock ${direction === 'add' ? 'added' : 'removed'}: ${qty}`);
    renderStockAdmin();
  } catch(e) { toast(e.message, 'error'); }
}


// ── WHATSAPP PROMOTIONS ──────────────────────────────────────────────────────
const PROMO_PROFILE_COPY = {
  retail: {
    general: 'Thanks for shopping with us. We have fresh stock and great deals available in store. Visit us again soon.',
    stock: 'New stock is in. Drop by and check out what is available.',
    offer: 'We have a special offer running in store. Visit us and enjoy the deal while it lasts.',
    comeback: 'We would love to see you again. Drop by whenever you are around.'
  },
  pharmacy: {
    general: 'Thanks for choosing us. We are here for your pharmacy and wellness needs. Visit us again whenever you need us.',
    stock: 'Fresh pharmacy and wellness stock is available. Visit us or message us to check availability.',
    offer: 'We have offers on selected wellness and personal-care items. Visit us for the current deals.',
    comeback: 'We would be happy to serve you again whenever you need your pharmacy and wellness essentials.'
  },
  restaurant: {
    general: 'Thanks for dining with us. We would love to serve you again. Visit us soon and enjoy your favourite meals.',
    stock: 'Your favourite meals are waiting. Come by and enjoy a fresh meal with us.',
    offer: 'We have a special food offer available. Come by and enjoy it while it lasts.',
    comeback: 'We would love to have you back. Come by for another meal soon.'
  },
  hardware: {
    general: 'Thanks for shopping with us. We are ready to help with your next project. Visit us or message us for stock and quotations.',
    stock: 'New hardware and building-material stock is in. Visit us or message us to check availability.',
    offer: 'We have a special deal on selected hardware and building supplies. Visit us for the current prices.',
    comeback: 'Planning another project? Visit us or send your list and we will help with stock and quotations.'
  },
  boutique: {
    general: 'Thanks for shopping with us. New styles and beauty picks are always coming in. Visit us again soon.',
    stock: 'New arrivals are in. Come by and check out the latest styles, colours and beauty picks.',
    offer: 'We have a special offer on selected fashion and beauty items. Visit us while the deal lasts.',
    comeback: 'We would love to see you again. Come by and check out the latest arrivals.'
  },
  bar: {
    general: 'Thanks for visiting us. Come through again soon for good vibes, drinks and a great time.',
    stock: 'Come through and enjoy good vibes, refreshments and a great time with us.',
    offer: 'We have a special offer at the venue. Come through and enjoy it while it lasts.',
    comeback: 'Come through again soon. We would love to have you back.'
  }
};

function promoEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function normalizePromoPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10 && digits.startsWith('0')) digits = `254${digits.slice(1)}`;
  else if (digits.length === 9 && (digits.startsWith('7') || digits.startsWith('1'))) digits = `254${digits}`;
  return digits;
}

function promoTemplateBody(type, campaign) {
  const profileCopy = PROMO_PROFILE_COPY[type] || PROMO_PROFILE_COPY.retail;
  return profileCopy[campaign] || profileCopy.general;
}

function makePromoTemplate(type, campaign, businessName) {
  return `${businessName}: ${promoTemplateBody(type, campaign)}`;
}

function personalizePromoMessage(template, customer) {
  const businessName = state.promoSettings?.business_name || 'Our business';
  return String(template || '').replaceAll('{business_name}', businessName);
}

async function renderPromotions() {
  const sec = $('#sec-promotions');
  sec.innerHTML = `<div class="loading-overlay"><div class="loading-spinner"></div> Loading customers…</div>`;
  try {
    const [customers, settingsPayload, smsConfig] = await Promise.all([
      api('/api/admin/customers'),
      api('/api/settings'),
      api('/api/admin/sms/config')
    ]);
    state.promoCustomers = (customers || []).filter(c => String(c.phone || '').trim());
    state.promoSettings = settingsPayload?.settings || {};
    state.promoProfile = settingsPayload?.profile || {};
    state.smsConfig = smsConfig || {};
    state.promoSelected = new Set();
    buildPromotions();
  } catch (e) {
    sec.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><p>${promoEscape(e.message)}</p></div>`;
  }
}

function buildPromotions() {
  const sec = $('#sec-promotions');
  const businessType = state.promoSettings?.business_type || 'retail';
  const businessName = state.promoSettings?.business_name || 'Our business';
  const profileName = state.promoProfile?.name || businessType;
  const initial = makePromoTemplate(businessType, 'general', businessName);

  sec.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1>Customer Marketing</h1>
        <p>WhatsApp and SMS promotions tailored for ${promoEscape(profileName)}</p>
      </div>
      <button class="btn btn-ghost btn-sm" id="promoRefreshBtn">Refresh Customers</button>
    </div>

    <div class="promo-consent-note">
      <strong>Customer privacy:</strong> only send promotions to customers who have agreed to receive marketing messages. A saved phone number alone does not necessarily mean marketing consent.
    </div>

    <div class="promo-grid">
      <div class="panel">
        <div class="panel-header">
          <div>
            <div class="panel-title">Campaign Message</div>
            <div class="panel-subtitle">The default wording changes automatically with the active business type.</div>
          </div>
        </div>
        <div class="panel-body">
          <label class="form-label">Campaign type</label>
          <select class="form-select" id="promoCampaignType">
            <option value="general">General Promotion</option>
            <option value="stock">New Stock / New Arrivals</option>
            <option value="offer">Special Offer</option>
            <option value="comeback">We Miss You / Come Back</option>
          </select>

          <label class="form-label" style="margin-top:14px">Message</label>
          <textarea class="form-input promo-message-editor" id="promoMessageEditor">${promoEscape(initial)}</textarea>
          <div class="promo-hint">Edit the message however you like. The same campaign text can be used for WhatsApp or SMS.</div>

          <div class="promo-hint" id="promoSmsCharCount" style="margin-top:8px">0 characters · 1 SMS segment</div>
          <div class="promo-actions">
            <button class="btn btn-ghost" id="promoResetBtn">Reset Template</button>
            <button class="btn btn-primary" id="promoPrepareBtn">Prepare WhatsApp Messages</button>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <div>
            <div class="panel-title">Customers</div>
            <div class="panel-subtitle"><span id="promoCustomerCount">${state.promoCustomers.length}</span> customers have a phone number saved</div>
          </div>
        </div>
        <div class="panel-body">
          <div class="promo-customer-toolbar">
            <input class="form-input" id="promoCustomerSearch" placeholder="Search customer or phone…">
            <label class="promo-select-all"><input type="checkbox" id="promoSelectAll"> Select all shown</label>
          </div>
          <div class="promo-customer-list" id="promoCustomerList"></div>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:20px">
      <div class="panel-header">
        <div>
          <div class="panel-title">SMS Marketing · Sozuri</div>
          <div class="panel-subtitle">Send the campaign above to the same customers you select for WhatsApp.</div>
        </div>
        <span class="badge badge-active">LIVE</span>
      </div>
      <div class="panel-body">
        <div class="promo-sms-layout" style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:end">
          <div>
            <div class="form-label">Selected customers</div>
            <div style="font-size:16px;font-weight:800;margin-top:4px"><span id="promoSmsSelectedCount">${state.promoSelected?.size || 0}</span> selected</div>
            <div class="promo-hint" style="margin-top:8px">SMS uses the message in the campaign editor above and the phone numbers saved on the selected customer records.</div>
            <div class="promo-hint" style="margin-top:5px">Provider status: <strong>${state.smsConfig?.configured ? 'Configured' : 'API key not configured on server'}</strong></div>
          </div>
          <button class="btn btn-primary" id="promoSmsSendBtn" ${state.smsConfig?.configured && state.promoSelected?.size ? '' : 'disabled'}>Send SMS to Selected (${state.promoSelected?.size || 0})</button>
        </div>
        <div id="promoSmsStatus" style="margin-top:12px"></div>
      </div>
    </div>

    <div class="panel promo-queue-panel" id="promoQueuePanel" style="display:none">
      <div class="panel-header">
        <div>
          <div class="panel-title">Ready to Send</div>
          <div class="panel-subtitle">Open each chat, review the personalized message, then tap Send in WhatsApp.</div>
        </div>
      </div>
      <div class="panel-body" id="promoQueueBody"></div>
    </div>
  `;

  renderPromoCustomerRows();

  $('#promoRefreshBtn').addEventListener('click', renderPromotions);
  $('#promoCustomerSearch').addEventListener('input', e => renderPromoCustomerRows(e.target.value));
  $('#promoCampaignType').addEventListener('change', resetPromoTemplate);
  $('#promoResetBtn').addEventListener('click', resetPromoTemplate);
  $('#promoPrepareBtn').addEventListener('click', preparePromoQueue);
  $('#promoMessageEditor').addEventListener('input', updatePromoSmsCounter);
  $('#promoSmsSendBtn')?.addEventListener('click', sendPromoSmsSelected);
  updatePromoSmsCounter();
  $('#promoSelectAll').addEventListener('change', e => {
    $$('.promo-customer-check').forEach(cb => {
      cb.checked = e.target.checked;
      const id = Number(cb.value);
      if (cb.checked) state.promoSelected.add(id);
      else state.promoSelected.delete(id);
    });
    updatePromoSelectionCount();
  });
}

function resetPromoTemplate() {
  const type = state.promoSettings?.business_type || 'retail';
  const businessName = state.promoSettings?.business_name || 'Our business';
  const campaign = $('#promoCampaignType')?.value || 'general';
  const editor = $('#promoMessageEditor');
  if (editor) editor.value = makePromoTemplate(type, campaign, businessName);
  updatePromoSmsCounter();
}

function brandedSmsMessage(text) {
  const name=String(state.promoSettings?.business_name || '').trim();
  const body=String(text || '').trim().replaceAll('{business_name}',name);
  return name && !body.toLowerCase().startsWith((name+':').toLowerCase()) ? `${name}: ${body}` : body;
}

function updatePromoSmsCounter() {
  const editor = $('#promoMessageEditor');
  const label = $('#promoSmsCharCount');
  if (!editor || !label) return;
  const length = brandedSmsMessage(editor.value).length;
  const segments = Math.max(1, Math.ceil(length / 160));
  label.textContent = `${length} characters · ${segments} SMS segment${segments === 1 ? '' : 's'}`;
}

async function sendPromoSmsSelected() {
  const editor = $('#promoMessageEditor');
  const button = $('#promoSmsSendBtn');
  const status = $('#promoSmsStatus');
  const rawMessage = editor?.value?.trim() || '';
  const message = brandedSmsMessage(rawMessage);
  const ids = [...(state.promoSelected || [])];

  if (!ids.length) {
    toast('Select at least one customer first.', 'info');
    return;
  }
  if (!rawMessage) {
    toast('Write a promotion message first.', 'error');
    return;
  }

  if (!state.promoSettings?.business_name?.trim()) { toast('Set your business name in Settings before sending SMS.', 'error'); return; }
  const customers = ids.map(id => state.promoCustomers.find(c => Number(c.id) === Number(id))).filter(Boolean);
  if (!confirm(`Send this SMS campaign through Sozuri to ${customers.length} selected customer${customers.length === 1 ? '' : 's'}?`)) return;

  const oldText = button?.textContent;
  if (button) { button.disabled = true; button.textContent = 'Sending…'; }
  if (status) status.innerHTML = `<span style="color:var(--muted)">Sending SMS to ${customers.length} customer${customers.length === 1 ? '' : 's'}…</span>`;

  try {
    const result = await api('/api/admin/sms/send', { method:'POST', body:{ message, customer_ids: ids } });
    if (Number(result.sent) < Number(result.total) || !result.sent) {
      throw new Error('Some messages could not be sent. Please check the selected recipients.');
    }
    if (status) status.textContent = '';
    openModal(`
      <div role="dialog" aria-modal="true" aria-label="SMS sent successfully" style="padding:28px;text-align:center;background:#dcfce7;color:#166534;border-radius:12px;">
        <div aria-hidden="true" style="font-size:40px;margin-bottom:12px;">✓</div>
        <h3 style="margin:0 0 20px;color:#166534;">Sent successfully</h3>
        <button type="button" class="btn btn-primary" data-sms-close style="background:#16a34a;border-color:#16a34a;color:white;">OK</button>
      </div>
    `, overlay => {
      const closeButton = overlay.querySelector('[data-sms-close]');
      closeButton.addEventListener('click', () => overlay.remove());
      overlay.addEventListener('keydown', event => { if (event.key === 'Escape') overlay.remove(); });
      closeButton.focus();
    });
  } catch (e) {
    if (status) status.innerHTML = `<div style="padding:10px 12px;border-radius:8px;background:#fee2e2;color:#991b1b;font-weight:700">${promoEscape(e.message)}</div>`;
    toast(e.message, 'error');
  } finally {
    updatePromoSelectionCount();
    if (button && !oldText) button.textContent = 'Send SMS to Selected';
  }
}

function renderPromoCustomerRows(filter = '') {
  const root = $('#promoCustomerList');
  if (!root) return;
  const q = String(filter || '').trim().toLowerCase();
  const rows = state.promoCustomers.filter(c =>
    !q || String(c.name || '').toLowerCase().includes(q) || String(c.phone || '').toLowerCase().includes(q)
  );

  root.innerHTML = rows.length ? rows.map(c => {
    const valid = normalizePromoPhone(c.phone).length >= 10;
    const checked = state.promoSelected.has(Number(c.id));
    return `
      <label class="promo-customer-row ${valid ? '' : 'invalid'}">
        <input type="checkbox" class="promo-customer-check" value="${Number(c.id)}" ${checked ? 'checked' : ''} ${valid ? '' : 'disabled'}>
        <div class="promo-customer-info">
          <strong>${promoEscape(c.name || 'Unnamed customer')}</strong>
          <span>${promoEscape(c.phone || '')}${valid ? '' : ' · Invalid phone number'}</span>
        </div>
      </label>`;
  }).join('') : `<div class="empty-state"><p>No customers with phone numbers match your search.</p></div>`;

  $$('.promo-customer-check', root).forEach(cb => cb.addEventListener('change', () => {
    const id = Number(cb.value);
    if (cb.checked) state.promoSelected.add(id);
    else state.promoSelected.delete(id);
    updatePromoSelectionCount();
  }));

  updatePromoSelectionCount();
}

function updatePromoSelectionCount() {
  const count = state.promoSelected?.size || 0;
  const btn = $('#promoPrepareBtn');
  if (btn) btn.textContent = `Prepare WhatsApp Messages (${count})`;

  const smsCount = $('#promoSmsSelectedCount');
  if (smsCount) smsCount.textContent = String(count);

  const smsBtn = $('#promoSmsSendBtn');
  if (smsBtn) {
    smsBtn.textContent = `Send SMS to Selected (${count})`;
    smsBtn.disabled = !state.smsConfig?.configured || count === 0;
  }
}

function preparePromoQueue() {
  const ids = [...(state.promoSelected || [])];
  if (!ids.length) {
    toast('Select at least one customer first.', 'info');
    return;
  }

  if (!confirm('Send only to customers who agreed to receive promotional WhatsApp messages. Continue preparing this campaign?')) return;

  const template = $('#promoMessageEditor')?.value?.trim();
  if (!template) {
    toast('Write a promotion message first.', 'error');
    return;
  }

  const customers = ids.map(id => state.promoCustomers.find(c => Number(c.id) === Number(id))).filter(Boolean);
  const queue = $('#promoQueuePanel');
  const body = $('#promoQueueBody');
  queue.style.display = 'block';
  body.innerHTML = customers.map(c => `
    <div class="promo-queue-row">
      <div>
        <strong>${promoEscape(c.name || 'Customer')}</strong>
        <div class="promo-queue-phone">${promoEscape(c.phone)}</div>
      </div>
      <button class="btn btn-primary btn-sm" data-promo-open="${Number(c.id)}">Open WhatsApp</button>
    </div>
  `).join('');

  $$('[data-promo-open]', body).forEach(btn => btn.addEventListener('click', () => openPromoWhatsApp(Number(btn.dataset.promoOpen))));
  queue.scrollIntoView({behavior: 'smooth', block: 'start'});
}

function openPromoWhatsApp(customerId) {
  const customer = state.promoCustomers.find(c => Number(c.id) === Number(customerId));
  if (!customer) return;
  const phone = normalizePromoPhone(customer.phone);
  if (phone.length < 10 || phone.length > 15) {
    toast(`Invalid WhatsApp number for ${customer.name || 'customer'}.`, 'error');
    return;
  }
  const template = $('#promoMessageEditor')?.value || '';
  const message = personalizePromoMessage(template, customer);
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}


// ── BOOT ──

// ── CUSTOMERS ──
async function renderCustomers() {
  const sec = $('#sec-customers');
  sec.innerHTML = `<div class="loading-overlay"><div class="loading-spinner"></div> Loading…</div>`;
  try {
    state.customers = await api('/api/admin/customers');
    buildCustomers();
  } catch(e) { sec.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`; }
}

function buildCustomers() {
  const sec = $('#sec-customers');
  sec.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1>Customers</h1>
        <p>${state.customers.length} customers registered</p>
      </div>
      <button class="btn btn-primary" id="addCustomerBtn">Add Customer</button>
    </div>
    <div class="panel">
      <table class="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Phone</th>
            <th>Email</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${state.customers.map(c=>`
            <tr>
              <td><strong>${c.name}</strong></td>
              <td style="color:var(--muted)">${c.phone||'—'}</td>
              <td style="color:var(--muted)">${c.email||'—'}</td>
              <td>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                  <button class="btn btn-ghost btn-sm" onclick="editCustomer(${c.id})">Edit</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  $('#addCustomerBtn').addEventListener('click', () => openCustomerModal(null));
}

function editCustomer(id) {
  const c = state.customers.find(x => x.id === id);
  if (c) openCustomerModal(c);
}

function openCustomerModal(customer) {
  const isNew = !customer;
  const overlay = openModal(`
    <div class="modal-header">
      <div class="modal-title">${isNew ? 'Add Customer' : 'Edit Customer'}</div>
      <button class="modal-close" id="modalClose">✕</button>
    </div>
    <div class="form-grid form-grid-2">
      <div class="form-group" style="grid-column:1/-1">
        <label class="form-label">Customer Name</label>
        <input class="form-input" id="mName" value="${customer?.name||''}" placeholder="e.g. John Doe">
      </div>
      <div class="form-group">
        <label class="form-label">Phone</label>
        <input class="form-input" id="mPhone" value="${customer?.phone||''}" placeholder="e.g. 07... or +254...">
      </div>
      <div class="form-group">
        <label class="form-label">Email</label>
        <input class="form-input" id="mEmail" type="email" value="${customer?.email||''}" placeholder="Optional">
      </div>
      <div class="form-group" style="grid-column:1/-1">
        <label class="form-label">Notes</label>
        <input class="form-input" id="mNotes" value="${customer?.notes||''}" placeholder="Preferences, address, etc.">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="mCancel">Cancel</button>
      <button class="btn btn-primary" id="mSave">Save</button>
    </div>
  `);
  overlay.querySelector('#modalClose').onclick = () => overlay.remove();
  overlay.querySelector('#mCancel').onclick = () => overlay.remove();
  overlay.querySelector('#mSave').onclick = async () => {
    const payload = {
      name: overlay.querySelector('#mName').value.trim(),
      phone: overlay.querySelector('#mPhone').value.trim(),
      email: overlay.querySelector('#mEmail').value.trim(),
      notes: overlay.querySelector('#mNotes').value.trim(),
    };
    if (!payload.name) {
      toast('Customer Name is required', 'error');
      return;
    }
    if (customer) payload.id = customer.id;
    try {
      state.customers = await api('/api/admin/customer', { method:'POST', body: payload });
      toast(`Customer ${isNew?'added':'updated'} successfully`);
      overlay.remove();
      buildCustomers();
    } catch(e) { toast(e.message, 'error'); }
  };
}

// ── BOOT ──
async function boot() {
  const data = await api('/api/bootstrap');
  if (!data) return;
  state.user = data.user;
  state.settings = data.settings || {};
  state.profile = data.profile || {};
  if (state.user.role !== 'manager') { location.href = '/admin'; return; }

  const businessName = state.settings.business_name || state.profile.name || 'POS';
  const profileName = state.profile.name || 'Business';
  const businessIcon = state.profile.icon || '🏪';
  const itemLabel = state.profile.item_label || 'Products';
  const businessNameEl = $('#adminBusinessName');
  const businessIconEl = $('#adminBusinessIcon');
  const portalTagEl = $('#adminPortalTag');
  const productsLabelEl = $('#adminProductsLabel');
  if (businessNameEl) businessNameEl.textContent = businessName;
  if (businessIconEl) businessIconEl.textContent = businessIcon;
  if (portalTagEl) portalTagEl.textContent = `${profileName} Admin`;
  if (productsLabelEl) productsLabelEl.textContent = itemLabel;
  document.title = `${businessName} — Admin Portal`;
  // render user info in sidebar
  $('#userDisplayName').textContent = state.user.name;
  $('#userAvatarLetter').textContent = (state.user.name||'A')[0].toUpperCase();
  // nav wiring
  $$('.nav-item').forEach(el => {
    el.addEventListener('click', () => navigate(el.dataset.section));
  });
  navigate('dashboard');
}

boot().catch(e => { console.error(e); });
