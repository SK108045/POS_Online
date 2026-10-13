"""Validate immutable POS sale JSON without creating fiscal identifiers."""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import hashlib
import json
import re

PAYMENTS = {'cash': '01', 'credit': '02', 'cash_credit': '03', 'bank': '04',
            'bank_slip': '04', 'card': '05', 'mpesa': '06', 'mobile_money': '06', 'other': '07'}

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)

def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()

def text(value, field, maximum=240):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum or any(ord(c) < 32 for c in value):
        raise ValueError('Invalid or missing ' + field)
    return value.strip()

def amount(value, field, positive=False):
    if isinstance(value, bool) or not isinstance(value, int) or value < (1 if positive else 0) or value > 9_000_000_000_000:
        raise ValueError(field + ' must be integer cents')
    return value

def decimal(value, field, positive=False):
    try:
        result = Decimal(str(value))
    except (ValueError, InvalidOperation):
        raise ValueError('Invalid ' + field) from None
    if not result.is_finite() or result < 0 or (positive and result <= 0) or len(result.as_tuple().digits) > 15:
        raise ValueError('Invalid ' + field)
    return result

def validate(sale):
    if not isinstance(sale, dict) or sale.get('version') != 2 or sale.get('currency') != 'KES':
        raise ValueError('A version 2 KES Windows invoice request is required')
    text(sale.get('shop_id'), 'shop identity', 140)
    text(sale.get('receipt_no'), 'POS receipt number', 100)
    if isinstance(sale.get('sale_id'), bool) or not isinstance(sale.get('sale_id'), int) or sale['sale_id'] <= 0:
        raise ValueError('Invalid POS sale identity')
    customer = sale.get('customer', {})
    if not re.fullmatch(r'[A-Z]\d{9}[A-Z]', customer.get('pin', '')):
        raise ValueError('Buyer KRA PIN is required')
    text(customer.get('name'), 'buyer name', 120)
    for key in ('phone', 'email', 'billing_address', 'remarks'):
        value = customer.get(key, '')
        if value and (not isinstance(value, str) or len(value) > (500 if key == 'remarks' else 240) or any(ord(c) < 32 for c in value)):
            raise ValueError('Invalid optional buyer field')
    if sale.get('payment_method') not in PAYMENTS:
        raise ValueError('Unsupported payment category; select the actual payment method')
    items = sale.get('items')
    if not isinstance(items, list) or not 1 <= len(items) <= 100:
        raise ValueError('The sale needs 1 to 100 item lines')
    subtotal = 0
    identities = {}
    for item in items:
        text(item.get('product_key'), 'stable POS product identity', 200)
        text(item.get('name'), 'product name', 200)
        identity=canonical({k:item.get(k,{}) for k in ('name','registration','inventory')})
        if item['product_key'] in identities and identities[item['product_key']]!=identity:
            raise ValueError('Repeated POS product identity has inconsistent registration or inventory')
        identities[item['product_key']]=identity
        qty = decimal(item.get('quantity'), 'quantity', True)
        price = amount(item.get('unit_price_cents'), 'selling price', True)
        total = amount(item.get('line_total_cents'), 'line total', True)
        if int((qty * price).quantize(Decimal('1'), rounding=ROUND_HALF_UP)) != total:
            raise ValueError('POS line quantity and price do not match its total')
        subtotal += total
    if subtotal != amount(sale.get('subtotal_cents'), 'subtotal'):
        raise ValueError('POS subtotal does not match its lines')
    discount = amount(sale.get('discount', {}).get('amount_cents', 0), 'discount')
    if subtotal - discount != amount(sale.get('total_cents'), 'total', True):
        raise ValueError('POS invoice total does not reconcile')
    tax = amount(sale.get('tax_cents', 0), 'tax')
    if tax > sale['total_cents']:
        raise ValueError('POS tax exceeds its total')
    # This installed Non-VAT profile has been validated with tax D only.
    # Fail before any registration/write instead of issuing a different amount.
    if discount or tax:
        raise ValueError('This verified desktop profile currently requires zero discount and Non-VAT sales')
    return sale

def job_id(sale):
    return digest([sale['shop_id'], sale['sale_id'], sale['receipt_no']])

def product_key(sale, item, taxpayer, branch):
    return digest([taxpayer, branch, sale['shop_id'], item['product_key']])

def to_request(sale, item_codes):
    validate(sale)
    return dict(buyer_pin=sale['customer']['pin'], buyer_name=sale['customer']['name'],
                pos_sale_digest=digest(sale),
                payment_code=PAYMENTS[sale['payment_method']], total=str(Decimal(sale['total_cents']) / 100),
                lines=[dict(name=i['name'], item_code=item_codes[i['product_key']],
                            quantity=str(decimal(i['quantity'], 'quantity', True)),
                            unit_price=str(Decimal(i['unit_price_cents']) / 100), tax_code='D',
                            total=str(Decimal(i['line_total_cents']) / 100)) for i in sale['items']])
