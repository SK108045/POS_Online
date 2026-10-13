# Oraforge Windows eTIMS integration

Oraforge sends completed sale JSON through its same-origin Node server to the Windows helper on `127.0.0.1:17383`. The helper uses the installed client's ordinary UI, native Excel importer, stock adjustment, Save/Approve, and original Print A4 PDF. It never writes the eTIMS database directly or generates fiscal identifiers or signatures.

## Checkout

Leave **Generate eTIMS Invoice** unchecked for ordinary receipts. When selected, buyer **PIN and name are required**. Phone, email, address and remarks are optional under the buyer-details dropdown. Products, quantities, prices and payment category come from the POS.

Preflight runs before payment and checks the installed build, configured seller, registered buyer, actual stock and capture printer. Missing required product details appear in one form, including multiple new products. Verified registration metadata is remembered. Kenya (`KE`) is the default origin for new products; existing native origins remain authoritative. Preflight creates no invoice.

After payment, the helper serializes the complete native workflow. Every sold product is checked against current eTIMS records using its seller/branch/shop/POS-product mapping, an explicit existing code or an unambiguous exact name. Missing products are imported together and confirmed from read-only records. Existing/inactive codes are never re-imported: the native importer can overwrite opening stock. Insufficient stock requires actual inventory and a reason; the helper uses native **Adjustment In** and verifies the result. Services do not acquire invented stock.

**Custom item** adds a non-catalog item directly to the sale, with its real name, quantity, price, purchase cost and optional stable reference. Checkout gathers its genuinely missing registration/inventory details. This does not insert a product into the POS catalog.

The helper verifies entered quantities/prices/totals, saves the draft, approves it once with the actual payment category, captures the original PDF and extracts the six genuine fiscal fields and original QR. The full POS receipt receives this footer. Final printing waits for every fiscal field and QR; the initial **Confirm & Print** opens the print dialog once after capture. History reprints remain explicit. Browser printing still uses the Windows print dialog.

An existing paid sale can be invoiced through **Manage eTIMS invoice** on its receipt, after explicitly confirming it has no fiscal invoice. Its original payment and stock decrement remain intact. Historical inventory comes from original records or confirmation; today's remaining stock is not treated as stock before an old sale.

## Windows setup and startup

If the official eTIMS launcher starts its client as administrator, the helper must run at sufficient integrity in the same Windows session. A normal Startup shortcut does not elevate it. After a reboot, this mismatch can make UI Automation return infinite window bounds and stop the first snapshot before invoice entry. Build 20261013.8 detects the mismatch during preflight and reports the required repair.

Build 20261013.9 also retries only read-only screen detection for up to five seconds while a native page is drawing. It never repeats a dispatched click or invoice approval. On completion it closes only read-only print/detail views whose invoice number matches the captured invoice; the next sale can also reconcile a previously completed view against the companion result and genuine native CU. Unknown forms and mismatched invoices remain blocked. The QR decoder is restricted to QR_CODE while preserving the original image and payload.

The later genuine recovery of a paid two-Book sale at KES 2,600 produced native invoice 5. Independent read-only reconciliation verified the original PDF, all six fields and original QR. The successful run took 61.86 seconds to issuance and 138.95 seconds to completed fiscal capture. This is one measured transaction, not a guaranteed duration for every checkout. An earlier attempt saved its customer but stopped on a transient customer-to-sales frame before invoice entry; the new bounded detection addresses that transition. Existing paid receipts and earlier fiscal invoices were preserved. Local issuance is verified; server acceptance remains unverified while the client stays offline.

Run **Repair eTIMS Helper Access.cmd** once and approve the Windows UAC prompt. The bundled helper's `--repair-access` command verifies the existing offline policy, refuses active invoice runs, and registers a per-user Windows logon task with an interactive token and highest available privileges. No Windows password is stored. It backs up and removes the previous normal Startup shortcut, restarts only the helper through the approved task, and preserves all invoices, configuration and ledgers. The POS uses that task when the helper needs to restart. This repair never changes firewall policy or eTIMS itself. The authenticated `/access` diagnostic captures and identifies the current native window without clicking, entering data or issuing an invoice.

For this source installation, double-click **Start Oraforge POS.cmd** in the project root, or the **Oraforge POS (eTIMS)** desktop shortcut. It starts the local server when needed and opens the saved Oraforge browser profile at `http://localhost:3000/pos`. Repeated launches reuse the server. It keeps port 3000 and the saved browser, preserving access to existing sales. The helper starts through local IPC; eTIMS itself must be opened and logged into normally. This launcher does not enable eTIMS Internet access. `windows/start-source-pos.ps1 -NoBrowser` checks startup and connectivity without opening a browser.

Use **Configure Oraforge eTIMS Helper** from the packaged Start menu, or `python windows/etims-helper/configure.py` from source. Enter this device's existing seller PIN, branch, installation folder and existing database path. This does not change KRA registration. Login passwords are neither requested nor stored.

Open one eTIMS client and log in normally. The verified profile is build `20240411.NEW.0138`, DLL SHA-256 `8869363751e79f0c4a8b97f5877ec2d5b83cb4b784c9e46f95bb91ca376eff75`. Changed builds stop before UI writes and require profile validation. The helper normalizes the outer window to 1384 × 786 pixels and requires at least a 1366 × 768 display. Unexpected forms stop the job. An interactive, unlocked Windows desktop is required.

The verified PDF workflow requires Windows default printer **Microsoft Print to PDF**. The POS final print dialog can select the receipt printer. No printer settings are changed automatically.

The packaged POS starts the helper on first use. The installer offers **Start the eTIMS Windows Helper when I sign in**. From source:

```powershell
python -m pip install -r windows/etims-helper/requirements.txt
powershell.exe -NoProfile -ExecutionPolicy Bypass -File windows/etims-helper/Install-Startup.ps1
```

For a standalone bundled helper, supply `-HelperExe <full path to OraforgeEtims.exe>` to the startup script. It creates a per-user Startup shortcut and does not automatically log into eTIMS.

## State, duplicate protection and recovery

Existing sales and the `oraforge:etims:v1` fiscal ledger remain in the same browser profile/database. Version-1 portal requests are preserved and never automatically reissued by Windows. Genuine manually recorded invoices remain available for reprinting.

New version-2 sale snapshots are immutable. The helper owns `%LOCALAPPDATA%/OraforgePOS/etims/companion.sqlite3`, mappings, invoice ledgers, original PDFs/QRs and import workbooks. `ORAFORGE_ETIMS_HOME` relocates helper state. Paths and port are configurable. Do not clear helper state to fix an invoice error.

The POS verifies the active helper's build and actual executable against its configured runtime. An older process on the same port is rejected with instructions to restart the helper and recover the same sale. Packaged helper PowerShell children run without console windows. The native stock quantity edit is completed with Enter before its calculated result is checked and saved.

Repeated identical submissions return the existing deterministic job; changed details with the same sale identity are rejected. A Windows named mutex covers the entire native workflow across processes. A dead process's old automation lock is reclaimed only for the same sale; its durable invoice ledger is preserved.

**Recover this sale** reconciles the recorded native invoice, sale digest, buyer, lines, amount, payment and `Oraforge:<job>` marker. The marker is entered after item selection and copied by native line confirmation; its persistence is checked before approval. An approved invoice is printed/extracted again without issuing another. A verified draft may continue approval. For an older, already captured approved invoice with a blank native marker, recovery additionally requires the original PDF hash, exact captured invoice/job identity and all genuine receipt fields to match. Unidentified or unsaved forms require review. Lost HTTP responses reuse the same job identity. Automatic "checked absent" resets are disabled. The public job becomes complete only after every fiscal field and the original QR are attached.

The local token stays in the helper directory and Node backchannel. Browser requests use same-origin `/api/etims/*`. Foreign origins, network clients and rebinding hosts are rejected. There is no CORS bridge. Payloads, tokens, connection options and customer fields are not logged.

## Issuance versus KRA acceptance

eTIMS must remain offline. The helper never enables Internet access, disables outbound blocking, or requests a KRA connection. Read-only checks require the Windows Firewall service, all three enabled profiles, and unrestricted outbound block rules covering both configured executables: `bin/EBM2x.WPF.exe` and `EBM2xLauncher.exe`. Rules are matched by installed program paths, not machine-specific names. Preflight, recovery and mutating UI steps stop if blocking cannot be verified. The helper does not change firewall policy. Persistent firewall rules enforce blocking outside helper activity as well.

`local_issuance_status=issued` means the client approved the invoice, its receipt exists and its original PDF fields/QR match that receipt. `kra_acceptance_status=unverified` is separate: a local receipt or QR alone does not prove server acceptance. Pending uploads remain preserved locally while eTIMS is blocked. Oraforge's localhost IPC runs in separate processes and remains available.

## Supported profile and real verification

This installed device is Non-VAT. The verified profile supports tax D, zero discounts, ordinary items/services and payment categories 01–07. Nonzero VAT, discounts, expiry-controlled stock and changed client builds stop in preflight. They require further native validation and are never silently converted. The verified original PDF embeds its QR; other templates require validation.

The owner authorized a distinct, genuine sale using Book, an existing native product. Book was added through the normal POS product form with the confirmed 20-unit physical stock count. Checkout recorded one Book at KES 1,300 cash. Through the POS recovery controls, the helper reconciled native stock from 0 to 20, saved and approved native invoice 2, captured its original PDF, and returned all six genuine fiscal fields to the same paid POS receipt. Both stock counts became 19. The rendered receipt QR and the QR in the exported full POS receipt PDF decoded to the original payload. Repeated recovery returned the completed job without another invoice or stock change, and the POS blocked a new issuance attempt for that sale. Earlier sales, the parked cart, catalog records and settings were preserved; native invoice 1 remained unchanged. No direct eTIMS database writes or network-policy changes were used.

This live test exercised existing-product selection, legitimate inventory reconciliation, invoice issuance, PDF extraction, POS fiscal capture and receipt rendering. Missing-product planning, stable mappings, multiple products and native import workbook generation have automated coverage; this particular transaction did not exercise a new native product import. Unsupported or absent classifications still stop preflight. In particular, Teddy Bears require commodity 60141004, absent from this client's active classification table. No substitute classification or online refresh is applied automatically.

## Tests and delivery

### Checkout performance update (helper build 20261013.7)

The helper uses one hidden PowerShell worker over private stdin/stdout instead of starting a new process for every action. Only the shipped, allowlisted scripts are callable; arguments are data and are never evaluated as shell code. Requests are serialized, replies are bound to request IDs, and a timeout kills the worker without replaying the operation. A later explicit recovery reconciles the existing sale. PowerShell exceptions are reduced to safe categories, and timing metrics contain script names and durations only.

Screen comparison runs in compiled C# with the same sampling, RGB tolerance, geometry requirements and mismatch limit. UI controls, values, stock, native drafts, fiscal receipts and original QR/PDF contents retain their existing verification. Live effective firewall policy is inspected before every mutating UI action; no firewall result is cached. Database access remains read-only. The helper also reserves its loopback port exclusively on Windows, preventing competing helper processes from sharing that port.

Read-only measurements on the installed client found a median screen-validation time of 2.0734 seconds with the previous worker versus 0.1448 seconds with this worker (14.32 times faster for that operation). Repeated native state reads were approximately 0.35 seconds in the initial measurement, versus 1.84 seconds previously. Machine load affects these results. These are component benchmarks, not a newly timed fiscal issuance; a complete checkout duration must be measured on the next genuine sale. New product/customer registration and native printing still add work.

```powershell
python -m unittest discover -s windows/etims-helper -p 'test_*.py'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File windows/etims-helper/test-screen-guard.ps1
# Optional timing checks; requires one normally logged-in native client.
# Does not click, type, save, print or submit an invoice.
python windows/etims-helper/benchmark.py --iterations 4
```

The performance regression suite includes actual Windows transport reuse, Unicode argument handling, concurrent response ownership, sanitized failures, worker replacement, no replay after timeouts, and exclusive loopback binding. Compiled comparison fixtures cover tolerance, mismatch, bounds and window geometry.

```powershell
npm ci --prefix capacitor
node --test capacitor/tests/*.cjs
python -m unittest discover -s windows/etims-helper -p test_companion.py
# With the local POS server running:
python capacitor/tests/etims-windows-browser.py
# After building the Windows helper:
python windows/etims-helper/test_frozen_offline.py --executable dist/windows/OraforgePOS/runtime/etims/OraforgeEtims/OraforgeEtims.exe
```

Python tests use temporary companion databases. The browser regression intercepts every helper route in an isolated context; it never submits a native fiscal job. Live loopback health/preflight and reconciliation of the genuine reference PDF were tested separately. Mock tests do not count as a new real issuance.

The frozen-helper smoke check uses an isolated configuration with an unregistered fixture installation path. It verifies that real firewall inspection rejects preflight before database or UI access. It passed on Windows without disabling any live firewall rules or submitting an invoice job, and is included in Windows CI.

Validation on 2026-10-13: 70 Node tests and 28 helper tests passed, along with the earlier three isolated browser flow checks. Regression coverage includes hidden child processes, mismatched active helper builds, native quantity completion, item-selection header refresh, interrupted capture recovery and complete-job publication. The frozen helper was started on Windows and reached through the actual POS proxy; its isolated offline smoke test passed. Both existing outbound blocks and all enabled firewall profiles remained effective. The distinct real issuance and receipt checks above also passed; they are separate from fixture tests. Local issuance is verified, while KRA server acceptance remains unverified because eTIMS stays offline.

GitHub Actions packages the Node POS, Windows launcher, Python backend, frozen helper and Inno Setup installer. `windows/build-etims-helper.ps1` builds the standalone helper/runtime. Merchant credentials, buyer data, real PDFs, tokens and databases are excluded. UI profile assets contain only cropped titles, menu labels and dialog prompts.

The retired extension source remains for legacy regression tests and is excluded from the Windows package. [Historical portal documentation](ETIMS-INTEGRATION.md) applies only to old requests.
