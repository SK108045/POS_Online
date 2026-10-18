const path = require('path');
const { isConfigured, client: supabase, getFallbackCatalog } = require(path.join(__dirname, 'supabase'));

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Oraforge-Etims');
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const method = req.method.toUpperCase();

  // Resolve sub-action from query param or path
  let action = url.searchParams.get('action') || '';
  if (!action) {
    action = url.pathname.replace(/^\/api\/order\/?/, '').replace(/^\/+/, '');
  }
  action = action.toLowerCase().replace(/\/+$/, '');

  try {
    // ── 1. GET SINGLE ORDER ──────────────────────────────────────────────────
    if (!action && method === 'GET') {
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

    // ── 2. ADD ITEM TO ORDER ─────────────────────────────────────────────────
    if (action === 'add' && method === 'POST') {
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

      return sendJson(res, 200, { id: orderId, status: 'open', items: [] });
    }

    // ── 3. UPDATE ITEM QTY ───────────────────────────────────────────────────
    if (action === 'qty' && method === 'POST') {
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

    // ── 4. PAY ORDER ─────────────────────────────────────────────────────────
    if (action === 'pay' && method === 'POST') {
      const body = await parseBody(req);
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

    // ── 5. OTHER ORDER ACTIONS ───────────────────────────────────────────────
    if (action === 'status' && method === 'POST') {
      const body = await parseBody(req);
      const orderId = Number(body.order_id);
      const status = body.status || 'open';
      if (isConfigured && supabase) {
        await supabase.from('orders').update({ status, updated_at: new Date().toISOString() }).eq('id', orderId);
      }
      return sendJson(res, 200, { ok: true, order_id: orderId, status });
    }

    if (action === 'discount' && method === 'POST') {
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

    if (action === 'add-manual' && method === 'POST') {
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
        await supabase.from('orders').update({ subtotal_cents: subtotal, total_cents: subtotal, updated_at: new Date().toISOString() }).eq('id', orderId);
        const { data: updatedOrder } = await supabase.from('orders').select('*').eq('id', orderId).single();
        return sendJson(res, 200, { ...(updatedOrder || {}), items: allItems || [] });
      }
      return sendJson(res, 200, { id: orderId, status: 'open', items: [] });
    }

    return sendJson(res, 200, { ok: true, action });
  } catch (err) {
    console.error('[Order API Error]', err);
    return sendJson(res, 500, { error: err.message || 'Internal order error' });
  }
};
