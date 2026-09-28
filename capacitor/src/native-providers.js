import swifta from '../swifta-contract';
import config from './provider-config.json';

export function createNativeProviders(http) {
  const parse = response => {
    const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    if (!data || typeof data !== 'object') throw new Error('Provider returned an invalid response.');
    return data;
  };
  return {
    async charge(payload) {
      return swifta.normalize(parse(await http.request({
        url: 'https://app.swifta.co.ke/stkpush', method: 'POST',
        headers: {'x-api-key':config.swifta, 'Content-Type':'application/json', Accept:'application/json'},
        data: swifta.validate(payload), readTimeout: 30000
      })));
    },
    async sms(path, body = {}) {
      if (path === '/api/admin/sms/config') return {configured: !!config.sozuri?.apiKey, message: 'Configured'};
      if (path !== '/api/admin/sms/send') throw new Error('Unknown SMS endpoint.');
      const message = String(body.message || '').trim();
      if (!message || message.length > 1000) throw new Error('Enter a message of 1–1000 characters.');
      if (!Array.isArray(body.recipients) || !body.recipients.length || body.recipients.length > 200) throw new Error('Select 1–200 recipients.');
      const recipients = [...new Set(body.recipients.map(phone => {
        let digits = String(phone || '').replace(/\D/g, '');
        if (/^0[17]\d{8}$/.test(digits)) digits = '254' + digits.slice(1);
        if (/^[17]\d{8}$/.test(digits)) digits = '254' + digits;
        if (!/^254[17]\d{8}$/.test(digits)) throw new Error('A selected customer has an invalid Kenyan phone number.');
        return '+' + digits;
      }))];
      const response = parse(await http.request({
        url: 'https://sozuri.net/api/v1/messaging', method: 'POST',
        headers: {Accept:'application/json', 'Content-Type':'application/json'},
        data: {...config.sozuri, to:recipients.join(','), message},
        readTimeout: 30000
      }));
      const results = response.recipients || [];
      const sent = results.filter(r => [11,13,14].includes(Number(r.statusCode))).length;
      return {sent, total:recipients.length, failed:recipients.length-sent, results:results.map(r=>({...r,number:r.to})), message:response.message || ''};
    }
  };
}
