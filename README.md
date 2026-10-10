# POS_2 — Multi-Profile Business Point of Sale System

A powerful, lightweight Point of Sale (POS) system built with **Python 3**, **SQLite**, **HTML5**, **CSS3**, and **Vanilla JavaScript**. Designed to support multiple business types from a single unified codebase with zero heavy dependencies or external frameworks.

---

## 🏢 Supported Business Profiles

Switch instantly between 6 specialized business profiles via a 1-click setting or directly from the login screen:

1. **🛒 Retail / Mini-Mart**: Barcodes, stock inventory, supplier receiving, low-stock & reorder alerts.
2. **💊 Pharmacy**: Batch tracking, expiry countdown & alerts, drug strengths, manufacturer notes.
3. **🍽️ Restaurant / Café**: Table/Tab management, waiter assignment, KOT kitchen printing, dine-in vs takeaway.
4. **🔨 Hardware**: Decimal quantities (e.g. 2.5 kg, 3.2 m), extended units, quotations, wholesale & retail pricing tiers.
5. **👗 Boutique / Cosmetics**: Product variants (sizes, colors, shades) with variant-level stock pickers.
6. **🍸 Bar / Nightclub**: Open tabs, server assignment, nightclub ticket receipts, hospitality flow.

---

## ✨ Features

- **Multi-Profile Architecture**: Unified codebase supporting 6 distinct shop profiles with pre-seeded sample catalogs.
- **📷 Barcode Scanning & Adding**:
  - **POS Page**: Dedicated barcode scan button and direct search bar scanning. Instantly verifies and adds matching items to the cart with cash-register audio chimes.
  - **Products Page**: Barcode button to scan physical barcodes, auto-detecting existing items or auto-filling new product forms.
  - **Hardware & Camera Support**: Real-time camera video viewfinder (`BarcodeDetector` API) plus auto-detection for handheld USB/Bluetooth barcode guns.
- **🔍 1-Click Online Image Search**: Built-in product photo search automatically optimized and resized using Pillow (`static/uploads/`).
- **🎨 Modern Neutral Monochrome Theme**: Crisp black, white, and shades of grey with 1-click **Light/Dark Mode toggle** (`☀️ / 🌙`).
- **Comprehensive Back-Office**:
  - Inventory management & stock adjustment
  - Supplier purchases and accounts
  - Sales history, receipt reprinting & payment logs
  - Staff management with role-based access (Cashier, Manager, Admin)
  - Daily & monthly sales analytics dashboard

---

## 🚀 Quick Start

### 1. Clone the Repository
```bash
git clone git@github.com:SK108045/POS_2.git
cd POS_2
```

### 2. Install Requirements
```bash
pip install pillow
```

### 3. Run the Application
```bash
python3 app.py
```

The application will start at:
```
http://127.0.0.1:3000
```

To run on a custom port:
```bash
POS_PORT=8080 python3 app.py
```

---

## 🔑 Default Credentials

| Portal | URL | Default Credentials |
| :--- | :--- | :--- |
| **POS Terminal** | `/login` or `/pos` | Staff PIN: `1234` |
| **Admin Portal** | `/admin` | Username: `admin`<br>Password: `admin123` |
| **Cashier Portal** | `/cashier` | Username: `admin`<br>Password: `admin123` |

---

## 📂 Project Structure

```text
.
├── app.py                # Main backend server & HTTP API routes
├── profiles.py           # Multi-profile definitions, capabilities & seeding
├── README.md             # Project documentation
├── start-pos.bat         # Windows quick-launch script
├── data/
│   └── pos.sqlite3       # SQLite database with pre-configured catalogs
└── static/
    ├── app.js            # Frontend POS application logic & barcode scanner
    ├── admin.js          # Admin dashboard & reporting logic
    ├── styles.css        # POS styling & light/dark monochrome theme
    ├── admin.css         # Admin portal styling
    └── uploads/          # Pillow-optimized product images
```

---

## 📄 License

MIT License. Open for personal and commercial point of sale deployments.


## Android APK architecture

### Chrome eTIMS integration

The active browser POS includes an optional **Generate eTIMS Invoice** checkout flow and the **Oraforge eTIMS Companion** extension in `chrome-extension/`. Load that folder unpacked in Chrome, then reload the POS. The extension prepares the existing KRA eCitizen popup for cashier review, captures official invoice details, and adds them to the existing branded receipt. Admin → eTIMS supports pending/generated records, uncertain-attempt recovery, manual CU entry and reprints.

See [installation, recovery rules and the required live KRA testing checklist](docs/ETIMS-INTEGRATION.md). Automated tests use a synthetic portal; authenticated KRA field mappings and printer output still need live verification.

The Android build is offline-first. The Capacitor WebView bundles the POS UI locally and stores operational data on-device using native SQLite (`@capacitor-community/sqlite`) with an IndexedDB fallback for browser testing. Core sales do not require a Python server or internet connection. Network-only integrations such as SMS, cloud sync, remote image search and future M-Pesa integrations should call a remote HTTPS backend so API secrets are never bundled in the APK.

### Single-machine backups (browser preview)

- **Settings → Backup & restore** downloads a versioned JSON export of local database records and shop-selection preferences. The browser uses IndexedDB; the APK bridge uses SQLite. This is a logical data export, not a copy of the separate Flask `data/pos.sqlite3` database.
- Restore replaces all local shops, after validation and confirmation, downloads a safety copy first, and signs out. Close other POS tabs before restoring. Keep backups on a USB drive or another safe location; manual downloads and daily PC backups are local, not cloud backups.
- API key files and image files referenced by URL/path are not embedded in the export. Retain the application files (including uploads) separately. Images stored inside database records remain included.
- This workflow is wired into `capacitor/www` used by `start-apk-browser.sh`. The separate legacy Flask interface is not changed by these features.

### Automatic backups on PC

While a POS or Admin page is open, changed data is backed up every minute, on focus, and after completed checkout. Unchanged snapshots are skipped. The browser cannot back up its data while closed.

The project-root `backups/` folder contains `latest.json`, the most recent snapshot for each day as `daily-YYYY-MM-DD.json`, and the 60 most recent timestamped `auto-*.json` versions. Daily files are retained indefinitely. Writes use temporary files and atomic rename. Restore any of these through Settings → Backup & restore. Copy backups to a USB drive or another computer to protect against drive failure; separate image/configuration files must also be retained. Restart the local server after updating the backup code. The APK does not load this PC scheduler.

Registered-shop Staff changes now control login: active staff/cashiers use a unique 4–6 digit PIN; active managers use a password of 8–128 characters. Changing credentials invalidates the old ones on the next login; disabling staff prevents their next login. Already-open sessions are not forcibly signed out. Blank passwords on an existing unchanged role preserve the current credential. The original owner account must remain an active manager.


### Garage & Auto Spares profile

Choose **Garage & Auto Spares** when registering a shop. It includes garage categories, parts stock tracking, quotations and workshop services. In the product editor, choose **Service / Labour (no stock)** for labour or diagnostics; these items can be sold without a stock balance and are excluded from inventory alerts and deductions. Item instructions can record a vehicle registration, model or repair details.

The Garage demo profile includes six sample spare parts and two workshop services, with bundled catalogue photos that work offline. Demo prices and quantities are illustrative. Registered garages start with empty stock and the seven garage categories so demo products do not appear as real inventory.

## Verified M-Pesa STK checkout (Capacitor browser preview)

Run the up-to-date Node browser preview with `./start-apk-browser.sh` (port 3000 by default). The POS M-Pesa checkout now **automatically polls Swifta after the STK prompt** and opens its existing receipt only after a verified successful transaction. There is no manual "Confirmed Payment" button. Cash sales are unchanged. A payment that fails, times out or cannot be verified stays unpaid.

### Required provider configuration

- Put the Swifta API key in the server-side `swifta.txt` file at the repository root, or update it from the POS login with `0788778450`. The update directly overwrites `swifta.txt` and takes effect on the next STK request. The server does not expose the key to browser JavaScript. Do not commit credentials to Git.
- The Node server sends requests to `https://app.swifta.co.ke/stkpush` and checks `https://app.swifta.co.ke/poll/{CheckoutRequestID}` over HTTPS. Accepted STK requests alone never count as payment. A valid M-Pesa receipt and matching transaction correlation are required.
- Pending attempts are saved under `data/swifta-attempts.json`, ignored by git, and survive Node restarts. Keep this file with your local shop backups; the browser POS orders remain stored in the shop-scoped local database.
- On a **public HTTPS backend only**, point Swifta's signed event webhook to `https://YOUR-PUBLIC-HTTPS-HOST/api/swifta/webhook`, with environment variable `SWIFTA_WEBHOOK_SECRET` matching the Swifta signing secret (default header: `X-Swifta-Signature`). Alternatively use `https://YOUR-PUBLIC-HTTPS-HOST/api/swifta/callback?token=YOUR_SECRET` and configure `SWIFTA_CALLBACK_TOKEN`. Do not register localhost as an external webhook URL. A signed webhook is preferred to a URL token.
- Browser checkout can still auto-verify by polling the **server-side** endpoint `GET /api/swifta/status?attempt=<server-generated-id>` when no inbound webhook is reachable. The browser never trusts its own "success" message or updates inventory before independent verification.
- The Android APK uses the official Swifta poll endpoint via `window.OraforgeProviders.paymentStatus` and must be **rebuilt** to include this provider method. The separate legacy Python `app.py` server is not this Node checkout flow.

**Operational notes:** Both status polling and callbacks require network access. If Swifta cannot confirm a result, **do not resend another STK push blindly**; first reconcile in the Swifta dashboard. The M-Pesa receipt code, not the payer's phone number, is stored as the transaction reference. A signed webhook cannot reach a laptop through `localhost`; it needs a live HTTPS reverse proxy/server.

### Replace Swifta key during local onboarding

On the **Ubuntu browser POS**, enter `0788778450` on the registered-shop login keypad. In the dialog, paste the replacement Swifta API key and click **Save Key**. The local Node server immediately overwrites the repository-root `swifta.txt` file; no `SWIFTA_SETUP_TOKEN`, additional password, or restart is needed **after** the new key is saved. The number is a convenience shortcut, not strong authentication: use the feature only on your own trusted computer. The replacement API key is not transmitted to GitHub. Do not commit `swifta.txt` or share the key.
