# Build and open the POS in the browser

Run these in Windows PowerShell with Node.js/npm installed. If your checkout is elsewhere, change the first path.

```powershell
Set-Location 'C:\eTIMS-Analysis\POS_APK-improved-ui'

# Install the exact dependencies in the lockfile.
npm.cmd ci --prefix capacitor --no-audit --no-fund

# Build the browser SQLite bridge and local provider configuration.
npm.cmd run build:bridge --prefix capacitor

# Start/reuse the local POS server and open the saved Oraforge browser profile.
& '.\Start Oraforge POS.cmd'
```

The launcher opens `http://localhost:3000/pos` with the existing sales profile. On this PC, you can also double-click **Oraforge POS (eTIMS)** on the desktop.

Check startup and the helper connection without opening another browser window:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\start-source-pos.ps1 -NoBrowser
```

Keep eTIMS open and logged in normally. Its Internet access stays blocked; the POS talks to the helper only over localhost. For helper installation, packaging, configuration, tests and current limitations, see [the Windows integration guide](docs/ETIMS-WINDOWS.md).
