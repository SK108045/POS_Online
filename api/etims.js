const crypto = require('crypto');
const path = require('path');
const { isConfigured, client: supabase } = require(path.join(__dirname, 'supabase'));

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

function computeDigest(data) {
  return crypto.createHash('sha256').update(typeof data === 'string' ? data : JSON.stringify(data)).digest('hex');
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

  // Resolve sub-route from query param (from rewrite) or url path
  let route = url.searchParams.get('route') || '';
  if (!route) {
    route = url.pathname.replace(/^\/api\/etims\/?/, '').replace(/^\/+/, '');
  }
  route = route.toLowerCase().replace(/\/+$/, '');

  try {
    // ── 1. HEALTH ────────────────────────────────────────────────────────────
    if (route === 'health' || route === '') {
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

    // ── 2. PREFLIGHT ─────────────────────────────────────────────────────────
    if (route === 'preflight') {
      return sendJson(res, 200, {
        ready: true,
        vat_supported: true,
        discount_supported: true,
        requirements: [],
        missing: [],
        adjustments: {}
      });
    }

    // ── 3. WORKER ENDPOINTS ──────────────────────────────────────────────────
    if (route === 'worker/pending') {
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

    if (route === 'worker/complete' && method === 'POST') {
      const body = await parseBody(req);
      const { job_id, result, error, ticket_no } = body;
      if (isConfigured && supabase && job_id) {
        await supabase.from('etims_queue').update({
          status: error ? 'failed' : 'completed',
          result: result || null,
          error: error || null,
          updated_at: new Date().toISOString()
        }).eq('id', job_id);

        if (ticket_no && result && result.fiscal) {
          const f = result.fiscal;
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
          }).eq('ticket_no', ticket_no);
        }
      }
      return sendJson(res, 200, { ok: true });
    }

    // ── 4. JOBS POST (Queue new invoice) ─────────────────────────────────────
    if (route === 'jobs' && method === 'POST') {
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

    // ── 5. JOBS GET / POLL ───────────────────────────────────────────────────
    if (route.startsWith('jobs/')) {
      const parts = route.split('/');
      const jobId = parts[1]; // e.g. jobs/:id
      const action = parts[2]; // e.g. recover, details, finish

      if (action === 'finish') return sendJson(res, 200, { ok: true });
      if (action === 'recover') return sendJson(res, 200, { ok: true, state: 'queued' });

      if (isConfigured && supabase && jobId) {
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

    return sendJson(res, 200, { ok: true, route });
  } catch (err) {
    console.error('[eTIMS Error]', err);
    return sendJson(res, 500, { error: err.message || 'Internal eTIMS error' });
  }
};
