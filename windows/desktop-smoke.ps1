# Smoke-test the actual bundled Windows launcher and Node executable, not just source JS.
param(
  [Parameter(Mandatory=$true)][string]$PackageDirectory
)
$ErrorActionPreference = 'Stop'
$exe = Join-Path $PackageDirectory 'OraforgePOS.exe'
$meta = Get-Content (Join-Path $PackageDirectory 'build-info.json') -Raw | ConvertFrom-Json
if (!(Test-Path $exe)) { throw "Missing launcher at $exe" }
if (!(Test-Path (Join-Path $PackageDirectory 'runtime\node.exe'))) { throw 'Missing bundled Node' }
$base = 'http://127.0.0.1:3000'
$instance = $null

try {
  $process = Start-Process -FilePath $exe -ArgumentList '--headless' -PassThru
  if (!$process.WaitForExit(20000)) { Stop-Process -Id $process.Id -Force; throw 'Windows launcher startup timed out' }
  if ($process.ExitCode -ne 0) { throw "Windows launcher failed: $($process.ExitCode)" }
  $health = $null
  for ($i = 0; $i -lt 50; $i++) {
    try {
      $health = Invoke-RestMethod -Uri "$base/api/local/health" -TimeoutSec 2
      if ($health.app -eq 'oraforge-pos') { break }
    } catch {}
    Start-Sleep -Milliseconds 300
  }
  if (!$health -or $health.app -ne 'oraforge-pos') { throw 'Native Windows server did not start' }
  if ($health.build -ne $meta.build) { throw 'Build mismatch' }
  $configFile = Join-Path $env:LOCALAPPDATA 'OraforgePOS\launcher.json'
  $config = Get-Content $configFile -Raw | ConvertFrom-Json
  $instance = $config.instance
  if ($instance -ne $health.instance) { throw 'Instance mismatch' }
  foreach ($route in @('/pos', '/admin.html', '/sqlite-bridge.js')) {
    $response = Invoke-WebRequest -Uri "$base$route" -TimeoutSec 8 -UseBasicParsing
    if ($response.StatusCode -ne 200) { throw "Failed GET $route" }
  }
  Write-Output "PASS: native Windows launcher and bundled Node serving POS/Admin (build $($meta.build))"
}
finally {
  if ($instance) {
    try {
      Invoke-WebRequest -Uri "$base/api/local/stop" -Method Post -Headers @{'X-POS-Instance' = $instance} -TimeoutSec 5 -UseBasicParsing | Out-Null
    } catch { Write-Warning "Could not stop smoke-test server: $_" }
  }
}
