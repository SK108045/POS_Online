"""Read supported eTIMS PDFs; preserve embedded QR bytes. Never issue or sign."""
from __future__ import annotations
import argparse
from datetime import datetime
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import urlparse
import fitz
from settings import ASSETS, settings

TOOLS = ASSETS / 'tools'
MONEY = r'[0-9][0-9,]*(?:\.[0-9]+)?'


def number(text: str) -> Decimal:
    value = Decimal(text.replace(',', ''))
    if not value.is_finite() or value < 0:
        raise ValueError('Invalid nonnegative amount')
    return value


def pdf_text(path: Path) -> tuple[str, str]:
    if path.suffix.lower() != '.pdf' or path.stat().st_size > 50_000_000:
        raise ValueError('Choose a PDF smaller than 50 MB')
    with fitz.open(path) as doc:
        if doc.needs_pass or not 0 < len(doc) <= 20:
            raise ValueError('Encrypted PDFs and PDFs over 20 pages are unsupported')
        return ('\n'.join(p.get_text(sort=True) for p in doc),
                '\n'.join(p.get_text() for p in doc))


def sale_from_text(text: str) -> dict:
    """Fail closed on ambiguous templates, VAT, discounts, or missing rows."""
    currency = re.search(r'Amounts are in\s+([A-Z]{3})', text, re.I)
    if currency and currency[1].upper() != 'KES':
        raise ValueError('Only KES sales are supported by this client profile')
    rows = []
    citizen = re.compile(
        rf'^\s*(.+?)\s+(\d+(?:\.\d+)?)\s+({MONEY})\s+NON\s+VAT\s+'
        rf'({MONEY})\s+({MONEY})\s+({MONEY})\s*$', re.I)
    desktop = re.compile(
        rf'^\s*(\S+)\s+(.+?)\s+(\d+(?:\.\d+)?)x({MONEY})\s+NV\s+'
        rf'({MONEY})\s+({MONEY})\s+({MONEY})\s*$', re.I)
    for line in text.splitlines():
        m = citizen.fullmatch(line)
        code = None
        if m:
            name, qty, price, tax, discount, total = m.groups()
        else:
            m = desktop.fullmatch(line)
            if not m:
                continue
            code, name, qty, price, exclusive, tax, total = m.groups()
            discount = '0'
            if number(exclusive) != number(total):
                raise ValueError('Unsupported tax or discount in desktop row')
        q, p, t = number(qty), number(price), number(total)
        if q <= 0 or p <= 0 or number(tax) != 0 or number(discount) != 0:
            raise ValueError('This version supports positive Non-VAT sales without discounts')
        if (q * p).quantize(Decimal('.01')) != t.quantize(Decimal('.01')):
            raise ValueError('PDF line quantity, price and total disagree')
        rows.append(dict(name=name.strip(), item_code=code, quantity=str(q),
                         unit_price=str(p), tax_code='D', total=str(t)))
    if not rows or len(rows) > 100:
        raise ValueError('No supported sale rows found; scanned PDFs require manual review')
    count = re.search(r'Number of items:\s*(\d+)', text, re.I)
    if count and int(count[1]) != len(rows):
        raise ValueError('PDF item count differs from extracted rows')
    total = sum((Decimal(r['total']) for r in rows), Decimal(0))
    declared = re.search(rf'Total Amount\s+({MONEY})', text, re.I)
    if not declared:
        declared = re.search(rf'^\s*Total\s+({MONEY})\s+({MONEY})\s+({MONEY})\s*$', text, re.M)
        if declared and number(declared[3]) != total:
            raise ValueError('PDF total differs from extracted rows')
    elif number(declared[1]) != total:
        raise ValueError('PDF total differs from extracted rows')
    if not declared:
        raise ValueError('Supported invoice total not found')
    payment = '06' if re.search(r'^\s*(mpesa|m-pesa|mobile money)\s*$', text, re.I | re.M) else None
    return dict(currency='KES', lines=rows, total=str(total), payment_code=payment)


def fields_from_text(text: str) -> dict:
    candidates = set(re.findall(r'\bKRA[A-Z0-9]+/\d+\b', text))
    if len(candidates) > 1:
        raise ValueError('PDF contains conflicting fiscal identifiers; select a single invoice')
    def get(pattern: str):
        m = re.search(pattern, text, re.I | re.M)
        return m[1].strip() if m else None
    scu = get(r'SCU ID\s*:\s*([A-Z0-9]+)')
    cu = get(r'CU Invoice (?:No\.?|Number)\s*:\s*([A-Z0-9]+/\d+)')
    if not cu:
        cu = next(iter(candidates)) if len(candidates) == 1 else None
    inv = get(r'INVOICE NO\s*:\s*([A-Z0-9/]+)')
    signature = get(r'(?:Rcpt|Receipt) Signature\s*:\s*([A-Z0-9-]+)')
    date = get(r'Date Created\s*:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})')
    if date:
        issued = datetime.strptime(date, '%Y-%m-%d %H:%M:%S')
    else:
        m = re.search(r'Date\s*:\s*(\d{2}-\d{2}-\d{4})\s+Time\s*:\s*(\d{2}:\d{2}:\d{2})', text, re.I)
        issued = datetime.strptime(' '.join(m.groups()), '%d-%m-%Y %H:%M:%S') if m else None
    return dict(cu_invoice_number=cu, scu_id=scu,
                receipt_signature=signature.replace('-', '') if signature else None,
                receipt_signature_printed=signature, invoice_number=inv,
                invoice_date=issued.isoformat() + '+03:00' if issued else None)


def decode_qr(path: Path):
    run = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-File',
                          str(TOOLS / 'decode-qr.ps1'), '-Path', str(path),
                          '-InstallationDir', settings()['installation_dir']],
                         capture_output=True, timeout=30)
    if run.returncode:
        raise RuntimeError('Installed QR decoder failed')
    return json.loads(run.stdout.decode('utf-8-sig', errors='strict').strip())


def find_original_qr(path: Path, output: Path) -> dict | None:
    with tempfile.TemporaryDirectory(prefix='etims-qr-') as temp, fitz.open(path) as doc:
        for page in doc:
            candidates = []
            for item in page.get_images(full=True):
                if item[2] < 50 or item[3] < 50:
                    continue
                data = doc.extract_image(item[0])
                candidate = Path(temp) / f'p{page.number}-x{item[0]}.{data["ext"]}'
                candidate.write_bytes(data['image'])
                candidates.append((candidate, 'original_embedded_image', item[0]))
            # Also handle a vector QR by decoding the original page rendering.
            render = Path(temp) / f'page-{page.number}.png'
            if page.rect.width * page.rect.height * 4 <= 12_000_000:
                page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False).save(render)
                candidates.append((render, 'original_page_render', None))
            for candidate, source, xref in candidates:
                decoded = decode_qr(candidate)
                if not decoded:
                    continue
                host = urlparse(decoded['text']).hostname or ''
                if host != 'kra.go.ke' and not host.endswith('.kra.go.ke'):
                    continue
                raw = candidate.read_bytes()
                asset = output / ('original-qr' + candidate.suffix if xref else 'original-qr-page.png')
                asset.write_bytes(raw)
                return dict(image=str(asset.resolve()), payload=decoded['text'],
                            source=source, page=page.number + 1, pdf_xref=xref,
                            sha256=hashlib.sha256(raw).hexdigest(), verification_status='not_checked')
    return None


def read_sale(path: Path) -> dict:
    text, _ = pdf_text(path)
    return dict(source_pdf=str(path.resolve()), source_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                source_fiscal_fields=fields_from_text(text), **sale_from_text(text))


def extract(path: Path, output: Path) -> dict:
    text, plain = pdf_text(path)
    result = fields_from_text(plain)
    output.mkdir(parents=True, exist_ok=False)
    result['qr_code'] = find_original_qr(path, output)
    result.update(pdf=str(path.resolve()), pdf_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                  kra_acceptance_verified=False, extraction_only=True)
    needed = ('qr_code', 'cu_invoice_number', 'scu_id', 'receipt_signature', 'invoice_number', 'invoice_date')
    result['missing_fields'] = [k for k in needed if not result[k]]
    result['all_six_fields_present'] = not result['missing_fields']
    (output / 'invoice-fields.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['sale', 'extract'])
    parser.add_argument('pdf', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.mode == 'extract' and not args.output:
        parser.error('--output is required for extract')
    result = read_sale(args.pdf) if args.mode == 'sale' else extract(args.pdf, args.output)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
