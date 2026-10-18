"""
Oraforge POS - Migration Pipeline: 'public' to 'pos' Schema
------------------------------------------------------------
Transfers all catalog, suppliers, customers, and order history from the
client's existing `public` tables into the dedicated `pos` schema in Supabase.

Zero disruption: leaves all `public.*` tables untouched and pristine.
Automatically updates identity sequences to ensure smooth POS operation.
"""

import json
import os
from pathlib import Path
import sys

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

import psycopg2
import psycopg2.extras


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
MIGRATION_SQL = REPO_ROOT / "supabase" / "migrations" / "001_initial_schema.sql"
CATALOG_JSON = REPO_ROOT / "capacitor" / "www" / "buildmart_catalog.json"

PG_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres.iyfebdvtcryjxitizuwb:8045%40JohnWakaba@aws-1-eu-west-1.pooler.supabase.com:6543/postgres"
)


def run_migration():
    print("=" * 70)
    print("   ORAFORGE POS: MIGRATING DATA TO DEDICATED 'pos' SCHEMA")
    print("=" * 70)

    print(f"\n[1/6] Connecting to Supabase database...")
    try:
        conn = psycopg2.connect(PG_URL)
        conn.autocommit = False
    except Exception as e:
        print(f"[ERROR] Failed to connect to Supabase: {e}")
        sys.exit(1)

    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # 1. Apply DDL
    print("[2/6] Applying DDL migration (creating pos.* tables & RLS policies)...")
    if MIGRATION_SQL.exists():
        sql_content = MIGRATION_SQL.read_text(encoding="utf-8")
        try:
            cur.execute(sql_content)
            conn.commit()
            print("  [OK] 'pos' schema tables and permissions created/verified.")
        except Exception as e:
            conn.rollback()
            print(f"[ERROR] Failed applying schema migration: {e}")
            sys.exit(1)
    else:
        print(f"⚠️ Migration SQL not found at {MIGRATION_SQL}")

    # 2. Migrate Shop Settings
    print("[3/6] Migrating Shop Settings...")
    cur.execute("SELECT * FROM public.shop_settings LIMIT 1")
    setting = cur.fetchone()
    if setting:
        cur.execute("""
            INSERT INTO pos.shop_settings (
                shop_id, business_name, business_type, kra_pin, address, phone, email,
                receipt_footer, tax_rate, tax_rate_confirmed, updated_at
            ) VALUES (
                %(shop_id)s, %(business_name)s, %(business_type)s, %(kra_pin)s, %(address)s, %(phone)s, %(email)s,
                %(receipt_footer)s, %(tax_rate)s, %(tax_rate_confirmed)s, %(updated_at)s
            ) ON CONFLICT (shop_id) DO UPDATE SET
                business_name = EXCLUDED.business_name,
                business_type = EXCLUDED.business_type,
                kra_pin = EXCLUDED.kra_pin,
                address = EXCLUDED.address,
                phone = EXCLUDED.phone,
                email = EXCLUDED.email,
                receipt_footer = EXCLUDED.receipt_footer,
                tax_rate = EXCLUDED.tax_rate,
                tax_rate_confirmed = EXCLUDED.tax_rate_confirmed,
                updated_at = NOW();
        """, setting)
        conn.commit()
        print(f"  [OK] Settings migrated: {setting.get('business_name')} ({setting.get('shop_id')})")
    else:
        cur.execute("""
            INSERT INTO pos.shop_settings (shop_id, business_name, business_type, kra_pin)
            VALUES ('retail', 'BuildMart Hardware', 'hardware', 'P051234567X')
            ON CONFLICT (shop_id) DO NOTHING;
        """)
        conn.commit()
        print("  [OK] Default shop settings initialized.")

    # 3. Migrate Categories
    print("[4/6] Migrating Categories & Suppliers...")
    cur.execute("SELECT * FROM public.categories ORDER BY id")
    categories = cur.fetchall()
    migrated_cats = 0
    for cat in categories:
        cur.execute("""
            INSERT INTO pos.categories (id, shop_id, name, sort_order, business_type, created_at)
            VALUES (%(id)s, COALESCE(%(shop_id)s, 'retail'), %(name)s, COALESCE(%(sort_order)s, 0), COALESCE(%(business_type)s, 'hardware'), COALESCE(%(created_at)s, NOW()))
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                sort_order = EXCLUDED.sort_order,
                business_type = EXCLUDED.business_type;
        """, cat)
        migrated_cats += 1
    conn.commit()
    print(f"  [OK] {migrated_cats} categories migrated to pos.categories.")

    # 4. Migrate Suppliers
    cur.execute("SELECT * FROM public.suppliers ORDER BY id")
    suppliers = cur.fetchall()
    migrated_supps = 0
    for supp in suppliers:
        cur.execute("""
            INSERT INTO pos.suppliers (id, shop_id, name, phone, email, address, active, created_at)
            VALUES (%(id)s, COALESCE(%(shop_id)s, 'retail'), %(name)s, COALESCE(%(phone)s, ''), COALESCE(%(email)s, ''), COALESCE(%(address)s, ''), COALESCE(%(active)s, 1), COALESCE(%(created_at)s, NOW()))
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                phone = EXCLUDED.phone,
                email = EXCLUDED.email,
                address = EXCLUDED.address,
                active = EXCLUDED.active;
        """, supp)
        migrated_supps += 1
    conn.commit()
    print(f"  [OK] {migrated_supps} suppliers migrated to pos.suppliers.")

    # 5. Migrate Menu Items (Products)
    print("[5/6] Migrating Menu Items (Products)...")
    cur.execute("SELECT * FROM public.menu_items ORDER BY id")
    products = cur.fetchall()
    migrated_items = 0
    for item in products:
        cur.execute("""
            INSERT INTO pos.menu_items (
                id, shop_id, category_id, supplier_id, name, price_cents, cost_cents,
                wholesale_price_cents, stock_qty, reorder_level, sku, barcode, unit,
                color, active, batch_no, expiry_date, manufacturer, strength,
                variants_json, decimal_qty_enabled, image_url, tax_code, created_at, updated_at
            ) VALUES (
                %(id)s, COALESCE(%(shop_id)s, 'retail'), %(category_id)s, %(supplier_id)s, %(name)s,
                COALESCE(%(price_cents)s, 0), COALESCE(%(cost_cents)s, 0),
                COALESCE(%(wholesale_price_cents)s, 0), COALESCE(%(stock_qty)s, 0),
                COALESCE(%(reorder_level)s, 5), COALESCE(%(sku)s, ''), COALESCE(%(barcode)s, ''),
                COALESCE(%(unit)s, 'pcs'), COALESCE(%(color)s, '#334155'), COALESCE(%(active)s, 1),
                COALESCE(%(batch_no)s, ''), COALESCE(%(expiry_date)s, ''), COALESCE(%(manufacturer)s, ''),
                COALESCE(%(strength)s, ''), COALESCE(%(variants_json)s, ''), COALESCE(%(decimal_qty_enabled)s, 0),
                COALESCE(%(image_url)s, ''), COALESCE(%(tax_code)s, 'D'),
                COALESCE(%(created_at)s, NOW()), COALESCE(%(updated_at)s, NOW())
            ) ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                category_id = EXCLUDED.category_id,
                supplier_id = EXCLUDED.supplier_id,
                price_cents = EXCLUDED.price_cents,
                cost_cents = EXCLUDED.cost_cents,
                wholesale_price_cents = EXCLUDED.wholesale_price_cents,
                stock_qty = EXCLUDED.stock_qty,
                reorder_level = EXCLUDED.reorder_level,
                sku = EXCLUDED.sku,
                barcode = EXCLUDED.barcode,
                unit = EXCLUDED.unit,
                color = EXCLUDED.color,
                active = EXCLUDED.active,
                batch_no = EXCLUDED.batch_no,
                expiry_date = EXCLUDED.expiry_date,
                manufacturer = EXCLUDED.manufacturer,
                strength = EXCLUDED.strength,
                variants_json = EXCLUDED.variants_json,
                decimal_qty_enabled = EXCLUDED.decimal_qty_enabled,
                image_url = EXCLUDED.image_url,
                tax_code = EXCLUDED.tax_code,
                updated_at = NOW();
        """, item)
        migrated_items += 1
    conn.commit()
    print(f"  [OK] {migrated_items} products migrated to pos.menu_items.")

    # 6. Migrate Customers
    cur.execute("SELECT * FROM public.customers ORDER BY id")
    customers = cur.fetchall()
    migrated_customers = 0
    for cust in customers:
        cur.execute("""
            INSERT INTO pos.customers (id, shop_id, name, pin, phone, email, address, notes)
            VALUES (%(id)s, COALESCE(%(shop_id)s, 'retail'), %(name)s, COALESCE(%(pin)s, ''), COALESCE(%(phone)s, ''), COALESCE(%(email)s, ''), COALESCE(%(notes)s, ''), COALESCE(%(notes)s, ''))
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                pin = EXCLUDED.pin,
                phone = EXCLUDED.phone,
                email = EXCLUDED.email;
        """, cust)
        migrated_customers += 1
    conn.commit()
    if migrated_customers > 0:
        print(f"  [OK] {migrated_customers} customers migrated to pos.customers.")

    # 7. Migrate Orders and Line Items
    print("[6/6] Migrating Sales Orders & Aligning Sequences...")
    cur.execute("SELECT * FROM public.orders ORDER BY id ASC")
    orders = cur.fetchall()
    migrated_orders = 0
    for o in orders:
        cur.execute("""
            INSERT INTO pos.orders (
                id, shop_id, ticket_no, supplier_id, order_type, customer_name,
                status, subtotal_cents, tax_cents, total_cents, paid_cents,
                payment_method, payment_ref, created_by,
                customer_kra_pin, customer_phone, customer_email, customer_billing_address, customer_remarks,
                discount_cents, discount_type, discount_value, tax_rate, tax_treatment,
                employee_name, table_name, notes, etims_requested, etims_status,
                cu_invoice_number, scu_id, receipt_signature, internal_data, qr_image,
                invoice_number, invoice_date, fiscal_day_count
            ) VALUES (
                %(id)s, COALESCE(%(shop_id)s, 'retail'), %(ticket_no)s, %(supplier_id)s, COALESCE(%(order_type)s, 'walk-in'), COALESCE(%(customer_name)s, 'Walk-In Customer'),
                COALESCE(%(status)s, 'paid'), COALESCE(%(subtotal_cents)s, 0), COALESCE(%(tax_cents)s, 0), COALESCE(%(total_cents)s, 0), COALESCE(%(paid_cents)s, 0),
                COALESCE(%(payment_method)s, 'cash'), COALESCE(%(payment_ref)s, 'CASH'), COALESCE(%(created_by)s, 1),
                COALESCE(%(customer_kra_pin)s, ''), COALESCE(%(customer_phone)s, ''), COALESCE(%(customer_email)s, ''), COALESCE(%(customer_billing_address)s, ''), COALESCE(%(customer_remarks)s, ''),
                COALESCE(%(discount_cents)s, 0), COALESCE(%(discount_type)s, 'fixed'), COALESCE(%(discount_value)s, 0), COALESCE(%(tax_rate)s, 0), COALESCE(%(tax_treatment)s, 'non_vat'),
                COALESCE(%(employee_name)s, 'POS Terminal'), COALESCE(%(table_name)s, ''), COALESCE(%(notes)s, ''), COALESCE(%(etims_requested)s, FALSE), COALESCE(%(etims_status)s, 'pending'),
                COALESCE(%(cu_invoice_number)s, ''), COALESCE(%(scu_id)s, ''), COALESCE(%(receipt_signature)s, ''), COALESCE(%(internal_data)s, ''), COALESCE(%(qr_image)s, ''),
                COALESCE(%(invoice_number)s, ''), COALESCE(%(invoice_date)s, ''), COALESCE(%(fiscal_day_count)s, '')
            ) ON CONFLICT (id) DO UPDATE SET
                status = EXCLUDED.status,
                cu_invoice_number = EXCLUDED.cu_invoice_number,
                scu_id = EXCLUDED.scu_id,
                receipt_signature = EXCLUDED.receipt_signature,
                internal_data = EXCLUDED.internal_data,
                qr_image = EXCLUDED.qr_image,
                invoice_number = EXCLUDED.invoice_number,
                invoice_date = EXCLUDED.invoice_date,
                fiscal_day_count = EXCLUDED.fiscal_day_count;
        """, o)
        migrated_orders += 1
    conn.commit()
    print(f"  [OK] {migrated_orders} orders migrated to pos.orders.")

    # Order items
    cur.execute("SELECT * FROM public.order_items ORDER BY id ASC")
    order_items = cur.fetchall()
    migrated_items_count = 0
    for oi in order_items:
        cur.execute("""
            INSERT INTO pos.order_items (
                id, order_id, menu_item_id, name, qty, unit_price_cents, line_total_cents,
                tax_code, discount_amount_cents, discount_rate, variant_info, batch_no, note
            ) VALUES (
                %(id)s, %(order_id)s, %(menu_item_id)s, %(name)s, %(qty)s, %(unit_price_cents)s, %(line_total_cents)s,
                COALESCE(%(tax_code)s, 'D'), COALESCE(%(discount_amount_cents)s, 0), COALESCE(%(discount_rate)s, 0),
                COALESCE(%(variant_info)s, ''), COALESCE(%(batch_no)s, ''), COALESCE(%(note)s, '')
            ) ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                qty = EXCLUDED.qty,
                unit_price_cents = EXCLUDED.unit_price_cents,
                line_total_cents = EXCLUDED.line_total_cents;
        """, oi)
        migrated_items_count += 1
    conn.commit()
    print(f"  [OK] {migrated_items_count} order line items migrated to pos.order_items.")

    # Align primary key identity sequences
    seq_tables = [
        ('pos.categories', 'id'),
        ('pos.suppliers', 'id'),
        ('pos.menu_items', 'id'),
        ('pos.customers', 'id'),
        ('pos.orders', 'id'),
        ('pos.order_items', 'id'),
        ('pos.etims_queue', 'id'),
    ]
    for tbl, col in seq_tables:
        try:
            cur.execute(f"SELECT setval(pg_get_serial_sequence('{tbl}', '{col}'), COALESCE(MAX({col}), 1) + 1, false) FROM {tbl};")
            conn.commit()
        except Exception as e:
            conn.rollback()
            print(f"  [INFO] Note sequence align for {tbl}: {e}")

    # Update buildmart_catalog.json for browser offline fallback
    try:
        from datetime import datetime, timezone
        cur.execute("SELECT * FROM pos.categories ORDER BY sort_order, id")
        cats_data = cur.fetchall()
        cur.execute("SELECT * FROM pos.menu_items WHERE active = 1 ORDER BY id")
        items_data = cur.fetchall()
        cur.execute("SELECT * FROM pos.suppliers WHERE active = 1 ORDER BY id")
        supps_data = cur.fetchall()

        def default_serializer(o):
            if hasattr(o, 'isoformat'):
                return o.isoformat()
            return str(o)

        catalog_payload = {
            "shop_name": setting.get('business_name', 'BuildMart Hardware') if setting else 'BuildMart Hardware',
            "business_type": setting.get('business_type', 'hardware') if setting else 'hardware',
            "categories": [dict(c) for c in cats_data],
            "items": [dict(i) for i in items_data],
            "suppliers": [dict(s) for s in supps_data],
            "synced_at": datetime.now(timezone.utc).isoformat()
        }

        CATALOG_JSON.parent.mkdir(parents=True, exist_ok=True)
        CATALOG_JSON.write_text(json.dumps(catalog_payload, indent=2, default=default_serializer), encoding="utf-8")
        print(f"  [OK] Updated offline browser catalog: {CATALOG_JSON} ({len(items_data)} items)")
    except Exception as e:
        print(f"  [INFO] Could not update buildmart_catalog.json: {e}")

    conn.close()

    print("\n" + "=" * 70)
    print("   [SUCCESS] MIGRATION TO DEDICATED 'pos' SCHEMA COMPLETED!")
    print(f"   Categories:  {migrated_cats}")
    print(f"   Suppliers:   {migrated_supps}")
    print(f"   Products:    {migrated_items}")
    print(f"   Customers:   {migrated_customers}")
    print(f"   Orders:      {migrated_orders} ({migrated_items_count} items)")
    print("   Public tables were left completely untouched.")
    print("=" * 70)


if __name__ == "__main__":
    run_migration()
