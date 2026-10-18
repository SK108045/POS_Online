"""
Oraforge Local eTIMS Fiscal Worker (Windows Paypoint Bridge)
-----------------------------------------------------------
Runs continuously in the background on the Windows store PC where the KRA eTIMS
Paypoint software and SQLite database reside.

Listens/polls the Supabase `etims_queue` table for checkout jobs dispatched by the
Online POS (running on Vercel or any browser/mobile device).
Executes high-speed programmatic signing via `EtimsFastInvoiceGenerator.exe`,
captures the official KRA fiscal confirmation & QR code, and posts the results back
to Supabase so the Online POS can print/render the official fiscal receipt in real time.
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
from pathlib import Path
import sys
import time
from datetime import datetime, timezone

# Load environment variables if python-dotenv is available
try:
    from dotenv import load_dotenv
    # Look for .env in current dir, parent dir, or root of Online-POS
    cur = Path(__file__).resolve().parent
    for env_candidate in [cur / '.env', cur.parent / '.env', cur.parent.parent / '.env']:
        if env_candidate.exists():
            load_dotenv(env_candidate)
            break
except ImportError:
    pass

import urllib.request
import urllib.parse
import urllib.error

# Local helper modules
HELPER_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(HELPER_DIR))

import fast_invoice
from settings import HOME, settings as helper_settings

try:
    import psycopg2
    import psycopg2.extras
    HAVE_PSYCOPG2 = True
except ImportError:
    HAVE_PSYCOPG2 = False


def encode_qr_data_uri(image_path: str | Path) -> str:
    p = Path(image_path)
    if not p.exists():
        return ""
    mime = mimetypes.guess_type(str(p))[0] or 'image/png'
    b64 = base64.b64encode(p.read_bytes()).decode('ascii')
    return f"data:{mime};base64,{b64}"


class EtimsCloudBridge:
    """Manages queue interactions via direct PostgreSQL connection or Supabase REST API."""

    def __init__(self, pg_url: str | None = None, supabase_url: str | None = None, supabase_key: str | None = None, vercel_url: str | None = None, schema: str = 'pos'):
        self.pg_url = pg_url
        self.supabase_url = (supabase_url or '').rstrip('/')
        self.supabase_key = supabase_key or ''
        self.vercel_url = (vercel_url or '').rstrip('/')
        self.schema = schema or os.environ.get('SUPABASE_SCHEMA', 'pos')
        self.mode = 'unknown'

        if self.pg_url and HAVE_PSYCOPG2:
            self.mode = 'postgres'
        elif self.supabase_url and self.supabase_key:
            self.mode = 'supabase_rest'
        elif self.vercel_url:
            self.mode = 'vercel_api'
        else:
            raise ValueError(
                "No valid connection method found. Please supply DATABASE_URL, or "
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or VERCEL_URL in your .env"
            )

    def fetch_pending_jobs(self, shop_id: str = 'retail', limit: int = 5) -> list[dict]:
        if self.mode == 'postgres':
            conn = psycopg2.connect(self.pg_url)
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute(f"SET search_path TO {self.schema}, public;")
            cur.execute(f"""
                SELECT id, job_hash, shop_id, order_id, ticket_no, status, payload
                FROM {self.schema}.etims_queue
                WHERE shop_id = %s AND status = 'pending'
                ORDER BY id ASC
                LIMIT %s
            """, (shop_id, limit))
            rows = cur.fetchall()
            conn.close()
            return [dict(r) for r in rows]

        elif self.mode == 'supabase_rest':
            endpoint = f"{self.supabase_url}/rest/v1/etims_queue?shop_id=eq.{shop_id}&status=eq.pending&order=id.asc&limit={limit}"
            req = urllib.request.Request(endpoint, headers={
                'apikey': self.supabase_key,
                'Authorization': f'Bearer {self.supabase_key}',
                'Accept': 'application/json',
                'Accept-Profile': self.schema,
                'Content-Profile': self.schema
            })
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode('utf-8'))

        elif self.mode == 'vercel_api':
            endpoint = f"{self.vercel_url}/api/etims/worker/pending?shop_id={shop_id}"
            req = urllib.request.Request(endpoint, headers={'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read().decode('utf-8'))

        return []

    def mark_processing(self, job_id: int):
        now_iso = datetime.now(timezone.utc).isoformat()
        if self.mode == 'postgres':
            conn = psycopg2.connect(self.pg_url)
            cur = conn.cursor()
            cur.execute(f"SET search_path TO {self.schema}, public;")
            cur.execute(f"UPDATE {self.schema}.etims_queue SET status = 'processing', updated_at = %s WHERE id = %s", (now_iso, job_id))
            conn.commit()
            conn.close()
        elif self.mode == 'supabase_rest':
            endpoint = f"{self.supabase_url}/rest/v1/etims_queue?id=eq.{job_id}"
            data = json.dumps({'status': 'processing', 'updated_at': now_iso}).encode('utf-8')
            req = urllib.request.Request(endpoint, data=data, method='PATCH', headers={
                'apikey': self.supabase_key,
                'Authorization': f'Bearer {self.supabase_key}',
                'Content-Type': 'application/json',
                'Accept-Profile': self.schema,
                'Content-Profile': self.schema
            })
            with urllib.request.urlopen(req, timeout=10):
                pass

    def mark_completed(self, job_id: int, ticket_no: str, result: dict):
        now_iso = datetime.now(timezone.utc).isoformat()
        fiscal = result.get('fiscal', {})

        if self.mode == 'postgres':
            conn = psycopg2.connect(self.pg_url)
            cur = conn.cursor()
            cur.execute(f"SET search_path TO {self.schema}, public;")
            cur.execute(f"""
                UPDATE {self.schema}.etims_queue
                SET status = 'completed', result = %s, error = NULL, updated_at = %s
                WHERE id = %s
            """, (json.dumps(result), now_iso, job_id))

            if ticket_no:
                cur.execute(f"""
                    UPDATE {self.schema}.orders SET
                        etims_status = 'generated',
                        cu_invoice_number = %s,
                        scu_id = %s,
                        receipt_signature = %s,
                        internal_data = %s,
                        qr_image = %s,
                        invoice_number = %s,
                        invoice_date = %s,
                        updated_at = %s
                    WHERE ticket_no = %s
                """, (
                    fiscal.get('cu_invoice_number', ''),
                    fiscal.get('scu_id', ''),
                    fiscal.get('receipt_signature', ''),
                    fiscal.get('internal_data', ''),
                    fiscal.get('qr_image', ''),
                    fiscal.get('invoice_number', ''),
                    fiscal.get('invoice_date', ''),
                    now_iso,
                    ticket_no
                ))
            conn.commit()
            conn.close()

        elif self.mode == 'supabase_rest':
            endpoint = f"{self.supabase_url}/rest/v1/etims_queue?id=eq.{job_id}"
            data = json.dumps({'status': 'completed', 'result': result, 'error': None, 'updated_at': now_iso}).encode('utf-8')
            req = urllib.request.Request(endpoint, data=data, method='PATCH', headers={
                'apikey': self.supabase_key,
                'Authorization': f'Bearer {self.supabase_key}',
                'Content-Type': 'application/json',
                'Accept-Profile': self.schema,
                'Content-Profile': self.schema
            })
            with urllib.request.urlopen(req, timeout=10):
                pass

            if ticket_no:
                o_endpoint = f"{self.supabase_url}/rest/v1/orders?ticket_no=eq.{ticket_no}"
                o_data = json.dumps({
                    'etims_status': 'generated',
                    'cu_invoice_number': fiscal.get('cu_invoice_number', ''),
                    'scu_id': fiscal.get('scu_id', ''),
                    'receipt_signature': fiscal.get('receipt_signature', ''),
                    'internal_data': fiscal.get('internal_data', ''),
                    'qr_image': fiscal.get('qr_image', ''),
                    'invoice_number': fiscal.get('invoice_number', ''),
                    'invoice_date': fiscal.get('invoice_date', ''),
                    'updated_at': now_iso
                }).encode('utf-8')
                o_req = urllib.request.Request(o_endpoint, data=o_data, method='PATCH', headers={
                    'apikey': self.supabase_key,
                    'Authorization': f'Bearer {self.supabase_key}',
                    'Content-Type': 'application/json',
                    'Accept-Profile': self.schema,
                    'Content-Profile': self.schema
                })
                with urllib.request.urlopen(o_req, timeout=10):
                    pass

        elif self.mode == 'vercel_api':
            endpoint = f"{self.vercel_url}/api/etims/worker/complete"
            data = json.dumps({'job_id': job_id, 'ticket_no': ticket_no, 'result': result}).encode('utf-8')
            req = urllib.request.Request(endpoint, data=data, headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=10):
                pass

    def mark_failed(self, job_id: int, error_message: str):
        now_iso = datetime.now(timezone.utc).isoformat()
        if self.mode == 'postgres':
            conn = psycopg2.connect(self.pg_url)
            cur = conn.cursor()
            cur.execute(f"SET search_path TO {self.schema}, public;")
            cur.execute(f"UPDATE {self.schema}.etims_queue SET status = 'failed', error = %s, updated_at = %s WHERE id = %s", (error_message[:600], now_iso, job_id))
            conn.commit()
            conn.close()
        elif self.mode == 'supabase_rest':
            endpoint = f"{self.supabase_url}/rest/v1/etims_queue?id=eq.{job_id}"
            data = json.dumps({'status': 'failed', 'error': error_message[:600], 'updated_at': now_iso}).encode('utf-8')
            req = urllib.request.Request(endpoint, data=data, method='PATCH', headers={
                'apikey': self.supabase_key,
                'Authorization': f'Bearer {self.supabase_key}',
                'Content-Type': 'application/json',
                'Accept-Profile': self.schema,
                'Content-Profile': self.schema
            })
            with urllib.request.urlopen(req, timeout=10):
                pass
        elif self.mode == 'vercel_api':
            endpoint = f"{self.vercel_url}/api/etims/worker/complete"
            data = json.dumps({'job_id': job_id, 'error': error_message[:600]}).encode('utf-8')
            req = urllib.request.Request(endpoint, data=data, headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=10):
                pass


def run_worker(bridge: EtimsCloudBridge, shop_id: str = 'retail', poll_interval: float = 2.0):
    try:
        gen_exe = fast_invoice.find_generator_exe()
        print(f"Fast Engine Executable : {gen_exe}")
    except Exception as e:
        print(f"WARNING: Fast Invoice Generator not found: {e}")
        print("Worker cannot sign official invoices without EtimsFastInvoiceGenerator.exe.")
        return

    print("=" * 70)
    print("      ORAFORGE LOCAL eTIMS FISCAL WORKER (ONLINE POS BRIDGE)")
    print("=" * 70)
    print(f"Connection Mode        : {bridge.mode.upper()}")
    print(f"Target Shop ID         : {shop_id}")
    print(f"Polling Interval       : {poll_interval}s")
    print(f"Status                 : ACTIVE & READY FOR INCOMING SALES")
    print("=" * 70)
    print("Listening for online POS transactions. Press Ctrl+C to stop.\n")

    cfg = helper_settings()

    while True:
        try:
            jobs = bridge.fetch_pending_jobs(shop_id=shop_id, limit=3)
            for job in jobs:
                job_id = job['id']
                ticket_no = job.get('ticket_no', '')
                job_key = job.get('job_hash') or f"job-{job_id}"
                raw_payload = job.get('payload', {})

                print(f"[{datetime.now().strftime('%H:%M:%S')}] Received pending eTIMS request for POS Ticket: {ticket_no} (Job #{job_id})")
                bridge.mark_processing(job_id)

                # Extract sale object
                sale = raw_payload.get('sale') or raw_payload.get('order') or raw_payload

                try:
                    t0 = time.time()
                    # Execute high-speed programmatic signing via EtimsFastInvoiceGenerator.exe
                    raw = fast_invoice.issue_programmatic(sale, cfg, job_key)
                    elapsed_ms = round((time.time() - t0) * 1000)

                    # Encode QR image as base64 Data URI
                    qr_image_uri = ''
                    qr_obj = raw.get('qr_code') or {}
                    if qr_obj.get('image'):
                        qr_image_uri = encode_qr_data_uri(qr_obj['image'])

                    fiscal = {
                        'cu_invoice_number': raw.get('cu_invoice_number', ''),
                        'scu_id': raw.get('scu_id', ''),
                        'receipt_signature': raw.get('receipt_signature', ''),
                        'receipt_signature_formatted': raw.get('receipt_signature_formatted', raw.get('receipt_signature', '')),
                        'internal_data': raw.get('internal_data', ''),
                        'invoice_number': raw.get('invoice_number', ''),
                        'invoice_date': raw.get('invoice_date', ''),
                        'qr_image': qr_image_uri,
                        'qr_payload': qr_obj.get('payload', ''),
                        'source': 'windows',
                        'local_issuance_status': 'issued',
                        'kra_acceptance_status': 'verified',
                        'original_pdf_sha256': raw.get('pdf_sha256', ''),
                        'original_qr_sha256': qr_obj.get('sha256', '')
                    }

                    result = {
                        'fiscal': fiscal,
                        'total_cents': sale.get('total_cents', 0),
                        'local_invoice_id': raw.get('local_invoice_id'),
                        'local_issuance_status': 'issued',
                        'kra_acceptance_status': 'verified'
                    }

                    # Mark completed in Supabase queue and orders
                    bridge.mark_completed(job_id, ticket_no, result)
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] ✓ SUCCESS: Issued KRA CU #{raw.get('cu_invoice_number')} in {elapsed_ms}ms! Updated cloud.")

                except Exception as issue_err:
                    err_msg = str(issue_err)
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] ✕ ERROR processing job #{job_id}: {err_msg}")
                    bridge.mark_failed(job_id, err_msg)

        except urllib.error.URLError as e:
            # Network blip, wait and retry
            pass
        except Exception as loop_err:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] Worker loop warning: {loop_err}")

        time.sleep(poll_interval)


def main():
    parser = argparse.ArgumentParser(description="Local eTIMS Fiscal Worker for Online POS")
    parser.add_argument('--shop-id', type=str, default=os.environ.get('ETIMS_SHOP_ID', 'retail'), help="Shop identifier")
    parser.add_argument('--interval', type=float, default=2.0, help="Polling interval in seconds")
    parser.add_argument('--pg-url', type=str, default=os.environ.get('DATABASE_URL') or os.environ.get('POSTGRES_URL'))
    parser.add_argument('--supabase-url', type=str, default=os.environ.get('SUPABASE_URL'))
    parser.add_argument('--supabase-key', type=str, default=os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_ANON_KEY'))
    parser.add_argument('--vercel-url', type=str, default=os.environ.get('VERCEL_URL'))
    parser.add_argument('--schema', type=str, default=os.environ.get('SUPABASE_SCHEMA', 'pos'), help="Target database schema (default: pos)")
    args = parser.parse_args()

    # Fallback to defaults if not set in arguments
    pg_url = args.pg_url
    if not pg_url and not args.supabase_url:
        # Default connection string from existing project
        pg_url = "postgresql://postgres.iyfebdvtcryjxitizuwb:8045%40JohnWakaba@aws-1-eu-west-1.pooler.supabase.com:6543/postgres"

    bridge = EtimsCloudBridge(
        pg_url=pg_url,
        supabase_url=args.supabase_url,
        supabase_key=args.supabase_key,
        vercel_url=args.vercel_url,
        schema=args.schema
    )

    try:
        run_worker(bridge, shop_id=args.shop_id, poll_interval=args.interval)
    except KeyboardInterrupt:
        print("\nLocal eTIMS Worker stopped by user.")
        sys.exit(0)


if __name__ == '__main__':
    main()
