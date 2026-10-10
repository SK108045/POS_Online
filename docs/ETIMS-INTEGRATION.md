# Oraforge eTIMS Companion

Implemented on `improved-ui` for the active browser POS in `capacitor/www` and its existing KRA eCitizen popup URL. The Chrome extension is in `chrome-extension/`. Windows packaging includes this folder. The separate legacy Python UI and Android WebView do not run Chrome extensions.

## Install

1. Run `npm ci --prefix capacitor` and `npm run build:bridge --prefix capacitor`.
2. Start the browser POS with `./start-apk-browser.sh`.
3. In the **same Chrome profile**, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the repository's `chrome-extension` folder. For a Windows distribution, select its `chrome-extension` folder.
4. Reload the POS and Admin pages. Use the same POS origin consistently, for example `http://localhost:3000`. `localhost` and `127.0.0.1`, and different ports, have separate browser databases.
5. Sign into KRA yourself when the popup requests it. Select the correct registered business. Save your business KRA PIN in POS Settings so the adapter can check it against the portal.

The manifest permits the local HTTP POS and `https://ecitizen.kra.go.ke` only. A remotely hosted POS requires explicit matching-origin changes to both `manifest.json` and the background worker's `isPos` allowlist. Do not replace this with `<all_urls>`. Chrome storage holds attempts and official invoice results locally; `unlimitedStorage` accommodates retained QR images. The extension stores no passwords, authentication cookies or OTPs.

## Cashier flow

- Leave **Generate eTIMS Invoice** unchecked for ordinary checkout and the existing branded receipt.
- When requested, select it and provide the customer's optional KRA PIN, email and billing address. The checkout phone is included. The extension never fills the customer's name; KRA resolves it through PIN validation.
- Cash and verified M-Pesa retain their existing payment flow. An invoice request is created only for a completed sale. Other saved payment methods, including Card, are preserved in the sale payload and can be invoiced from **Manage eTIMS invoice** on their paid receipt.
- After successful payment, the extension opens the existing KRA create-invoice URL in a compact popup. It fills recognized customer, item, quantity, unit-price, discount, payment and receipt-reference fields. Any missing mapping is reported in the panel.
- Validate the PIN in KRA, review all entries and the correct seller, and complete KRA-specific tax classifications or other required fields. No tax category or fiscal identifier is inferred.
- Check the review checkbox, click **Enable KRA Generate**, then click **KRA's own Generate/Submit button once**. The extension never submits the invoice or clicks that button.
- Open the resulting official invoice. Automatic capture requires its own POS receipt reference and total, CU Invoice Number, SCU ID, signature, invoice date, invoice number and QR image. Fields are read from the issued invoice container, rather than the creation form. The official QR bytes are retained for later printing; an existing official SVG/canvas QR can be copied as a PNG. The extension never builds a QR from POS data.
- The result is saved against the original sale and appears inside the existing receipt. Use the POS receipt's **Manage eTIMS invoice** button, Sales History reprint, or Admin → eTIMS.

The adapter deliberately stops if an amount, line, discount, payment, supplied customer field or configured seller PIN does not match. It does not modify prices, add balancing lines, invent missing values, or treat a generic success notification as a fiscal invoice.

## Recovery and duplicates

The POS stores a separate durable ledger, `oraforge:etims:v1`, keyed by shop, sale ID and POS receipt number. It contains the immutable sale snapshot, SHA-256 digest, attempt ID, status, fiscal details and history. The original sale records retain the invoice request, customer details, original shop and seller PIN. Fiscal writes do not rewrite stock, payments or sale totals. IndexedDB transactions atomically claim invoices across tabs.

| State | Available workflow |
| --- | --- |
| Pending | Prepare in KRA, or record an already-issued CU manually |
| Check existing invoice | Open KRA's invoice list and inspect the original transaction; no fresh generation |
| Generated | Reprint or complete missing official details; fresh generation and changing the CU are blocked |

Opening a linked popup marks the sale **Check existing invoice** before any portal operation. A Chrome crash, lost response, failed popup or missed capture therefore cannot silently return it to Pending. Chrome's background job also persists through service-worker suspension, and validates the sender origin, bound portal tab, attempt, snapshot digest, receipt reference and total.

If no invoice was issued, first search KRA's existing invoices by receipt, amount and customer. Then select **Checked: no invoice issued** and record what was checked. The extension closes the old bound tab and revokes its job **before** the POS permits another attempt. If an official result was already captured, reset is refused.

Manual entry requires the actual CU shown by KRA. Optional fields and an official QR image can be added later. A partial manual entry still marks Generated and blocks duplicates; missing QR data is described honestly on the receipt. Manual entries are labeled **Manually recorded**. Automatic results can complete a matching manual CU, but cannot replace it with a different one. Reusing a CU for another sale is blocked.

The ledger is included in the existing POS backup/restore export. Extension results are retained separately and can repair an older pending POS backup when the sale snapshot still matches. Keep POS backups: deleting both browser databases removes local duplicate history. Duplicate blocking covers the linked workflow on this POS origin/profile; separate machines need a shared fiscal ledger, and invoices issued directly outside the linked workflow cannot be intercepted.

## Live KRA verification still required

**This is implemented and tested against a synthetic portal fixture, not certified against an authenticated live KRA session. No real invoice was issued during development.** Public documentation establishes the portal workflow but does not expose the current authenticated DOM or its exact field selectors.

Before production use, validate the following with a cashier and an authorized real sale:

1. Login/OTP redirects, account selection and PIN validation remain usable. KRA retrieves the customer name correctly, including a sale with no buyer PIN.
2. Confirm the live names/selectors for line rows and Add Item, customer contact fields, receipt reference, payment options, percentage/fixed discount controls, seller PIN and invoice total. Test multiple lines, fractional quantities, a fixed discount, a percentage discount and a fully discounted sale where supported.
3. Verify the portal's final issuance control is recognized and gated. Test the native click and keyboard submission. Confirm neither field-change handlers nor intermediate preview controls issue an invoice.
4. Confirm the invoice-list route `/individual/etims/sale` and the path from that list to the official invoice. The existing create route is `/individual/etims/sale/create`; the list route must be checked live.
5. Confirm that the issued invoice exposes the POS reference and exact total, plus CU, SCU ID, signature, date, number and official QR in a distinct invoice container. Check QR image/blob/SVG/canvas extraction and scan the printed QR with KRA's checker.
6. Test capture after login redirects, page reload, popup closure, delayed confirmation and POS restart. Confirm uncertain attempts cannot generate again until the existing invoice is checked.
7. Test receipt rendering/printing on the actual thermal printer, including long fiscal fields, official QR quality, manually completed details and admin reprints.
8. Verify the customer's actual KRA tax treatment and payment mapping with the business. The extension intentionally leaves unknown KRA classifications for cashier review.

If KRA renders an invoice only inside a PDF/download, hides its reference, or does not expose the necessary DOM fields, automatic capture stays unresolved. Use manual entry from the genuine invoice until the adapter is extended and verified. There is no PDF OCR, network-response interception or undocumented KRA API integration in this implementation.

## Adjusting the portal adapter

Open the extension's **Details → Extension options**. Save a JSON object of CSS selectors for fields whose live markup differs. For example, an administrator may set `rows`, `reference`, `total`, `generate`, `invoice_root` and `qr` after inspecting the actual portal. The options page lists all supported keys. Reload the popup after saving.

`invoice_root` must select the actual issued invoice, including its total, POS reference and QR. It must exclude a stale creation form. Unknown or missing fields stop verification/capture; do not weaken the checks to make an unverified portal appear connected. Re-run the fixture and browser regressions after adapter changes.

## Validation

```sh
npm ci --prefix capacitor
npm run build:bridge --prefix capacitor
npm test --prefix capacitor
```

The regression suite covers cents/discount reconciliation, partial manual entry, CU immutability, stale-attempt rejection, unsafe QR rejection, atomic concurrent claims, origin/tab binding, worker restart, capture correlation, revocation of stale forms and scripted-submit blocking. Existing authentication, backup, native-provider, SMS and verified M-Pesa tests remain included.

Optional browser checks require Python Playwright and Google Chrome at `/usr/bin/google-chrome`:

```sh
# In one terminal, use an isolated server data directory:
POS_DESKTOP=1 PORT=3099 POS_DATA_DIR=/tmp/oraforge-etims-test POS_BACKUP_DIR=/tmp/oraforge-etims-test-backups node capacitor/dev-server.js
# In another:
python3 capacitor/tests/etims-browser.py
```

This runner requires Chrome 144 or another Chrome version supporting the experimental `Extensions.loadUnpacked` testing command. It uses a fresh browser profile, synthetic sales and synthetic fiscal identifiers. Its KRA requests are fulfilled by the local HTML fixture. It verifies ordinary checkout, opted checkout, manual capture, generated-state blocking, admin reprint, trusted review, one native generation click and official-detail extraction. It also loads the actual unpacked extension into an isolated Chrome profile and verifies the complete page bridge → background worker → portal → original sale → receipt flow against the fixture. The final extension test blocks real KRA DNS resolution and routes its test navigation to local HTML. Live authenticated KRA testing is still required.

References: [KRA eCitizen](https://ecitizen.kra.go.ke/), [KRA eTIMS guidance](https://www.kra.go.ke/helping-tax-payers/faqs/learn-about-etims), [Chrome messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging), [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts).
