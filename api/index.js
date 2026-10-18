/**
 * Unified Serverless API Router for Oraforge Online POS on Vercel
 * Backed by Supabase PostgreSQL with local Windows eTIMS Queue Bridge
 */
const crypto = require('crypto');
const path = require('path');
const { isConfigured, client: supabase, getFallbackCatalog } = require(path.join(__dirname, 'supabase'));

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Oraforge-Etims');
  res.end(JSON.stringify(data));
}

async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return new Promise(resolve => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (_) { resolve({}); }
    });
  });
}

function computeDigest(data) {
  return crypto.createHash('sha256').update(typeof data === 'string' ? data : JSON.stringify(data)).digest('hex');
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Oraforge-Etims');
    res.end();
    return;
  }

  const matchedPath = req.headers['x-matched-path'] || req.headers['x-forwarded-uri'] || req.headers['x-now-route-matches'];
  const rawUrl = matchedPath || req.url;
  const url = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`);
  let pathname = url.pathname;
  if (url.searchParams.get('path')) {
    pathname = `/api/${url.searchParams.get('path')}`;
  } else if (req.query && req.query.slug) {
    const slugStr = Array.isArray(req.query.slug) ? req.query.slug.join('/') : req.query.slug;
    pathname = `/api/${slugStr}`;
  }
  pathname = pathname.replace(/\/+$/, '') || '/';
  const method = req.method.toUpperCase();

  try {
    // ── 0. ROOT STATUS ─────────────────────────────────────────────────────────
    if (pathname === '/api' || pathname === '') {
      return sendJson(res, 200, {
        ok: true,
        service: 'Oraforge POS API',
        status: 'online',
        cloud: isConfigured ? 'supabase' : 'preview',
        timestamp: new Date().toISOString()
      });
    }

    // ── 1. BOOTSTRAP ───────────────────────────────────────────────────────────
    if (pathname === '/api/bootstrap') {
      const catalog = getFallbackCatalog();

      let categories = [];
      let items = [];
      let settings = {
        business_name: catalog.shop_name || 'BuildMart Hardware',
        business_type: catalog.business_type || 'hardware',
        address: 'Langata Road, Nairobi',
        phone: '0712345678',
        email: 'info@buildmart.co.ke',
        kra_pin: 'P051234567X',
        receipt_footer: 'Thank you for your business!\n------- END OF RECEIPT -------',
        tax_rate: 16,
        tax_rate_confirmed: true
      };

      if (isConfigured && supabase) {
        const [catRes, itemRes, setRes] = await Promise.all([
          supabase.from('categories').select('*').order('sort_order', { ascending: true }),
          supabase.from('menu_items').select('*').order('id', { ascending: true }),
          supabase.from('shop_settings').select('*').limit(1).maybeSingle()
        ]);

        if (catRes.data && catRes.data.length > 0) categories = catRes.data;
        if (itemRes.data && itemRes.data.length > 0) items = itemRes.data;
        if (setRes.data) settings = { ...settings, ...setRes.data };
      }

      // If Supabase has no data or is not configured yet, use fallback catalog
      if (categories.length === 0 && catalog.categories) {
        categories = catalog.categories;
      }
      if (items.length === 0 && catalog.items) {
        items = catalog.items;
      }

      const lowStockCount = items.filter(i => Number(i.stock_qty || 0) <= Number(i.reorder_level || 5)).length;

      return sendJson(res, 200, {
        user: { id: 1, username: 'admin', full_name: 'Store Manager', role: 'manager', active: 1 },
        settings,
        profile: { id: settings.business_type || 'hardware', name: settings.business_name || 'Hardware POS' },
        profiles: { hardware: { name: 'Hardware & Building' } },
        capabilities: {
          barcode: true,
          wholesale_pricing: true,
          reorder_levels: true,
          decimal_qty: true
        },
        tables: [],
        alerts: { expiry: 0, low_stock: lowStockCount },
        employees: [{ id: 1, name: 'Main Terminal', role: 'cashier' }],
        menu: { categories, items },
        cloud: {
          configured: isConfigured,
          provider: 'supabase',
          message: isConfigured ? 'Connected to Supabase PostgreSQL' : 'Preview Mode: Set SUPABASE_URL and SUPABASE_ANON_KEY in Vercel to activate cloud database'
        }
      });
    }

    // ── 2. MENU & ITEMS ────────────────────────────────────────────────────────
    if (pathname === '/api/menu' && method === 'GET') {
      if (isConfigured && supabase) {
        const [catRes, itemRes] = await Promise.all([
          supabase.from('categories').select('*').order('sort_order', { ascending: true }),
          supabase.from('menu_items').select('*').order('id', { ascending: true })
        ]);
        return sendJson(res, 200, {
          categories: catRes.data || [],
          items: itemRes.data || []
        });
      }
      const catalog = getFallbackCatalog();
      return sendJson(res, 200, {
        categories: catalog.categories || [],
        items: catalog.items || []
      });
    }

    if (pathname === '/api/menu/category' && method === 'POST') {
      const body = await parseBody(req);
      const name = String(body.name || '').trim();
      if (!name) return sendJson(res, 400, { error: 'Category name is required' });

      if (isConfigured && supabase) {
        if (body.id) {
          await supabase.from('categories').update({
            name,
            sort_order: Number(body.sort_order || 0),
            business_type: body.business_type || 'hardware'
          }).eq('id', body.id);
        } else {
          await supabase.from('categories').insert({
            name,
            sort_order: Number(body.sort_order || 0),
            business_type: body.business_type || 'hardware',
            shop_id: 'retail'
          });
        }
        const { data: cats } = await supabase.from('categories').select('*').order('sort_order');
        return sendJson(res, 200, { ok: true, categories: cats || [] });
      }
      return sendJson(res, 200, { ok: true, category: body });
    }

    if (pathname === '/api/menu/item') {
      const body = await parseBody(req);
      if (method === 'DELETE' || url.searchParams.get('id')) {
        const id = url.searchParams.get('id') || body.id;
        if (isConfigured && supabase) {
          await supabase.from('menu_items').delete().eq('id', id);
          const [catRes, itemRes] = await Promise.all([
            supabase.from('categories').select('*').order('sort_order', { ascending: true }),
            supabase.from('menu_items').select('*').order('id', { ascending: true })
          ]);
          return sendJson(res, 200, { categories: catRes.data || [], items: itemRes.data || [] });
        }
        return sendJson(res, 200, { ok: true, deleted: id });
      }

      if (method === 'POST') {
        const payload = {
          name: String(body.name || '').trim(),
          category_id: body.category_id ? Number(body.category_id) : null,
          price_cents: Math.round(Number(body.price || (body.price_cents ? body.price_cents / 100 : 0)) * 100),
          cost_cents: Math.round(Number(body.cost || (body.cost_cents ? body.cost_cents / 100 : 0)) * 100),
          stock_qty: Number(body.stock_qty ?? 0),
          sku: body.sku || '',
          barcode: body.barcode || '',
          unit: body.unit || 'pcs',
          color: body.color || '#334155',
          reorder_level: Number(body.reorder_level || 5),
          active: body.active !== undefined ? Number(body.active) : 1,
          updated_at: new Date().toISOString()
        };

        if (isConfigured && supabase) {
          if (body.id) {
            await supabase.from('menu_items').update(payload).eq('id', body.id);
          } else {
            payload.created_at = new Date().toISOString();
            await supabase.from('menu_items').insert(payload);
          }
          const [catRes, itemRes] = await Promise.all([
            supabase.from('categories').select('*').order('sort_order', { ascending: true }),
            supabase.from('menu_items').select('*').order('id', { ascending: true })
          ]);
          return sendJson(res, 200, { categories: catRes.data || [], items: itemRes.data || [] });
        }

        return sendJson(res, 200, { ok: true, item: { ...payload, id: body.id || Date.now() } });
      }
    }

    // ── 3. STOCK & ADJUSTMENT ──────────────────────────────────────────────────
    if (pathname === '/api/stock' && method === 'GET') {
      if (isConfigured && supabase) {
        const { data } = await supabase.from('menu_items').select('*').order('name');
        return sendJson(res, 200, data || []);
      }
      return sendJson(res, 200, getFallbackCatalog().items || []);
    }

    if (pathname === '/api/stock/adjust' && method === 'POST') {
      const body = await parseBody(req);
      const productId = Number(body.product_id);
      const qtyChange = Number(body.qty_change || 0);

      if (isConfigured && supabase) {
        const { data: item } = await supabase.from('menu_items').select('stock_qty').eq('id', productId).single();
        if (item) {
          const newStock = Math.max(0, Math.round((Number(item.stock_qty || 0) + qtyChange) * 100) / 100);
          await supabase.from('menu_items').update({ stock_qty: newStock }).eq('id', productId);
          return sendJson(res, 200, { ok: true, product_id: productId, stock_qty: newStock });
        }
      }
      return sendJson(res, 200, { ok: true, product_id: productId, qty_change: qtyChange });
    }

    // ── 4. ORDERS & CHECKOUT PAY ───────────────────────────────────────────────
    if (pathname === '/api/orders' && method === 'GET') {
      if (isConfigured && supabase) {
        const { data: orders } = await supabase.from('orders').select('*').order('id', { ascending: false }).limit(200);
        return sendJson(res, 200, orders || []);
      }
      return sendJson(res, 200, getFallbackCatalog().orders || []);
    }

    if (pathname === '/api/order' && method === 'GET') {
      const orderId = url.searchParams.get('id');
      if (isConfigured && supabase) {
        const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
        if (order) {
          const { data: items } = await supabase.from('order_items').select('*').eq('order_id', orderId);
          order.items = items || [];
          return sendJson(res, 200, order);
        }
      }
      const found = (getFallbackCatalog().orders || []).find(o => String(o.id) === String(orderId));
      return sendJson(res, 200, found || {});
    }

    if (pathname === '/api/orders' && method === 'POST') {
      const body = await parseBody(req);
      const ticketNo = `REC-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`;
      const orderPayload = {
        ticket_no: ticketNo,
        table_id: body.table_id ? Number(body.table_id) : null,
        order_type: body.order_type || 'walk-in',
        customer_name: (body.customer_name || '').trim(),
        notes: (body.notes || '').trim(),
        pricing_tier: body.pricing_tier || 'retail',
        is_quote: body.is_quote ? 1 : 0,
        status: 'open',
        subtotal_cents: 0,
        tax_cents: 0,
        total_cents: 0,
        business_type: 'hardware',
        shop_id: body.shop_id || 'retail',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      if (isConfigured && supabase) {
        const { data, error } = await supabase.from('orders').insert(orderPayload).select().single();
        if (error) {
          console.error('[Create Order Error]', error);
          return sendJson(res, 500, { error: error.message });
        }
        return sendJson(res, 200, { ...data, items: [] });
      }

      const mockOrder = { ...orderPayload, id: Date.now(), items: [] };
      return sendJson(res, 200, mockOrder);
    }

    if (pathname === '/api/order/add' && method === 'POST') {
      const body = await parseBody(req);
      const orderId = Number(body.order_id);
      const menuItemId = Number(body.menu_item_id);
      const qty = Number(body.qty || 1);
      const pricingTier = body.pricing_tier || 'retail';
      const variantInfo = (body.variant_info || '').trim();
      const note = (body.note || '').trim();

      if (isConfigured && supabase) {
        const { data: item } = await supabase.from('menu_items').select('*').eq('id', menuItemId).single();
        if (!item) return sendJson(res, 404, { error: 'Item not found' });

        const unitPrice = (pricingTier === 'wholesale' && item.wholesale_price_cents > 0)
          ? Number(item.wholesale_price_cents)
          : Number(body.unit_price_cents || item.price_cents || 0);

        const { data: existingRows } = await supabase.from('order_items').select('*')
          .eq('order_id', orderId)
          .eq('menu_item_id', menuItemId)
          .eq('note', note)
          .eq('variant_info', variantInfo);
        const existing = existingRows && existingRows[0];

        if (existing) {
          const newQty = Math.round((Number(existing.qty) + qty) * 1000) / 1000;
          const newTotal = Math.round(newQty * unitPrice);
          await supabase.from('order_items').update({ qty: newQty, line_total_cents: newTotal }).eq('id', existing.id);
        } else {
          await supabase.from('order_items').insert({
            order_id: orderId,
            menu_item_id: menuItemId,
            name: item.name,
            qty,
            unit_price_cents: unitPrice,
            line_total_cents: Math.round(qty * unitPrice),
            note,
            variant_info: variantInfo,
            batch_no: body.batch_no || item.batch_no || '',
            cost_cents: Number(item.cost_cents || 0)
          });
        }

        const { data: allItems } = await supabase.from('order_items').select('*').eq('order_id', orderId).order('id');
        const subtotal = (allItems || []).reduce((sum, it) => sum + Number(it.line_total_cents || 0), 0);
        await supabase.from('orders').update({
          subtotal_cents: subtotal,
          total_cents: subtotal,
          updated_at: new Date().toISOString()
        }).eq('id', orderId);

        const { data: updatedOrder } = await supabase.from('orders').select('*').eq('id', orderId).single();
        return sendJson(res, 200, { ...(updatedOrder || {}), items: allItems || [] });
      }

      return sendJson(res, 200, { id: orderId, status: 'open', items: [{ name: 'Item', qty, unit_price_cents: 100, line_total_cents: Math.round(qty * 100) }] });
    }

    if (pathname === '/api/order/qty' && method === 'POST') {
      const body = await parseBody(req);
      const itemId = Number(body.item_id);
      const qty = Math.max(0, Number(body.qty || 0));

      if (isConfigured && supabase) {
        const { data: item } = await supabase.from('order_items').select('*').eq('id', itemId).single();
        if (!item) return sendJson(res, 404, { error: 'Item not found' });
        const orderId = item.order_id;

        if (qty <= 0) {
          await supabase.from('order_items').delete().eq('id', itemId);
        } else {
          const unitPrice = Number(item.unit_price_cents || 0);
          await supabase.from('order_items').update({ qty, line_total_cents: Math.round(qty * unitPrice) }).eq('id', itemId);
        }

        const { data: allItems } = await supabase.from('order_items').select('*').eq('order_id', orderId).order('id');
        const subtotal = (allItems || []).reduce((sum, it) => sum + Number(it.line_total_cents || 0), 0);
        await supabase.from('orders').update({
          subtotal_cents: subtotal,
          total_cents: subtotal,
          updated_at: new Date().toISOString()
        }).eq('id', orderId);

        const { data: updatedOrder } = await supabase.from('orders').select('*').eq('id', orderId).single();
        return sendJson(res, 200, { ...(updatedOrder || {}), items: allItems || [] });
      }
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/order/add-manual' && method === 'POST') {
      const body = await parseBody(req);
      const orderId = Number(body.order_id);
      const name = (body.name || 'Custom Item').trim();
      const qty = Number(body.qty || 1);
      const unitPrice = Number(body.unit_price_cents || 0);
      const costCents = Number(body.cost_cents || 0);
      const sku = (body.sku || '').trim();

      if (isConfigured && supabase) {
        await supabase.from('order_items').insert({
          order_id: orderId,
          name,
          qty,
          unit_price_cents: unitPrice,
          line_total_cents: Math.round(qty * unitPrice),
          cost_cents: costCents,
          note: sku
        });

        const { data: allItems } = await supabase.from('order_items').select('*').eq('order_id', orderId).order('id');
        const subtotal = (allItems || []).reduce((sum, it) => sum + Number(it.line_total_cents || 0), 0);
        await supabase.from('orders').update({
          subtotal_cents: subtotal,
          total_cents: subtotal,
          updated_at: new Date().toISOString()
        }).eq('id', orderId);

        const { data: updatedOrder } = await supabase.from('orders').select('*').eq('id', orderId).single();
        return sendJson(res, 200, { ...(updatedOrder || {}), items: allItems || [] });
      }
      return sendJson(res, 200, { id: orderId, status: 'open', items: [] });
    }

    if (pathname === '/api/order/discount' && method === 'POST') {
      const body = await parseBody(req);
      const orderId = Number(body.order_id);
      if (isConfigured && supabase) {
        await supabase.from('orders').update({
          discount_amount_cents: Number(body.amount_cents || 0),
          discount_type: body.type || 'fixed',
          updated_at: new Date().toISOString()
        }).eq('id', orderId);
        const { data: updatedOrder } = await supabase.from('orders').select('*').eq('id', orderId).single();
        const { data: items } = await supabase.from('order_items').select('*').eq('order_id', orderId);
        return sendJson(res, 200, { ...(updatedOrder || {}), items: items || [] });
      }
      return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/order/status' && method === 'POST') {
      const body = await parseBody(req);
      const orderId = Number(body.order_id);
      const status = body.status || 'open';
      if (isConfigured && supabase) {
        await supabase.from('orders').update({ status, updated_at: new Date().toISOString() }).eq('id', orderId);
        return sendJson(res, 200, { ok: true, order_id: orderId, status });
      }
      return sendJson(res, 200, { ok: true, order_id: orderId, status });
    }

    if (pathname === '/api/order/pay' && method === 'POST') {
      const body = await parseBody(req);
      const nowTs = Math.floor(Date.now() / 1000);
      const taxRate = Number(body.tax_rate || 0);

      const orderData = {
        status: 'paid',
        payment_method: body.payment_method || 'cash',
        payment_ref: body.payment_ref || (body.payment_method === 'cash' ? 'CASH' : `TXN-${Date.now()}`),
        customer_phone: String(body.customer_phone || '').trim(),
        tax_rate: taxRate,
        tax_treatment: taxRate > 0 ? 'vat' : 'non_vat',
        updated_at: new Date().toISOString()
      };

      if (body.etims_customer) {
        const ec = body.etims_customer;
        if (ec.name) orderData.customer_name = ec.name;
        if (ec.pin) orderData.customer_kra_pin = ec.pin;
        if (ec.phone) orderData.customer_phone = ec.phone;
        if (ec.email) orderData.customer_email = ec.email;
        if (ec.billing_address) orderData.customer_billing_address = ec.billing_address;
        if (ec.remarks) orderData.customer_remarks = ec.remarks;
      }

      if (body.generate_etims) {
        orderData.etims_requested = true;
        orderData.etims_status = 'pending';
      }

      let savedOrder = { ...orderData, id: body.order_id || Date.now(), ticket_no: body.ticket_no || `REC-${Date.now()}` };

      if (isConfigured && supabase) {
        if (body.order_id) {
          const { data } = await supabase.from('orders').update(orderData).eq('id', body.order_id).select().single();
          if (data) savedOrder = data;
        } else {
          const { data } = await supabase.from('orders').insert({ ...orderData, created_at: new Date().toISOString() }).select().single();
          if (data) savedOrder = data;
        }

        // If eTIMS requested, push to cloud queue so local PC worker picks it up
        if (body.generate_etims) {
          const queuePayload = {
            order_id: savedOrder.id,
            ticket_no: savedOrder.ticket_no,
            shop_id: body.etims_shop_id || 'retail',
            status: 'pending',
            payload: {
              order: savedOrder,
              customer: body.etims_customer || {},
              items: body.items || [],
              settings: body.settings || {},
              tax_rate: taxRate
            },
            created_at: new Date().toISOString()
          };
          await supabase.from('etims_queue').insert(queuePayload);
        }
      }

      return sendJson(res, 200, savedOrder);
    }

    // ── 5. eTIMS QUEUE & STATUS (For Local Worker & Online POS) ─────────────────
    if (pathname === '/api/etims/health' && method === 'GET') {
      return sendJson(res, 200, {
        app: 'oraforge-etims-helper',
        version: 2,
        platform: 'cloud-bridge',
        build: '20261018.1',
        runtime_mode: isConfigured ? 'cloud_supabase' : 'preview',
        elevated: true,
        cloud_connected: isConfigured,
        worker_ready: true,
        vat_supported: true
      });
    }

    if ((pathname === '/api/etims/preflight' || pathname === '/api/etims') && (method === 'POST' || method === 'GET')) {
      return sendJson(res, 200, {
        ready: true,
        vat_supported: true,
        discount_supported: true,
        requirements: [],
        missing: [],
        adjustments: {}
      });
    }

    if (pathname === '/api/etims/jobs' && method === 'POST') {
      const body = await parseBody(req);
      const queueId = Date.now();
      const sale = body.sale || body.order || body;
      const ticketNo = sale.receipt_no || sale.ticket_no || `REC-${queueId}`;
      const jobHash = computeDigest([sale.shop_id || 'retail', Number(sale.sale_id || sale.id || queueId), String(ticketNo)]);

      if (isConfigured && supabase) {
        const { data } = await supabase.from('etims_queue').insert({
          job_hash: jobHash,
          ticket_no: ticketNo,
          shop_id: sale.shop_id || 'retail',
          status: 'pending',
          payload: body,
          created_at: new Date().toISOString()
        }).select().single();

        const resolvedId = data ? data.id : queueId;
        return sendJson(res, 200, { ok: true, id: resolvedId, job_id: resolvedId, job_hash: jobHash, state: 'queued' });
      }

      return sendJson(res, 200, { ok: true, id: queueId, job_id: queueId, job_hash: jobHash, state: 'queued' });
    }

    if (pathname.startsWith('/api/etims/jobs/')) {
      const parts = pathname.split('/').filter(Boolean);
      const jobId = parts[3]; // e.g., /api/etims/jobs/:id[/action]
      const action = parts[4]; // 'details', 'recover', 'finish'

      if (action === 'finish') {
        return sendJson(res, 200, { ok: true });
      }

      if (action === 'recover' && method === 'POST') {
        if (isConfigured && supabase) {
          await supabase.from('etims_queue').update({ status: 'pending', updated_at: new Date().toISOString() }).or(`id.eq.${jobId},job_hash.eq.${jobId}`);
        }
        return sendJson(res, 200, { ok: true, state: 'queued' });
      }

      if (action === 'details' && method === 'POST') {
        const body = await parseBody(req);
        if (isConfigured && supabase) {
          const { data: existing } = await supabase.from('etims_queue').select('payload').or(`id.eq.${jobId},job_hash.eq.${jobId}`).maybeSingle();
          if (existing) {
            const updatedPayload = { ...existing.payload, details: body.details || {} };
            await supabase.from('etims_queue').update({ payload: updatedPayload, status: 'pending', updated_at: new Date().toISOString() }).or(`id.eq.${jobId},job_hash.eq.${jobId}`);
          }
        }
        return sendJson(res, 200, { ok: true });
      }

      // Default GET /jobs/:id: Check status
      if (isConfigured && supabase) {
        let query = supabase.from('etims_queue').select('*');
        if (/^\d+$/.test(jobId)) {
          query = query.or(`id.eq.${jobId},ticket_no.eq.${jobId}`);
        } else {
          query = query.or(`job_hash.eq.${jobId},ticket_no.eq.${jobId}`);
        }

        const { data } = await query.order('id', { ascending: false }).limit(1).maybeSingle();
        if (data) {
          if (data.status === 'completed' && data.result) {
            return sendJson(res, 200, { state: 'complete', result: data.result });
          }
          if (data.status === 'failed') {
            return sendJson(res, 200, { state: 'error', error: data.error || 'eTIMS issuance failed' });
          }
          return sendJson(res, 200, { state: data.status || 'queued' });
        }
      }

      return sendJson(res, 200, { state: 'queued' });
    }

    // Worker endpoints: Local PC helper fetches pending jobs & submits result
    if (pathname === '/api/etims/worker/pending' && method === 'GET') {
      if (isConfigured && supabase) {
        const shopId = url.searchParams.get('shop_id') || 'retail';
        const { data } = await supabase
          .from('etims_queue')
          .select('*')
          .eq('shop_id', shopId)
          .eq('status', 'pending')
          .order('id', { ascending: true })
          .limit(5);

        return sendJson(res, 200, data || []);
      }
      return sendJson(res, 200, []);
    }

    if (pathname === '/api/etims/worker/complete' && method === 'POST') {
      const body = await parseBody(req);
      const { job_id, result, error, ticket_no } = body;

      if (isConfigured && supabase && job_id) {
        const updateData = {
          status: error ? 'failed' : 'completed',
          result: result || null,
          error: error || null,
          updated_at: new Date().toISOString()
        };
        await supabase.from('etims_queue').update(updateData).eq('id', job_id);

        if (result && result.fiscal) {
          const f = result.fiscal;
          const targetTicket = ticket_no || (result.sale && (result.sale.receipt_no || result.sale.ticket_no));
          if (targetTicket) {
            await supabase.from('orders').update({
              etims_status: 'generated',
              cu_invoice_number: f.cu_invoice_number || '',
              scu_id: f.scu_id || '',
              receipt_signature: f.receipt_signature || '',
              internal_data: f.internal_data || '',
              qr_image: f.qr_image || '',
              invoice_number: f.invoice_number || '',
              invoice_date: f.invoice_date || '',
              updated_at: new Date().toISOString()
            }).eq('ticket_no', targetTicket);
          }
        }

        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 200, { ok: true });
    }

    // ── 6. REPORTS & SUMMARY ───────────────────────────────────────────────────
    if (pathname === '/api/reports' && method === 'GET') {
      if (isConfigured && supabase) {
        const period = url.searchParams.get('period') || 'today';
        const { data: orders } = await supabase.from('orders').select('*').eq('status', 'paid').order('id', { ascending: false }).limit(500);
        const { data: products } = await supabase.from('menu_items').select('*');

        const sales = (orders || []).reduce((sum, o) => sum + Number(o.total_cents || 0), 0);
        const costs = 0; // Calculated per items sold
        const inventoryValue = (products || []).reduce((sum, p) => sum + (Number(p.stock_qty || 0) * Number(p.cost_cents || 0)), 0);

        return sendJson(res, 200, {
          totals: { sales, costs, orders: (orders || []).length },
          payments: [{ method: 'cash', amount: sales, transactions: (orders || []).length }],
          top_items: [],
          stock: { inventory_value: inventoryValue, potential_profit: 0 },
          period
        });
      }

      return sendJson(res, 200, {
        totals: { sales: 0, costs: 0, orders: 0 },
        payments: [],
        top_items: [],
        stock: { inventory_value: 0, potential_profit: 0 },
        period: 'today'
      });
    }

    // ── 7. SUPPLIERS & CUSTOMERS ───────────────────────────────────────────────
    if (pathname === '/api/suppliers' || pathname === '/api/admin/suppliers') {
      if (method === 'POST') {
        const body = await parseBody(req);
        if (isConfigured && supabase) {
          if (body.id) {
            await supabase.from('suppliers').update(body).eq('id', body.id);
          } else {
            await supabase.from('suppliers').insert({ ...body, shop_id: 'retail' });
          }
          const { data } = await supabase.from('suppliers').select('*').order('name');
          return sendJson(res, 200, data || []);
        }
        return sendJson(res, 200, [body]);
      }

      if (isConfigured && supabase) {
        const { data } = await supabase.from('suppliers').select('*').order('name');
        return sendJson(res, 200, data || []);
      }
      return sendJson(res, 200, getFallbackCatalog().suppliers || []);
    }

    if (pathname === '/api/admin/customers' || pathname === '/api/admin/customer') {
      if (method === 'POST') {
        const body = await parseBody(req);
        if (isConfigured && supabase) {
          if (body.id) {
            await supabase.from('customers').update(body).eq('id', body.id);
          } else {
            await supabase.from('customers').insert({ ...body, shop_id: 'retail' });
          }
          const { data } = await supabase.from('customers').select('*').order('name');
          return sendJson(res, 200, data || []);
        }
        return sendJson(res, 200, [body]);
      }

      if (isConfigured && supabase) {
        const { data } = await supabase.from('customers').select('*').order('name');
        return sendJson(res, 200, data || []);
      }
      return sendJson(res, 200, []);
    }

    if (pathname === '/api/settings') {
      if (method === 'POST') {
        const body = await parseBody(req);
        if (isConfigured && supabase) {
          await supabase.from('shop_settings').upsert({ shop_id: 'retail', ...body, updated_at: new Date().toISOString() });
        }
        return sendJson(res, 200, { ok: true, settings: body });
      }
      if (isConfigured && supabase) {
        const { data } = await supabase.from('shop_settings').select('*').limit(1).maybeSingle();
        return sendJson(res, 200, data || {});
      }
      return sendJson(res, 200, { ok: true });
    }

    // ── Fallback 404 for unknown API routes ────────────────────────────────────
    return sendJson(res, 404, { error: `Endpoint not found: ${pathname}` });

  } catch (err) {
    console.error(`[API Error] ${method} ${pathname}:`, err);
    return sendJson(res, 500, { error: err.message || 'Internal server error' });
  }
};
