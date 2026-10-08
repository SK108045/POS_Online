const fs = require('fs');
const path = require('path');
const https = require('https');
function config() {
  const cfg = JSON.parse(fs.readFileSync(process.env.POS_DATA_DIR ? path.join(process.env.POS_DATA_DIR, 'sozuri-config.json') : path.join(__dirname, 'sozuri-config.json'), 'utf8'));
  return {...cfg, key:cfg.apiKey, configured:!!(cfg.apiKey && cfg.project && cfg.from)};
}
function normalize(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (/^0[17]\d{8}$/.test(digits)) digits = '254' + digits.slice(1);
  if (/^[17]\d{8}$/.test(digits)) digits = '254' + digits;
  return /^254[17]\d{8}$/.test(digits) ? '+' + digits : '';
}
module.exports = { config, normalize, handle(req, res, pathname) {
  const reply = (code, value) => { res.writeHead(code, {'Content-Type':'application/json'}); res.end(JSON.stringify(value)); };
  const cfg = config();
  if (pathname.endsWith('/config') && req.method === 'GET') {
    reply(200, {configured:cfg.configured, message:cfg.configured ? 'Configured' : "Sozuri SMS credentials are missing."});
    return;
  }
  if (req.method !== 'POST' || !pathname.endsWith('/send')) { reply(405,{error:'Method not allowed'}); return; }
  if (!cfg.configured) { reply(503,{error:"Sozuri SMS credentials are missing."}); return; }
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 100000) req.destroy(); });
  req.on('end', () => {
    try {
      const input = JSON.parse(raw);
      const message = String(input.message || '').trim();
      if (!message || message.length > 1000) throw new Error('Enter a message of 1–1000 characters.');
      if (!Array.isArray(input.recipients) || !input.recipients.length || input.recipients.length > 200) throw new Error('Select 1–200 recipients.');
      const recipients = [...new Set(input.recipients.map(normalize))];
      if (recipients.includes('')) throw new Error('A selected customer has an invalid Kenyan phone number.');
      const body = JSON.stringify({project:cfg.project, apiKey:cfg.apiKey, from:cfg.from, channel:'sms', type:cfg.type, to:recipients.join(','), message});
      const upstream = https.request('https://sozuri.net/api/v1/messaging', {method:'POST', headers:{Accept:'application/json', 'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}}, response => {
        let text = '';
        response.on('data', c => text += c);
        response.on('end', () => {
          try {
            const data = JSON.parse(text);
            if (response.statusCode >= 400) { reply(502,{error:String(data.errorMessage || data.message || 'SMS provider rejected the request').split(cfg.key).join('***')}); return; }
            const results = data.recipients || [];
            const sent = results.filter(r => [11,13,14].includes(Number(r.statusCode))).length;
            reply(200,{sent,total:recipients.length,failed:recipients.length-sent,results:results.map(r=>({...r,number:r.to})),message:data.message || ''});
          } catch (_) { reply(502,{error:'SMS provider returned an unreadable response.'}); }
        });
      });
      upstream.setTimeout(20000, () => upstream.destroy(new Error('SMS request timed out; check provider status before retrying.')));
      upstream.on('error', error => {
        const code = error.code || 'CONNECTION_ERROR';
        const reason = {
          ENOTFOUND: 'Could not resolve the Sozuri server address.',
          EAI_AGAIN: 'DNS lookup temporarily failed.',
          ECONNREFUSED: 'Connection to Sozuri was refused.',
          ECONNRESET: 'The connection to Sozuri was interrupted.',
          ETIMEDOUT: 'Connection to Sozuri timed out.',
          CERT_HAS_EXPIRED: 'The connection certificate has expired.',
          UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'Unable to verify the server certificate.'
        }[code] || 'Could not confirm SMS submission.';
        reply(502,{error:reason + ' (' + code + ') Check provider status before retrying.'});
      });
      upstream.end(body);
    } catch (error) { reply(400,{error:error.message}); }
  });
}};
