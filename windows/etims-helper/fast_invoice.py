"""High-speed programmatic eTIMS invoice issuance bridge.
Bypasses slow/fragile UI automation by signing and recording sales directly
against the local eTIMS SQLite database and encrypted outbox queue.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
from decimal import Decimal

from contracts import PAYMENTS, digest
from settings import ASSETS, HOME


def find_generator_exe() -> Path:
    candidates = [
        Path(__file__).parent / 'fast_engine' / 'EtimsFastInvoiceGenerator.exe',
        HOME / 'fast_engine' / 'EtimsFastInvoiceGenerator.exe',
        ASSETS / 'fast_engine' / 'EtimsFastInvoiceGenerator.exe',
    ]
    for c in candidates:
        if c.exists():
            return c.resolve()
    raise FileNotFoundError('EtimsFastInvoiceGenerator.exe not found in fast_engine directory')


def sale_to_request(sale: dict, mappings: dict | None = None) -> dict:
    mappings = mappings or {}
    items = []
    for item in sale.get('items', []):
        pos_key = item.get('product_key', '')
        code = mappings.get(pos_key) or item.get('item_code') or ''
        qty = float(item.get('quantity', 1))
        unit_price = float(item.get('unit_price_cents', 0)) / 100.0
        line_total = float(item.get('line_total_cents', 0)) / 100.0
        tax_code = item.get('tax_code', 'D')
        items.append({
            'ItemCode': code,
            'Name': item.get('name', 'Item'),
            'Quantity': qty,
            'UnitPrice': unit_price,
            'LineTotal': line_total,
            'TaxCode': tax_code
        })

    cust = sale.get('customer', {})
    payment_method = sale.get('payment_method', 'cash')
    payment_code = PAYMENTS.get(payment_method, '01')
    shop_id = sale.get('shop_id', 'pos')
    receipt_no = sale.get('receipt_no', '')

    return {
        'BuyerPin': cust.get('pin', 'NA'),
        'BuyerName': cust.get('name', 'Walk-In Customer'),
        'BuyerPhone': cust.get('phone', ''),
        'BuyerEmail': cust.get('email', ''),
        'BuyerAddress': cust.get('billing_address', ''),
        'PaymentCode': payment_code,
        'Remark': f"Oraforge:{shop_id}:{receipt_no}",
        'PosSaleDigest': digest(sale),
        'Items': items
    }


def issue_programmatic(sale: dict, config: dict, key: str,
                       mappings: dict | None = None,
                       checkpoint=None) -> dict:
    if checkpoint:
        checkpoint('preparing')

    generator_exe = find_generator_exe()
    install_dir = config.get('installation_dir', r'C:\eTIMS-Paypoint-Win')
    db_path = config.get('database_path') or str(
        Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'EBM2x/sqlite/RRA_EBM2x.db'
    )
    outbox_dir = str(Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'EBM2x/rrasdc/transaction')
    output_dir = str(HOME / 'invoices')
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    request_payload = sale_to_request(sale, mappings)

    with tempfile.NamedTemporaryFile('w', encoding='utf-8', suffix='.json', delete=False) as tf:
        json.dump(request_payload, tf, ensure_ascii=False)
        temp_req_path = tf.name

    try:
        if checkpoint:
            checkpoint('issuing')

        cmd = [
            str(generator_exe),
            '--file', temp_req_path,
            '--installation-dir', install_dir,
            '--db-path', db_path,
            '--outbox-dir', outbox_dir,
            '--output-dir', output_dir
        ]

        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=30,
            check=False
        )

        stdout = proc.stdout.strip()
        if not stdout:
            stderr = proc.stderr.strip()
            raise RuntimeError(f"Fast invoice generator exited with code {proc.returncode}: {stderr}")

        try:
            gen_res = json.loads(stdout)
        except Exception:
            # Look for JSON line in output if there are preamble lines
            json_line = None
            for line in stdout.splitlines():
                line = line.strip()
                if line.startswith('{') and line.endswith('}'):
                    try:
                        json_line = json.loads(line)
                        break
                    except Exception:
                        pass
            if not json_line:
                raise RuntimeError(f"Invalid generator response: {stdout}")
            gen_res = json_line

        if not gen_res.get('Success'):
            err = gen_res.get('Error', 'Unknown invoice generation failure')
            raise RuntimeError(f"Fast eTIMS issuance failed: {err}")

        # Build raw dict conforming to Engine.result requirements
        qr_obj = gen_res.get('QrCode') or {}
        raw = {
            'local_invoice_id': gen_res['LocalInvoiceId'],
            'invoice_number': gen_res.get('InvoiceNumber') or str(gen_res['LocalInvoiceId']),
            'cu_invoice_number': gen_res['CuInvoiceNumber'],
            'scu_id': gen_res['ScuId'],
            'receipt_signature': gen_res['ReceiptSignature'],
            'receipt_signature_formatted': gen_res.get('ReceiptSignatureFormatted', gen_res['ReceiptSignature']),
            'internal_data': gen_res.get('InternalData', ''),
            'invoice_date': gen_res['InvoiceDate'],
            'qr_code': {
                'image': qr_obj.get('Image', ''),
                'payload': qr_obj.get('Payload', ''),
                'sha256': qr_obj.get('Sha256', ''),
                'source': 'programmatic'
            },
            'pdf_sha256': gen_res.get('PdfSha256') or qr_obj.get('Sha256', ''),
            'total_amount': gen_res.get('TotalAmount', float(sale.get('total_cents', 0)) / 100.0),
            'execution_ms': gen_res.get('ExecutionMs', 0),
            'execution_method': 'Programmatic Fast VSCU Engine (Signed locally via eTIMS keys)',
            'raw_generator_result': gen_res
        }

        # Write durable ledger entry for recovery and auditing
        ledger_file = HOME / 'ledger' / (key + '.json')
        ledger_file.parent.mkdir(parents=True, exist_ok=True)
        ledger_entry = {
            'request': {
                'buyer_pin': request_payload['BuyerPin'],
                'buyer_name': request_payload['BuyerName'],
                'pos_sale_digest': digest(sale),
                'payment_code': request_payload['PaymentCode'],
                'total': str(Decimal(sale['total_cents']) / 100),
                'lines': request_payload['Items']
            },
            'stage': 'complete',
            'local_invoice_id': raw['local_invoice_id'],
            'invoice_id': raw['local_invoice_id'],
            'cu_invoice_number': raw['cu_invoice_number'],
            'receipt_signature': raw['receipt_signature'],
            'result': raw
        }
        ledger_file.write_text(json.dumps(ledger_entry, indent=2), encoding='utf-8')

        if checkpoint:
            checkpoint('complete')

        return raw

    finally:
        try:
            if os.path.exists(temp_req_path):
                os.unlink(temp_req_path)
        except Exception:
            pass
