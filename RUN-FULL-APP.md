# Oraforge POS + eTIMS: application files and commands

Verified on this PC: 13 October 2026. Run the commands below in Windows PowerShell.

## What is installed

The full system has three parts:

1. **Oraforge POS:** a browser app served by a local Node.js process. This installation starts from a CMD launcher; a standalone `OraforgePOS.exe` has not been built/deployed here.
2. **Windows eTIMS helper:** a real packaged Windows EXE, `OraforgeEtims.exe`. It contains the Python automation and its Python runtime. Running this installed helper does not require starting a Python file or installing Python separately.
3. **KRA eTIMS client:** the existing KRA Windows application. The helper operates its normal UI and captures its original invoice PDF.

The POS runs at `http://localhost:3000/pos`. The helper listens only on `127.0.0.1:17383`. eTIMS remains blocked from the Internet. Local invoice issuance and KRA server acceptance are separate statuses.

## Application files

| Location | Purpose |
| --- | --- |
| `C:\eTIMS-Analysis\POS_APK-improved-ui` | Live POS application folder. |
| `C:\eTIMS-Analysis\POS_APK-improved-ui\Start Oraforge POS.cmd` | Main daily launcher. Starts/reuses the POS server, connects the helper and opens the existing browser profile. |
| `C:\eTIMS-Analysis\POS_APK-improved-ui\windows\start-source-pos.ps1` | Script used by the CMD launcher. |
| `C:\eTIMS-Analysis\POS_APK-improved-ui\capacitor\dev-server.js` | Local Node.js POS server. |
| `C:\eTIMS-Analysis\POS_APK-improved-ui\capacitor\www` | POS interface, checkout, receipt and browser database code. |
| `C:\eTIMS-Analysis\POS_APK-improved-ui\capacitor\etims-windows.js` | POS server's authenticated localhost connection to the helper. |
| `C:\eTIMS-Analysis\POS_APK-improved-ui\windows\etims-helper` | Integrated helper's Python source, UI profiles and native import tools. |
| `C:\eTIMS-Analysis\invoice-helper\windows-integration\20261013-v13-busy-menu\OraforgeEtims\OraforgeEtims.exe` | Currently configured helper EXE, build `20261013.13`. Keep its entire neighboring `_internal` folder. |
| `C:\eTIMS-Paypoint-Win\EBM2xLauncher.exe` | Installed KRA launcher. |
| `C:\eTIMS-Paypoint-Win\bin\EBM2x.WPF.exe` | Main installed KRA application. |
| `C:\eTIMS-Analysis\repos\POS_APK-etims-windows` | Git working copy, branch `Etims_Client_Integration`. |

Inside the integrated helper source, `server.py` receives jobs, `engine.py` coordinates products/inventory/invoicing/recovery, `client.py` navigates the native UI, `workflow.py` saves/approves/captures invoices, and `pdf_invoice.py` extracts genuine fiscal fields and the original QR. Native product import code is under `product_import`.

The older standalone `C:\eTIMS-Analysis\invoice-helper\app.py` and `C:\eTIMS-Analysis\product-import-helper` utilities are separate tools. You do not need to launch them for normal integrated POS checkout.

## Daily use: run the full application

Open eTIMS if it is not already running:

```powershell
if (-not (Get-Process -Name 'EBM2x.WPF' -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath 'C:\eTIMS-Paypoint-Win\EBM2xLauncher.exe' -WorkingDirectory 'C:\eTIMS-Paypoint-Win'
}
```

Log into eTIMS normally and leave it open on the unlocked Windows desktop. The verified invoice-capture workflow uses **Microsoft Print to PDF** as the existing Windows default printer.

Start Oraforge with this command, or double-click **Oraforge POS (eTIMS)** on the desktop:

```powershell
& 'C:\eTIMS-Analysis\POS_APK-improved-ui\Start Oraforge POS.cmd'
```

Sign into the POS normally. For a genuine new sale, check **Generate eTIMS Invoice**, enter the buyer PIN and name, and complete checkout. The helper handles the native steps; the final receipt waits for the genuine fiscal fields and QR. Choose your receipt printer in the final Windows print dialog.

The helper is configured to start at Windows sign-in. The POS also starts it when needed. There is no need to manually start `server.py`, `workflow.py`, or a separate product-import window for each sale.

## Check startup and connection without opening another browser

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\eTIMS-Analysis\POS_APK-improved-ui\windows\start-source-pos.ps1' -NoBrowser

Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/etims/health' |
    Select-Object app, version, build, runtime_mode
```

Expect `PosReady=True`, `HelperConnected=True`, and helper build `20261013.13`, mode `frozen`. This checks the application connection; checkout separately verifies eTIMS login, the installed profile, stock, product information and outbound blocking.

## Optional: start the configured helper manually

Only needed if it is not already listening. Read its configured path rather than guessing a runtime version:

```powershell
$helperConfig = Get-Content -LiteralPath "$env:LOCALAPPDATA\OraforgePOS\etims\config.json" -Raw | ConvertFrom-Json
if (-not (Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $helperConfig.port -State Listen -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $helperConfig.helper_exe -WindowStyle Hidden
}
```

To recreate its Windows sign-in shortcut using the existing configuration:

```powershell
$helperConfig = Get-Content -LiteralPath "$env:LOCALAPPDATA\OraforgePOS\etims\config.json" -Raw | ConvertFrom-Json
& 'C:\eTIMS-Analysis\POS_APK-improved-ui\windows\etims-helper\Install-Startup.ps1' -HelperExe $helperConfig.helper_exe
```

## Developer commands: build the POS browser assets

These are build/setup commands, not commands to repeat before every sale:

```powershell
Set-Location 'C:\eTIMS-Analysis\POS_APK-improved-ui'
npm.cmd ci --prefix capacitor --no-audit --no-fund
npm.cmd run build:bridge --prefix capacitor
& '.\Start Oraforge POS.cmd'
```

Node.js/npm are required for this source-based POS installation. The already packaged helper contains its own Python runtime.

## Developer commands: rebuild the helper EXE

The existing isolated build environment used for the tested helper is in the Git working copy:

```powershell
Set-Location 'C:\eTIMS-Analysis\repos\POS_APK-etims-windows'
$env:PATH = (Join-Path $PWD 'windows\.cache\etims-build-env\Scripts') + ';' + $env:PATH
& '.\windows\build-etims-helper.ps1'
```

Output: `C:\eTIMS-Analysis\repos\POS_APK-etims-windows\dist\windows\OraforgePOS\runtime\etims\OraforgeEtims\OraforgeEtims.exe` and its accompanying runtime files. This builds the helper EXE, not a complete POS installer. Building does not automatically replace the running helper; deployment must keep its source/build version matched to the POS and preserve existing jobs.

## Existing data and real test output

Keep `%LOCALAPPDATA%\OraforgePOS` intact: it contains the existing POS browser profile, backups, helper configuration, product mappings, durable jobs, original invoice PDFs and QR captures. The KRA database stays in its existing configured location. Never clear these directories to retry a failed invoice; use **Recover this sale** on the original transaction.

Verified new sale: POS receipt `R874097-003`, one Book at KES 1,300 cash; local invoice `KRACU0100544492/2`. Both stock counts ended at 19. This sale is already invoiced and must not be issued again.

Full POS receipt: `C:\eTIMS-Analysis\exports\live-book-pos-test\final-pos-receipt.pdf`.
Original KRA PDF: `C:\eTIMS-Analysis\exports\live-book-pos-test\original-etims-invoice-2.pdf`.

This live test used an existing eTIMS product. New-product registration needs verified classifications and actual inventory; its live verification remains separate. The validated client profile is Non-VAT; unsupported tax/discount/expiry cases stop for review. KRA server acceptance remains unverified while eTIMS is offline.


If eTIMS runs as administrator, run `Repair eTIMS Helper Access.cmd` in the POS folder once and approve Windows UAC. This installs the per-user administrator startup task. Use that repair command for future startup repairs; keep the existing firewall blocks enabled.


Current verified helper: build 20261013.13, administrator logon task. For a manual helper restart, use the approved task: `schtasks.exe /Run /TN (Get-Content "$env:LOCALAPPDATA\OraforgePOS\etims\config.json" -Raw | ConvertFrom-Json).startup_task`. The daily POS launcher starts this task automatically when needed.
