import psycopg2
import sys

PG_URL = "postgresql://postgres.iyfebdvtcryjxitizuwb:8045%40JohnWakaba@aws-1-eu-west-1.pooler.supabase.com:6543/postgres"

def main():
    try:
        conn = psycopg2.connect(PG_URL)
        cur = conn.cursor()
        tables = ['shop_settings', 'categories', 'suppliers', 'menu_items', 'customers', 'orders', 'order_items', 'etims_queue']
        print("=== Schema 'pos' Table Row Counts ===")
        for tbl in tables:
            cur.execute(f"SELECT count(*) FROM pos.{tbl};")
            cnt = cur.fetchone()[0]
            print(f"  pos.{tbl:<15} : {cnt:>6} rows")
        conn.close()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
