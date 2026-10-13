param([string]$OutputDirectory)
$ErrorActionPreference='Stop'
$helperRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'etims-helper')).Path
$repoRoot=Split-Path $PSScriptRoot -Parent
if(-not $OutputDirectory){$OutputDirectory=Join-Path $repoRoot 'dist\windows\OraforgePOS\runtime\etims'}
$buildRoot=Join-Path $repoRoot 'dist\windows\etims-build'
# PyInstaller progress uses stderr. Windows PowerShell 5 treats redirected
# native stderr as ErrorRecords; preserve progress without aborting the build.
$previousPreference=$ErrorActionPreference
try{
 $ErrorActionPreference='Continue'
 python -m PyInstaller --noconfirm --clean --onedir --noconsole --name OraforgeEtims --distpath $OutputDirectory --workpath $buildRoot --specpath $buildRoot --add-data "$helperRoot\tools;tools" --add-data "$helperRoot\profiles;profiles" --add-data "$helperRoot\read-state.ps1;." --add-data "$helperRoot\ui-step.ps1;." --add-data "$helperRoot\powershell-worker.ps1;." --add-data "$helperRoot\product_import;product_import" --additional-hooks-dir "$helperRoot\hooks" --paths $helperRoot --paths "$helperRoot\product_import" "$helperRoot\server.py" 2>&1 | ForEach-Object { $_.ToString() }
 $buildExit=$LASTEXITCODE
}finally{$ErrorActionPreference=$previousPreference}
if($buildExit -ne 0){throw 'eTIMS helper packaging failed'}
if(-not (Test-Path -LiteralPath (Join-Path $OutputDirectory 'OraforgeEtims\OraforgeEtims.exe'))){throw 'Helper EXE missing'}
Write-Output 'PASS: eTIMS Windows helper and Python runtime bundled.'
