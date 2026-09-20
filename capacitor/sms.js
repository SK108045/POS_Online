const fs = require('fs');
const path = require('path');
const https = require('https');
function config() {
  const file = path.join(__dirname, '..', 'api.txt');
  const key = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
  return { key, username: 'sk10', configured: !!key };
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
    reply(200, {configured:cfg.configured, message:cfg.configured ? 'Configured' : "Africa's Talking key missing: add it to POS_APK/api.txt (username sk10)."});
    return;
  }
  if (req.method !== 'POST' || !pathname.endsWith('/send')) { reply(405,{error:'Method not allowed'}); return; }
  if (!cfg.configured) { reply(503,{error:"Africa's Talking key missing: add it to POS_APK/api.txt (username sk10)."}); return; }
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
      const body = new URLSearchParams({username:cfg.username, to:recipients.join(','), message}).toString();
      const upstream = https.request('https://api.africastalking.com/version1/messaging', {method:'POST', headers:{apiKey:cfg.key, Accept:'application/json', 'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}}, response => {
        let text = '';
        response.on('data', c => text += c);
        response.on('end', () => {
          try {
            const data = JSON.parse(text);
            if (response.statusCode >= 400) { reply(502,{error:String(data.errorMessage || data.message || 'SMS provider rejected the request').split(cfg.key).join('***')}); return; }
            const results = data.SMSMessageData?.Recipients || [];
            const sent = results.filter(r => Number(r.statusCode) === 101 || Number(r.statusCode) === 100 || /^(success|sent)$/i.test(r.status)).length;
            reply(200,{sent,total:recipients.length,failed:recipients.length-sent,results,message:data.SMSMessageData?.Message || ''});
          } catch (_) { reply(502,{error:'SMS provider returned an unreadable response.'}); }
        });
      });
      upstream.setTimeout(20000, () => upstream.destroy(new Error('SMS request timed out; check provider status before retrying.')));
      upstream.on('error', error => {
        const code = error.code || 'CONNECTION_ERROR';
        const reason = {
          ENOTFOUND: 'Could not resolve the Africa’s Talking server address.',
          EAI_AGAIN: 'DNS lookup temporarily failed.',
          ECONNREFUSED: 'Connection to Africa’s Talking was refused.',
          ECONNRESET: 'The connection to Africa’s Talking was interrupted.',
          ETIMEDOUT: 'Connection to Africa’s Talking timed out.',
          CERT_HAS_EXPIRED: 'The connection certificate has expired.',
          UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'Unable to verify the server certificate.'
        }[code] || 'Could not confirm SMS submission.';
        reply(502,{error:reason + ' (' + code + ') Check provider status before retrying.'});
      });
      upstream.end(body);
    } catch (error) { reply(400,{error:error.message}); }
  });
}};
