# Oraforge Online POS: Vercel & Supabase Deployment Guide

This guide explains how to deploy the **Online POS Application to Vercel**, connect it to **Supabase Cloud Database**, and run the **Local eTIMS Invoice Generator (`EtimsFastInvoiceGenerator.exe`)** on your Windows store PC.

---

## 🏛️ System Architecture

```
                    ┌────────────────────────────────────────────────────────┐
                    │                   VERCEL CLOUD                         │
                    │  • Web POS Frontend (Cashier, Products, Sales, Admin)  │
                    │  • Serverless API Router (/api/bootstrap, /api/orders) │
                    └───────────────────────────┬────────────────────────────┘
                                                │
                                    REST API / Database Pool
                                                │
                                                ▼
                    ┌────────────────────────────────────────────────────────┐
                    │                 SUPABASE POSTGRESQL                    │
                    │  • 831 Products, Categories, Stock, Orders             │
                    │  • Cloud eTIMS Queue (etims_queue)                     │
                    └───────────────────────────▲────────────────────────────┘
                                                │
                                  Cloud Queue Worker Bridge
                                                │
                                                ▼
                    ┌────────────────────────────────────────────────────────┐
                    │            WINDOWS STORE PC (LOCAL MACHINE)            │
                    │  • Start-Local-eTIMS-Worker.cmd (Python Worker)        │
                    │  • EtimsFastInvoiceGenerator.exe (High-Speed Engine)   │
                    │  • Local KRA eTIMS SQLite Database (RRA_EBM2x.db)      │
                    └────────────────────────────────────────────────────────┘
```

1. **Online POS (Vercel)**:
   - Cashiers can open the POS from any browser, tablet, or PC using your Vercel URL (`https://your-pos.vercel.app`).
   - All transactions, stock counts, and sales history synchronize directly to Supabase.
2. **Local eTIMS Worker (Windows PC)**:
   - When a sale is completed with eTIMS requested, the Online POS queues the request in Supabase `etims_queue`.
   - The local worker on your store PC picks up the job within 1-2 seconds, signs it with `EtimsFastInvoiceGenerator.exe` against the KRA keys/eTIMS Paypoint database, generates the official KRA QR Code, and writes the confirmation back to Supabase.
   - The POS receipt automatically displays the official **CU Invoice Number**, **Receipt Signature**, and **KRA QR Code**!

---

## 🚀 Step 1: Set Up Supabase Database

1. Go to [https://supabase.com](https://supabase.com) and create a new project.
2. Under **Project Settings -> API**, copy:
   - **Project URL** (`https://<project-ref>.supabase.co`)
   - **anon public key** (`eyJh...`)
   - **service_role key** (`eyJh...`)
3. Under **Project Settings -> Database**, copy:
   - **Connection string (URI)** (`postgresql://postgres.<ref>:<password>@aws-...pooler.supabase.com:6543/postgres`)
4. Open the **SQL Editor** in Supabase and run the schema file:
   - Copy the SQL from `Online-POS/supabase/migrations/001_initial_schema.sql` and run it.

---

## 📦 Step 2: Migrate SQLite Data to Supabase

Run the migration script to copy all 831 products, categories, suppliers, and sales history from your local SQLite database (`data/pos.sqlite3`) into Supabase:

### Method A (Double-Click):
1. In the `Online-POS` folder, copy `.env.example` to `.env`.
2. Open `.env` in Notepad and paste your Supabase URL and keys (or `DATABASE_URL`).
3. Double-click `Run-Migration-To-Supabase.cmd`.

### Method B (Command Line):
```bash
python tools/migrate_sqlite_to_supabase.py --pg-url "postgresql://postgres.<project>:<password>@...pooler.supabase.com:6543/postgres"
```

The script will confirm:
- `✓ Migrated 7 categories`
- `✓ Migrated 5 suppliers`
- `✓ Migrated 831 products`
- `✓ Migrated 787 orders`
- `✓ Migrated 2699 order items`

---

## 🌐 Step 3: Deploy to Vercel

### Method A: Deploy via GitHub (Recommended)
1. Initialize a git repository for `Online-POS` and push to your GitHub account:
   ```bash
   cd Online-POS
   git init
   git add .
   git commit -m "Initial commit for Online POS"
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
2. Log into [vercel.com](https://vercel.com) and click **Add New -> Project**.
3. Import your new repository.
4. In the **Environment Variables** section, add:
   - `SUPABASE_URL` = your Supabase Project URL (`https://xyz.supabase.co`)
   - `SUPABASE_ANON_KEY` = your Supabase anon key
   - `SUPABASE_SERVICE_ROLE_KEY` = your Supabase service_role key
5. Click **Deploy**. Vercel will build and launch your Online POS!

### Method B: Deploy using Vercel CLI
```bash
npm install -g vercel
cd Online-POS
vercel
```
Follow the prompts to link and deploy your project.

---

## 🖥️ Step 4: Run the Local eTIMS Worker on the Store PC

On the Windows store PC where the KRA eTIMS Paypoint software is installed:

1. Ensure the `Online-POS/.env` file has your `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (or `DATABASE_URL`).
2. Double-click:
   ```
   Start-Local-eTIMS-Worker.cmd
   ```
3. A command window will open with:
   ```
   ======================================================================
         ORAFORGE LOCAL eTIMS FISCAL WORKER (ONLINE POS BRIDGE)
   ======================================================================
   Fast Engine Executable : ...\EtimsFastInvoiceGenerator.exe
   Target Shop ID         : retail
   Polling Interval       : 2.0s
   Status                 : ACTIVE & READY FOR INCOMING SALES
   ======================================================================
   Listening for online POS transactions. Press Ctrl+C to stop.
   ```
4. Keep this window running in the background while the store is open.

---

## 🧾 Step 5: Test Fiscal Invoicing from Online POS

1. Open your Vercel URL (e.g. `https://your-pos.vercel.app/pos`) on any device.
2. Add products to the ticket.
3. Click **Pay / Checkout**.
4. Check **Generate eTIMS Invoice** (fill in buyer name / PIN if required).
5. Complete payment:
   - The Online POS records the sale in Supabase.
   - The local worker automatically detects the job, signs it with `EtimsFastInvoiceGenerator.exe` in under 200ms, and uploads the KRA fiscal details and QR code.
   - The receipt dialog renders immediately with the official **CU Invoice Number**, **Receipt Signature**, and **KRA QR Code**!
