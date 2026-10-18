const crypto = require('crypto');
const { isConfigured, client: supabase } = require('../supabase');

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

  try {
    if (method === 'POST') {
      const body = await parseBody(req);
      const queueId = Date.now();
      const sale = body.sale || body.order || body;
      const ticketNo = sale.receipt_no || sale.ticket_no || `REC-${queueId}`;
      const jobHash = computeDigest([sale.shop_id || 'retail', Number(sale.sale_id || sale.id || queueId), String(ticketNo)]);

      if (isConfigured && supabase) {
        const { data, error } = await supabase.from('etims_queue').insert({
          job_hash: jobHash,
          ticket_no: ticketNo,
          shop_id: sale.shop_id || 'retail',
          status: 'pending',
          payload: body,
          created_at: new Date().toISOString()
        }).select().single();

        if (error) {
          console.error('[Queue Error]', error);
        }

        const resolvedId = data ? data.id : queueId;
        return sendJson(res, 200, { ok: true, id: resolvedId, job_id: resolvedId, job_hash: jobHash, state: 'queued' });
      }

      return sendJson(res, 200, { ok: true, id: queueId, job_id: queueId, job_hash: jobHash, state: 'queued' });
    }

    if (method === 'GET') {
      const parts = url.pathname.split('/').filter(Boolean);
      const jobId = url.searchParams.get('id') || parts[parts.length - 1];

      if (isConfigured && supabase && jobId && jobId !== 'jobs') {
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

    return sendJson(res, 200, { ok: true });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || 'Internal error' });
  }
};
