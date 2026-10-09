# Oraforge POS — automated Windows EXE builds

This branch starts from `improved-ui`. The Windows version uses the existing
Capacitor web UI and IndexedDB (desktop browser), a bundled official Windows
Node.js runtime, a self-contained frozen Python backend (with embedded CPython), and a Go launcher. **No Android APK conversion, Python,
or Node.js installation on the customer's PC is needed.**

## Downloads

In **Actions > Build Windows POS EXE > Run workflow**, select this branch.
Once the jobs pass, download:

- `oraforge-pos-windows-portable`: ZIP containing `OraforgePOS.exe`,
  bundled Node.js, app assets, `Stop POS.cmd`, optional Python legacy backend, and SHA256 checksum.
- `oraforge-pos-windows-installer`: single-file Windows installer EXE,
  with Start menu and optional desktop shortcuts, and its SHA256 checksum.

Artifacts expire after 30 days. To retain release downloads, create and push
a tag named `windows-v1.0.0` (or `windows-v1.0.1`, etc.) *from the
tested branch*. The tag build will create a GitHub Release containing both
the portable ZIP and installer EXE.

The CI pipeline: npm ci -> JavaScript tests -> fetch SHA256-verified official
Node for Windows -> build esbuild browser SQLite bridge with **blank** native
provider credentials -> cross-compile Go launcher for Windows -> package ZIP ->
verify ZIP, Windows PE binaries, and no bundled keys -> run desktop Node smoke
test on Linux -> freeze the separate legacy Python backend using PyInstaller ->
run the real Node and Python executables on Windows -> compile Inno Setup per-user installer -> upload download artifacts.

## Running on a client PC

Use Windows 10/11 x64. Run the installer once, or extract the entire
portable ZIP and double-click `OraforgePOS.exe`. Edge is preferred;
Chrome is the fallback. The app opens a dedicated browser window with
`http://localhost:3000/pos`. It works offline for local core POS sales;
payment requests, SMS, and eTIMS need internet.

**Never copy only the launcher EXE** from the portable ZIP. It depends on
the neighboring `runtime/` and `app/` folders. The installer version
packages these automatically into one EXE for distribution.

User browser data, automatic backups and merchant provider settings live at
`%LOCALAPPDATA%\OraforgePOS` outside the program directory. Installing a
new app version must not erase that directory. Do not delete the browser
profile or clear the site's data. Export/restore JSON backups from
Settings > Backup & restore when migrating devices; copy backups off-PC.

For M-Pesa onboarding: use the POS's local Swifta setup flow to enter each
client's key. The server writes the merchant key to
`%LOCALAPPDATA%\OraforgePOS\swifta.txt`. For SMS, configure
`%LOCALAPPDATA%\OraforgePOS\sozuri-config.json` on the client's PC
with `project`, `apiKey`, `from`, `channel` and `type`.
**Neither key is bundled into the downloadable installer.** The build
intentionally seeds blank defaults on first launch, without overwriting
existing per-user values.

## Updating or removing

Close all POS browser windows; use `Stop POS.cmd` (or the Start menu shortcut)
before updating. Run the newer installer to replace the application.
Uninstalling keeps merchant-specific browser data/backups under AppData;
back them up before manually deleting that directory.

## Local developer build

On Linux with Python 3, curl, Go, and Node.js/npm:

```sh
cd capacitor && npm ci && cd ..
python3 windows/build.py
python3 windows/verify_package.py
POS_TEST_SERVER=dist/windows/OraforgePOS/app/capacitor/dev-server.js node --test windows/server-smoke.cjs
```

The local Linux build produces a **Node-only staging ZIP**. Run the GitHub Actions workflow for the complete Node + Python distribution and installer.
Builds always use blank native provider keys and never package tracked
`swifta.txt`, `sozuri-config.json` credentials, or `www/paystack.txt`.

## Required customer acceptance tests

CI tests server start/stop, routes, runtime, archive integrity, and credentials
on a real Windows runner. Before distributing to customers, also manually test
shop registration, cash sale, barcode scanning, printing to the actual receipt
printer, M-Pesa with a merchant-provided key, SMS, eTIMS popups, backup restore,
Windows restart, and an in-place app update. A CI runner cannot prove external
hardware and provider integrations work.

Unsigned installers may trigger Windows SmartScreen. Production deployment
should use a trusted Authenticode code-signing certificate.

## Bundled Python runtime and two distinct servers

Both Node and Python are included in the **final GitHub Actions ZIP/installer**.
The main `OraforgePOS.exe` automatically launches the Node POS server at
`127.0.0.1:3000` and opens the improved UI in Edge/Chrome.

Python is bundled via PyInstaller (CPython plus Python library dependencies);
its separate, older Python HTTP POS backend is available at
`runtime\python\OraforgePOSPython\OraforgePOSPython.exe`.
It is **not launched by default**, because it presents a different legacy POS
interface backed by a different SQLite database. Launching both would create
two confusing, unconnected stores rather than integrating their data.

If required for backward compatibility, launch the Python backend separately.
It listens only on `127.0.0.1:5000`, maintains an isolated database under
`%LOCALAPPDATA%\OraforgePOS\legacy`, and needs no Python installation.
The Node server does **not** proxy API calls to the Python backend: the
improved-ui app calls Node directly. Cross-server integration would require
a separate, tested data and API migration.
