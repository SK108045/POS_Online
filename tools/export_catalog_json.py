import json
from pathlib import Path
from datetime import datetime, timezone
import psycopg2
import psycopg2.extras

PG_URL = "postgresql://postgres.iyfebdvtcryjxitizuwb:8045%40JohnWakaba@aws-1-eu-west-1.pooler.supabase.com:6543/postgres"

def main():
    conn = psycopg2.connect(PG_URL)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute('SELECT * FROM pos.categories ORDER BY sort_order, id')
    cats = cur.fetchall()
    cur.execute('SELECT * FROM pos.menu_items WHERE active = 1 ORDER BY id')
    items = cur.fetchall()
    cur.execute('SELECT * FROM pos.suppliers WHERE active = 1 ORDER BY id')
    supps = cur.fetchall()
    cur.execute('SELECT * FROM pos.shop_settings LIMIT 1')
    set_row = cur.fetchone()

    def ser(o):
        if hasattr(o, 'isoformat'):
            return o.isoformat()
        return str(o)

    cat_payload = {
        'shop_name': set_row.get('business_name', 'BuildMart Hardware') if set_row else 'BuildMart Hardware',
        'business_type': set_row.get('business_type', 'hardware') if set_row else 'hardware',
        'categories': [dict(c) for c in cats],
        'items': [dict(i) for i in items],
        'suppliers': [dict(s) for s in supps],
        'synced_at': datetime.now(timezone.utc).isoformat()
    }
    targets = [
        Path('capacitor/www/buildmart_catalog.json'),
        Path('dist/windows/OraforgePOS/app/capacitor/www/buildmart_catalog.json'),
    ]
    for p in targets:
        if p.parent.exists():
            p.write_text(json.dumps(cat_payload, indent=2, default=ser), encoding='utf-8')
            print(f"Wrote {len(items)} items to {p}")
    conn.close()

if __name__ == '__main__':
    main()
