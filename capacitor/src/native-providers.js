import config from './provider-config.json';

export function createNativeProviders(http) {
  const parse = response => {
    const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    if (!data || typeof data !== 'object') throw new Error('Provider returned an invalid response.');
    return data;
  };
  return {
    async charge(payload) {
      return parse(await http.request({
        url: 'https://api.paystack.co/charge', method: 'POST',
        headers: {Authorization: `Bearer ${config.paystack}`, 'Content-Type':'application/json', Accept:'application/json'},
        data: payload, readTimeout: 30000
      }));
    },
    async sms(path, body = {}) {
      if (path === '/api/admin/sms/config') return {configured: !!config.sms, message: 'Configured'};
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
        url: 'https://api.africastalking.com/version1/messaging', method: 'POST',
        headers: {apiKey:config.sms, Accept:'application/json', 'Content-Type':'application/x-www-form-urlencoded'},
        data: new URLSearchParams({username:config.username, to:recipients.join(','), message}).toString(),
        readTimeout: 30000
      }));
      const results = response.SMSMessageData?.Recipients || [];
      const sent = results.filter(r => [100,101].includes(Number(r.statusCode)) || /^(success|sent)$/i.test(r.status)).length;
      return {sent, total:recipients.length, failed:recipients.length-sent, results, message:response.SMSMessageData?.Message || ''};
    }
  };
}
