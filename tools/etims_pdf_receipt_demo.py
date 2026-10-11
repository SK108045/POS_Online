#!/usr/bin/env python3
"""Offline, read-only experiment: extract an existing eTIMS PDF into the real POS receipt renderer.

Usage: python3 tools/etims_pdf_receipt_demo.py INVXLBRZJX.pdf --out /tmp/oraforge-etims-demo
Dependencies: python -m pip install pymupdf numpy opencv-python-headless
No POS sales, cookies or extension data are read or modified.
"""
import argparse
import base64
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import urlparse


def extract(pdf: Path):
    try:
        import fitz
        import cv2
        import numpy as np
    except ImportError as exc:
        raise SystemExit('Install PDF demo dependencies: python3 -m pip install pymupdf numpy opencv-python-headless') from exc
    if not pdf.is_file() or pdf.stat().st_size > 10_000_000:
        raise ValueError('Provide an existing KRA PDF no larger than 10 MB.')
    document = fitz.open(pdf)
    try:
        if len(document) != 1:
            raise ValueError('This isolated experiment supports a single-page KRA invoice PDF only.')
        page = document[0]
        lines = [re.sub(r'\s+', ' ', line).strip() for line in page.get_text('text').splitlines()]
        lines = [line for line in lines if line]
        if not lines or lines[0] != 'Invoice':
            raise ValueError('Unrecognized KRA invoice text; refusing to guess fields.')
        def following(label):
            try:
                return lines[lines.index(label) + 1]
            except (ValueError, IndexError) as e:
                raise ValueError(f'Missing required PDF field: {label}') from e
        def labeled(label):
            match = next((re.fullmatch(re.escape(label) + r'\s*(.*)', line) for line in lines if line.startswith(label)), None)
            if not match:
                raise ValueError(f'Missing required PDF field: {label}')
            return match.group(1).strip() or following(label)
        def cents(value):
            if not re.fullmatch(r'\d[\d,]*\.\d{2}', value):
                raise ValueError('Invalid PDF money value: ' + str(value))
            whole, decimal = value.replace(',', '').split('.')
            return int(whole) * 100 + int(decimal)
        try:
            start = lines.index('Item')
            if lines[start + 1:start + 7] != ['Qty', 'Price', 'Tax Type', 'Tax', 'Discount', 'Total']:
                raise ValueError('Unrecognized KRA item table columns.')
            end = next(i for i in range(start + 7, len(lines)) if lines[i].startswith('Number of items:'))
            cells = lines[start + 7:end]
            if len(cells) % 7:
                raise ValueError('Unrecognized KRA item table layout; refusing to infer line items.')
            items = []
            for i in range(0, len(cells), 7):
                name, quantity, price, tax_type, tax, discount, total = cells[i:i + 7]
                if not re.fullmatch(r'\d+(?:\.\d{1,3})?', quantity):
                    raise ValueError('Invalid quantity in KRA PDF')
                items.append({'name': name, 'quantity': float(quantity),
                              'unit_price_cents': cents(price), 'line_total_cents': cents(total),
                              'tax_type': tax_type, 'tax_cents': cents(tax),
                              'discount_cents': cents(discount)})
            declared = int(re.fullmatch(r'Number of items:\s*(\d+)', lines[end]).group(1))
            if declared != len(items) or not items:
                raise ValueError('KRA PDF item-count mismatch.')
        except (IndexError, AttributeError, StopIteration) as exc:
            raise ValueError('Unrecognized KRA invoice item structure.') from exc
        result = {
            'invoice_date': labeled('Date Created:'),
            'invoice_number': labeled('Invoice No:'),
            'scu_id': labeled('SCU ID:'),
            'receipt_signature': labeled('Receipt Signature:'),
            'cu_invoice_number': following('CU Invoice Number:'),
            'seller_name': following('Sale From:'),
            'buyer_name': following('Sale To:'),
            'payment_method': following('Payment Method:'),
            'subtotal_cents': cents(following('Subtotal')),
            'tax_cents': cents(following('Total VAT')),
            'discount_cents': cents(following('Total Discount')),
            'total_cents': cents(following('Total Amount')),
            'items': items,
        }
        try:
            result['seller_pin'] = next(line[5:].strip() for line in lines[lines.index('Sale From:'):lines.index('Sale To:')] if line.startswith('PIN:') and line[4:].strip())
        except (ValueError, StopIteration):
            result['seller_pin'] = ''
        if sum(item['line_total_cents'] for item in items) != result['total_cents']:
            raise ValueError('This demo requires undiscounted line totals matching the PDF total.')
        if result['subtotal_cents'] - result['discount_cents'] + result['tax_cents'] != result['total_cents']:
            raise ValueError('Invoice amounts do not reconcile; stop rather than invent totals.')
        pix = page.get_pixmap(matrix=fitz.Matrix(3, 3), alpha=False)
        rgb = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        qr_url, bounds, _ = cv2.QRCodeDetector().detectAndDecode(gray)
        if not qr_url or bounds is None:
            raise ValueError('Official QR could not be decoded from the PDF.')
        parsed = urlparse(qr_url)
        if parsed.scheme != 'https' or parsed.hostname != 'etims.kra.go.ke' or '/receipt/' not in parsed.path:
            raise ValueError('PDF QR does not point to an approved KRA eTIMS receipt URL.')
        if result['receipt_signature'] not in qr_url:
            raise ValueError('KRA QR payload does not match the printed receipt signature.')
        p = bounds[0]
        x0, y0 = np.maximum(np.floor(p.min(axis=0)).astype(int) - 18, 0)
        x1, y1 = np.minimum(np.ceil(p.max(axis=0)).astype(int) + 19, [pix.width, pix.height])
        cropped = rgb[y0:y1, x0:x1]
        qr_rgb = cv2.resize(cropped, None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST)
        if cv2.QRCodeDetector().detectAndDecode(cv2.cvtColor(qr_rgb, cv2.COLOR_RGB2GRAY))[0] != qr_url:
            raise ValueError('Extracted QR crop failed scan verification.')
        success, png = cv2.imencode('.png', cv2.cvtColor(qr_rgb, cv2.COLOR_RGB2BGR))
        if not success:
            raise ValueError('Unable to encode extracted QR image.')
        result['qr_image'] = 'data:image/png;base64,' + base64.b64encode(png.tobytes()).decode('ascii')
        result['qr_url'] = qr_url
        return result, png.tobytes()
    finally:
        document.close()


def main():
    parser = argparse.ArgumentParser(description='Render KRA PDF data in original Oraforge POS receipt HTML (demo only).')
    parser.add_argument('pdf', type=Path, help='Existing single-page official eTIMS PDF (never generates an invoice)')
    parser.add_argument('--out', type=Path, default=Path('/tmp/oraforge-etims-pdf-demo'))
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    args.out.mkdir(parents=True, exist_ok=True)
    data, qr = extract(args.pdf)
    (args.out / 'invoice-data.json').write_text(json.dumps(data, indent=2), encoding='utf-8')
    (args.out / 'original-kra-qr.png').write_bytes(qr)
    subprocess.run(['node', str(root / 'tools' / 'etims_pdf_receipt_demo.cjs'), str(args.out / 'invoice-data.json'), str(args.out / 'oraforge-receipt-preview.html')], check=True)
    print(f'PDF extraction successful. Original receipt preview: {args.out / "oraforge-receipt-preview.html"}')
    print(f'CU: {data["cu_invoice_number"]}; SCU: {data["scu_id"]}; signature: {data["receipt_signature"]}')
    print('DEMO ONLY. No real Oraforge sale was matched or marked generated. No invoice was issued.')


if __name__ == '__main__':
    main()
