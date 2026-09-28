function validate(payload) {
  let phone=String(payload.phone || '').replace(/\D/g,'');
  if (/^254[17]\d{8}$/.test(phone)) phone='0'+phone.slice(3);
  if (/^[17]\d{8}$/.test(phone)) phone='0'+phone;
  if (!/^0[17]\d{8}$/.test(phone)) throw new Error('Enter a valid Kenyan mobile number.');
  if (typeof payload.amount !== 'number' || !Number.isFinite(payload.amount) || payload.amount<=0) throw new Error('Payment amount must be greater than zero.');
  if (!String(payload.accountReference || '').trim()) throw new Error('Payment reference is required.');
  return {phone,amount:payload.amount,accountReference:String(payload.accountReference).trim(),description:String(payload.description || 'POS payment')};
}
function normalize(result) {
  if (!result || typeof result!=='object' || Array.isArray(result)) return {status:false,message:'Swifta returned an unreadable response. Check payment status before retrying.'};
  const data=result.data && typeof result.data==='object'?result.data:result;
  const code=data.ResponseCode ?? data.responseCode ?? result.ResponseCode ?? result.responseCode;
  const failed=result.success===false || result.status===false || data.success===false || data.status===false || (code!=null && String(code)!=='0');
  const accepted=!failed && (String(code)==='0' || result.success===true || result.status===true || ['success','accepted','pending'].includes(String(result.status).toLowerCase()));
  const message=data.errorMessage || result.errorMessage || result.error || data.ResponseDescription || result.message || data.message || data.CustomerMessage;
  return {status:accepted,message:typeof message==='string'?message:(accepted?'STK request accepted':'Could not confirm STK acceptance. Check Swifta before retrying.'),data:{status:accepted?'pay_offline':'failed',reference:data.CheckoutRequestID || data.checkoutRequestId || data.checkout_request_id || data.reference || result.reference || ''}};
}
module.exports={validate,normalize};
