"""
SQLite to Supabase Migration Tool for Oraforge Online POS
---------------------------------------------------------
Transfers all data from local SQLite database (pos.sqlite3) or buildmart_catalog.json
into Supabase PostgreSQL so the online Vercel POS has the complete product catalog,
categories, suppliers, and sales history.

Usage:
  python migrate_sqlite_to_supabase.py [--pg-url "postgresql://..."]
  or configure DATABASE_URL or SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY in .env
"""

import argparse
import json
import os
from pathlib import Path
import sqlite3
import sys
from datetime import datetime, timezone

# Load environment variables if python-dotenv is installed
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / '.env')
except ImportError:
    pass

try:
    import psycopg2
    import psycopg2.extras
    HAVE_PSYCOPG2 = True
except ImportError:
    HAVE_PSYCOPG2 = False

if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_SQLITE_PATH = ROOT_DIR / "data" / "pos.sqlite3"
DEFAULT_CATALOG_PATH = ROOT_DIR / "capacitor" / "www" / "buildmart_catalog.json"

def format_iso(ts):
    if not ts:
        return datetime.now(timezone.utc).isoformat()
    if isinstance(ts, str):
        if 'T' in ts or '-' in ts:
            return ts
        try:
            ts = float(ts)
        except ValueError:
            return datetime.now(timezone.utc).isoformat()
    try:
        return datetime.fromtimestamp(float(ts), tz=timezone.utc).isoformat()
    except Exception:
        return datetime.now(timezone.utc).isoformat()

def migrate_via_postgres(pg_url, sqlite_path, catalog_path):
    print(f"\n[1/4] Connecting to Supabase PostgreSQL...", flush=True)
    conn = psycopg2.connect(pg_url)
    cur = conn.cursor()

    # Ensure tables and columns exist
    schema_file = ROOT_DIR / "supabase" / "migrations" / "001_initial_schema.sql"
    if schema_file.exists():
        print(f"      Applying schema from {schema_file.name}...", flush=True)
        cur.execute(schema_file.read_text(encoding='utf-8'))
        conn.commit()

    print("\n[2/4] Reading data source...", flush=True)
    categories = []
    items = []
    suppliers = []
    orders = []
    order_items = []

    if sqlite_path.exists():
        print(f"      Loading from SQLite: {sqlite_path}", flush=True)
        sconn = sqlite3.connect(sqlite_path)
        sconn.row_factory = sqlite3.Row
        scur = sconn.cursor()

        try:
            cur_cats = scur.execute("SELECT * FROM categories ORDER BY id").fetchall()
            categories = [dict(r) for r in cur_cats]
        except Exception as e:
            print(f"      Warning: could not read categories from SQLite: {e}", flush=True)

        try:
            cur_items = scur.execute("SELECT * FROM menu_items ORDER BY id").fetchall()
            items = [dict(r) for r in cur_items]
        except Exception as e:
            print(f"      Warning: could not read menu_items from SQLite: {e}", flush=True)

        try:
            cur_supps = scur.execute("SELECT * FROM suppliers ORDER BY id").fetchall()
            suppliers = [dict(r) for r in cur_supps]
        except Exception as e:
            print(f"      Warning: could not read suppliers from SQLite: {e}", flush=True)

        try:
            cur_orders = scur.execute("SELECT * FROM orders ORDER BY id").fetchall()
            orders = [dict(r) for r in cur_orders]
        except Exception as e:
            print(f"      Warning: could not read orders from SQLite: {e}", flush=True)

        try:
            cur_order_items = scur.execute("SELECT * FROM order_items ORDER BY id").fetchall()
            order_items = [dict(r) for r in cur_order_items]
        except Exception as e:
            print(f"      Warning: could not read order_items from SQLite: {e}", flush=True)

        sconn.close()
    elif catalog_path.exists():
        print(f"      Loading from JSON catalog: {catalog_path}", flush=True)
        cat_data = json.loads(catalog_path.read_text(encoding='utf-8'))
        categories = cat_data.get('categories', [])
        items = cat_data.get('items', [])
        suppliers = cat_data.get('suppliers', [])
        orders = cat_data.get('orders', [])
    else:
        raise FileNotFoundError(f"Neither SQLite database ({sqlite_path}) nor catalog ({catalog_path}) was found.")

    print(f"      -> {len(categories)} categories", flush=True)
    print(f"      -> {len(items)} products", flush=True)
    print(f"      -> {len(suppliers)} suppliers", flush=True)
    print(f"      -> {len(orders)} orders", flush=True)
    print(f"      -> {len(order_items)} order items", flush=True)

    print("\n[3/4] Inserting/Upserting records to Supabase...", flush=True)

    # Default shop settings
    cur.execute("""
        INSERT INTO shop_settings (shop_id, business_name, business_type, address, phone, email, kra_pin, tax_rate, tax_rate_confirmed)
        VALUES ('retail', 'BuildMart Hardware', 'hardware', 'Langata Road, Nairobi', '0712345678', 'info@buildmart.co.ke', 'P051234567X', 16, true)
        ON CONFLICT (shop_id) DO NOTHING;
    """)
    conn.commit()

    # 1. Categories (Match by name or id)
    cat_id_map = {}
    if categories:
        for c in categories:
            cur.execute("SELECT id FROM categories WHERE name = %s", (c['name'],))
            existing = cur.fetchone()
            if existing:
                cat_id_map[c['id']] = existing[0]
                cur.execute("""
                    UPDATE categories
                    SET sort_order = %s, business_type = %s, shop_id = 'retail'
                    WHERE id = %s
                """, (c.get('sort_order', 0), c.get('business_type', 'hardware'), existing[0]))
            else:
                cur.execute("""
                    INSERT INTO categories (name, sort_order, business_type, shop_id)
                    VALUES (%s, %s, %s, 'retail')
                    RETURNING id;
                """, (c['name'], c.get('sort_order', 0), c.get('business_type', 'hardware')))
                new_id = cur.fetchone()[0]
                cat_id_map[c['id']] = new_id
        cur.execute("SELECT setval(pg_get_serial_sequence('categories', 'id'), COALESCE(MAX(id), 1)) FROM categories;")
        conn.commit()
        print(f"      [OK] Migrated {len(categories)} categories", flush=True)

    # 2. Suppliers (Match by name)
    supp_id_map = {}
    if suppliers:
        for s in suppliers:
            cur.execute("SELECT id FROM suppliers WHERE name = %s", (s['name'],))
            existing = cur.fetchone()
            if existing:
                supp_id_map[s['id']] = existing[0]
                cur.execute("""
                    UPDATE suppliers
                    SET phone = %s, email = %s, address = %s, active = %s, shop_id = 'retail'
                    WHERE id = %s
                """, (s.get('phone', ''), s.get('email', ''), s.get('address', ''), s.get('active', 1), existing[0]))
            else:
                cur.execute("""
                    INSERT INTO suppliers (name, phone, email, address, active, shop_id)
                    VALUES (%s, %s, %s, %s, %s, 'retail')
                    RETURNING id;
                """, (s['name'], s.get('phone', ''), s.get('email', ''), s.get('address', ''), s.get('active', 1)))
                new_id = cur.fetchone()[0]
                supp_id_map[s['id']] = new_id
        cur.execute("SELECT setval(pg_get_serial_sequence('suppliers', 'id'), COALESCE(MAX(id), 1)) FROM suppliers;")
        conn.commit()
        print(f"      [OK] Migrated {len(suppliers)} suppliers", flush=True)

    # 3. Products / Menu items in batch
    if items:
        item_params = []
        for item in items:
            mapped_cat_id = cat_id_map.get(item.get('category_id'), item.get('category_id'))
            item_params.append((
                item['id'],
                'retail',
                mapped_cat_id,
                item['name'],
                item.get('price_cents', 0),
                item.get('cost_cents', 0),
                item.get('wholesale_price_cents', 0),
                item.get('stock_qty', 0),
                item.get('reorder_level', 5),
                item.get('sku', ''),
                item.get('barcode', ''),
                item.get('unit', 'pcs'),
                item.get('color', '#334155'),
                item.get('active', 1),
                item.get('batch_no', ''),
                item.get('expiry_date', '')
            ))

        psycopg2.extras.execute_batch(cur, """
            INSERT INTO menu_items (
                id, shop_id, category_id, name, price_cents, cost_cents,
                wholesale_price_cents, stock_qty, reorder_level, sku, barcode,
                unit, color, active, batch_no, expiry_date
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                category_id = EXCLUDED.category_id,
                name = EXCLUDED.name,
                price_cents = EXCLUDED.price_cents,
                cost_cents = EXCLUDED.cost_cents,
                stock_qty = EXCLUDED.stock_qty,
                reorder_level = EXCLUDED.reorder_level,
                sku = EXCLUDED.sku,
                barcode = EXCLUDED.barcode,
                unit = EXCLUDED.unit,
                color = EXCLUDED.color,
                active = EXCLUDED.active;
        """, item_params, page_size=200)

        cur.execute("SELECT setval(pg_get_serial_sequence('menu_items', 'id'), COALESCE(MAX(id), 1)) FROM menu_items;")
        conn.commit()
        print(f"      [OK] Migrated {len(items)} products", flush=True)

    # 4. Orders in batch
    if orders:
        cur.execute("SELECT data_type FROM information_schema.columns WHERE table_name='orders' AND column_name='created_at'")
        c_type_row = cur.fetchone()
        orders_int_ts = c_type_row and 'int' in c_type_row[0].lower()

        def convert_ts(val):
            if not val:
                return int(datetime.now(timezone.utc).timestamp()) if orders_int_ts else datetime.now(timezone.utc).isoformat()
            try:
                if isinstance(val, (int, float)):
                    ts_int = int(val)
                    return ts_int if orders_int_ts else datetime.fromtimestamp(ts_int, tz=timezone.utc).isoformat()
                if isinstance(val, str):
                    if val.isdigit():
                        ts_int = int(val)
                        return ts_int if orders_int_ts else datetime.fromtimestamp(ts_int, tz=timezone.utc).isoformat()
                    dt = datetime.fromisoformat(val.replace('Z', '+00:00'))
                    return int(dt.timestamp()) if orders_int_ts else val
            except Exception:
                pass
            return int(datetime.now(timezone.utc).timestamp()) if orders_int_ts else datetime.now(timezone.utc).isoformat()

        order_params = []
        for o in orders:
            ticket = o.get('ticket_no') or f"REC-{o['id']}"
            order_params.append((
                o['id'],
                'retail',
                ticket,
                o.get('order_type', 'walk-in'),
                o.get('customer_name', 'Walk-In Customer'),
                o.get('status', 'paid'),
                o.get('subtotal_cents', o.get('total_cents', 0)),
                o.get('discount_cents', 0),
                o.get('tax_rate', 0),
                o.get('tax_cents', 0),
                o.get('total_cents', 0),
                o.get('paid_cents', o.get('total_cents', 0)),
                o.get('payment_method', 'cash'),
                o.get('payment_ref', 'CASH'),
                1,  # created_by references users(id) = 1
                o.get('employee_name') or o.get('created_by') or 'POS Terminal',
                convert_ts(o.get('created_at')),
                convert_ts(o.get('updated_at'))
            ))

        psycopg2.extras.execute_batch(cur, """
            INSERT INTO orders (
                id, shop_id, ticket_no, order_type, customer_name,
                status, subtotal_cents, discount_cents, tax_rate, tax_cents,
                total_cents, paid_cents, payment_method, payment_ref,
                created_by, employee_name, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                status = EXCLUDED.status,
                total_cents = EXCLUDED.total_cents,
                paid_cents = EXCLUDED.paid_cents,
                payment_method = EXCLUDED.payment_method,
                updated_at = EXCLUDED.updated_at;
        """, order_params, page_size=200)

        cur.execute("SELECT setval(pg_get_serial_sequence('orders', 'id'), COALESCE(MAX(id), 1)) FROM orders;")
        conn.commit()
        print(f"      [OK] Migrated {len(orders)} orders", flush=True)

    # 5. Order items in batch
    if order_items:
        oi_params = []
        for it in order_items:
            oi_params.append((
                it['id'],
                it['order_id'],
                it.get('menu_item_id'),
                it.get('name', 'Item'),
                it.get('qty', 1),
                it.get('unit_price_cents', 0),
                it.get('line_total_cents', 0),
                it.get('note', '')
            ))

        psycopg2.extras.execute_batch(cur, """
            INSERT INTO order_items (
                id, order_id, menu_item_id, name, qty,
                unit_price_cents, line_total_cents, note
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                qty = EXCLUDED.qty,
                unit_price_cents = EXCLUDED.unit_price_cents,
                line_total_cents = EXCLUDED.line_total_cents;
        """, oi_params, page_size=200)

        cur.execute("SELECT setval(pg_get_serial_sequence('order_items', 'id'), COALESCE(MAX(id), 1)) FROM order_items;")
        conn.commit()
        print(f"      [OK] Migrated {len(order_items)} order items", flush=True)

    print("\n[4/4] Verification...", flush=True)
    for table in ['shop_settings', 'categories', 'menu_items', 'suppliers', 'orders', 'order_items', 'etims_queue']:
        cur.execute(f"SELECT COUNT(*) FROM {table}")
        count = cur.fetchone()[0]
        print(f"      {table}: {count} records in Supabase", flush=True)

    conn.close()
    print("\nMigration completed successfully!", flush=True)


def main():
    parser = argparse.ArgumentParser(description="Migrate SQLite POS database to Supabase PostgreSQL")
    parser.add_argument('--sqlite', type=Path, default=DEFAULT_SQLITE_PATH, help="Path to pos.sqlite3")
    parser.add_argument('--catalog', type=Path, default=DEFAULT_CATALOG_PATH, help="Path to buildmart_catalog.json")
    parser.add_argument('--pg-url', type=str, default=os.environ.get('DATABASE_URL') or os.environ.get('POSTGRES_URL'), help="PostgreSQL connection string")
    args = parser.parse_args()

    pg_url = args.pg_url
    if not pg_url:
        pg_url = "postgresql://postgres.iyfebdvtcryjxitizuwb:8045%40JohnWakaba@aws-1-eu-west-1.pooler.supabase.com:6543/postgres"

    if not HAVE_PSYCOPG2:
        print("ERROR: psycopg2 is required. Run: pip install psycopg2-binary")
        sys.exit(1)

    try:
        migrate_via_postgres(pg_url, args.sqlite, args.catalog)
    except Exception as e:
        print(f"\nMigration failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
