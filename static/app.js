const money = cents => `KES ${(cents / 100).toFixed(2)}`;
const moneyRaw = cents => (cents / 100).toFixed(2);
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

// ── Receipt Modal ─────────────────────────────────────────────────────────────
const receiptEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
function showReceiptModal(order, isKot = false) {
  document.getElementById('receiptModal')?.remove();

  const bname = state.settings?.business_name || 'POS SYSTEM';
  const baddr = state.settings?.address || '';
  const bphone = state.settings?.phone || '';
  const bEmail = state.settings?.email || '';
  const bPin = state.settings?.kra_pin || '';
  const bfooter = state.settings?.receipt_footer || 'Thank you for your business!\n------- END OF RECEIPT -------';
  const isQuote = Boolean(order.is_quote || order.order_type === 'quote');

  let bodyHtml = '';
  if (isKot) {
    const itemRows = (order.items || []).map(item =>
      `<tr>
        <td>
          <strong>${item.qty} x ${item.name}</strong>
          ${item.variant_info ? `<br><small style="color:#666">[${item.variant_info}]</small>` : ''}
          ${item.note ? `<br><small style="color:#2563eb">* ${item.note}</small>` : ''}
        </td>
      </tr>`
    ).join('');

    bodyHtml = `
      <div class="receipt">
        <h1 style="font-size:18px;">*** KITCHEN / BAR ORDER ***</h1>
        <p>Ticket: <strong>#${order.ticket_no}</strong></p>
        <div style="border-top: 2px dashed var(--line); margin: 10px 0;"></div>
        <div class="receipt-line"><span>Table / Tab</span><strong>${order.table_name || 'Counter'}</strong></div>
        <div class="receipt-line"><span>Server</span><strong>${order.employee_name || '-'}</strong></div>
        <div class="receipt-line"><span>Time</span><strong>${new Date().toLocaleTimeString()}</strong></div>
        ${order.notes ? `<div class="receipt-line"><span>Note</span><strong>${order.notes}</strong></div>` : ''}
        <div style="border-top: 2px dashed var(--line); margin: 10px 0;"></div>
        <table><tbody>${itemRows}</tbody></table>
        <div style="border-top: 2px dashed var(--line); margin: 10px 0;"></div>
        <button id="receiptPrintBtn">Print KOT</button>
      </div>
    `;
  } else {
    const itemRows = (order.items || []).map(item => {
      const qty = Number(item.qty ?? 1);
      const total = Number(item.line_total_cents || 0);
      const unit = Number.isFinite(Number(item.unit_price_cents))
        ? Number(item.unit_price_cents) : (qty ? total / qty : 0);
      const notes = [
        item.variant_info && `<small>${receiptEscape(item.variant_info)}</small>`,
        item.batch_no && `<small>Batch: ${receiptEscape(item.batch_no)}</small>`,
        item.note && `<small>${receiptEscape(item.note)}</small>`
      ].filter(Boolean).join(' ');
      return `
        <tr class="receipt-item-name"><td colspan="3">${receiptEscape(item.name)} ${notes}</td></tr>
        <tr class="receipt-item-values">
          <td>${receiptEscape(qty)}</td><td>${moneyRaw(unit)}</td><td>${moneyRaw(total)}</td>
        </tr>`;
    }).join('');
    // Do not infer VAT from today's settings. Respect the tax recorded with this sale.
    const grossCents = Number(order.total_cents || 0);
    const vatAmount = Math.max(0, Math.min(grossCents, Math.round(Number(order.tax_cents || 0))));
    const exclVat = grossCents - vatAmount;
    const savedRate = Number(order.tax_rate);
    const taxRate = vatAmount > 0
      ? (order.tax_rate != null && Number.isFinite(savedRate) ? savedRate
        : (exclVat > 0 ? vatAmount / exclVat * 100 : 0)) : 0;
    const discountCents = Math.max(0, Number(order.discount_cents || 0));
    const subtotalCents = Number(order.subtotal_cents ?? (grossCents + discountCents));
    const saleStamp = Number(order.created_at || order.paid_at || 0);
    const created = saleStamp > 0 ? new Date(saleStamp * 1000) : new Date();
    const printedAt = new Date().toLocaleTimeString('en-KE', {hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:true});
    const contact = [
      baddr && `<p class="receipt-contact">Address: ${receiptEscape(baddr)}</p>`,
      bphone && `<p class="receipt-contact">Mobile: ${receiptEscape(bphone)}</p>`,
      bEmail && `<p class="receipt-contact">Email: ${receiptEscape(bEmail)}</p>`,
      bPin && `<p class="receipt-contact">KRA PIN: ${receiptEscape(bPin)}</p>`
    ].filter(Boolean).join('');
    bodyHtml = `
      <div class="receipt sales-receipt">
        <header class="receipt-business-header">
          <h1 class="receipt-business-name">${receiptEscape(bname)}</h1>
          ${contact}
          <p class="receipt-kind">${isQuote ? 'QUOTATION / ESTIMATE' : 'SALES RECEIPT'}</p>
          <h2 class="receipt-sale-title">${isQuote ? 'Quotation' : 'Cash Sale'}</h2>
        </header>
        <div class="receipt-details">
          <div class="receipt-line"><span>Name</span><span>${receiptEscape(order.customer_name || 'Walk-In Customer')}</span></div>
          <div class="receipt-line"><span>Receipt No.</span><span>${receiptEscape(order.ticket_no || order.id || '-')}</span></div>
          <div class="receipt-line"><span>Date</span><span>${created.toLocaleDateString('en-GB')}</span></div>
          <div class="receipt-line"><span>Print Time</span><span>${printedAt}</span></div>
          ${order.table_name ? `<div class="receipt-line"><span>Table / Tab</span><span>${receiptEscape(order.table_name)}</span></div>` : ''}
          <div class="receipt-line"><span>Type</span><span>${receiptEscape((order.order_type || 'walk-in').toUpperCase())}</span></div>
          <div class="receipt-line"><span>Served By</span><span>${receiptEscape(order.employee_name || 'POS Terminal')}</span></div>
          <div class="receipt-line"><span>Status</span><span>${receiptEscape((order.status || 'open').toUpperCase())}</span></div>
        </div>
        <table class="receipt-items">
          <thead><tr><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
        <div class="receipt-totals">
          ${discountCents ? `<div class="receipt-line"><span>Subtotal</span><span>${moneyRaw(subtotalCents)}</span></div><div class="receipt-line"><span>Discount</span><span>-${moneyRaw(discountCents)}</span></div>` : ''}
          <div class="receipt-line"><span>Total Excl. VAT</span><span>${moneyRaw(exclVat)}</span></div>
          <div class="receipt-line"><span>VAT Total (${Number(taxRate.toFixed(1))}%)</span><span>${moneyRaw(vatAmount)}</span></div>
          <div class="receipt-total"><span>Total</span><strong>KES ${moneyRaw(grossCents)}</strong></div>
        </div>
        ${isQuote ? '' : `
          <div class="receipt-payment">
            <div class="receipt-line"><span>Payment Method</span><span>${receiptEscape((order.payment_method || 'CASH').toUpperCase())}</span></div>
            ${order.payment_ref ? `<div class="receipt-line"><span>Txn Ref</span><span>${receiptEscape(order.payment_ref)}</span></div>` : ''}
          </div>
        `}
        <footer class="receipt-note">${receiptEscape(bfooter)}</footer>
        <button id="receiptPrintBtn">Print ${isQuote ? 'Quotation' : 'Receipt'}</button>
      </div>
    `;

  }

  const overlay = document.createElement('div');
  overlay.id = 'receiptModal';
  overlay.className = 'receipt-modal-overlay';
  overlay.innerHTML = `
    <div class="receipt-modal" role="dialog" aria-modal="true">
      <button class="receipt-modal-close" id="receiptModalClose" title="Close">&times;</button>
      <div class="receipt-modal-print-area">
        ${bodyHtml}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.classList.add('receipt-modal-visible');

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };

  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('receiptModalClose').addEventListener('click', close);
  document.getElementById('receiptPrintBtn').addEventListener('click', () => window.print());

  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
}

// ── UI Utilities ─────────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]||'•'}</span><span>${msg}</span>`;
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    document.body.appendChild(container);
  }
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── SPA Pages ────────────────────────────────────────────────────────────────
const SPA_PAGES = {
  '/pos':       { title: 'POS',       active: 'POS',       shell: 'pos-shell',  page: 'pos' },
  '/suppliers': { title: 'Suppliers', active: 'Suppliers', shell: 'page-shell', page: 'suppliers' },
  '/sales':     { title: 'Sales',     active: 'Sales',     shell: 'page-shell', page: 'sales' },
  '/products':  { title: 'Products',  active: 'Products',  shell: 'page-shell', page: 'products' },
  '/customers': { title: 'Customers', active: 'Customers', shell: 'page-shell', page: 'customers' },
  '/reports':   { title: 'Reports',   active: 'Reports',   shell: 'page-shell', page: 'reports' },
  '/settings':  { title: 'Settings',  active: 'Settings',  shell: 'page-shell', page: 'settings' },
};

// ── State & Capabilities ──────────────────────────────────────────────────────
const state = {
  user: null,
  settings: {},
  profile: {},
  profiles: {},
  capabilities: {},
  tables: [],
  alerts: { expiry: 0, low_stock: 0 },
  employees: [],
  selectedEmployeeId: null,
  selectedTableId: null,
  pricingTier: 'retail', // 'retail' or 'wholesale'
  categories: [],
  items: [],
  activeCategory: null,
  order: null,
  searchQuery: '',
};

function hasCap(capName) {
  return Boolean(state.capabilities && state.capabilities[capName]);
}

// Services can be sold repeatedly and do not consume physical inventory.
function garageUnitOptions(currentUnit = 'pcs') {
  const units = [...new Set(['pcs', 'btl', 'set', 'litre', 'service', currentUnit])];
  const escape = value => String(value).replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]));
  return units.map(unit => `<option value="${escape(unit)}" ${currentUnit === unit ? 'selected' : ''}>${unit === 'service' ? 'Service / Labour (no stock)' : escape(unit)}</option>`).join('');
}

function tracksStock(item) {
  return Boolean(item && item.unit !== 'service' && item.stock_qty !== undefined);
}

function syncActiveTopNav(path = window.location.pathname) {
  const navRoot = qs('#topNav') || qs('header nav');
  if (!navRoot) return;
  const currentPath = (path || '/pos').replace(/\/+$/, '') || '/pos';
  qsa('.nav-link', navRoot).forEach(link => {
    const linkPath = new URL(link.href, window.location.origin).pathname.replace(/\/+$/, '') || '/';
    const active = linkPath === currentPath;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function updateHeaderAndNav() {
  const bLogo = qs('.brand-logo');
  if (bLogo && state.profile && state.profile.icon) bLogo.textContent = state.profile.icon;
  const bName = qs('#brandName') || qs('.brand-text span');
  if (bName && state.settings && state.settings.business_name) bName.textContent = state.settings.business_name;
  const bTag = qs('#brandTagline') || qs('.brand-text small');
  if (bTag && state.settings && state.settings.business_tagline) bTag.textContent = state.settings.business_tagline;

  // Remove quick profile switcher from inside the portal (store selection only on login)
  qs('#quickProfileWrap')?.remove();

  // Ensure Admin Portal link is in top nav
  const nav = qs('#topNav');
  if (nav && !qs('#navAdminLink')) {
    const adminLink = document.createElement('a');
    adminLink.id = 'navAdminLink';
    adminLink.className = 'nav-link';
    adminLink.href = 'admin.html';
    adminLink.innerHTML = '<span class="nav-icon">👑</span>Admin';
    nav.appendChild(adminLink);
  }

  // Hook up Logout button to return to login screen
  const logoutBtn = qs('.logout');
  if (logoutBtn) {
    logoutBtn.onclick = (e) => {
      e.preventDefault();
      localStorage.removeItem('pos_logged_in');
      showLoginScreen();
    };
  }

  // Setup theme toggle button in header
  const themeToggle = qs('#themeToggleBtn');
  if (themeToggle) {
    const currentTheme = document.documentElement.getAttribute('data-theme') || localStorage.getItem('pos_theme') || 'light';
    themeToggle.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
    themeToggle.title = currentTheme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme';
    themeToggle.onclick = () => {
      const active = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      const next = active === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('pos_theme', next);
      themeToggle.textContent = next === 'dark' ? '☀️' : '🌙';
      themeToggle.title = next === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme';
      // Re-render settings if settings page is currently active
      if (qs('#themeCardLight') || qs('#themeCardDark')) {
        renderSettings();
      }
    };
  }

  const navRoot = qs('#topNav') || qs('header nav');
  if (navRoot) {
    const navItems = [
      { icon: '🖥️', label: 'POS', href: '/pos' },
    ];
    if (hasCap('suppliers')) {
      navItems.push({ icon: '🚚', label: 'Suppliers', href: '/suppliers' });
    }
    navItems.push({ icon: '🧾', label: 'Sales', href: '/sales' });
    const productLabel = state.profile?.id === 'garage' ? 'Catalogue' : state.profile?.item_label || 'Products';
    navItems.push({ icon: '📦', label: productLabel, href: '/products' });
    navItems.push({ icon: '📊', label: 'Reports', href: '/reports' });
    navItems.push({ icon: '⚙️', label: 'Settings', href: '/settings' });

    navRoot.innerHTML = navItems.map(item =>
      `<a class="nav-link" href="${item.href}"><span class="nav-icon">${item.icon}</span>${item.label}</a>`
    ).join('');
    syncActiveTopNav();
  }
}

if (!window.__posActiveNavRouterHooked) {
  window.__posActiveNavRouterHooked = true;
  const originalPushState = history.pushState.bind(history);
  const originalReplaceState = history.replaceState.bind(history);

  history.pushState = (...args) => {
    const result = originalPushState(...args);
    queueMicrotask(() => syncActiveTopNav());
    return result;
  };

  history.replaceState = (...args) => {
    const result = originalReplaceState(...args);
    queueMicrotask(() => syncActiveTopNav());
    return result;
  };

  window.addEventListener('popstate', () => queueMicrotask(() => syncActiveTopNav()));
  document.addEventListener('click', event => {
    const link = event.target.closest?.('#topNav .nav-link, header nav .nav-link');
    if (!link) return;
    const path = new URL(link.href, window.location.origin).pathname;
    syncActiveTopNav(path);
  });
}

// ── Full Profiles Data & Local Offline POS Storage ───────────────────────────
const LOCAL_PROFILES_DATA = {"profiles":{"retail":{"id":"retail","name":"Retail / Mini-Mart","tagline":"Supermarket, Grocery & General Retail POS","icon":"🛒","item_label":"Products","order_type_default":"walk-in","capabilities":{"barcode":true,"stock_tracking":true,"reorder_levels":true,"suppliers":true,"tables":false,"waiters":false,"kot":false,"batches_expiry":false,"decimal_qty":false,"units_extended":false,"quotations":true,"wholesale_pricing":false,"variants":false,"order_notes":false,"order_types":["walk-in","quote","delivery"]}},"pharmacy":{"id":"pharmacy","name":"Pharmacy","tagline":"Pharmacy & Chemist POS","icon":"💊","item_label":"Medicines","order_type_default":"walk-in","capabilities":{"barcode":true,"stock_tracking":true,"reorder_levels":true,"suppliers":true,"tables":false,"waiters":false,"kot":false,"batches_expiry":true,"decimal_qty":false,"units_extended":false,"quotations":false,"wholesale_pricing":false,"variants":false,"order_notes":true,"order_types":["walk-in","prescription","delivery"]}},"restaurant":{"id":"restaurant","name":"Restaurant / Café","tagline":"Food, Dining & Kitchen POS","icon":"🍽️","item_label":"Menu Items","order_type_default":"dine-in","capabilities":{"barcode":false,"stock_tracking":true,"reorder_levels":false,"suppliers":true,"tables":true,"waiters":true,"kot":true,"batches_expiry":false,"decimal_qty":false,"units_extended":false,"quotations":false,"wholesale_pricing":false,"variants":false,"order_notes":true,"order_types":["dine-in","takeaway","delivery"]}},"hardware":{"id":"hardware","name":"Hardware","tagline":"Hardware, Building Materials & Tools POS","icon":"🔧","item_label":"Hardware Items","order_type_default":"walk-in","capabilities":{"barcode":true,"stock_tracking":true,"reorder_levels":true,"suppliers":true,"tables":false,"waiters":false,"kot":false,"batches_expiry":false,"decimal_qty":true,"units_extended":true,"quotations":true,"wholesale_pricing":true,"variants":false,"order_notes":true,"order_types":["walk-in","quote","delivery"]}},"boutique":{"id":"boutique","name":"Boutique / Cosmetics","tagline":"Fashion, Beauty & Cosmetics POS","icon":"👗","item_label":"Apparel & Beauty","order_type_default":"walk-in","capabilities":{"barcode":true,"stock_tracking":true,"reorder_levels":true,"suppliers":true,"tables":false,"waiters":false,"kot":false,"batches_expiry":false,"decimal_qty":false,"units_extended":false,"quotations":false,"wholesale_pricing":false,"variants":true,"order_notes":false,"order_types":["walk-in","layaway","delivery"]}},"bar":{"id":"bar","name":"Bar / Nightclub","tagline":"Bar, Lounge & Club POS","icon":"🍸","item_label":"Drinks & Snacks","order_type_default":"dine-in","capabilities":{"barcode":true,"stock_tracking":true,"reorder_levels":false,"suppliers":true,"tables":true,"waiters":true,"kot":true,"batches_expiry":false,"decimal_qty":false,"units_extended":false,"quotations":false,"wholesale_pricing":false,"variants":false,"order_notes":true,"order_types":["dine-in","bar-tab","takeaway"]}},"garage":{"id":"garage","name":"Garage & Auto Spares","tagline":"Auto Parts, Repairs & Workshop POS","icon":"🚗","item_label":"Parts & Services","order_type_default":"walk-in","capabilities":{"barcode":true,"stock_tracking":true,"reorder_levels":true,"suppliers":true,"tables":false,"waiters":false,"kot":false,"batches_expiry":false,"decimal_qty":false,"units_extended":true,"quotations":true,"wholesale_pricing":false,"variants":false,"order_notes":true,"order_types":["walk-in","service","quote"]}},"tech_accessories":{"id":"tech_accessories","name":"Phone Accessories & Gadgets","tagline":"Covers, Earphones, Chargers & Everyday Tech POS","icon":"📱","item_label":"Accessories & Gadgets","order_type_default":"walk-in","capabilities":{"barcode":true,"stock_tracking":true,"reorder_levels":true,"suppliers":true,"tables":false,"waiters":false,"kot":false,"batches_expiry":false,"decimal_qty":false,"units_extended":false,"quotations":false,"wholesale_pricing":true,"variants":true,"order_notes":true,"order_types":["walk-in","delivery","wholesale"]}}},"sample_data":{"pharmacy":{"categories":["Pain & Fever Relief","Antibiotics & Prescriptions","Cough, Cold & Flu","Vitamins & Supplements","First Aid & Antiseptics"],"items":[{"category":"Pain & Fever Relief","name":"Paracetamol 500mg Tablets","price":100,"cost":60,"sku":"PHARM-001","barcode":"616120100001","stock":80,"unit":"strip","reorder_level":15,"batch_no":"B4829","expiry_date":"2027-11-30","manufacturer":"Dawa Ltd","strength":"500mg","image_url":"/static/uploads/sample_paracetamol.jpg","color":"#0e7490"},{"category":"Antibiotics & Prescriptions","name":"Amoxicillin 500mg Capsules","price":350,"cost":220,"sku":"PHARM-002","barcode":"616120100002","stock":40,"unit":"strip","reorder_level":10,"batch_no":"AM912","expiry_date":"2027-08-15","manufacturer":"Cosmos Ltd","strength":"500mg","image_url":"/static/uploads/sample_amoxicillin.jpg","color":"#0d9488"},{"category":"Cough, Cold & Flu","name":"Cough Relief Syrup 100ml","price":280,"cost":180,"sku":"PHARM-003","barcode":"616120100003","stock":24,"unit":"btl","reorder_level":6,"batch_no":"CR104","expiry_date":"2026-12-31","manufacturer":"Regal Pharma","strength":"100ml","image_url":"/static/uploads/sample_cough_syrup.jpg","color":"#b45309"},{"category":"Cough, Cold & Flu","name":"Cetirizine 10mg Tablets","price":150,"cost":90,"sku":"PHARM-004","barcode":"616120100004","stock":50,"unit":"strip","reorder_level":10,"batch_no":"CT553","expiry_date":"2027-05-20","manufacturer":"GlaxoSmithKline","strength":"10mg","image_url":"/static/uploads/sample_cetirizine.jpg","color":"#0284c7"},{"category":"Vitamins & Supplements","name":"Multivitamin Effervescent 20s","price":650,"cost":450,"sku":"PHARM-005","barcode":"616120100005","stock":18,"unit":"tube","reorder_level":5,"batch_no":"MV771","expiry_date":"2028-01-10","manufacturer":"Bayer","strength":"20 tabs","image_url":"/static/uploads/sample_multivitamin.jpg","color":"#d97706"},{"category":"First Aid & Antiseptics","name":"Povidone Iodine 100ml","price":220,"cost":140,"sku":"PHARM-006","barcode":"616120100006","stock":30,"unit":"btl","reorder_level":8,"batch_no":"PI302","expiry_date":"2027-04-01","manufacturer":"Medilab","strength":"10%","image_url":"/static/uploads/sample_iodine.jpg","color":"#9f1239"}]},"hardware":{"categories":["Cement & Building","Fasteners & Fixings","Paints & Finishes","Plumbing","Hand Tools","Electrical"],"items":[{"category":"Cement & Building","name":"Simba Portland Cement 50kg","price":750,"wholesale_price":680,"cost":620,"sku":"HDW-001","barcode":"616130100001","stock":120,"unit":"bag","reorder_level":25,"decimal_qty_enabled":0,"image_url":"/static/uploads/sample_cement.jpg","color":"#475569"},{"category":"Fasteners & Fixings","name":"Steel Wire Nails 3-inch","price":180,"wholesale_price":150,"cost":120,"sku":"HDW-002","barcode":"616130100002","stock":250,"unit":"kg","reorder_level":30,"decimal_qty_enabled":1,"image_url":"/static/uploads/sample_nails.jpg","color":"#64748b"},{"category":"Paints & Finishes","name":"Crown Vinyl Gloss Paint White 4L","price":2400,"wholesale_price":2100,"cost":1800,"sku":"HDW-003","barcode":"616130100003","stock":30,"unit":"tin","reorder_level":5,"decimal_qty_enabled":0,"image_url":"/static/uploads/sample_paint.jpg","color":"#ea580c"},{"category":"Plumbing","name":"PPR Plumbing Pipe 1/2-inch","price":120,"wholesale_price":95,"cost":80,"sku":"HDW-004","barcode":"616130100004","stock":300,"unit":"metre","reorder_level":50,"decimal_qty_enabled":1,"image_url":"/static/uploads/sample_pipe.jpg","color":"#10b981"},{"category":"Hand Tools","name":"Heavy Duty Claw Hammer 16oz","price":850,"wholesale_price":720,"cost":550,"sku":"HDW-005","barcode":"616130100005","stock":15,"unit":"pcs","reorder_level":4,"decimal_qty_enabled":0,"image_url":"/static/uploads/sample_hammer.jpg","color":"#1e293b"},{"category":"Electrical","name":"Twin & Earth Electric Cable 2.5mm","price":160,"wholesale_price":135,"cost":110,"sku":"HDW-006","barcode":"616130100006","stock":500,"unit":"metre","reorder_level":100,"decimal_qty_enabled":1,"image_url":"/static/uploads/sample_cable.jpg","color":"#dc2626"}]},"boutique":{"categories":["Women's Apparel","Men's Wear","Lip & Face Beauty","Skincare","Denim & Trousers"],"items":[{"category":"Women's Apparel","name":"Floral Summer Chiffon Dress","price":2800,"cost":1600,"sku":"BTQ-001","barcode":"616140100001","stock":24,"unit":"pcs","reorder_level":6,"image_url":"/static/uploads/sample_dress.jpg","color":"#db2777","variants_json":"[{\"name\": \"S / Sky Blue\", \"size\": \"S\", \"color\": \"Sky Blue\", \"shade\": \"\", \"stock\": 6, \"price_cents\": 280000}, {\"name\": \"M / Sky Blue\", \"size\": \"M\", \"color\": \"Sky Blue\", \"shade\": \"\", \"stock\": 8, \"price_cents\": 280000}, {\"name\": \"L / Sky Blue\", \"size\": \"L\", \"color\": \"Sky Blue\", \"shade\": \"\", \"stock\": 4, \"price_cents\": 280000}, {\"name\": \"M / Rose Pink\", \"size\": \"M\", \"color\": \"Rose Pink\", \"shade\": \"\", \"stock\": 6, \"price_cents\": 280000}]"},{"category":"Men's Wear","name":"Men's Oxford Slim Fit Shirt","price":2200,"cost":1300,"sku":"BTQ-002","barcode":"616140100002","stock":30,"unit":"pcs","reorder_level":8,"image_url":"/static/uploads/sample_shirt.jpg","color":"#2563eb","variants_json":"[{\"name\": \"38 / White\", \"size\": \"38\", \"color\": \"White\", \"shade\": \"\", \"stock\": 8, \"price_cents\": 220000}, {\"name\": \"40 / White\", \"size\": \"40\", \"color\": \"White\", \"shade\": \"\", \"stock\": 10, \"price_cents\": 220000}, {\"name\": \"42 / Navy Blue\", \"size\": \"42\", \"color\": \"Navy Blue\", \"shade\": \"\", \"stock\": 12, \"price_cents\": 220000}]"},{"category":"Lip & Face Beauty","name":"Velvet Matte Longstay Lipstick","price":850,"cost":450,"sku":"BTQ-003","barcode":"616140100003","stock":45,"unit":"pcs","reorder_level":12,"image_url":"/static/uploads/sample_lipstick.jpg","color":"#be123c","variants_json":"[{\"name\": \"Ruby Red #01\", \"size\": \"\", \"color\": \"Red\", \"shade\": \"Ruby Red\", \"stock\": 15, \"price_cents\": 85000}, {\"name\": \"Velvet Nude #05\", \"size\": \"\", \"color\": \"Nude\", \"shade\": \"Velvet Nude\", \"stock\": 18, \"price_cents\": 85000}, {\"name\": \"Plum Desire #09\", \"size\": \"\", \"color\": \"Purple\", \"shade\": \"Plum Desire\", \"stock\": 12, \"price_cents\": 85000}]"},{"category":"Skincare","name":"Hydrating Glow Serum 50ml","price":1500,"cost":900,"sku":"BTQ-004","barcode":"616140100004","stock":20,"unit":"btl","reorder_level":5,"image_url":"/static/uploads/sample_serum.jpg","color":"#f59e0b"},{"category":"Denim & Trousers","name":"High-Waist Stretch Denim Jeans","price":2500,"cost":1400,"sku":"BTQ-005","barcode":"616140100005","stock":18,"unit":"pcs","reorder_level":5,"image_url":"/static/uploads/sample_jeans.jpg","color":"#1e3a8a","variants_json":"[{\"name\": \"Size 28 / Dark Wash\", \"size\": \"28\", \"color\": \"Dark Wash\", \"shade\": \"\", \"stock\": 6, \"price_cents\": 250000}, {\"name\": \"Size 30 / Dark Wash\", \"size\": \"30\", \"color\": \"Dark Wash\", \"shade\": \"\", \"stock\": 7, \"price_cents\": 250000}, {\"name\": \"Size 32 / Light Wash\", \"size\": \"32\", \"color\": \"Light Wash\", \"shade\": \"\", \"stock\": 5, \"price_cents\": 250000}]"}]},"restaurant":{"categories":["Burgers & Grills","Main Courses","Pizzas","Pasta & Bowls","Desserts","Beverages"],"items":[{"category":"Burgers & Grills","name":"Classic Beef Burger with Fries","price":650,"cost":320,"sku":"REST-001","barcode":"","stock":100,"unit":"plate","reorder_level":0,"image_url":"/static/uploads/sample_burger.jpg","color":"#b45309"},{"category":"Main Courses","name":"Grilled Herb Chicken Breast","price":850,"cost":420,"sku":"REST-002","barcode":"","stock":80,"unit":"plate","reorder_level":0,"image_url":"/static/uploads/sample_chicken.jpg","color":"#c2410c"},{"category":"Pizzas","name":"Wood-Fired Margherita Pizza","price":900,"cost":400,"sku":"REST-003","barcode":"","stock":50,"unit":"pie","reorder_level":0,"image_url":"/static/uploads/sample_pizza.jpg","color":"#dc2626"},{"category":"Pasta & Bowls","name":"Creamy Chicken Alfredo Pasta","price":750,"cost":350,"sku":"REST-004","barcode":"","stock":60,"unit":"plate","reorder_level":0,"image_url":"/static/uploads/sample_pasta.jpg","color":"#ca8a04"},{"category":"Desserts","name":"Fresh Fruit Salad & Ice Cream","price":350,"cost":150,"sku":"REST-005","barcode":"","stock":40,"unit":"bowl","reorder_level":0,"image_url":"/static/uploads/sample_fruit.jpg","color":"#10b981"},{"category":"Beverages","name":"House Cappuccino Coffee","price":280,"cost":80,"sku":"REST-006","barcode":"","stock":200,"unit":"cup","reorder_level":0,"image_url":"/static/uploads/sample_coffee.jpg","color":"#78350f"}]},"retail":{"categories":["Bakery & Bread","Dairy & Milk","Cooking Oils & Spices","Sugar, Flour & Rice","Cleaning & Household"],"items":[{"category":"Bakery & Bread","name":"Fresh Sliced White Bread 400g","price":65,"cost":50,"sku":"RET-001","barcode":"616110100001","stock":45,"unit":"loaf","reorder_level":10,"image_url":"/static/uploads/sample_bread.jpg","color":"#d97706"},{"category":"Dairy & Milk","name":"Fresh Whole Milk 500ml","price":60,"cost":45,"sku":"RET-002","barcode":"616110100002","stock":30,"unit":"pkt","reorder_level":8,"image_url":"/static/uploads/sample_milk.jpg","color":"#0ea5e9"},{"category":"Cooking Oils & Spices","name":"Pure Vegetable Cooking Oil 1L","price":290,"cost":240,"sku":"RET-003","barcode":"616110100003","stock":25,"unit":"btl","reorder_level":5,"image_url":"/static/uploads/sample_oil.jpg","color":"#eab308"},{"category":"Sugar, Flour & Rice","name":"White Sugar Refined 1kg","price":170,"cost":140,"sku":"RET-004","barcode":"616110100004","stock":50,"unit":"pkt","reorder_level":10,"image_url":"/static/uploads/sample_sugar.jpg","color":"#64748b"},{"category":"Sugar, Flour & Rice","name":"Pure Basmati Rice 2kg","price":450,"cost":370,"sku":"RET-005","barcode":"616110100005","stock":20,"unit":"bag","reorder_level":5,"image_url":"/static/uploads/sample_rice.jpg","color":"#ca8a04"},{"category":"Cleaning & Household","name":"Multi-Purpose Bar Soap 800g","price":160,"cost":130,"sku":"RET-006","barcode":"616110100006","stock":35,"unit":"bar","reorder_level":8,"image_url":"/static/uploads/sample_soap.jpg","color":"#10b981"}]},"bar":{"categories":["Beers","Cocktails","Spirits","Wines","Soft Drinks","Snacks"],"items":[{"name":"Tusker Lager 500ml","category":"Beers","price":250,"cost":200,"color":"#d97706","sku":"BE-001","stock_qty":120,"unit":"btl"},{"name":"Guinness 500ml","category":"Beers","price":300,"cost":240,"color":"#1e293b","sku":"BE-002","stock_qty":80,"unit":"btl"},{"name":"White Cap 500ml","category":"Beers","price":250,"cost":200,"color":"#94a3b8","sku":"BE-003","stock_qty":100,"unit":"btl"},{"name":"Heineken","category":"Beers","price":350,"cost":280,"color":"#15803d","sku":"BE-004","stock_qty":60,"unit":"btl"},{"name":"Mojito","category":"Cocktails","price":600,"cost":300,"color":"#22c55e","sku":"CO-001","stock_qty":999,"unit":"glass"},{"name":"Margarita","category":"Cocktails","price":650,"cost":320,"color":"#eab308","sku":"CO-002","stock_qty":999,"unit":"glass"},{"name":"Jameson 750ml","category":"Spirits","price":3500,"cost":2800,"color":"#166534","sku":"SP-001","stock_qty":12,"unit":"btl"},{"name":"Gilbeys Gin 750ml","category":"Spirits","price":1800,"cost":1400,"color":"#0ea5e9","sku":"SP-002","stock_qty":15,"unit":"btl"},{"name":"Four Cousins Sweet","category":"Wines","price":1200,"cost":900,"color":"#db2777","sku":"WI-001","stock_qty":24,"unit":"btl"},{"name":"Coca Cola 300ml","category":"Soft Drinks","price":80,"cost":50,"color":"#dc2626","sku":"SD-001","stock_qty":60,"unit":"btl"},{"name":"Roasted Peanuts","category":"Snacks","price":100,"cost":60,"color":"#d97706","sku":"SN-001","stock_qty":30,"unit":"pkt"}]},"garage":{"categories":["Oils & Lubricants","Filters","Brakes & Suspension","Engine Parts","Batteries & Electrical","Tyres & Wheels","Workshop Services"],"items":[{"name":"Engine Oil 5W-30 · 4L","category":"Oils & Lubricants","price":3500,"cost":2600,"sku":"GAR-001","barcode":"2000000700014","stock":24,"stock_qty":24,"unit":"btl","color":"#183d35","reorder_level":5,"image_url":"/static/uploads/garage_engine_oil.jpg"},{"name":"Oil Filter","category":"Filters","price":850,"cost":500,"sku":"GAR-002","barcode":"2000000700021","stock":40,"stock_qty":40,"unit":"pcs","color":"#183d35","reorder_level":8,"image_url":"/static/uploads/garage_oil_filter.jpg"},{"name":"Front Brake Pads Set","category":"Brakes & Suspension","price":2800,"cost":1900,"sku":"GAR-003","barcode":"2000000700038","stock":18,"stock_qty":18,"unit":"set","color":"#183d35","reorder_level":4,"image_url":"/static/uploads/garage_brake_pads.jpg"},{"name":"Spark Plugs · Set of 4","category":"Engine Parts","price":1800,"cost":1100,"sku":"GAR-004","barcode":"2000000700045","stock":32,"stock_qty":32,"unit":"set","color":"#183d35","reorder_level":6,"image_url":"/static/uploads/garage_spark_plugs.jpg"},{"name":"Car Battery · 12V 60Ah","category":"Batteries & Electrical","price":9500,"cost":7300,"sku":"GAR-005","barcode":"2000000700052","stock":10,"stock_qty":10,"unit":"pcs","color":"#183d35","reorder_level":3,"image_url":"/static/uploads/garage_car_battery.jpg"},{"name":"Passenger Tyre · 195/65 R15","category":"Tyres & Wheels","price":6500,"cost":4700,"sku":"GAR-006","barcode":"2000000700069","stock":16,"stock_qty":16,"unit":"pcs","color":"#183d35","reorder_level":4,"image_url":"/static/uploads/garage_tyre.jpg"},{"name":"Computer Diagnostics","category":"Workshop Services","price":1500,"cost":0,"sku":"GAR-007","barcode":"","stock":0,"stock_qty":0,"unit":"service","color":"#183d35","reorder_level":0,"image_url":"/static/uploads/garage_diagnostics.jpg"},{"name":"Oil Change Labour","category":"Workshop Services","price":800,"cost":0,"sku":"GAR-008","barcode":"","stock":0,"stock_qty":0,"unit":"service","color":"#183d35","reorder_level":0,"image_url":"/static/uploads/garage_engine_oil.jpg"}]},"tech_accessories":{"categories":["Earphones & Audio","Phone Covers","Chargers & Cables","Power Banks","Smart Watches","Bluetooth Speakers"],"items":[{"category":"Earphones & Audio","name":"Wireless Earbuds Pro","price":2499,"cost":1650,"sku":"TECH-001","barcode":"2000000800011","stock":18,"unit":"pcs","reorder_level":5,"image_url":"/static/uploads/tech_wireless_earbuds.jpg","color":"#16a34a"},{"category":"Phone Covers","name":"Premium Phone Cover","price":799,"cost":350,"sku":"TECH-002","barcode":"2000000800028","stock":45,"unit":"pcs","reorder_level":10,"image_url":"/static/uploads/tech_phone_cases.jpg","color":"#7c3aed","variants_json":"[{\"name\":\"iPhone / Navy\",\"size\":\"iPhone\",\"color\":\"Navy\",\"shade\":\"\",\"stock\":12,\"price_cents\":79900},{\"name\":\"Samsung / Clear\",\"size\":\"Samsung\",\"color\":\"Clear\",\"shade\":\"\",\"stock\":18,\"price_cents\":79900},{\"name\":\"Tecno / Black\",\"size\":\"Tecno\",\"color\":\"Black\",\"shade\":\"\",\"stock\":15,\"price_cents\":69900}]"},{"category":"Chargers & Cables","name":"20W Fast Charger + Type-C Cable","price":1299,"cost":780,"sku":"TECH-003","barcode":"2000000800035","stock":28,"unit":"set","reorder_level":7,"image_url":"/static/uploads/tech_charging_bundle.jpg","color":"#2563eb"},{"category":"Power Banks","name":"Slim Power Bank 10000mAh","price":1999,"cost":1350,"sku":"TECH-004","barcode":"2000000800042","stock":14,"unit":"pcs","reorder_level":4,"image_url":"/static/uploads/tech_charging_bundle.jpg","color":"#334155"},{"category":"Smart Watches","name":"Smart Watch Series Fit","price":2999,"cost":1900,"sku":"TECH-005","barcode":"2000000800059","stock":12,"unit":"pcs","reorder_level":3,"image_url":"","color":"#0f766e"},{"category":"Bluetooth Speakers","name":"Mini Bluetooth Speaker","price":2199,"cost":1450,"sku":"TECH-006","barcode":"2000000800066","stock":16,"unit":"pcs","reorder_level":4,"image_url":"","color":"#ea580c"}]}}};

const SHOP_PROFILES = [
  { id: 'garage', name: 'Garage & Auto Spares', icon: '🚗', tagline: 'Auto Parts, Repairs & Workshop POS' },
  { id: 'retail', name: 'Retail / Mini-Mart', icon: '🛒', tagline: 'Supermarket, Grocery & General Retail POS' },
  { id: 'pharmacy', name: 'Pharmacy & Chemist', icon: '💊', tagline: 'Pharmacy & Drugstore POS' },
  { id: 'restaurant', name: 'Restaurant & Café', icon: '🍽️', tagline: 'Food & Dining POS' },
  { id: 'hardware', name: 'Hardware & Tools', icon: '🔧', tagline: 'Hardware Store POS' },
  { id: 'boutique', name: 'Boutique & Fashion', icon: '👗', tagline: 'Fashion & Cosmetics POS' },
  { id: 'bar', name: 'Bar & Nightclub', icon: '🍸', tagline: 'Bar, Lounge & Club POS' }
];

const LocalPOS = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('pos_local_' + key);
      return v ? JSON.parse(v) : fallback;
    } catch(e) { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem('pos_local_' + key, JSON.stringify(val)); } catch(e) {}
  },
  switchProfile(btype) {
    const prof = LOCAL_PROFILES_DATA.profiles[btype] || LOCAL_PROFILES_DATA.profiles['retail'];
    const sample = LOCAL_PROFILES_DATA.sample_data[btype] || LOCAL_PROFILES_DATA.sample_data['retail'];

    const cats = sample.categories.map((c, i) => ({
      id: i + 1,
      name: c,
      sort_order: i,
      business_type: btype
    }));

    const items = sample.items.map((it, i) => ({
      id: i + 1,
      category_id: (sample.categories.indexOf(it.category) >= 0 ? sample.categories.indexOf(it.category) + 1 : 1),
      name: it.name,
      price_cents: Math.round((it.price || 0) * 100),
      cost_cents: Math.round((it.cost || 0) * 100),
      color: it.color || "#334155",
      sku: it.sku || `SKU-${i+1}`,
      barcode: it.barcode || '',
      stock_qty: it.stock_qty !== undefined ? it.stock_qty : 50,
      unit: it.unit || "pcs",
      image_url: it.image_url || "",
      active: 1
    }));

    this.set('categories', cats);
    this.set('items', items);
    this.set('settings', {
      business_name: prof.name + ' POS',
      business_tagline: prof.tagline || '',
      business_type: btype,
      tax_rate: 0,
      tax_rate_confirmed: false,
      currency: 'KES',
      phone: '',
      email: '',
      kra_pin: '',
      address: '',
      receipt_header: 'Welcome to ' + prof.name,
      receipt_footer: 'Thank you for your business!\n------- END OF RECEIPT -------'
    });
    this.set('current_profile', prof);
    this.set('current_type', btype);
  },
  init() {
    const curType = localStorage.getItem('pos_active_business_type') || this.get('current_type', 'retail');
    if (!this.get('seeded', false) || this.get('current_type') !== curType) {
      this.switchProfile(curType);
      this.set('orders', []);
      this.set('suppliers', [
        { id: 1, name: "East African Breweries Ltd", phone: "+254 700 111 000", email: "orders@eabl.co.ke", active: 1 },
        { id: 2, name: "Coca-Cola Beverages Africa", phone: "+254 722 222 111", email: "supply@ccba.co.ke", active: 1 },
        { id: 3, name: "Local Wholesale Distributors", phone: "+254 733 444 000", email: "sales@lwd.co.ke", active: 1 }
      ]);
      this.set('customers', [
        { id: 1, name: "Walk-In Customer", phone: "+254 700 000 000" }
      ]);
      this.set('seeded', true);
    }
    let settings = this.get('settings', {});
    if (Number(settings.tax_rate) === 16 && settings.tax_rate_confirmed !== true) {
      settings = { ...settings, tax_rate: 0, tax_rate_confirmed: false };
      this.set('settings', settings);
    }
  },
  handle(path, options = {}) {
    this.init();
    const cleanPath = path.split('?')[0];
    const method = (options.method || 'GET').toUpperCase();
    const body = options.body ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body) : {};
    const btype = this.get('current_type', 'retail');
    const prof = this.get('current_profile', LOCAL_PROFILES_DATA.profiles[btype] || LOCAL_PROFILES_DATA.profiles['retail']);

    if (cleanPath === '/api/bootstrap') {
      const cats = this.get('categories', []);
      const items = this.get('items', []);
      return {
        user: { id: 1, username: 'terminal', full_name: 'POS Terminal', role: 'cashier' },
        settings: this.get('settings', {}),
        profile: prof,
        profiles: LOCAL_PROFILES_DATA.profiles,
        capabilities: prof.capabilities || {},
        employees: [{ id: 1, name: "POS Terminal" }, { id: 2, name: "The Owner" }],
        menu: { categories: cats, items: items },
        suppliers: this.get('suppliers', []),
        tables: [{ id: 1, name: "Counter 1", seats: 4 }, { id: 2, name: "Counter 2", seats: 4 }],
        alerts: { expiry: 0, low_stock: 0 }
      };
    }

    if (cleanPath === '/api/orders' && method === 'POST') {
      const orders = this.get('orders', []);
      const now = Math.floor(Date.now() / 1000);
      const ticketNo = 'R' + now + String(orders.length + 1).padStart(3, '0');
      let subtotal = 0;
      const orderItems = (body.items || []).map((it, idx) => {
        const lineTotal = (it.price_cents || 0) * (it.qty || 1);
        subtotal += lineTotal;
        return {
          id: idx + 1,
          menu_item_id: it.menu_item_id,
          name: it.name,
          qty: it.qty,
          unit_price_cents: it.price_cents,
          line_total_cents: lineTotal,
          note: it.note || ''
        };
      });
      const order = {
        id: orders.length + 1,
        ticket_no: ticketNo,
        order_type: body.order_type || 'walk-in',
        customer_name: body.customer_name || '',
        status: 'open',
        subtotal_cents: subtotal,
        tax_cents: 0,
        total_cents: subtotal,
        total: (subtotal / 100).toFixed(2),
        paid_cents: 0,
        created_at: now,
        updated_at: now,
        items: orderItems
      };
      orders.unshift(order);
      this.set('orders', orders);
      return { order };
    }

    if (cleanPath === '/api/pay' && method === 'POST') {
      const orders = this.get('orders', []);
      const order = orders.find(o => o.id === Number(body.order_id));
      if (order) {
        const settings = this.get('settings', {});
        const configured = Number(settings.tax_rate);
        const rate = settings.tax_rate_confirmed === true && Number.isFinite(configured) && configured > 0 && configured <= 100 ? configured : 0;
        order.tax_rate = rate;
        order.tax_cents = rate > 0 ? Math.round(Number(order.total_cents || 0) * rate / (100 + rate)) : 0;
        order.status = 'paid';
        order.paid_at = Math.floor(Date.now() / 1000);
        order.payment_method = body.method || 'cash';
        order.payment_ref = body.ref || ('TXN-' + Math.floor(Math.random() * 900000 + 100000));
        order.paid_cents = order.total_cents;
        this.set('orders', orders);
        const items = this.get('items', []);
        (order.items || []).forEach(oi => {
          const item = items.find(i => i.id === oi.menu_item_id);
          if (tracksStock(item) && item.stock_qty) item.stock_qty = Math.max(0, item.stock_qty - oi.qty);
        });
        this.set('items', items);
        return { success: true, order };
      }
      return { success: true };
    }

    if (cleanPath === '/api/orders') {
      return { orders: this.get('orders', []) };
    }

    if (cleanPath === '/api/sales') {
      const orders = this.get('orders', []).filter(o => o.status === 'paid');
      const totalCents = orders.reduce((sum, o) => sum + (o.total_cents || 0), 0);
      return {
        period: 'today',
        total_sales_cents: totalCents,
        order_count: orders.length,
        orders: orders
      };
    }

    if (cleanPath === '/api/suppliers') {
      return { suppliers: this.get('suppliers', []) };
    }

    if (cleanPath === '/api/customers') {
      return { customers: this.get('customers', []) };
    }

    if (cleanPath === '/api/settings' && method === 'POST') {
      const settings = { ...this.get('settings', {}), ...body };
      if (Object.prototype.hasOwnProperty.call(body, 'tax_rate')) {
        const rate = Number(body.tax_rate);
        if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error('VAT rate must be between 0% and 100%.');
        settings.tax_rate = rate;
        settings.tax_rate_confirmed = true;
      }
      this.set('settings', settings);
      return { settings, profile: prof };
    }

    if (cleanPath === '/api/reports') {
      const orders = this.get('orders', []).filter(o => o.status === 'paid');
      const totalSales = orders.reduce((s, o) => s + (o.total_cents || 0), 0);
      return {
        totals: {
          sales_today: totalSales,
          paid_today: orders.length,
          unpaid_orders: 0,
          unpaid_total: 0
        },
        counts: { active_items: this.get('items', []).length },
        by_method: [],
        top_items: []
      };
    }

    return {};
  }
};

async function api(path, options = {}) {
  const init = { headers: { 'Content-Type': 'application/json' }, ...options };
  if (init.body && typeof init.body !== 'string') init.body = JSON.stringify(init.body);

  try {
    const res = await fetch(path, init);
    if (res.ok) return await res.json();
    if (res.status === 401 || res.status === 403) {
      return LocalPOS.handle(path, options);
    }
  } catch (err) {
    // Standalone local offline mode in APK
    return LocalPOS.handle(path, options);
  }
  return LocalPOS.handle(path, options);
}

async function bootstrap() {
  const data = await api('/api/bootstrap');
  state.user = data.user;
  state.settings = data.settings || {};
  state.profile = data.profile || {};
  state.profiles = data.profiles || {};
  state.capabilities = data.capabilities || {};
  state.tables = data.tables || [];
  state.alerts = data.alerts || { expiry: 0, low_stock: 0 };
  state.employees = data.employees || [];
  state.selectedEmployeeId = Number(localStorage.getItem('pos_employee_id')) || state.employees[0]?.id || null;
  state.categories = data.menu ? data.menu.categories : [];
  state.items = data.menu ? data.menu.items : [];
  state.activeCategory = 'all';

  updateHeaderAndNav();
}

function pageName() {
  return qs('[data-page]')?.dataset.page;
}

function renderShellError(err) {
  const root = qs('[data-page]');
  if (root) root.innerHTML = `<section class="empty">Could not load page. ${err.message}</section>`;
}

// ── Audio Feedback Synthesizer ───────────────────────────────────────────────
function playBeep(type = 'success') {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    if (type === 'success') {
      // Crisp two-tone register chime
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.05);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
      osc.start();
      osc.stop(ctx.currentTime + 0.16);
    } else {
      // Low buzz for error or not found
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
      osc.start();
      osc.stop(ctx.currentTime + 0.22);
    }
  } catch (e) {
    // AudioContext may be restricted until user gesture
  }
}

// ── Unified Barcode Scanner Modal ────────────────────────────────────────────
function showBarcodeModal(mode = 'pos', onScan = null) {
  const isPos = (mode === 'pos');
  const title = isPos ? 'Scan Barcode to Add to Cart' : 'Scan Barcode for Product';
  const subtitle = isPos 
    ? 'Scan physical barcode with camera or handheld USB reader to immediately add to order'
    : 'Scan a barcode to populate product details or lookup existing items';

  // Sample barcoded items from current catalog for quick 1-click test
  const sampleItems = (state.items || []).filter(i => i.barcode).slice(0, 5);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box" style="width:480px; max-width:92vw; max-height:92vh; overflow-y:auto;">
      <div class="modal-head" style="padding:16px 20px; border-bottom:1px solid var(--line); display:flex; align-items:center; justify-content:space-between;">
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-size:24px;">📷</span>
          <div>
            <h3 style="margin:0; font-size:16px; font-weight:800; color:var(--ink);">${title}</h3>
            <span style="font-size:12px; color:var(--muted);">${subtitle}</span>
          </div>
        </div>
        <button class="modal-close" id="bmClose" type="button">&times;</button>
      </div>

      <div style="padding:18px 20px;">
        <!-- Camera Viewfinder -->
        <div class="scanner-viewfinder" id="scannerViewfinder">
          <video class="scanner-video" id="scannerVideo" playsinline muted autoplay></video>
          <div class="scanner-reticle"></div>
          <div class="scanner-laser"></div>
          <div id="cameraStatusText" style="position:absolute; bottom:10px; left:0; right:0; text-align:center; font-size:11px; color:#a1a1aa; z-index:6; background:rgba(0,0,0,0.6); padding:3px 8px;">
            Initializing camera…
          </div>
        </div>

        <!-- Manual or USB Scanner Input -->
        <div style="margin-bottom:12px;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
            <label style="font-size:12px; font-weight:700; color:var(--ink); text-transform:uppercase; letter-spacing:0.5px;">Barcode / SKU Input</label>
            <span style="font-size:11px; color:var(--muted);">USB scanner ready</span>
          </div>
          <div style="display:flex; gap:8px;">
            <input type="text" id="barcodeManualInput" class="field" placeholder="Enter / scan barcode here…" autocomplete="off" autofocus style="flex:1; font-size:15px; font-family:monospace; font-weight:700; text-align:center; letter-spacing:1px;">
            <button type="button" class="primary" id="barcodeSubmitBtn" style="padding:8px 16px; font-size:13px; font-weight:700; white-space:nowrap;">
              ${isPos ? '+ Add to Cart' : 'Lookup / Add'}
            </button>
          </div>
        </div>

        <!-- Scan Feedback Notification Box -->
        <div id="scannerFeedback" style="min-height:48px; border-radius:8px; border:1px solid var(--line); background:var(--bg); padding:10px 14px; margin-bottom:14px; display:flex; align-items:center; justify-content:space-between; transition:all 0.2s;">
          <div style="font-size:12.5px; color:var(--muted); line-height:1.4;" id="feedbackMsg">
            Ready to scan. Point camera or press Enter after scanning barcode.
          </div>
        </div>

        ${sampleItems.length ? `
          <!-- Quick-test Sample Barcodes from Catalog -->
          <div style="border-top:1px dashed var(--line); padding-top:12px; margin-bottom:14px;">
            <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">
              ⚡ Quick Test Barcodes (Click to simulate scan):
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:6px;">
              ${sampleItems.map(item => `
                <button type="button" class="quick-barcode-pill" data-code="${item.barcode}" title="${item.name} (${money(item.price_cents)})">
                  <strong>${item.barcode}</strong>
                  <span>${item.name}</span>
                </button>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Footer actions -->
        <div style="display:flex; align-items:center; justify-content:space-between; border-top:1px solid var(--line); padding-top:14px;">
          <div style="font-size:12px; font-weight:600; color:var(--muted);">
            ${isPos ? `Cart items: <strong id="scannerCartCount">${state.order?.items?.length || 0}</strong>` : ''}
          </div>
          <button type="button" class="primary" id="bmDoneBtn" style="padding:9px 20px; font-size:13px;">
            ${isPos ? '✓ Done / Return to Cart' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const videoElem = overlay.querySelector('#scannerVideo');
  const cameraStatus = overlay.querySelector('#cameraStatusText');
  const manualInput = overlay.querySelector('#barcodeManualInput');
  const submitBtn = overlay.querySelector('#barcodeSubmitBtn');
  const feedbackMsg = overlay.querySelector('#feedbackMsg');
  const feedbackBox = overlay.querySelector('#scannerFeedback');
  const cartCountElem = overlay.querySelector('#scannerCartCount');

  manualInput.focus();

  let stream = null;
  let detector = null;
  let scanActive = true;
  let lastScannedCode = '';
  let lastScannedTime = 0;

  // Cleanup handler
  const closeModal = () => {
    scanActive = false;
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    overlay.remove();
  };

  overlay.querySelector('#bmClose').addEventListener('click', closeModal);
  overlay.querySelector('#bmDoneBtn').addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  // Start Camera Stream & Detection
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
    }).then(s => {
      stream = s;
      if (videoElem) {
        videoElem.srcObject = stream;
        videoElem.play().catch(() => {});
        cameraStatus.textContent = 'Camera active — hold barcode in box';
      }

      if ('BarcodeDetector' in window) {
        try {
          detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] });
          const detectLoop = async () => {
            if (!scanActive) return;
            if (videoElem.readyState >= 2) {
              try {
                const barcodes = await detector.detect(videoElem);
                if (barcodes && barcodes.length > 0) {
                  const rawCode = barcodes[0].rawValue;
                  const now = Date.now();
                  // Debounce: prevent same code scanning repeatedly in 1.5s
                  if (rawCode !== lastScannedCode || (now - lastScannedTime) > 1500) {
                    lastScannedCode = rawCode;
                    lastScannedTime = now;
                    handleCodeScanned(rawCode);
                  }
                }
              } catch (e) {}
            }
            if (scanActive) requestAnimationFrame(detectLoop);
          };
          requestAnimationFrame(detectLoop);
        } catch (e) {
          cameraStatus.textContent = 'Hold barcode in box or scan with USB gun';
        }
      } else {
        cameraStatus.textContent = 'Video on. Use handheld scanner or type barcode below';
      }
    }).catch(err => {
      if (cameraStatus) cameraStatus.textContent = 'Camera unavailable — use handheld reader or input below';
    });
  } else {
    if (cameraStatus) cameraStatus.textContent = 'Use handheld reader or type barcode below';
  }

  // Core Barcode Processor
  const handleCodeScanned = async (code) => {
    const q = (code || '').trim().toLowerCase();
    if (!q) return;

    manualInput.value = code;

    // Custom onScan callback (used e.g. in Add Product modal barcode input)
    if (typeof onScan === 'function') {
      playBeep('success');
      onScan(code);
      closeModal();
      return;
    }

    // Match against state.items
    const match = (state.items || []).find(i =>
      (i.barcode && i.barcode.trim().toLowerCase() === q) ||
      (i.sku && i.sku.trim().toLowerCase() === q)
    );

    if (isPos) {
      if (match) {
        // In system: Add to cart
        if (hasCap('variants') && match.variants_json) {
          closeModal();
          showVariantModal(match);
          return;
        }

        const existing = state.order?.items?.find(i => i.menu_item_id === match.id);
        const existingQty = existing ? existing.qty : 0;
        if (tracksStock(match) && (1 + existingQty) > match.stock_qty) {
          playBeep('error');
          feedbackBox.style.background = 'rgba(239, 68, 68, 0.15)';
          feedbackBox.style.borderColor = 'var(--danger)';
          feedbackMsg.innerHTML = `<span style="color:var(--danger); font-weight:700;">⚠️ Cannot add "${match.name}". Stock limit reached (${match.stock_qty} in stock).</span>`;
          return;
        }

        await addItemWithQty(match.id, 1);
        playBeep('success');

        feedbackBox.style.background = 'rgba(22, 163, 74, 0.15)';
        feedbackBox.style.borderColor = 'var(--ok)';
        feedbackMsg.innerHTML = `
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:18px;">✅</span>
            <div>
              <strong style="color:var(--ok); font-size:13px;">Added to cart: ${match.name}</strong>
              <div style="font-size:11px; color:var(--ink);">${money(match.price_cents)} • Barcode: ${match.barcode || match.sku}</div>
            </div>
          </div>
        `;

        if (cartCountElem) {
          cartCountElem.textContent = state.order?.items?.length || 0;
        }

        manualInput.value = '';
        manualInput.focus();
      } else {
        // Not in system
        playBeep('error');
        feedbackBox.style.background = 'rgba(245, 158, 11, 0.15)';
        feedbackBox.style.borderColor = 'var(--warn)';
        feedbackMsg.innerHTML = `
          <div>
            <div style="color:var(--warn); font-weight:700; font-size:13px;">⚠️ Barcode "${code}" not found in system!</div>
            <div style="font-size:11px; color:var(--muted); margin-top:2px;">Item is not registered in this shop catalog.</div>
          </div>
          <button type="button" class="btn-xs" id="registerMissingProductBtn" style="white-space:nowrap; background:var(--ink); color:var(--panel);">+ Register Product</button>
        `;

        feedbackBox.querySelector('#registerMissingProductBtn')?.addEventListener('click', () => {
          closeModal();
          location.href = '/products';
          setTimeout(() => {
            showProductModal({ barcode: code, sku: 'SKU-' + code.slice(-6) });
          }, 300);
        });
      }
    } else {
      // Product Page Mode
      if (match) {
        playBeep('success');
        feedbackBox.style.background = 'rgba(37, 99, 235, 0.15)';
        feedbackBox.style.borderColor = 'var(--info)';
        feedbackMsg.innerHTML = `
          <div>
            <div style="color:var(--info); font-weight:700; font-size:13px;">✓ Product Already Registered</div>
            <div style="font-size:11px; color:var(--ink); margin-top:2px;"><strong>${match.name}</strong> • SKU: ${match.sku} • ${money(match.price_cents)}</div>
          </div>
          <button type="button" class="btn-xs" id="editFoundProductBtn" style="white-space:nowrap; background:var(--primary); color:var(--primary-fg);">✏️ Edit Product</button>
        `;
        feedbackBox.querySelector('#editFoundProductBtn')?.addEventListener('click', () => {
          closeModal();
          showProductModal(match);
        });
      } else {
        // New Barcode detected -> open Add Product modal with barcode pre-filled
        playBeep('success');
        toast(`New barcode "${code}" detected. Opening product form…`, 'info');
        closeModal();
        showProductModal({ barcode: code, sku: 'SKU-' + (code.length > 6 ? code.slice(-6) : code) });
      }
    }
  };

  // Submit on manual input or USB scanner enter
  submitBtn.addEventListener('click', () => {
    handleCodeScanned(manualInput.value.trim());
  });

  manualInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCodeScanned(manualInput.value.trim());
    }
  });

  // Sample barcode pills click
  overlay.querySelectorAll('.quick-barcode-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      handleCodeScanned(btn.dataset.code);
    });
  });
}

// ── POS Layout ────────────────────────────────────────────────────────────────
function posLayout() {
  const root = qs('[data-page="pos"]');
  const itemLabel = state.profile?.item_label || 'Products';
  const orderTypes = (state.profile?.order_types && state.profile.order_types.length)
    ? state.profile.order_types
    : state.profile?.id === 'garage'
      ? state.capabilities.order_types
      : ['walk-in', 'quote', 'layaway'];

  root.innerHTML = `
    <section class="menu-side">
      <div class="pos-head" style="flex-wrap:wrap; gap:8px;">
        <h2>${itemLabel}</h2>
        
        <div style="display:flex; align-items:center; gap:8px; margin-left:auto; flex-wrap:wrap;">
          ${hasCap('wholesale_pricing') ? `
            <button type="button" id="tierToggleBtn" class="tier-toggle-btn ${state.pricingTier === 'wholesale' ? 'active' : ''}">
              ${state.pricingTier === 'wholesale' ? '⚡ Wholesale Pricing' : '🏷️ Retail Pricing'}
            </button>
          ` : ''}

          ${hasCap('tables') ? `
            <select id="tableSelect" class="field" style="padding:6px 10px; font-size:13px; max-width:140px;">
              <option value="">-- Table / Tab --</option>
              ${state.tables.map(t => `<option value="${t.id}" ${state.selectedTableId == t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
            </select>
          ` : ''}

          ${hasCap('waiters') ? `
            <select id="waiterSelect" class="field" style="padding:6px 10px; font-size:13px; max-width:140px;">
              <option value="">-- Staff / Waiter --</option>
              ${state.employees.map(e => `<option value="${e.id}" ${state.selectedEmployeeId == e.id ? 'selected' : ''}>${e.name}</option>`).join('')}
            </select>
          ` : ''}

          <select id="orderType" class="field" style="padding:6px 10px; font-size:13px;">
            ${orderTypes.map(t => {
              const label = t.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
              return `<option value="${t}">${label}</option>`;
            }).join('')}
          </select>
        </div>
      </div>

      ${hasCap('expiry_alerts') && state.alerts.expiry > 0 ? `
        <div class="alert-banner warning" style="margin: 8px 16px; padding: 8px 14px; background: #fef2f2; border: 1px solid #f87171; border-radius: 8px; font-size: 13px; color: #991b1b; display: flex; align-items: center; justify-content: space-between;">
          <span>⚠️ <strong>Expiry Alert:</strong> ${state.alerts.expiry} item(s) expired or expiring within 30 days.</span>
          <a href="/products" class="nav-link" style="color:#b91c1c; font-weight:700; text-decoration:underline;">View Products</a>
        </div>
      ` : ''}

      ${hasCap('reorder_levels') && state.alerts.low_stock > 0 ? `
        <div class="alert-banner info" style="margin: 8px 16px; padding: 8px 14px; background: #fffbeb; border: 1px solid #fbbf24; border-radius: 8px; font-size: 13px; color: #92400e; display: flex; align-items: center; justify-content: space-between;">
          <span>📦 <strong>Reorder Alert:</strong> ${state.alerts.low_stock} product(s) at or below reorder level.</span>
          <a href="/stock" class="nav-link" style="color:#b45309; font-weight:700; text-decoration:underline;">Check Stock</a>
        </div>
      ` : ''}

      <div class="sku-search-wrap" style="display:flex; gap:8px; align-items:center;">
        <div class="sku-search-inner" style="flex:1;">
          <span class="sku-search-icon">&#128269;</span>
          <input class="sku-search-input" id="skuSearch" placeholder="${hasCap('barcode') ? 'Search name, SKU or scan barcode…' : 'Search by name or SKU…'}" autocomplete="off" autocorrect="off">
          <button class="sku-search-clear" id="skuClear" title="Clear">&#215;</button>
        </div>
        <button type="button" class="barcode-scan-btn" id="posBarcodeScanBtn" title="Scan Barcode to Add to Cart">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 5v14M8 5v14M12 5v14M17 5v14M21 5v14"/>
          </svg>
          <span>Scan Barcode</span>
        </button>
      </div>
      <div class="tabs" id="catTabs"></div>
      <div class="item-grid" id="itemGrid"></div>
    </section>
    <aside class="ticket-side">
      <div class="ticket-head">
        <div>
          <h2>${hasCap('tables') ? 'Ticket / Tab' : 'Sale'}</h2>
          <small>${state.profile?.name || 'POS'}</small>
        </div>
        <div style="font-weight: 700; font-size: 15px; color: var(--ink);">
          ${selectedEmployeeName() || state.user?.username || 'Staff'}
        </div>
      </div>
      <div class="ticket-list" id="ticketList"></div>
      <div class="ticket-foot" id="ticketFoot"></div>
    </aside>
  `;

  qs('#orderType')?.addEventListener('change', ensureOrder);
  
  qs('#tableSelect')?.addEventListener('change', e => {
    state.selectedTableId = e.target.value ? Number(e.target.value) : null;
    if (state.order) {
      state.order.table_id = state.selectedTableId;
      const found = state.tables.find(t => t.id === state.selectedTableId);
      state.order.table_name = found ? found.name : '';
      renderTicket();
    }
  });

  qs('#waiterSelect')?.addEventListener('change', e => {
    state.selectedEmployeeId = e.target.value ? Number(e.target.value) : null;
    if (state.order) {
      state.order.employee_id = state.selectedEmployeeId;
      state.order.employee_name = selectedEmployeeName();
      renderTicket();
    }
  });

  qs('#tierToggleBtn')?.addEventListener('click', () => {
    state.pricingTier = state.pricingTier === 'wholesale' ? 'retail' : 'wholesale';
    qs('#tierToggleBtn').classList.toggle('active', state.pricingTier === 'wholesale');
    qs('#tierToggleBtn').textContent = state.pricingTier === 'wholesale' ? '⚡ Wholesale Pricing' : '🏷️ Retail Pricing';
    toast(`Switched to ${state.pricingTier.toUpperCase()} pricing`, 'info');
    renderItems();
    if (state.order) {
      state.order.pricing_tier = state.pricingTier;
      renderTicket();
    }
  });

  qs('#posBarcodeScanBtn')?.addEventListener('click', () => {
    showBarcodeModal('pos');
  });

  const skuInput = qs('#skuSearch');
  skuInput.addEventListener('input', () => {
    state.searchQuery = skuInput.value.trim().toLowerCase();
    renderItems();
  });
  qs('#skuClear').addEventListener('click', () => {
    skuInput.value = '';
    state.searchQuery = '';
    renderItems();
    skuInput.focus();
  });

  skuInput.addEventListener('keydown', async e => {
    if (e.key === 'Enter') {
      const q = skuInput.value.trim().toLowerCase();
      if (!q) return;
      const match = (state.items || []).find(i =>
        (i.barcode && i.barcode.trim().toLowerCase() === q) ||
        (i.sku && i.sku.trim().toLowerCase() === q)
      );
      if (match) {
        if (hasCap('variants') && match.variants_json) {
          showVariantModal(match);
        } else {
          const existing = state.order?.items?.find(i => i.menu_item_id === match.id);
          const existingQty = existing ? existing.qty : 0;
          if (tracksStock(match) && (1 + existingQty) > match.stock_qty) {
            playBeep('error');
            toast(`Cannot add "${match.name}". Only ${match.stock_qty} left in stock.`, 'error');
            return;
          }
          await addItemWithQty(match.id, 1);
          playBeep('success');
          toast(`✓ Added "${match.name}" to cart!`, 'success');
        }
        skuInput.value = '';
        state.searchQuery = '';
        renderItems();
      } else {
        playBeep('error');
        toast(`⚠️ Barcode / SKU "${skuInput.value.trim()}" not found in system!`, 'error');
      }
    }
  });

  renderTabs();
  renderItems();
  renderTicket();
}

function getCategoryIcon(name) {
  const zap = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;margin-right:6px;vertical-align:-3px"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>`;
  const droplet = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;margin-right:6px;vertical-align:-3px"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path></svg>`;
  const palette = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;margin-right:6px;vertical-align:-3px"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c2 0 3-1 3-2 0-.55-.22-1.05-.59-1.41-.36-.36-.59-.86-.59-1.41 0-1.1.9-2 2-2h1c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-4 8c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm4-4c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm4 4c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>`;
  const crosshair = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;margin-right:6px;vertical-align:-3px"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>`;
  const wrench = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;margin-right:6px;vertical-align:-3px"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>`;
  const shield = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;margin-right:6px;vertical-align:-3px"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`;
  const box = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;margin-right:6px;vertical-align:-3px"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`;
  
  const lower = name.toLowerCase();
  if (lower.includes('electric')) return zap;
  if (lower.includes('plumb')) return droplet;
  if (lower.includes('paint')) return palette;
  if (lower.includes('fastener')) return crosshair;
  if (lower.includes('tool')) return wrench;
  if (lower.includes('safet')) return shield;
  if (lower.includes('building') || lower.includes('material')) return box;
  if (lower === 'all') return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;margin-right:6px;vertical-align:-3px"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>`;
  
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;margin-right:6px;vertical-align:-3px"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>`;
}

function renderTabs() {
  const tabs = qs('#catTabs');
  if (!tabs) return;
  
  const allTab = `<button class="tab ${state.activeCategory === 'all' ? 'active' : ''}" data-cat="all">
    ${getCategoryIcon('All')} All
  </button>`;
  
  const catTabs = state.categories.map(cat =>
    `<button class="tab ${cat.id === state.activeCategory ? 'active' : ''}" data-cat="${cat.id}">
       ${getCategoryIcon(cat.name)} ${cat.name}
     </button>`
  ).join('');
  
  tabs.innerHTML = allTab + catTabs;
  
  qsa('.tab').forEach(btn => btn.addEventListener('click', () => {
    state.activeCategory = btn.dataset.cat === 'all' ? 'all' : Number(btn.dataset.cat);
    state.searchQuery = '';
    const inp = qs('#skuSearch');
    if (inp) inp.value = '';
    renderTabs();
    renderItems();
  }));
}

function renderItems() {
  const grid = qs('#itemGrid');
  if (!grid) return;
  let items = state.items;
  if (state.searchQuery) {
    const q = state.searchQuery;
    items = items.filter(i =>
      i.name.toLowerCase().includes(q) ||
      (i.sku && i.sku.toLowerCase().includes(q)) ||
      (i.barcode && i.barcode.toLowerCase().includes(q))
    );
  } else {
    if (state.activeCategory !== 'all') {
      items = items.filter(i => i.category_id === state.activeCategory);
    }
  }

  grid.innerHTML = items.map(item => {
    const low = tracksStock(item) && (item.reorder_level ? item.stock_qty <= item.reorder_level : item.stock_qty <= 5);
    const stockLabel = tracksStock(item)
      ? `<span class="stock-badge ${low ? '' : 'ok'}">${item.stock_qty} ${item.unit || 'pcs'}</span>`
      : '';
    const catName = state.categories.find(c => c.id === item.category_id)?.name || '';
    const effectivePrice = (state.pricingTier === 'wholesale' && item.wholesale_price_cents) ? item.wholesale_price_cents : item.price_cents;
    return `
      <button class="menu-btn" data-id="${item.id}">
        <div class="menu-btn-img-wrapper">
          ${item.image_url ? `<img src="${item.image_url}" style="width:100%;height:100%;object-fit:contain;padding:12px;box-sizing:border-box;">` : getCategoryIcon(catName)}
          ${stockLabel}
        </div>
        <div class="menu-btn-content">
          <strong>${item.name}</strong>
          ${item.strength ? `<div style="font-size:11px; color:#2563eb; font-weight:700;">${item.strength}</div>` : ''}
          ${item.sku ? `<div class="item-sku">SKU: ${item.sku}</div>` : ''}
          <div class="item-price">
            ${money(effectivePrice)}
            ${state.pricingTier === 'wholesale' && item.wholesale_price_cents ? '<span style="font-size:10px; color:#2563eb; font-weight:700; margin-left:4px;">(Wholesale)</span>' : ''}
          </div>
          <div class="menu-btn-stock-status ${low ? 'low' : ''}">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            ${item.unit === 'service' ? 'Workshop Service' : low ? 'Low Stock' : 'In Stock'}
          </div>
        </div>
      </button>
    `;
  }).join('') || `<div class="empty">No products found</div>`;

  qsa('.menu-btn').forEach(btn => btn.addEventListener('click', async () => {
    const id = Number(btn.dataset.id);
    const item = state.items.find(i => i.id === id);
    if (!item) return;

    if (hasCap('variants') && item.variants_json) {
      showVariantModal(item);
      return;
    }

    const existing = state.order?.items?.find(i => i.menu_item_id === item.id && !(i.variant_info || ''));
    const existingQty = existing ? Number(existing.qty || 0) : 0;
    if (tracksStock(item) && (1 + existingQty) > Number(item.stock_qty)) {
      toast(`Cannot add item. Only ${item.stock_qty} left in stock (you have ${existingQty} in cart).`, 'error');
      return;
    }
    await addItemWithQty(item.id, 1, '', '', item.batch_no || '');
  }));
}

// ── Variant Selection Modal ───────────────────────────────────────────────────
function showVariantModal(item) {
  let variants = [];
  try {
    if (typeof item.variants_json === 'string') {
      variants = JSON.parse(item.variants_json);
    } else if (Array.isArray(item.variants_json)) {
      variants = item.variants_json;
    }
  } catch(e) {
    if (item.variants_json) {
      variants = item.variants_json.split(',').map(s => ({ name: s.trim() }));
    }
  }

  const overlay = document.createElement('div');
  overlay.className = 'qty-popup-overlay';
  overlay.innerHTML = `
    <div class="qty-popup" style="max-width: 460px; text-align: left;">
      <h3 style="margin-top:0">${item.name}</h3>
      <p style="color:var(--muted); font-size:13px; margin-bottom: 16px;">Select variant or shade to add to order:</p>
      
      <div class="variant-grid" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap:10px; margin-bottom: 16px;">
        ${variants.map((v, idx) => {
          const vName = typeof v === 'object' ? v.name : v;
          const vPrice = typeof v === 'object' && v.price_cents ? money(v.price_cents) : '';
          const vStock = typeof v === 'object' && v.stock_qty !== undefined ? `${v.stock_qty} left` : '';
          return `
            <button type="button" class="variant-btn" data-idx="${idx}" style="padding:10px; border:2px solid var(--line); border-radius:8px; background:white; text-align:left; cursor:pointer; transition:all 0.15s;">
              <strong style="display:block; color:var(--ink); font-size:13px;">${vName}</strong>
              ${vPrice ? `<div style="color:var(--primary-dark); font-weight:700; font-size:12px; margin-top:2px;">${vPrice}</div>` : ''}
              ${vStock ? `<div style="color:var(--muted); font-size:11px;">${vStock}</div>` : ''}
            </button>
          `;
        }).join('')}
      </div>

      <div style="border-top:1px dashed var(--line); padding-top:12px; margin-bottom:16px;">
        <label style="font-size:12px; font-weight:600; color:var(--muted); display:block; margin-bottom:4px;">Or custom specification:</label>
        <input class="field" id="customVariantInput" placeholder="e.g. Size XL / Red / Shade 3" style="width:100%; padding:8px;">
      </div>

      <div class="qty-popup-actions">
        <button class="ghost" id="varCancel">Cancel</button>
        <button class="primary" id="varCustomConfirm">Add Specification</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('#varCancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  overlay.querySelectorAll('.variant-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = Number(btn.dataset.idx);
      const selected = variants[idx];
      const vName = typeof selected === 'object' ? selected.name : selected;
      const existing = state.order?.items?.find(i => i.menu_item_id === item.id && (i.variant_info || '') === (vName || ''));
      const existingQty = existing ? Number(existing.qty || 0) : 0;
      const variantStock = typeof selected === 'object' && selected.stock_qty !== undefined ? Number(selected.stock_qty) : Number(item.stock_qty);
      if (Number.isFinite(variantStock) && (1 + existingQty) > variantStock) {
        toast(`Cannot add ${vName}. Only ${variantStock} left in stock.`, 'error');
        return;
      }
      close();
      await addItemWithQty(item.id, 1, vName || '', '', item.batch_no || '');
    });
  });

  overlay.querySelector('#varCustomConfirm').addEventListener('click', async () => {
    const val = overlay.querySelector('#customVariantInput').value.trim();
    if (!val) {
      toast('Please enter or select a variant', 'error');
      return;
    }
    close();
    await addItemWithQty(item.id, 1, val, '', item.batch_no || '');
  });
}

// ── Qty Popup ─────────────────────────────────────────────────────────────────
function showQtyPopup(item, variantInfo = null, customPrice = null) {
  const isDecimal = Boolean(item.decimal_qty_enabled || hasCap('decimal_qty'));
  const step = isDecimal ? '0.01' : '1';
  const min = isDecimal ? '0.01' : '1';
  const unitPrice = customPrice !== null ? customPrice : (state.pricingTier === 'wholesale' && item.wholesale_price_cents ? item.wholesale_price_cents : item.price_cents);

  const overlay = document.createElement('div');
  overlay.className = 'qty-popup-overlay';
  overlay.innerHTML = `
    <div class="qty-popup" style="max-width:420px; text-align:left;">
      <h3 style="margin-top:0;">${item.name}</h3>
      ${variantInfo ? `<div style="background:#f1f5f9; padding:4px 8px; border-radius:6px; display:inline-block; font-size:12px; font-weight:700; color:var(--primary-dark); margin-bottom:8px;">Variant: ${variantInfo}</div>` : ''}
      <p style="margin:4px 0 12px; color:var(--muted); font-size:14px;">
        ${money(unitPrice)} per ${item.unit || 'pcs'} ${item.sku ? `· SKU: ${item.sku}` : ''}
        ${item.batch_no ? `<br><small>Batch: ${item.batch_no} ${item.expiry_date ? `(Exp: ${item.expiry_date})` : ''}</small>` : ''}
      </p>

      <label style="display:block; font-size:13px; font-weight:600; margin-bottom:6px;">Quantity (${item.unit || 'pcs'})</label>
      <div class="qty-popup-row" style="margin-bottom:12px;">
        <button class="qty-pop-btn" id="qtyDec">−</button>
        <input type="number" id="qtyVal" value="1" min="${min}" step="${step}" max="9999" inputmode="decimal">
        <button class="qty-pop-btn" id="qtyInc">+</button>
      </div>

      ${hasCap('order_notes') ? `
        <div style="margin-bottom:12px;">
          <label style="display:block; font-size:13px; font-weight:600; margin-bottom:4px;">Item Note / Instructions</label>
          <input type="text" class="field" id="itemNoteInput" placeholder="${state.profile?.id === 'garage' ? 'Vehicle reg, model, repair instructions...' : 'e.g. Well done, no ice, 2.5m cut, dosage note...'}" style="width:100%; padding:8px;" autocomplete="off">
        </div>
      ` : ''}

      <div class="qty-popup-actions">
        <button class="ghost" id="qtyCancel">Cancel</button>
        <button class="primary" id="qtyConfirm">Add to Sale</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const inp = overlay.querySelector('#qtyVal');
  inp.select();
  inp.focus();

  overlay.querySelector('#qtyDec').addEventListener('click', () => {
    const current = parseFloat(inp.value) || 1;
    const next = Math.max(isDecimal ? 0.1 : 1, current - 1);
    inp.value = isDecimal ? (Math.round(next * 100) / 100) : next;
  });
  overlay.querySelector('#qtyInc').addEventListener('click', () => {
    const current = parseFloat(inp.value) || 0;
    const next = current + 1;
    inp.value = isDecimal ? (Math.round(next * 100) / 100) : next;
  });
  overlay.querySelector('#qtyCancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const confirm = async () => {
    const qty = parseFloat(inp.value) || 1;
    if (qty <= 0) {
      toast('Quantity must be greater than 0', 'error');
      return;
    }

    const note = overlay.querySelector('#itemNoteInput')?.value?.trim() || '';

    const existing = state.order?.items?.find(i => i.menu_item_id === item.id && (i.variant_info || '') === (variantInfo || ''));
    const existingQty = existing ? existing.qty : 0;

    if (tracksStock(item) && (qty + existingQty) > item.stock_qty) {
      toast(`Cannot add ${qty}. Only ${item.stock_qty} left in stock (you have ${existingQty} in cart).`, 'error');
      return;
    }

    overlay.remove();
    await addItemWithQty(item.id, qty, variantInfo || '', note, item.batch_no || '');
  };
  overlay.querySelector('#qtyConfirm').addEventListener('click', confirm);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') confirm(); });
}

async function ensureOrder() {
  if (state.order && state.order.status === 'open') return state.order;
  const customerInput = qs('#customerName');
  const orderType = qs('#orderType')?.value || (state.profile?.order_types?.[0] || 'walk-in');
  const isQuote = orderType.toLowerCase().includes('quote') || orderType === 'quote';
  state.order = await api('/api/orders', {
    method: 'POST',
    body: {
      order_type: orderType,
      table_id: state.selectedTableId || null,
      employee_id: state.selectedEmployeeId,
      customer_name: customerInput?.value?.trim() || '',
      pricing_tier: state.pricingTier || 'retail',
      is_quote: isQuote ? 1 : 0,
      notes: qs('#orderNotes')?.value?.trim() || '',
    },
  });
  renderTicket();
  return state.order;
}

async function addItemWithQty(menuItemId, qty, variantInfo = '', note = '', batchNo = '') {
  const order = await ensureOrder();
  state.order = await api('/api/order/add', {
    method: 'POST',
    body: {
      order_id: order.id,
      menu_item_id: menuItemId,
      qty,
      pricing_tier: state.pricingTier || 'retail',
      variant_info: variantInfo,
      note: note,
      batch_no: batchNo,
    },
  });
  renderTicket();
}

async function changeQty(itemId, qty) {
  if (state.order && state.order.items) {
    const existingItem = state.order.items.find(i => i.id === itemId);
    if (existingItem) {
      const catalogItem = state.items.find(i => i.id === existingItem.menu_item_id);
      if (tracksStock(catalogItem)) {
        if (qty > catalogItem.stock_qty) {
          toast(`Cannot increase. Only ${catalogItem.stock_qty} left in stock.`, 'error');
          return;
        }
      }
    }
  }
  
  state.order = await api('/api/order/qty', { method: 'POST', body: { item_id: itemId, qty } });
  renderTicket();
}

async function setStatus(status) {
  if (!state.order) return;
  state.order = await api('/api/order/status', {
    method: 'POST',
    body: { order_id: state.order.id, status },
  });
  renderTicket();
}

function renderTicket() {
  const list = qs('#ticketList');
  const foot = qs('#ticketFoot');
  if (!list || !foot) return;

  if (!state.order) {
    list.innerHTML = `<div class="empty">Add products to start a sale</div>`;
    foot.innerHTML = `
      <div class="customer-row">
        <input id="customerName" placeholder="Customer name (optional)" autocomplete="off">
      </div>
      <button class="primary" id="newTicket" style="width:100%">New Sale</button>
      <div class="totals"><div class="grand"><span>Total</span><span>KES 0.00</span></div></div>
    `;
    qs('#newTicket').addEventListener('click', ensureOrder);
    return;
  }

  const isQuote = Boolean(state.order.is_quote || state.order.order_type === 'quote');

  list.innerHTML = state.order.items.length
    ? state.order.items.map(item => {
      const dbItem = state.items.find(i => i.id === item.menu_item_id) || {};
      const catName = state.categories.find(c => c.id === dbItem.category_id)?.name || '';
      return `
      <div class="ticket-row">
        <div class="ticket-img">
          ${dbItem.image_url ? `<img src="${dbItem.image_url}" style="width:100%;height:100%;object-fit:contain;padding:4px;box-sizing:border-box;border-radius:7px;">` : getCategoryIcon(catName)}
        </div>
        <div class="ticket-info">
          <strong>${item.name}</strong>
          ${item.variant_info ? `<div style="font-size:11px; color:var(--ink); font-weight:700;">[${item.variant_info}]</div>` : ''}
          ${item.batch_no ? `<div style="font-size:11px; color:var(--muted);">Batch: ${item.batch_no}</div>` : ''}
          ${item.note ? `<div style="font-size:11px; color:#2563eb; font-style:italic;">* ${item.note}</div>` : ''}
          <small>SKU: ${dbItem.sku || '-'}</small>
          <div class="t-price">${money(item.unit_price_cents)}</div>
        </div>
        <div class="ticket-right">
          <div class="qty-controls">
            <button data-qty="${Math.max(0, (item.qty - 1))}" data-id="${item.id}">−</button>
            ${(dbItem.decimal_qty_enabled || hasCap('decimal_qty'))
              ? `<input type="number" class="cart-qty-input" data-id="${item.id}" value="${item.qty}" min="0.01" step="0.01" inputmode="decimal" style="width:64px;text-align:center;padding:4px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--ink);font-weight:700;">`
              : `<strong>${item.qty}</strong>`}
            <button data-qty="${item.qty + 1}" data-id="${item.id}">+</button>
            <button class="remove-btn" data-qty="0" data-id="${item.id}">×</button>
          </div>
          <div class="t-total">${money(item.line_total_cents)}</div>
        </div>
      </div>
      `}).join('')
    : `<div class="empty">Add products to start a sale</div>`;

  qsa('.qty-controls button').forEach(btn =>
    btn.addEventListener('click', () => changeQty(Number(btn.dataset.id), Number(btn.dataset.qty)))
  );
  qsa('.cart-qty-input').forEach(input => {
    const applyQty = () => {
      const qty = Number.parseFloat(input.value);
      if (!Number.isFinite(qty) || qty <= 0) {
        toast('Enter a quantity greater than 0', 'error');
        renderTicket();
        return;
      }
      changeQty(Number(input.dataset.id), Math.round(qty * 100) / 100);
    };
    input.addEventListener('change', applyQty);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      }
    });
  });

  foot.innerHTML = `
    ${isQuote ? `<div class="quote-banner" style="background:#eff6ff; border:1px dashed #3b82f6; border-radius:8px; padding:8px; text-align:center; font-size:12px; font-weight:800; color:#1d4ed8; margin-bottom:10px;">📋 ESTIMATE / QUOTATION</div>` : ''}
    <div class="totals">
      <div><span>Receipt #</span><span>${state.order.ticket_no}</span></div>
      ${state.order.table_name ? `<div><span>Table / Tab</span><strong>${state.order.table_name}</strong></div>` : ''}
      <div><span>Type</span><span>${state.order.order_type}</span></div>
      ${state.order.pricing_tier === 'wholesale' ? `<div><span>Tier</span><span class="cap-pill" style="background:#e0e7ff; color:#3730a3; font-size:10px;">Wholesale</span></div>` : ''}
      <div><span>Served By</span><span>${state.order.employee_name || selectedEmployeeName() || '-'}</span></div>
      <div><span>Subtotal</span><span>${money(state.order.subtotal_cents)}</span></div>
      <div class="grand"><span>Total</span><span>${money(state.order.total_cents)}</span></div>
    </div>
    <div class="actions" style="display:flex; flex-direction:column; gap:8px;">
      <div style="display:flex; gap:8px;">
        ${isQuote ? `
          <button class="primary" id="convertQuoteBtn" style="flex:1;">Convert to Sale</button>
          <button class="secondary" id="printQuoteBtn" style="flex:1;">Print Quote</button>
        ` : `
          <button class="primary" id="checkoutBtn" style="flex:1;">Checkout</button>
        `}
      </div>
      <div style="display:flex; gap:8px;">
        <button class="secondary" id="newTicket" style="flex:1;">New</button>
        <button class="danger" id="voidTicket" style="flex:1;">Void</button>
      </div>
    </div>
  `;

  if (isQuote) {
    qs('#convertQuoteBtn')?.addEventListener('click', async () => {
      try {
        state.order = await api('/api/order/convert-quote', {
          method: 'POST',
          body: { order_id: state.order.id }
        });
        toast('Quotation converted to active sale!', 'success');
        renderTicket();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    qs('#printQuoteBtn')?.addEventListener('click', () => {
      showReceiptModal(state.order);
    });
  } else {
    qs('#checkoutBtn')?.addEventListener('click', () => showCheckoutModal(state.order));
  }

  qs('#newTicket')?.addEventListener('click', () => { state.order = null; renderTicket(); });
  qs('#voidTicket')?.addEventListener('click', async () => {
    await setStatus('cancelled');
    state.order = null;
    renderTicket();
  });
}

function selectedEmployeeName() {
  return state.employees.find(emp => emp.id === state.selectedEmployeeId)?.name;
}

function showCheckoutModal(order) {
  const overlay = document.createElement('div');
  overlay.className = 'qty-popup-overlay';
  overlay.innerHTML = `
    <div class="qty-popup" style="max-width: 400px; text-align: left;">
      <h3 style="margin-top:0">Checkout - ${order.ticket_no}</h3>
      <p style="font-size: 18px; font-weight: bold; margin-bottom: 20px;">Total: ${money(order.total_cents)}</p>
      
      <div style="margin-bottom: 16px;">
        <label style="display:block; margin-bottom: 8px; font-weight: 600;">Customer Phone <span style="font-weight:400;color:var(--muted)">(optional)</span></label>
        <input type="tel" id="checkoutCustomerPhone" class="field" placeholder="e.g. 0712345678" style="width: 100%; padding: 10px;" autocomplete="tel">
        <small style="display:block;margin-top:6px;color:var(--muted);">If entered, the number is saved to Customers after payment. M-Pesa uses its payment phone automatically.</small>
      </div>

      <div style="margin-bottom: 16px;">
        <label style="display:block; margin-bottom: 8px; font-weight: 600;">Payment Method</label>
        <select id="checkoutMethod" class="field" style="width: 100%; padding: 10px;">
          <option value="cash">Cash</option>
          <option value="mpesa">M-Pesa</option>
        </select>
      </div>

      <div id="mpesaRefContainer" style="display: none; margin-bottom: 16px;">
        <label style="display:block; margin-bottom: 8px; font-weight: 600;">M-Pesa / STK Phone</label>
        <input type="text" id="mpesaRef" class="field" placeholder="e.g. 0712345678" style="width: 100%; padding: 10px;" autocomplete="off">
      </div>

      <div id="checkoutMsg" style="margin-top: 10px; font-weight: 600; font-size: 14px; text-align: center;"></div>

      <div class="qty-popup-actions" style="margin-top: 16px;">
        <button class="ghost" id="chkCancel">Cancel</button>
        <button class="primary" id="chkConfirm">Confirm & Print</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const methodSelect = overlay.querySelector('#checkoutMethod');
  const refContainer = overlay.querySelector('#mpesaRefContainer');
  const refInput = overlay.querySelector('#mpesaRef');
  const customerPhoneInput = overlay.querySelector('#checkoutCustomerPhone');

  methodSelect.addEventListener('change', () => {
    if (methodSelect.value === 'mpesa') {
      refContainer.style.display = 'block';
      refInput.focus();
    } else {
      refContainer.style.display = 'none';
    }
  });

  overlay.querySelector('#chkCancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const msgEl = overlay.querySelector('#checkoutMsg');

  overlay.querySelector('#chkConfirm').addEventListener('click', async () => {
    msgEl.textContent = '';
    const method = methodSelect.value;
    const ref = refInput.value.trim();
    const customerPhone = (customerPhoneInput?.value || '').trim() || (method === 'mpesa' ? ref : '');
    if (method === 'mpesa' && !ref) {
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = 'Please enter the M-Pesa / STK phone number.';
      return;
    }
    
    overlay.querySelector('#chkConfirm').disabled = true;
    overlay.querySelector('#chkConfirm').textContent = 'Processing...';

    try {
      const paidOrder = await api('/api/order/pay', {
        method: 'POST',
        body: { order_id: order.id, payment_method: method, payment_ref: ref, customer_phone: customerPhone }
      });
      
      if (method === 'mpesa') {
        msgEl.style.color = 'var(--ok)';
        msgEl.textContent = 'Processing M-Pesa payment...';
        
        setTimeout(() => {
          msgEl.textContent = 'Payment successful! Generating receipt...';
          setTimeout(() => {
            overlay.remove();
            showReceiptModal(paidOrder);
            state.order = null; 
            renderTicket();
          }, 1000);
        }, 2500);
      } else {
        msgEl.style.color = 'var(--ok)';
        msgEl.textContent = 'Payment successful! Generating receipt...';
        setTimeout(() => {
          overlay.remove();
          showReceiptModal(paidOrder);
          state.order = null; 
          renderTicket();
        }, 800);
      }
      
    } catch (e) {
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = e.message;
      overlay.querySelector('#chkConfirm').disabled = false;
      overlay.querySelector('#chkConfirm').textContent = 'Confirm & Print';
    }
  });
}

// ── Suppliers (replaces Tables) ───────────────────────────────────────────────
async function renderSuppliers() {
  const root = qs('[data-page="suppliers"]');
  const suppliers = await api('/api/suppliers');
  
  root.innerHTML = `
    <div class="panel-title-group" style="margin: 0 24px 20px; padding-top: 24px;">
      <h2>Suppliers</h2>
      <div style="display: flex; gap: 12px; margin-left: auto;">
        <button class="add-btn" id="addSupplierBtn" style="background:var(--primary)">+ Add Supplier</button>
        <button class="add-btn" id="refreshSuppliers" style="background:var(--ink)">Refresh</button>
      </div>
    </div>
    
    <div class="sales-table-container">
      <table class="sales-table">
        <thead>
          <tr>
            <th>Supplier Name</th>
            <th>Phone</th>
            <th>Email</th>
            <th>Status</th>
            <th style="text-align: right">Action</th>
          </tr>
        </thead>
        <tbody>
          ${suppliers.map(s => `
            <tr class="sales-row">
              <td><strong>${s.name}</strong></td>
              <td>${s.phone || '-'}</td>
              <td>${s.email || '-'}</td>
              <td>
                <span class="pay-badge" style="${s.active ? 'background:#dcfce7;color:#16a34a;' : 'background:#f1f5f9;color:#64748b;'}">
                  ${s.active ? 'Active' : 'Inactive'}
                </span>
              </td>
              <td style="text-align: right">
                <button class="view-receipt-btn supplier-view-btn" data-id="${s.id}" style="margin-right: 4px;">View</button>
                <button class="view-receipt-btn supplier-edit-btn" data-id="${s.id}">Edit</button>
              </td>
            </tr>
          `).join('') || `<tr><td colspan="5" class="empty" style="text-align:center; padding: 40px;">No suppliers found</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
  
  qs('#refreshSuppliers').addEventListener('click', renderSuppliers);
  qs('#addSupplierBtn').addEventListener('click', () => showSupplierModal());
  
  qsa('.supplier-edit-btn', root).forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      const supplier = suppliers.find(s => s.id === id);
      if (supplier) showSupplierModal(supplier);
    });
  });

  qsa('.supplier-view-btn', root).forEach(btn => {
    btn.addEventListener('click', () => {
      showSupplierDetails(Number(btn.dataset.id));
    });
  });
}

async function showSupplierDetails(id) {
  const supplier = await api(`/api/supplier/detail?id=${id}`);
  
  const formatDate = (ts) => {
    if (!ts) return '-';
    const d = new Date(ts * 1000);
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short' });
  };

  const overlay = document.createElement('div');
  overlay.className = 'qty-popup-overlay';
  overlay.innerHTML = `
    <div class="qty-popup" style="max-width: 500px; text-align: left;">
      <h2 style="margin-top:0">${supplier.name}</h2>
      <p style="color:var(--muted); margin-bottom: 20px;">Total Purchases: <strong style="color:var(--ink)">${money(supplier.total_purchases)}</strong></p>
      
      <div style="font-weight:700; font-size:12px; text-transform:uppercase; color:var(--muted); border-bottom:1px solid var(--line); padding-bottom:8px; margin-bottom:8px;">Products Supplied</div>
      <div style="max-height:300px; overflow-y:auto; margin-bottom:20px;">
        ${supplier.products.length ? supplier.products.map(p => `
          <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #f1f5f9;">
            <div>
              <div style="font-weight:600;">${p.name}</div>
              <div style="font-size:12px; color:var(--muted)">Last Delivery: ${formatDate(p.last_delivery)}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-weight:700; color:var(--primary-dark)">${money(p.cost_cents)} cost</div>
              <div style="font-size:12px; color:var(--muted)">Stock: ${p.stock_qty}</div>
            </div>
          </div>
        `).join('') : '<div style="color:var(--muted); font-size:14px; padding:10px 0;">No products supplied yet.</div>'}
      </div>

      <div class="qty-popup-actions">
        <button class="primary" id="closeSupplierView" style="width:100%">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('#closeSupplierView').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

function showSupplierModal(supplier = null) {
  const overlay = document.createElement('div');
  overlay.className = 'qty-popup-overlay';
  overlay.innerHTML = `
    <div class="qty-popup" style="max-width: 450px; text-align: left;">
      <h3 style="margin-top:0">${supplier ? 'Edit Supplier' : 'New Supplier'}</h3>
      <form id="supplierForm" style="display:flex; flex-direction:column; gap:16px;">
        <div>
          <label style="display:block; margin-bottom:6px; font-weight:600; font-size:14px;">Supplier Name *</label>
          <input class="field" name="name" required value="${supplier ? supplier.name : ''}" style="width:100%; padding:10px;">
        </div>
        <div style="display:flex; gap:16px;">
          <div style="flex:1;">
            <label style="display:block; margin-bottom:6px; font-weight:600; font-size:14px;">Phone Number</label>
            <input class="field" name="phone" value="${supplier?.phone || ''}" style="width:100%; padding:10px;">
          </div>
          <div style="flex:1;">
            <label style="display:block; margin-bottom:6px; font-weight:600; font-size:14px;">Status</label>
            <select name="active" class="field" style="width:100%; padding:10px;">
              <option value="1" ${supplier?.active === 0 ? '' : 'selected'}>Active</option>
              <option value="0" ${supplier?.active === 0 ? 'selected' : ''}>Inactive</option>
            </select>
          </div>
        </div>
        <div>
          <label style="display:block; margin-bottom:6px; font-weight:600; font-size:14px;">Email Address</label>
          <input type="email" class="field" name="email" value="${supplier?.email || ''}" style="width:100%; padding:10px;">
        </div>
        
        <div id="supplierMsg" style="margin-top:4px; font-weight:600; font-size:14px; text-align:center;"></div>
        
        <div class="qty-popup-actions" style="margin-top:16px;">
          <button type="button" class="ghost" id="cancelSupplierBtn">Cancel</button>
          <button type="submit" class="primary">Save Supplier</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('#cancelSupplierBtn').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const msgEl = overlay.querySelector('#supplierMsg');
  const submitBtn = overlay.querySelector('button[type="submit"]');

  overlay.querySelector('#supplierForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    msgEl.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';
    
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    if (supplier) payload.id = supplier.id;
    
    try {
      await api('/api/admin/supplier', { method: 'POST', body: payload });
      msgEl.style.color = 'var(--ok)';
      msgEl.textContent = 'Supplier saved successfully!';
      
      setTimeout(() => {
        close();
        renderSuppliers();
      }, 800);
      
    } catch (err) {
      msgEl.style.color = 'var(--danger)';
      msgEl.textContent = err.message;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save Supplier';
    }
  });
}

// ── Sales History (replaces Orders) ──────────────────────────────────────────
async function renderSales() {
  const root = qs('[data-page="sales"]');
  const orders = await api('/api/orders?status=paid');
  
  const formatDate = (ts) => {
    if (!ts) return '-';
    const d = new Date(ts * 1000);
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  root.innerHTML = `
    <div class="panel-title-group" style="margin: 0 24px 20px; padding-top: 24px;">
      <h2>Sales History</h2>
      <button class="add-btn" id="refreshSales" style="background:var(--ink)">Refresh</button>
    </div>
    
    <div class="sales-table-container">
      <table class="sales-table">
        <thead>
          <tr>
            <th>Receipt No.</th>
            <th>Date</th>
            <th>Cashier</th>
            <th>Payment</th>
            <th style="text-align: right">Total</th>
            <th style="text-align: right">Action</th>
          </tr>
        </thead>
        <tbody>
          ${orders.map(o => `
            <tr class="sales-row" data-id="${o.id}">
              <td class="font-mono"><strong>${o.ticket_no}</strong></td>
              <td class="text-muted">${formatDate(o.updated_at)}</td>
              <td>${o.employee_name || '-'}</td>
              <td>
                <span class="pay-badge ${o.payment_method === 'mpesa' ? 'mpesa' : 'cash'}">
                  ${o.payment_method === 'mpesa' ? 'M-Pesa' : 'Cash'}
                </span>
                ${o.payment_ref ? `<div class="pay-ref">${o.payment_ref}</div>` : ''}
              </td>
              <td class="sales-total" style="text-align: right">${money(o.total_cents)}</td>
              <td style="text-align: right">
                <button class="view-receipt-btn">View</button>
              </td>
            </tr>
          `).join('') || `<tr><td colspan="6" class="empty" style="text-align:center; padding: 40px;">No sales found</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
  
  qs('#refreshSales').addEventListener('click', renderSales);
  
  qsa('.sales-row', root).forEach(row => {
    row.addEventListener('click', async () => {
      const id = row.dataset.id;
      try {
        const fullOrder = await api(`/api/order?id=${id}`);
        showReceiptModal(fullOrder);
      } catch (err) {
        toast('Failed to load receipt', 'error');
      }
    });
  });
}

// ── Cashier Payments ──────────────────────────────────────────────────────────
async function renderCashier() {
  const root = qs('[data-page="cashier"]');
  const existingSearch = qs('#paymentSearch')?.value || '';
  const orders = await api(`/api/payments?q=${encodeURIComponent(existingSearch)}`);
  root.innerHTML = `
    <div class="panel-head">
      <h2>Pending Payments</h2>
      <div class="head-actions">
        <input class="field compact-field" id="paymentSearch" placeholder="Ticket, customer, staff" value="${existingSearch}">
        <button class="primary" id="refreshCashier">Refresh</button>
      </div>
    </div>
    <div class="content-grid">
      ${orders.map(o => `
        <article class="order-card ${o.status}" data-order="${o.id}">
          <span class="badge">${o.status}</span>
          <strong>${o.ticket_no}</strong>
          <span>${o.order_type} — ${o.employee_name || '-'}</span>
          ${o.customer_name ? `<span>Customer: ${o.customer_name}</span>` : ''}
          <strong>${money(o.total_cents)}</strong>
          <input class="field pay-ref" placeholder="M-Pesa code / reference">
          <div class="pay-actions">
            <button class="primary pay-btn" data-method="mpesa">M-Pesa</button>
            <button class="secondary pay-btn" data-method="cash">Cash</button>
            <button class="secondary pay-btn" data-method="card">Card</button>
          </div>
          <button class="receipt-link-btn" data-receipt-order="${o.id}">View Receipt</button>
        </article>
      `).join('') || '<div class="empty">No pending payments</div>'}
    </div>
  `;

  qs('#refreshCashier').addEventListener('click', renderCashier);
  qs('#paymentSearch').addEventListener('keydown', event => {
    if (event.key === 'Enter') renderCashier();
  });

  qsa('[data-receipt-order]', root).forEach(btn => btn.addEventListener('click', async () => {
    const orderId = Number(btn.dataset.receiptOrder);
    try {
      const allOrders = await api('/api/payments?q=');
      const summary = allOrders.find(o => o.id === orderId);
      if (summary) showReceiptModal({ ...summary, items: [] });
    } catch(e) { /* ignore */ }
  }));

  qsa('.pay-btn', root).forEach(btn => btn.addEventListener('click', async () => {
    const card = btn.closest('[data-order]');
    const orderId = Number(card.dataset.order);
    const ref = qs('.pay-ref', card).value.trim();
    await api('/api/order/pay', {
      method: 'POST',
      body: { order_id: orderId, payment_method: btn.dataset.method, payment_ref: ref },
    });
    await renderCashier();
  }));
}

// ── Product Admin (replaces Menu Admin) ──────────────────────────────────────
let productSearch = '';
let productCategoryFilter = '';

function renderProductAdmin() {
  const root = qs('[data-page="products"]');

  root.innerHTML = `
    <div class="panel-head">
      <div class="panel-title-group">
        <h2>Products</h2>
        <span class="badge" id="productCountBadge">${state.items.length} active</span>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <button type="button" class="secondary barcode-scan-btn" id="scanAddProductBtn" style="padding:9px 14px; font-size:13px;" title="Scan Barcode to Add or Lookup Product">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 5v14M8 5v14M12 5v14M17 5v14M21 5v14"/>
          </svg>
          <span>Scan Barcode / Add</span>
        </button>
        <button class="primary add-btn" id="showAddProductModal">+ Add Product</button>
      </div>
    </div>
    
    <div class="toolbar">
      <div class="search-bar">
        <span class="search-icon">🔍</span>
        <input type="text" class="field search-field" id="productSearchInput" placeholder="Search by name or SKU..." value="${productSearch}">
      </div>
      <select class="field cat-filter" id="productCatFilter">
        <option value="">All Categories</option>
        ${state.categories.map(c => `<option value="${c.id}" ${productCategoryFilter == c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
      </select>
    </div>

    <div class="content-grid product-grid" id="productAdminGrid"></div>
  `;

  // Global Event Listeners for the page
  const searchInput = qs('#productSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      productSearch = e.target.value;
      renderProductAdminGrid();
    });
  }

  qs('#productCatFilter')?.addEventListener('change', e => {
    productCategoryFilter = e.target.value;
    renderProductAdminGrid();
  });

  qs('#showAddProductModal')?.addEventListener('click', () => showProductModal());
  qs('#scanAddProductBtn')?.addEventListener('click', () => showBarcodeModal('product'));

  // Close menus on outside click
  document.addEventListener('click', () => {
    qsa('.action-menu', root).forEach(m => m.classList.add('hidden'));
  });

  renderProductAdminGrid();
}

function renderProductAdminGrid() {
  const grid = qs('#productAdminGrid');
  if (!grid) return;
  const root = qs('[data-page="products"]');
  
  const filteredItems = state.items.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(productSearch.toLowerCase()) || 
                          (item.sku && item.sku.toLowerCase().includes(productSearch.toLowerCase())) ||
                          (item.barcode && item.barcode.toLowerCase().includes(productSearch.toLowerCase()));
    const matchesCat = productCategoryFilter ? item.category_id === Number(productCategoryFilter) : true;
    return matchesSearch && matchesCat;
  });

  const badge = qs('#productCountBadge');
  if (badge) badge.textContent = `${filteredItems.length} active`;

  grid.innerHTML = filteredItems.map(item => {
    const isExpired = item.expiry_date && new Date(item.expiry_date) < new Date();
    const isExpiringSoon = item.expiry_date && !isExpired && (new Date(item.expiry_date) - new Date() < 30 * 86400000);
    const lowStock = tracksStock(item) && (item.stock_qty || 0) <= (item.reorder_level ?? 5);

    return `
      <article class="menu-card product-card" data-id="${item.id}">
        <div class="card-header">
          <span class="badge" style="background:${item.color || '#334155'};color:white">${categoryName(item.category_id)}</span>
          <div class="card-actions">
            <button class="action-menu-btn">⋮</button>
            <div class="action-menu hidden">
              <button class="edit-btn" data-id="${item.id}">Edit Product</button>
              <button class="delete-btn" data-id="${item.id}">Delete</button>
            </div>
          </div>
        </div>
        <strong>${item.name}</strong>
        ${item.strength ? `<div style="font-size:12px; color:#2563eb; font-weight:700;">${item.strength}</div>` : ''}
        ${item.manufacturer ? `<small style="color:var(--muted); font-size:11px;">Mfr: ${item.manufacturer}</small>` : ''}
        ${item.sku ? `<small class="sku-text">SKU: ${item.sku}</small>` : '<small class="sku-text">No SKU</small>'}
        ${item.barcode ? `<small class="sku-text" style="color:var(--muted)">Barcode: ${item.barcode}</small>` : ''}

        ${hasCap('batches_expiry') && item.batch_no ? `<small style="font-size:11px; color:#475569;">Batch: <strong>${item.batch_no}</strong></small>` : ''}
        ${hasCap('batches_expiry') && item.expiry_date ? `
          <div style="margin-top:2px;">
            <span class="expiry-badge" style="font-size:11px; padding:2px 6px; border-radius:4px; font-weight:700; ${isExpired ? 'background:#fee2e2; color:#b91c1c;' : (isExpiringSoon ? 'background:#fef3c7; color:#b45309;' : 'background:#dcfce7; color:#15803d;')}">
              ${isExpired ? 'EXPIRED' : (isExpiringSoon ? 'Exp Soon' : 'Exp')}: ${item.expiry_date}
            </span>
          </div>
        ` : ''}

        ${hasCap('variants') && item.variants_json ? `
          <div style="margin-top:2px;">
            <span class="cap-pill" style="font-size:11px; background:var(--line); color:var(--ink); font-weight:600;">Variants: ${item.variants_json}</span>
          </div>
        ` : ''}
        
        <div class="price-tier">
          <div class="price-row">
            <span class="price-label">Retail (Sell)</span>
            <span class="price-value sell-price">${money(item.price_cents)}</span>
          </div>
          ${hasCap('wholesale_pricing') && item.wholesale_price_cents ? `
            <div class="price-row">
              <span class="price-label">Wholesale</span>
              <span class="price-value" style="color:#2563eb; font-weight:700;">${money(item.wholesale_price_cents)}</span>
            </div>
          ` : `
            <div class="price-row">
              <span class="price-label">Cost</span>
              <span class="price-value cost-price">${money(item.cost_cents || 0)}</span>
            </div>
          `}
        </div>
        
        <div class="card-footer">
          <small style="color:${lowStock ? '#b91c1c; font-weight:700;' : 'var(--muted)'}">
            ${item.unit === 'service' ? 'Workshop Service' : `Stock: ${item.stock_qty !== undefined ? item.stock_qty : '?'} ${item.unit || 'pcs'}`}
          </small>
          ${hasCap('reorder_levels') && item.reorder_level ? `<small style="color:var(--muted)">Min: ${item.reorder_level}</small>` : ''}
        </div>
      </article>
    `;
  }).join('') || '<div class="empty">No products match your criteria</div>';

  // Dropdown toggles
  qsa('.action-menu-btn', grid).forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const menu = btn.nextElementSibling;
      const isHidden = menu.classList.contains('hidden');
      qsa('.action-menu', root).forEach(m => m.classList.add('hidden')); // close all
      if (isHidden) menu.classList.remove('hidden');
    });
  });

  qsa('.edit-btn', grid).forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const item = state.items.find(i => i.id == btn.dataset.id);
      if (item) showProductModal(item);
    });
  });

  qsa('.delete-btn', grid).forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm('Are you sure you want to completely delete this product?')) return;
      const item = state.items.find(i => i.id == btn.dataset.id);
      if (item) {
        try {
          const payload = await api('/api/menu/item?id=' + item.id, { method: 'DELETE' });
          if (payload.error) {
            alert(payload.error);
            return;
          }
          state.categories = payload.categories;
          state.items = payload.items;
          renderProductAdmin();
        } catch (err) {
          alert('Could not delete product. It may have sales history tied to it.');
        }
      }
    });
  });
}

// ── Online Image Search Modal ────────────────────────────────────────────────
function showImageSearchModal(query, onSelect) {
  const overlay = document.createElement('div');
  overlay.className = 'qty-popup-overlay';
  overlay.style.zIndex = '10000';
  overlay.innerHTML = `
    <div class="qty-popup" style="max-width: 500px; width: 90vw; max-height: 85vh; display:flex; flex-direction:column; text-align: left; padding: 22px; background:var(--panel); border:1px solid var(--line); border-radius:14px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:20px;">🔍</span>
          <h3 style="margin:0; font-size:17px; font-weight:700; color:var(--ink);">Search Product Image</h3>
        </div>
        <button class="modal-close" id="imgModalClose" style="background:none; border:none; font-size:24px; color:var(--muted); cursor:pointer; line-height:1;">&times;</button>
      </div>
      <p style="font-size:12px; color:var(--muted); margin:0 0 14px; line-height:1.4;">
        Finds the single best matching product photo online. Click <strong>Use This Image</strong> to download and optimize it locally with Pillow.
      </p>
      
      <div style="display:flex; gap:8px; margin-bottom:14px;">
        <input class="field" id="imgSearchInput" placeholder="Enter product name..." value="${query || ''}" style="flex:1; padding:9px 12px; font-size:13px;">
        <button class="primary" id="doImgSearchBtn" style="padding:9px 16px; font-size:13px; font-weight:700; white-space:nowrap;">Search</button>
      </div>

      <div id="imgSearchResults" style="min-height: 240px; display:flex; flex-direction:column; justify-content:center;">
        <div style="text-align:center; color:var(--muted); padding:30px 0; font-size:13px;">Type a product name and click Search</div>
      </div>

      <div id="imgSearchStatus" style="font-size:12px; color:var(--muted); margin-top:8px; text-align:center;"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('#imgModalClose').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const input = overlay.querySelector('#imgSearchInput');
  const resultsBox = overlay.querySelector('#imgSearchResults');
  const statusEl = overlay.querySelector('#imgSearchStatus');
  const searchBtn = overlay.querySelector('#doImgSearchBtn');

  const executeSearch = async () => {
    const q = input.value.trim();
    if (!q) return;
    searchBtn.disabled = true;
    searchBtn.textContent = 'Searching...';
    resultsBox.innerHTML = `
      <div style="text-align:center; padding:40px 0;">
        <span style="font-size:28px; display:inline-block; animation:spin 1s linear infinite;">⏳</span>
        <p style="margin-top:10px; color:var(--muted); font-size:13px;">Finding best product photo for "${q}"...</p>
      </div>
    `;
    statusEl.textContent = '';

    try {
      const data = await api(`/api/product/image-search?q=${encodeURIComponent(q)}&limit=1`);
      searchBtn.disabled = false;
      searchBtn.textContent = 'Search';

      const imagesList = data.images || data.results || [];
      const img = imagesList[0];

      if (!img) {
        resultsBox.innerHTML = `
          <div style="text-align:center; color:var(--muted); padding:35px 0;">
            <div style="font-size:28px; margin-bottom:6px;">📷</div>
            <div>No image found for "${q}".</div>
            <div style="font-size:12px; margin-top:4px;">Try a broader keyword (e.g. "Cetirizine", "Cement", "Burger").</div>
          </div>
        `;
        return;
      }

      const imgUrl = img.full || img.url || img.thumb || img.thumbnail;
      const displayThumb = img.thumb || img.thumbnail || imgUrl;

      resultsBox.innerHTML = `
        <div style="background:var(--bg); border:1px solid var(--line); border-radius:12px; padding:14px; display:flex; flex-direction:column; align-items:center; gap:12px;">
          <div style="width:100%; height:230px; background:var(--panel); border-radius:8px; display:flex; align-items:center; justify-content:center; overflow:hidden; border:1px solid var(--line); position:relative;">
            <img src="${displayThumb}" alt="${img.title || 'Product'}" style="max-height:100%; max-width:100%; object-fit:contain;" onerror="this.src='/static/uploads/default.png';">
            <span style="position:absolute; top:8px; right:8px; font-size:11px; font-weight:700; background:rgba(0,0,0,0.75); color:#cbd5e1; padding:3px 8px; border-radius:6px; text-transform:capitalize;">${img.source || 'web'}</span>
          </div>
          <div style="text-align:center; width:100%;">
            <div style="font-size:13px; font-weight:700; color:var(--ink); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${img.title || ''}">
              ${img.title || q}
            </div>
          </div>
          <button type="button" id="useThisImgBtn" class="primary" style="width:100%; padding:12px 20px; font-size:14px; font-weight:700; border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 2px 8px rgba(0,0,0,0.15);">
            <span>✓</span> Use This Image
          </button>
        </div>
      `;

      resultsBox.querySelector('#useThisImgBtn')?.addEventListener('click', async () => {
        const btn = resultsBox.querySelector('#useThisImgBtn');
        btn.disabled = true;
        btn.textContent = 'Optimizing and saving with Pillow...';
        statusEl.innerHTML = `<span style="color:var(--primary); font-weight:700;">Processing with Pillow...</span>`;

        try {
          const saved = await api('/api/product/save-image', {
            method: 'POST',
            body: { image_url: imgUrl, name: q }
          });
          if (saved.local_url) {
            onSelect(saved.local_url);
            toast('Image saved & optimized!', 'success');
            close();
          } else {
            throw new Error('Image save failed');
          }
        } catch(err) {
          statusEl.innerHTML = `<span style="color:var(--danger); font-weight:700;">Failed to download: ${err.message}</span>`;
          btn.disabled = false;
          btn.textContent = '✓ Use This Image';
        }
      });

    } catch (err) {
      searchBtn.disabled = false;
      searchBtn.textContent = 'Search';
      resultsBox.innerHTML = `<div style="text-align:center; color:var(--danger); padding:30px 0; font-size:13px;">Search failed: ${err.message}</div>`;
    }
  };

  searchBtn.addEventListener('click', executeSearch);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') executeSearch(); });

  if (query) executeSearch();
}

function showProductModal(item = null) {
  document.getElementById('productModal')?.remove();
  
  const isEdit = !!item;
  let defaultSku = '';
  if (!isEdit) {
    const skus = state.items.map(i => parseInt(i.sku) || 0);
    const maxSku = skus.length > 0 ? Math.max(...skus) : 0;
    defaultSku = maxSku + 1;
  }
  const overlay = document.createElement('div');
  overlay.id = 'productModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box" style="width:540px; max-width:92vw; max-height:90vh; overflow-y:auto;">
      <div class="modal-head">
        <h3>${isEdit ? 'Edit Product' : 'Add Product'}</h3>
        <button class="modal-close" id="pmClose" type="button">&times;</button>
      </div>
      <form id="pmForm" class="modal-form">
        <div class="form-grid">
          <div class="form-group" style="grid-column: 1 / -1;">
            <label>Product Image</label>
            <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
              <div id="imgPreview" style="width:64px; height:64px; background:#f1f5f9; border-radius:8px; border:1px solid var(--line); display:flex; align-items:center; justify-content:center; overflow:hidden;">
                ${item?.image_url ? `<img src="${item.image_url}" style="width:100%;height:100%;object-fit:contain;padding:4px;box-sizing:border-box;">` : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:24px;height:24px;color:var(--muted)"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>'}
              </div>
              <input type="file" id="imgUpload" accept="image/*" class="field" style="flex:1; min-width:160px; padding:6px;">
              <button type="button" class="secondary" id="searchImgOnlineBtn" style="padding: 7px 12px; font-size: 13px; white-space:nowrap;">🔍 Search Online</button>
              <input type="hidden" name="image_base64" id="imgBase64">
              <input type="hidden" name="image_url" id="imgUrlInput" value="${item?.image_url || ''}">
            </div>
          </div>
          <div class="form-group" style="grid-column: 1 / -1;">
            <label>Product Name *</label>
            <input class="field" name="name" id="productNameInput" value="${item?.name || ''}" required>
          </div>
          <div class="form-group">
            <label>Category</label>
            <select class="field" name="category_id">
              ${state.categories.map(c => `<option value="${c.id}" ${item?.category_id == c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>SKU</label>
            <input class="field" name="sku" value="${item?.sku || defaultSku}">
          </div>
          ${hasCap('barcode') ? `
            <div class="form-group">
              <label style="display:flex; justify-content:space-between; align-items:center;">
                <span>Barcode</span>
                <span style="display:flex; gap:6px;">
                  <button type="button" class="btn-xs" id="pmScanBarcodeBtn" title="Scan with camera or barcode reader">📷 Scan</button>
                  <button type="button" class="btn-xs" id="pmGenBarcodeBtn" title="Generate random EAN barcode">🎲 Generate</button>
                </span>
              </label>
              <input class="field" id="pmBarcodeInput" name="barcode" value="${item?.barcode || ''}" placeholder="Scan or enter barcode">
            </div>
          ` : ''}
          <div class="form-group">
            <label>Unit of Measure</label>
            ${state.profile?.id === 'garage' ? `<select class="field" name="unit">${garageUnitOptions(item?.unit || 'pcs')}</select>` : `<input class="field" name="unit" placeholder="pcs, kg, m, tin" value="${item?.unit || 'pcs'}">`}
          </div>
          <div class="form-group">
            <label>Stock Qty</label>
            <input class="field" name="stock_qty" type="number" step="${item?.decimal_qty_enabled || hasCap('decimal_qty') ? '0.01' : '1'}" value="${item?.stock_qty !== undefined ? item.stock_qty : 0}">
          </div>
          ${hasCap('reorder_levels') ? `
            <div class="form-group">
              <label>Reorder Level (Min Stock)</label>
              <input class="field" name="reorder_level" type="number" value="${item?.reorder_level || 5}">
            </div>
          ` : ''}
          <div class="form-group">
            <label>Cost Price</label>
            <input class="field" name="cost" type="number" step="0.01" min="0" value="${item ? (item.cost_cents || 0)/100 : ''}">
          </div>
          <div class="form-group">
            <label>Selling Price (Retail) *</label>
            <input class="field" name="price" type="number" step="0.01" min="0" value="${item ? (item.price_cents || 0)/100 : ''}" required>
          </div>
          ${hasCap('wholesale_pricing') ? `
            <div class="form-group">
              <label>Wholesale Price (KES)</label>
              <input class="field" name="wholesale_price" type="number" step="0.01" min="0" value="${item?.wholesale_price_cents ? (item.wholesale_price_cents)/100 : ''}">
            </div>
          ` : ''}
          ${hasCap('batches_expiry') ? `
            <div class="form-group">
              <label>Batch Number</label>
              <input class="field" name="batch_no" value="${item?.batch_no || ''}" placeholder="e.g. BATCH-2024-01">
            </div>
            <div class="form-group">
              <label>Expiry Date</label>
              <input class="field" name="expiry_date" type="date" value="${item?.expiry_date || ''}">
            </div>
          ` : ''}
          ${hasCap('manufacturer_strength') ? `
            <div class="form-group">
              <label>Manufacturer / Brand</label>
              <input class="field" name="manufacturer" value="${item?.manufacturer || ''}" placeholder="e.g. GSK, Bayer, Nike">
            </div>
            <div class="form-group">
              <label>Strength / Dosage</label>
              <input class="field" name="strength" value="${item?.strength || ''}" placeholder="e.g. 500mg, 10ml, 50ml">
            </div>
          ` : ''}
          ${hasCap('decimal_qty') ? `
            <div class="form-group" style="grid-column: 1 / -1; display:flex; align-items:center; gap:8px;">
              <input type="checkbox" id="decimalQtyCheck" name="decimal_qty_enabled" value="1" ${item?.decimal_qty_enabled ? 'checked' : ''}>
              <label for="decimalQtyCheck" style="margin:0; cursor:pointer; font-size:13px; font-weight:600;">Allow Decimal Quantities (e.g. 1.5 kg, 2.75 m)</label>
            </div>
          ` : ''}
          ${hasCap('variants') ? `
            <div class="form-group" style="grid-column: 1 / -1;">
              <label>Product Variants (e.g. Small, Medium, Large or Shade 01, Shade 02)</label>
              <input class="field" name="variants_json" value="${item?.variants_json ? (typeof item.variants_json === 'string' ? item.variants_json : JSON.stringify(item.variants_json)) : ''}" placeholder="e.g. Small, Medium, Large">
            </div>
          ` : ''}
        </div>
        <div class="modal-actions">
          <button type="button" class="secondary" id="pmCancel">Cancel</button>
          <button type="submit" class="primary">${isEdit ? 'Save Changes' : 'Add Product'}</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  
  const close = () => overlay.remove();
  qs('#pmClose', overlay).addEventListener('click', close);
  qs('#pmCancel', overlay).addEventListener('click', close);
  
  const imgUpload = qs('#imgUpload', overlay);
  const imgPreview = qs('#imgPreview', overlay);
  const imgBase64 = qs('#imgBase64', overlay);
  const imgUrlInput = qs('#imgUrlInput', overlay);

  qs('#searchImgOnlineBtn', overlay)?.addEventListener('click', () => {
    const pName = qs('#productNameInput', overlay)?.value || item?.name || '';
    showImageSearchModal(pName, (localUrl) => {
      imgUrlInput.value = localUrl;
      imgBase64.value = '';
      imgPreview.innerHTML = `<img src="${localUrl}" style="width:100%;height:100%;object-fit:contain;padding:4px;box-sizing:border-box;">`;
    });
  });

  if (imgUpload) {
    imgUpload.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
          const MAX = 400;
          let w = img.width, h = img.height;
          if (w > h) { if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; } }
          else        { if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; } }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          const compressed = canvas.toDataURL('image/jpeg', 0.75);
          imgBase64.value = compressed;
          imgPreview.innerHTML = `<img src="${compressed}" style="width:100%;height:100%;object-fit:contain;padding:4px;box-sizing:border-box;">`;
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  overlay.querySelector('#pmScanBarcodeBtn')?.addEventListener('click', () => {
    showBarcodeModal('product', (code) => {
      const bInput = overlay.querySelector('#pmBarcodeInput');
      if (bInput) {
        bInput.value = code;
        toast(`Scanned barcode: ${code}`, 'success');
      }
    });
  });

  overlay.querySelector('#pmGenBarcodeBtn')?.addEventListener('click', () => {
    const randomEan = '616' + Math.floor(100000000 + Math.random() * 900000000);
    const bInput = overlay.querySelector('#pmBarcodeInput');
    if (bInput) {
      bInput.value = randomEan;
      toast(`Generated barcode: ${randomEan}`, 'info');
    }
  });

  qs('#pmForm', overlay).addEventListener('submit', async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    if (isEdit) data.id = item.id;
    if (item) {
      data.color = item.color;
      data.active = item.active;
    }
    const payload = await api('/api/menu/item', { method: 'POST', body: data });
    state.categories = payload.categories;
    state.items = payload.items;
    close();
    renderProductAdmin();
  });
}

// ── Stock Page (replaces Kitchen) ────────────────────────────────────────────
let stockSearch = '';
let stockFilter = 'all'; // all, low, in_stock

async function renderStock() {
  const root = qs('[data-page="stock"]');
  const allItems = (await api('/api/stock')).filter(tracksStock);
  
  const lowStockCount = allItems.filter(i => (i.stock_qty || 0) <= 5).length;
  
  const filteredItems = allItems.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(stockSearch.toLowerCase()) || 
                          (item.sku && item.sku.toLowerCase().includes(stockSearch.toLowerCase()));
    
    let matchesFilter = true;
    if (stockFilter === 'low') matchesFilter = (item.stock_qty || 0) <= 5;
    if (stockFilter === 'in_stock') matchesFilter = (item.stock_qty || 0) > 5;
    
    return matchesSearch && matchesFilter;
  });

  root.innerHTML = `
    <div class="panel-head">
      <div class="panel-title-group">
        <h2>Stock Levels</h2>
      </div>
      <button class="primary" id="refreshStock">Refresh</button>
    </div>
    
    <div class="toolbar stock-toolbar">
      <div class="filter-pills">
        <button class="pill ${stockFilter === 'all' ? 'active' : ''}" data-filter="all">All Inventory</button>
        <button class="pill alert-pill ${stockFilter === 'low' ? 'active' : ''}" data-filter="low">
          Low Stock Alert <span class="pill-badge">${lowStockCount}</span>
        </button>
        <button class="pill ${stockFilter === 'in_stock' ? 'active' : ''}" data-filter="in_stock">In Stock</button>
      </div>
      <div class="search-bar">
        <span class="search-icon">🔍</span>
        <input type="text" class="field search-field" id="stockSearchInput" placeholder="Search by name or SKU..." value="${stockSearch}">
      </div>
    </div>

    <div class="content-grid stock-grid">
      ${filteredItems.map(item => {
        const low = (item.stock_qty || 0) <= 5;
        return `
          <article class="stock-card ${low ? 'low-stock' : 'in-stock'}" data-id="${item.id}">
            <div class="card-header">
              <span class="badge status-badge">${low ? 'LOW STOCK' : 'In Stock'}</span>
              <span class="category-text">${categoryName(item.category_id)}</span>
            </div>
            <strong>${item.name}</strong>
            ${item.sku ? `<small class="sku-text">SKU: ${item.sku}</small>` : '<small class="sku-text">No SKU</small>'}
            
            <div class="stock-display">
              <span class="stock-value">${item.stock_qty || 0}</span>
              <span class="stock-unit">${item.unit || 'pcs'}</span>
            </div>
            
            <div class="card-footer">
              ${low ? `
                <button class="danger restock-btn" data-id="${item.id}">Restock / Reorder</button>
              ` : `
                <div class="inline-adjust">
                  <button class="adjust-btn minus" data-id="${item.id}">−</button>
                  <span class="adjust-label">Adjust</span>
                  <button class="adjust-btn plus" data-id="${item.id}">+</button>
                </div>
              `}
            </div>
          </article>
        `;
      }).join('') || '<div class="empty">No products match your criteria</div>'}
    </div>
  `;
  
  qs('#refreshStock')?.addEventListener('click', renderStock);
  
  const stInp = qs('#stockSearchInput');
  if (stInp) {
    stInp.addEventListener('input', e => {
      stockSearch = e.target.value;
      renderStock();
      const inp = qs('#stockSearchInput');
      inp.focus();
      inp.selectionStart = inp.selectionEnd = inp.value.length;
    });
  }

  qsa('.pill', root).forEach(btn => {
    btn.addEventListener('click', () => {
      stockFilter = btn.dataset.filter;
      renderStock();
    });
  });

  // Adjust actions
  qsa('.adjust-btn', root).forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const isPlus = btn.classList.contains('plus');
      const change = isPlus ? 1 : -1;
      
      try {
        await api('/api/stock/adjust', {
          method: 'POST',
          body: { product_id: id, qty_change: change, reason: 'inline_adjustment' }
        });
        await bootstrap(); // refresh global catalog
        renderStock();
      } catch (err) {
        alert('Failed to adjust stock. Ensure you have manager privileges.');
      }
    });
  });

  qsa('.restock-btn', root).forEach(btn => {
    btn.addEventListener('click', () => {
      alert('Restock request recorded for product ID: ' + btn.dataset.id);
    });
  });
}

// ── Reports ───────────────────────────────────────────────────────────────────
async function renderReports(period = 'today') {
  const root = qs('[data-page="reports"]');
  const report = await api(`/api/reports?period=${period}`);
  
  const profit = report.totals.sales - report.totals.costs;
  const margin = report.totals.sales > 0 ? Math.round((profit / report.totals.sales) * 100) : 0;
  
  let mpesaTotal = 0;
  let cashTotal = 0;
  if (report.payments) {
    report.payments.forEach(p => {
      if (p.method === 'mpesa') mpesaTotal += p.amount;
      else cashTotal += p.amount;
    });
  }

  root.innerHTML = `
    <div class="panel-title-group" style="margin: 0 24px 20px; padding-top: 24px; display: flex; justify-content: space-between; align-items: center;">
      <div><h2 style="margin:0">Business Analytics</h2><div style="font-size:12px;color:var(--muted);margin-top:4px;">${report.range?.label || 'Selected period'} · ${state.profile?.name || 'POS'}</div></div>
      <div style="display:flex; gap: 8px;">
        <select id="reportPeriod" class="field" style="padding: 6px 12px; height: 36px;">
          <option value="today" ${period === 'today' ? 'selected' : ''}>Today</option>
          <option value="yesterday" ${period === 'yesterday' ? 'selected' : ''}>Yesterday</option>
          <option value="week" ${period === 'week' ? 'selected' : ''}>Last 7 Days</option>
          <option value="month" ${period === 'month' ? 'selected' : ''}>Last 30 Days</option>
        </select>
        <button class="add-btn" id="printReportBtn">Print Z-Report</button>
      </div>
    </div>
    
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 0 24px 24px;">
      <div class="report-stat-card">
        <div style="font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase;">Gross Revenue</div>
        <div style="font-size: 28px; font-weight: 800; color: var(--ink); margin-top: 8px;">${money(report.totals.sales)}</div>
        <div style="font-size: 13px; color: var(--muted); margin-top: 4px;">From ${report.totals.orders} sales</div>
      </div>
      <div class="report-stat-card">
        <div style="font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase;">Gross Profit</div>
        <div style="font-size: 28px; font-weight: 800; color: var(--ok); margin-top: 8px;">${money(profit)}</div>
        <div style="font-size: 13px; color: var(--muted); margin-top: 4px;">Realized Margin: ${margin}%</div>
      </div>
      <div class="report-stat-card">
        <div style="font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase;">Inventory Value</div>
        <div style="font-size: 28px; font-weight: 800; color: var(--info); margin-top: 8px;">${money(report.stock?.inventory_value || 0)}</div>
        <div style="font-size: 13px; color: var(--muted); margin-top: 4px;">Potential Profit: ${money(report.stock?.potential_profit || 0)}</div>
      </div>
      <div class="report-stat-card">
        <div style="font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase;">Cash Sales</div>
        <div style="font-size: 28px; font-weight: 800; color: var(--ok); margin-top: 8px;">${money(cashTotal)}</div>
      </div>
      <div class="report-stat-card">
        <div style="font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase;">M-Pesa Sales</div>
        <div style="font-size: 28px; font-weight: 800; color: var(--ok); margin-top: 8px;">${money(mpesaTotal)}</div>
      </div>
    </div>
    
    <div class="sales-table-container">
      <div style="padding: 16px 20px; font-weight: 700; font-size: 12px; color: var(--muted); text-transform: uppercase; border-bottom: 1px solid var(--line); background: var(--surface-soft);">TOP MOVERS (BY REVENUE)</div>
      <table class="sales-table" style="border-top: none;">
        <thead>
          <tr>
            <th>Product Name</th>
            <th style="text-align: right">Qty Sold</th>
            <th style="text-align: right">Revenue Generated</th>
            <th style="text-align: right">Current Stock Left</th>
          </tr>
        </thead>
        <tbody>
          ${(report.top_items || []).map(item => `
            <tr class="sales-row">
              <td><strong>${item.name}</strong></td>
              <td style="text-align: right">${item.qty}</td>
              <td style="text-align: right; font-weight: 700; color: var(--primary-dark)">${money(item.sales)}</td>
              <td style="text-align: right">
                <span class="pay-badge report-stock-status ${item.current_stock > 10 ? '' : 'low'}">
                  ${item.current_stock || 0} left
                </span>
              </td>
            </tr>
          `).join('') || `<tr><td colspan="4" class="empty" style="text-align:center; padding: 40px;">No sales data for this period</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
  
  qs('#reportPeriod').addEventListener('change', (e) => renderReports(e.target.value));
  qs('#printReportBtn').addEventListener('click', () => {
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html><head><style>
        body { font-family: monospace; font-size: 12px; margin: 0; padding: 20px; width: 300px; }
        .text-center { text-align: center; }
        .flex { display: flex; justify-content: space-between; margin-bottom: 4px; }
        h2 { margin: 0 0 5px 0; font-size: 16px; }
        hr { border-top: 1px dashed black; border-bottom: none; margin: 10px 0; }
      </style></head><body>
        <div class="text-center">
          <h2>${state.settings?.business_name || state.profile?.name || 'POS'}</h2>
          <p style="margin:0">Z-REPORT · ${report.range?.label || period.toUpperCase()}</p>
        </div>
        <hr>
        <div class="flex"><span>TOTAL SALES:</span> <strong>${money(report.totals.sales)}</strong></div>
        <div class="flex"><span>GROSS PROFIT:</span> <strong>${money(profit)}</strong></div>
        <div class="flex"><span>PROFIT MARGIN:</span> <strong>${margin}%</strong></div>
        <hr>
        <div class="flex"><span>M-PESA TOTAL:</span> <span>${money(mpesaTotal)}</span></div>
        <div class="flex"><span>CASH TOTAL:</span> <span>${money(cashTotal)}</span></div>
        <hr>
        <div class="text-center"><p>Printed: ${new Date().toLocaleString()}</p></div>
        <script>window.print(); window.close();</script>
      </body></html>
    `);
  });
}

function categoryName(id) {
  return state.categories.find(c => c.id === id)?.name || 'Products';
}

// ── Settings Page ─────────────────────────────────────────────────────────────
async function renderSettings() {
  const root = qs('[data-page="settings"]');
  if (!root) return;

  const activeType = state.settings?.business_type || 'bar';
  const profilesList = Object.entries(state.profiles || {});
  const curTheme = document.documentElement.getAttribute('data-theme') || localStorage.getItem('pos_theme') || 'light';

  root.innerHTML = `
    <div class="settings-container" style="max-width: 1040px; margin: 0 auto; padding: 24px;">
      <div class="settings-header" style="margin-bottom: 24px;">
        <h2 style="font-size:26px; font-weight:800; color:var(--ink); margin:0 0 6px;">Business Settings & Profiles</h2>
        <p style="color:var(--muted); font-size:14px; margin:0;">
          Select your shop category and appearance preferences below. Each business profile enables tailored features (tables, barcodes, expiry dates, variants, quotes) and loads its dedicated product catalog without deleting your existing sales.
        </p>
      </div>

      <!-- ── Appearance & Theme Preference ────────────────────────────────── -->
      <div class="settings-section" style="background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:24px; margin-bottom:24px;">
        <div class="section-title" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:24px;">🎨</span>
            <div>
              <h3 style="margin:0; font-size:18px; color:var(--ink); font-weight:700;">Appearance & Theme</h3>
              <span style="font-size:13px; color:var(--muted);">Select your preferred display theme</span>
            </div>
          </div>
          <span style="background:var(--bg); color:var(--ink); font-size:12px; font-weight:700; padding:4px 12px; border-radius:20px; border:1px solid var(--line);">
            Active: ${curTheme === 'dark' ? '🌙 Dark Mode' : '☀️ Light Mode'}
          </span>
        </div>

        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:16px;">
          <!-- Light Theme Card -->
          <div id="themeCardLight" class="theme-card ${curTheme === 'light' ? 'selected' : ''}" style="background:#ffffff; border:2px solid ${curTheme === 'light' ? '#18181b' : '#e4e4e7'}; border-radius:12px; padding:18px; cursor:pointer; transition:all 0.2s ease; box-shadow: ${curTheme === 'light' ? '0 0 0 1px #18181b, 0 4px 12px rgba(0,0,0,0.06)' : '0 1px 3px rgba(0,0,0,0.05)'};">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
              <div style="display:flex; align-items:center; gap:10px;">
                <span style="font-size:30px;">☀️</span>
                <div>
                  <h4 style="margin:0; font-size:16px; font-weight:700; color:#09090b;">Light Theme (Default)</h4>
                  <span style="font-size:12px; color:#71717a;">Clean, high-contrast, modern POS</span>
                </div>
              </div>
              ${curTheme === 'light' ? '<span style="background:#18181b; color:#ffffff; font-size:11px; font-weight:800; padding:3px 9px; border-radius:12px;">ACTIVE</span>' : ''}
            </div>
            <p style="font-size:12px; color:#71717a; margin:4px 0 14px; line-height:1.4;">
              Crisp white surfaces, deep solid black typography, and neutral grey borders. Clean, fast, and high-contrast.
            </p>
            <button type="button" style="width:100%; font-size:12px; font-weight:700; padding:10px; border-radius:8px; cursor:pointer; border:1px solid ${curTheme === 'light' ? '#18181b' : '#e4e4e7'}; background:${curTheme === 'light' ? '#18181b' : '#f4f4f5'}; color:${curTheme === 'light' ? '#ffffff' : '#09090b'}; transition:all 0.15s ease;">
              ${curTheme === 'light' ? '✓ Currently Active' : 'Switch to Light Theme'}
            </button>
          </div>

          <!-- Dark Theme Card -->
          <div id="themeCardDark" class="theme-card ${curTheme === 'dark' ? 'selected' : ''}" style="background:#18181b; border:2px solid ${curTheme === 'dark' ? '#ffffff' : '#27272a'}; border-radius:12px; padding:18px; cursor:pointer; transition:all 0.2s ease; box-shadow: ${curTheme === 'dark' ? '0 0 0 1px #ffffff, 0 8px 24px rgba(0,0,0,0.5)' : '0 4px 12px rgba(0,0,0,0.3)'};">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
              <div style="display:flex; align-items:center; gap:10px;">
                <span style="font-size:30px;">🌙</span>
                <div>
                  <h4 style="margin:0; font-size:16px; font-weight:700; color:#fafafa;">Dark Theme</h4>
                  <span style="font-size:12px; color:#a1a1aa;">Zinc & charcoal dark mode</span>
                </div>
              </div>
              ${curTheme === 'dark' ? '<span style="background:#ffffff; color:#09090b; font-size:11px; font-weight:800; padding:3px 9px; border-radius:12px;">ACTIVE</span>' : ''}
            </div>
            <p style="font-size:12px; color:#a1a1aa; margin:4px 0 14px; line-height:1.4;">
              Deep zinc and pure black surfaces with crisp white text. No purple tints, built for low-light night shifts.
            </p>
            <button type="button" style="width:100%; font-size:12px; font-weight:700; padding:10px; border-radius:8px; cursor:pointer; border:1px solid ${curTheme === 'dark' ? '#ffffff' : '#3f3f46'}; background:${curTheme === 'dark' ? '#ffffff' : '#27272a'}; color:${curTheme === 'dark' ? '#09090b' : '#fafafa'}; transition:all 0.15s ease;">
              ${curTheme === 'dark' ? '✓ Currently Active' : 'Switch to Dark Theme'}
            </button>
          </div>
        </div>
      </div>

      <!-- ── Shop Category Selector ──────────────────────────────────────── -->
      <div class="settings-section" style="background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:24px; margin-bottom:24px;">
        <div class="section-title" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:24px;">🏢</span>
            <div>
              <h3 style="margin:0; font-size:18px; color:var(--ink); font-weight:700;">Choose Shop Category</h3>
              <span style="font-size:13px; color:var(--muted);">Click any shop profile to switch instantly</span>
            </div>
          </div>
          <span style="background:var(--bg); color:var(--ink); font-size:12px; font-weight:700; padding:4px 12px; border-radius:20px; border:1px solid var(--line);">
            Current: ${state.profile?.name || activeType}
          </span>
        </div>

        <div class="profile-cards-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:16px;">
          ${profilesList.map(([key, prof]) => {
            const isActive = key === activeType;
            return `
              <div class="profile-card ${isActive ? 'selected' : ''}" data-type="${key}" style="background:${isActive ? 'var(--primary-light)' : 'var(--panel)'}; border:2px solid ${isActive ? 'var(--primary)' : 'var(--line)'}; border-radius:12px; padding:18px; cursor:pointer; transition:all 0.2s ease; display:flex; flex-direction:column; justify-content:space-between;">
                <div>
                  <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
                    <div style="display:flex; align-items:center; gap:10px;">
                      <span style="font-size:32px;">${prof.icon}</span>
                      <div>
                        <h4 style="margin:0; font-size:16px; font-weight:700; color:var(--ink);">${prof.name}</h4>
                        <span style="font-size:12px; color:var(--muted);">${prof.tagline || prof.description || ''}</span>
                      </div>
                    </div>
                    ${isActive ? `<span style="background:var(--primary); color:#fff; font-size:11px; font-weight:800; padding:3px 8px; border-radius:12px;">ACTIVE</span>` : ''}
                  </div>
                  <div class="profile-caps" style="display:flex; flex-wrap:wrap; gap:5px; margin:12px 0;">
                    ${(prof.capabilities ? Object.entries(prof.capabilities).filter(([k,v]) => v === true).slice(0, 5) : []).map(([k]) => `<span class="cap-pill" style="font-size:11px; padding:3px 8px; border-radius:6px; background:var(--bg); color:var(--muted); border:1px solid var(--line);">✓ ${k.replace(/_/g, ' ')}</span>`).join('')}
                  </div>
                </div>
                <div style="margin-top:14px; padding-top:12px; border-top:1px solid var(--line); display:flex; justify-content:space-between; align-items:center;">
                  <span style="font-size:12px; color:var(--muted);">${prof.item_label || 'Products'} Catalog</span>
                  <button type="button" class="switch-profile-btn ${isActive ? 'secondary' : 'primary'}" data-type="${key}" style="font-size:12px; padding:6px 14px; border-radius:6px; cursor:pointer;">
                    ${isActive ? '✓ Selected' : 'Switch to this Shop →'}
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <form id="settingsForm" class="settings-section" style="background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:24px; margin-bottom:24px;">
        <div class="section-title" style="display:flex; align-items:center; gap:8px; margin-bottom:16px;">
          <span style="font-size:22px;">🏪</span>
          <h3 style="margin:0; font-size:18px; color:var(--ink); font-weight:700;">Store Information & Receipt Settings</h3>
        </div>

        <input type="hidden" name="business_type" id="settingsBusinessType" value="${activeType}">

        <div class="form-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:16px;">
          <div class="form-group">
            <label style="display:block; font-size:13px; font-weight:600; margin-bottom:6px; color:var(--muted);">Store / Business Name *</label>
            <input class="field" name="business_name" id="settingsBusinessName" value="${state.settings?.business_name || ''}" required style="width:100%;">
          </div>
          <div class="form-group">
            <label style="display:block; font-size:13px; font-weight:600; margin-bottom:6px; color:var(--muted);">Tagline / Subtitle</label>
            <input class="field" name="business_tagline" value="${state.settings?.business_tagline || ''}" style="width:100%;">
          </div>
          <div class="form-group">
            <label style="display:block; font-size:13px; font-weight:600; margin-bottom:6px; color:var(--muted);">Mobile / Contact Number</label>
            <input class="field" name="phone" value="${state.settings?.phone || ''}" style="width:100%;">
          </div>
          <div class="form-group">
            <label style="display:block; font-size:13px; font-weight:600; margin-bottom:6px; color:var(--muted);">Store Address</label>
            <input class="field" name="address" value="${receiptEscape(state.settings?.address || '')}" maxlength="180" autocomplete="street-address" style="width:100%;">
          </div>
          <div class="form-group">
            <label style="display:block; font-size:13px; font-weight:600; margin-bottom:6px; color:var(--muted);">Business Email</label>
            <input class="field" name="email" type="email" autocomplete="email" maxlength="120" placeholder="e.g. hello@yourshop.co.ke" value="${receiptEscape(state.settings?.email || '')}" style="width:100%;">
          </div>
          <div class="form-group">
            <label style="display:block; font-size:13px; font-weight:600; margin-bottom:6px; color:var(--muted);">Business KRA PIN (optional)</label>
            <input class="field" name="kra_pin" maxlength="20" autocapitalize="characters" placeholder="Enter your registered business PIN" value="${receiptEscape(state.settings?.kra_pin || '')}" style="width:100%;">
          </div>
          <p style="grid-column:1/-1; margin:0; font-size:12px; line-height:1.5; color:var(--muted);">These details appear on printed receipts when provided. A PIN does not make a POS receipt an eTIMS tax invoice.</p>
          <div class="form-group">
            <label style="display:block; font-size:13px; font-weight:600; margin-bottom:6px; color:var(--muted);">Currency Code</label>
            <input class="field" name="currency" value="${state.settings?.currency || 'KES'}" style="width:100%;">
          </div>
          <div class="form-group">
            <label style="display:block; font-size:13px; font-weight:600; margin-bottom:6px; color:var(--muted);">Tax Rate % (VAT)</label>
            <input class="field" name="tax_rate" type="number" step="0.1" value="${state.settings?.tax_rate ?? 0}" style="width:100%;">
          </div>
          <div class="form-group" style="grid-column: 1 / -1;">
            <label style="display:block; font-size:13px; font-weight:600; margin-bottom:6px; color:var(--muted);">Receipt Footer Note</label>
            <textarea class="field" name="receipt_footer" rows="2" style="width:100%; padding:8px;">${state.settings?.receipt_footer || ''}</textarea>
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:24px; padding-top:16px; border-top:1px solid var(--line); flex-wrap:wrap; gap:12px;">
          <button type="button" id="seedCatalogBtn" class="secondary" style="display:flex; align-items:center; gap:8px; padding:10px 16px;">
            <span>📦</span> Re-load Sample Products for ${state.profile?.name || activeType}
          </button>
          <button type="submit" class="primary" id="saveSettingsBtn" style="padding:10px 24px; font-weight:700;">
            Save Store Info
          </button>
        </div>
      </form>
    </div>
  `;

  // Theme switch handlers
  const setTheme = (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pos_theme', theme);
    const themeBtn = qs('#themeToggleBtn');
    if (themeBtn) {
      themeBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
      themeBtn.title = theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme';
    }
    renderSettings();
  };

  qs('#themeCardLight', root)?.addEventListener('click', () => setTheme('light'));
  qs('#themeCardDark', root)?.addEventListener('click', () => setTheme('dark'));

  // 1-Click Profile switch handler
  qsa('.profile-cards-grid .profile-card, .profile-cards-grid .switch-profile-btn', root).forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const targetCard = el.closest('.profile-card');
      if (!targetCard) return;
      const type = targetCard.dataset.type;
      if (!type || type === activeType) return;

      const prof = state.profiles[type];
      try {
        toast(`Switching to ${prof?.name || type}...`, 'info');
        const updated = await api('/api/settings', {
          method: 'POST',
          body: {
            business_type: type,
            business_name: prof?.name || type,
            business_tagline: prof?.tagline || '',
          }
        });
        state.settings = updated.settings;
        state.profile = updated.profile;
        state.capabilities = updated.capabilities;
        toast(`Switched to ${prof?.name || type}!`, 'success');
        await bootstrap();
        updateHeaderAndNav();
        await renderSettings();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });

  // Sample catalog loader
  qs('#seedCatalogBtn', root)?.addEventListener('click', async () => {
    const selectedType = activeType;
    const profileName = state.profiles[selectedType]?.name || selectedType;
    if (!confirm(`Reload sample products with images for ${profileName}? (Existing items will NOT be deleted).`)) return;

    try {
      const res = await api('/api/seed-samples', {
        method: 'POST',
        body: { profile_id: selectedType }
      });
      toast(`Loaded sample products for ${profileName}!`, 'success');
      await bootstrap();
      await renderSettings();
    } catch(err) {
      toast('Failed to load sample products: ' + err.message, 'error');
    }
  });

  // Settings form submission
  qs('#settingsForm', root)?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = qs('#saveSettingsBtn', root);
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());

    try {
      const updated = await api('/api/settings', { method: 'POST', body: data });
      state.settings = updated.settings;
      state.profile = updated.profile;
      state.capabilities = updated.capabilities;
      toast('Store settings saved successfully!', 'success');
      await bootstrap();
      updateHeaderAndNav();
      await renderSettings();
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Save Store Info';
    }
  });
}

let bootstrapped = false;

async function renderPage(pageDef) {
  // Swap the <main> content
  const main = qs('main');
  if (!main) return;
  main.innerHTML = `<section class="${pageDef.shell}" data-page="${pageDef.page}"></section>`;

  // Update page title
  const storeName = state.settings?.business_name || 'POS System';
  document.title = `${pageDef.title} — ${storeName}`;

  // Update active nav link
  qsa('.nav-link').forEach(link => {
    link.classList.toggle('active', link.textContent.trim() === pageDef.active);
  });

  // Bootstrap data once (categories, items, user)
  if (!bootstrapped) {
    await bootstrap();
    bootstrapped = true;
  }

  // Render the page content
  const p = pageDef.page;
  if (p === 'pos')       posLayout();
  if (p === 'suppliers') await renderSuppliers();
  if (p === 'sales')     await renderSales();
  if (p === 'cashier')   await renderCashier();
  if (p === 'products')  renderProductAdmin();
  if (p === 'stock')     await renderStock();
  if (p === 'reports')   await renderReports();
  if (p === 'settings')  await renderSettings();
}

async function navigateTo(path, pushState = true) {
  const pageDef = SPA_PAGES[path];
  if (!pageDef) { location.href = path; return; }
  if (pushState) history.pushState(null, '', path);
  await renderPage(pageDef);
}

function initSPARouter() {
  // Intercept all nav-link clicks
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a.nav-link, a.brand');
    if (!link) return;
    const href = link.getAttribute('href');
    if (href && SPA_PAGES[href]) {
      e.preventDefault();
      navigateTo(href);
    }
  });

  // Handle browser back/forward
  window.addEventListener('popstate', () => {
    const path = location.pathname;
    if (SPA_PAGES[path]) {
      navigateTo(path, false);
    }
  });
}


// ── Staff Login Screen (Category Selection & PIN Verification) ─────────────────
function showLoginScreen() {
  let screen = qs('#posLoginScreen');
  if (screen) screen.remove();

  let selectedShop = localStorage.getItem('pos_active_business_type') || 'retail';

  const renderChips = () => {
    return SHOP_PROFILES.map(p => {
      const isSel = p.id === selectedShop;
      return `
        <button type="button" class="login-shop-chip" data-id="${p.id}" style="${isSel ? 'background:var(--primary); color:var(--primary-fg); border:1px solid var(--primary); font-weight:700; box-shadow:0 1px 3px rgba(0,0,0,0.15);' : 'background:var(--panel); color:var(--ink); border:1px solid var(--line);'} padding:10px 12px; border-radius:8px; font-size:12px; cursor:pointer; display:flex; align-items:center; gap:8px; text-align:left; transition:all 0.15s ease;">
          <span style="font-size:20px;">${p.icon}</span>
          <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.name}${isSel ? ' ✓' : ''}</span>
        </button>
      `;
    }).join('');
  };

  const activeProf = SHOP_PROFILES.find(p => p.id === selectedShop) || SHOP_PROFILES[0];

  screen = document.createElement('div');
  screen.id = 'posLoginScreen';
  screen.className = 'login-body';
  screen.style.cssText = 'position:fixed; inset:0; z-index:999999; background:var(--login-bg); display:grid; place-items:center; overflow-y:auto; padding:16px;';
  screen.innerHTML = `
    <div style="position:fixed; top:18px; right:18px; z-index:1000000;">
      <button id="loginThemeToggle" class="theme-toggle-btn" style="width:40px; height:40px; font-size:18px;" title="Toggle Light / Dark theme">☀️</button>
    </div>

    <div class="login-panel" style="width:min(440px, 100%); background:var(--panel); border:1px solid var(--line); border-radius:14px; box-shadow:var(--shadow-lg); padding:24px; display:grid; gap:12px;">
      <div style="display:flex; align-items:center; gap:12px; margin-bottom:4px;">
        <div id="loginHeaderIcon" style="width:48px; height:48px; border-radius:12px; background:var(--ink); display:grid; place-items:center; font-size:26px; flex-shrink:0; box-shadow:0 2px 8px rgba(0,0,0,0.15); color:var(--panel);">
          ${activeProf.icon}
        </div>
        <div>
          <h1 id="loginHeaderTitle" style="margin:0; font-size:21px; font-weight:800; color:var(--ink);">${activeProf.name} POS</h1>
          <p id="loginHeaderTag" style="margin:2px 0 0; color:var(--muted); font-size:12px;">${activeProf.tagline}</p>
        </div>
      </div>

      <div style="background:var(--bg); border:1px solid var(--line); border-radius:10px; padding:12px;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
          <span style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">🏢 Select Shop Category</span>
          <span style="font-size:11px; color:var(--muted); font-weight:600;">Choose before login</span>
        </div>
        <div id="loginChipsContainer" style="display:grid; grid-template-columns:repeat(2, 1fr); gap:6px;">
          ${renderChips()}
        </div>
      </div>

      <p id="loginErrorMsg" style="display:none; color:var(--danger); font-size:12px; font-weight:700; margin:0; text-align:center;"></p>

      <button type="button" id="loginDemoBtn" style="width:100%; padding:12px; background:var(--primary); color:var(--primary-fg); border-radius:8px; font-weight:700; font-size:14px; border:1px solid var(--primary); cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 2px 8px rgba(0,0,0,0.1);">
        <span>⚡</span> 1-Click Demo Login (PIN: 1234)
      </button>

      <div style="display:flex; align-items:center; gap:10px; margin:2px 0;">
        <div style="flex:1; height:1px; background:var(--line);"></div>
        <span style="font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px;">or enter pin on keypad</span>
        <div style="flex:1; height:1px; background:var(--line);"></div>
      </div>

      <input id="loginPinInput" type="password" inputmode="numeric" pattern="[0-9]*" value="" placeholder="Staff PIN" style="text-align:center; font-size:22px; letter-spacing:4px; font-weight:700; width:100%; padding:11px 12px; border:1px solid var(--line); border-radius:6px; background:var(--panel); color:var(--ink);">

      <div class="pin-pad" id="loginPinPad" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:9px;">
        <button type="button" data-key="1">1</button>
        <button type="button" data-key="2">2</button>
        <button type="button" data-key="3">3</button>
        <button type="button" data-key="4">4</button>
        <button type="button" data-key="5">5</button>
        <button type="button" data-key="6">6</button>
        <button type="button" data-key="7">7</button>
        <button type="button" data-key="8">8</button>
        <button type="button" data-key="9">9</button>
        <button type="button" data-key="clear">Clear</button>
        <button type="button" data-key="0">0</button>
        <button type="button" data-key="enter" style="background:var(--primary); color:var(--primary-fg); border-color:var(--primary); font-size:16px;">Enter</button>
      </div>

      <div style="border-top:1px solid var(--line); margin-top:6px; padding-top:10px; display:flex; justify-content:space-between; align-items:center;">
        <small style="color:var(--muted); font-size:12px;">Staff PIN: <strong>1234</strong></small>
        <a href="admin.html" style="display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:var(--ink); background:var(--bg); border:1px solid var(--line); padding:6px 12px; border-radius:6px; text-decoration:none;">
          <span>👑</span> Admin Portal →
        </a>
      </div>
    </div>
  `;
  document.body.appendChild(screen);

  // Setup theme toggle
  const loginTheme = qs('#loginThemeToggle', screen);
  if (loginTheme) {
    const curTheme = document.documentElement.getAttribute('data-theme') || 'light';
    loginTheme.textContent = curTheme === 'dark' ? '☀️' : '🌙';
    loginTheme.onclick = () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('pos_theme', next);
      loginTheme.textContent = next === 'dark' ? '☀️' : '🌙';
    };
  }

  // Setup category chip selection
  const bindChips = () => {
    qsa('.login-shop-chip', screen).forEach(btn => {
      btn.onclick = () => {
        selectedShop = btn.dataset.id;
        localStorage.setItem('pos_active_business_type', selectedShop);
        const prof = SHOP_PROFILES.find(p => p.id === selectedShop);
        if (prof) {
          qs('#loginHeaderIcon', screen).textContent = prof.icon;
          qs('#loginHeaderTitle', screen).textContent = prof.name + ' POS';
          qs('#loginHeaderTag', screen).textContent = prof.tagline;
        }
        qs('#loginChipsContainer', screen).innerHTML = renderChips();
        bindChips();
      };
    });
  };
  bindChips();

  const pinInput = qs('#loginPinInput', screen);
  const doLogin = async (pin) => {
    const errEl = qs('#loginErrorMsg', screen);
    if (pin !== '1234' && pin.length < 4) {
      if (errEl) { errEl.textContent = 'Invalid PIN. Use default: 1234'; errEl.style.display = 'block'; }
      return;
    }

    localStorage.setItem('pos_logged_in', 'true');
    localStorage.setItem('pos_active_business_type', selectedShop);

    LocalPOS.switchProfile(selectedShop);

    screen.remove();
    await bootstrap();
    updateHeaderAndNav();
    posLayout();
    initSPARouter();
  };

  qs('#loginDemoBtn', screen).onclick = () => doLogin('1234');

  qsa('#loginPinPad button', screen).forEach(b => {
    b.onclick = () => {
      const k = b.dataset.key;
      if (k === 'clear') pinInput.value = '';
      else if (k === 'enter') doLogin(pinInput.value);
      else if (pinInput.value.length < 8) pinInput.value += k;
      pinInput.focus();
    };
  });

  pinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doLogin(pinInput.value);
    }
  });
}

// ── Entry Point ───────────────────────────────────────────────────────────────
async function start() {
  if (localStorage.getItem('pos_logged_in') !== 'true') {
    showLoginScreen();
    return;
  }
  const page = pageName() || 'pos';
  await bootstrap();
  bootstrapped = true;
  if (page === 'pos')       posLayout();
  if (page === 'suppliers') await renderSuppliers();
  if (page === 'sales')     await renderSales();
  if (page === 'cashier')   await renderCashier();
  if (page === 'products')  renderProductAdmin();
  if (page === 'stock')     await renderStock();
  if (page === 'reports')   await renderReports();
  if (page === 'settings')  await renderSettings();

  // Initialize SPA router after first page render
  initSPARouter();
}

start().catch(renderShellError);

