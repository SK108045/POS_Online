# Validate the optional frozen Python compatibility server without touching customer data.
param([Parameter(Mandatory=$true)][string]$PackageDirectory)
$ErrorActionPreference = 'Stop'
$exe = Join-Path $PackageDirectory 'runtime\python\OraforgePOSPython\OraforgePOSPython.exe'
if (!(Test-Path $exe)) { throw "Missing bundled Python backend at $exe" }
$port = 54327
$directory = Join-Path $env:RUNNER_TEMP 'oraforge-python-legacy-test'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$env:POS_LEGACY_PORT = "$port"
$env:POS_LEGACY_DATA_DIR = $directory
try {
    $proc = Start-Process -FilePath $exe -PassThru
    $ok = $false
    for($i=0; $i -lt 80; $i++) {
        if ($proc.HasExited) { throw "Bundled Python backend exited with code $($proc.ExitCode)" }
        try {
            $r = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 3
            if ($r.StatusCode -eq 200) { $ok = $true; break }
        } catch {}
        Start-Sleep -Milliseconds 300
    }
    if (!$ok) { throw 'Bundled Python backend failed health smoke' }
    if (!(Test-Path (Join-Path $directory 'data\pos.sqlite3'))) { throw 'Legacy Python database not persistent in AppData' }
    Write-Output 'PASS: bundled Python backend boots and initializes isolated SQLite data'
}
finally {
    if ($proc -and !$proc.HasExited) { Stop-Process -Id $proc.Id -Force }
    Remove-Item Env:\POS_LEGACY_PORT -ErrorAction SilentlyContinue
    Remove-Item Env:\POS_LEGACY_DATA_DIR -ErrorAction SilentlyContinue
}
