param([switch]$NoBrowser)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$dataRoot=Join-Path $env:LOCALAPPDATA 'OraforgePOS'
$baseUrl='http://localhost:3000'
$healthUrl='http://127.0.0.1:3000'
$owned=$false
$mutex=New-Object Threading.Mutex($false,'Local\OraforgePOS-Source-Launch')
function Read-LocalHealth {
 try{
  $health=Invoke-RestMethod -Uri "$healthUrl/api/local/health" -TimeoutSec 5
  if($health.app -eq 'oraforge-pos'){return $health}
 }catch{}
 return $null
}
function Test-LocalPort {
 $socket=New-Object Net.Sockets.TcpClient
 try{$socket.Connect('127.0.0.1',3000);return $true}catch{return $false}finally{$socket.Dispose()}
}
try{
 try{$owned=$mutex.WaitOne(10000)}catch [Threading.AbandonedMutexException]{$owned=$true}
 if(-not $owned){throw 'Another Oraforge launch is starting. Please try again shortly.'}
 foreach($relative in @('capacitor\dev-server.js','capacitor\etims-windows.js','capacitor\www\sqlite-bridge.js')){
  if(-not (Test-Path -LiteralPath (Join-Path $projectRoot $relative))){throw 'POS source files or the built browser bridge are missing. Keep the complete POS folder.'}
 }
 # Reuse the exact profile and localhost origin containing the existing sales.
 # Never fall back to another browser or another port with an empty database.
 $browserKind='edge'
 $launcherConfig=Join-Path $dataRoot 'launcher.json'
 if(Test-Path -LiteralPath $launcherConfig){
  $saved=Get-Content -LiteralPath $launcherConfig -Raw|ConvertFrom-Json
  if($saved.Browser -notin @('edge','chrome')){throw 'Saved POS browser settings are invalid. Keep the existing Oraforge data folder.'}
  $browserKind=$saved.Browser
 }
 $browserFile=if($browserKind -eq 'chrome'){'chrome.exe'}else{'msedge.exe'}
 $browserSubdirectory=if($browserKind -eq 'chrome'){'Google\Chrome\Application\chrome.exe'}else{'Microsoft\Edge\Application\msedge.exe'}
 $browserPaths=@()
 foreach($registryRoot in @('HKCU:','HKLM:')){
  $key="$registryRoot\Software\Microsoft\Windows\CurrentVersion\App Paths\$browserFile"
  if(Test-Path -LiteralPath $key){$value=(Get-ItemProperty -LiteralPath $key).'(default)';if($value){$browserPaths+=$value.Trim('"')}}
 }
 foreach($directory in @(${env:ProgramFiles(x86)},$env:ProgramFiles,$env:LOCALAPPDATA)){
  if($directory){$browserPaths+=Join-Path $directory $browserSubdirectory}
 }
 $browser=@($browserPaths|Where-Object {Test-Path -LiteralPath $_}|Select-Object -First 1)
 if($browser.Count -ne 1){throw "Reinstall $browserKind to use the existing POS profile. The launcher will not switch browsers automatically."}
 $health=Read-LocalHealth
 if(-not $health){
  if(Test-LocalPort){throw 'Port 3000 is occupied by another application or POS version. Close that instance first; Oraforge must keep its existing address.'}
  $node=Get-Command node.exe -ErrorAction SilentlyContinue
  if(-not $node){throw 'Install Node.js, then start Oraforge POS again.'}
  $logRoot=Join-Path $dataRoot 'logs'
  New-Item -ItemType Directory -Path $logRoot -Force|Out-Null
  $env:POS_DESKTOP='1';$env:PORT='3000';$env:POS_PORT='3000'
  $env:POS_INSTANCE=[guid]::NewGuid().ToString('N')
  $env:POS_BUILD='windows-etims-source'
  $env:POS_BACKUP_DIR=Join-Path $dataRoot 'backups'
  $logName='source-'+[guid]::NewGuid().ToString('N')
  $process=Start-Process -FilePath $node.Source -ArgumentList ('"'+(Join-Path $projectRoot 'capacitor\dev-server.js')+'"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot ($logName+'.log')) -RedirectStandardError (Join-Path $logRoot ($logName+'.error.log')) -PassThru
  $deadline=[DateTime]::UtcNow.AddSeconds(20)
  do{
   $health=Read-LocalHealth
   if($health){break}
   $process.Refresh()
   if($process.HasExited){throw 'The POS server stopped during startup. See the Oraforge logs folder.'}
   Start-Sleep -Milliseconds 250
  }while([DateTime]::UtcNow -lt $deadline)
  if(-not $health){throw 'The POS server did not become ready. Keep its logs and try again.'}
 }
 # Only localhost IPC is contacted. This neither launches nor connects eTIMS
 # to the Internet. Fiscal readiness is checked separately during checkout.
 $helperReady=$false
 try{$helper=Invoke-RestMethod -Uri "$healthUrl/api/etims/health" -TimeoutSec 20;$helperReady=($helper.app -eq 'oraforge-etims-helper')}catch{}
 if($NoBrowser){
  [pscustomobject]@{PosReady=$true;HelperConnected=$helperReady;Browser=$browserKind;Url="$baseUrl/pos"}
 }else{
  $browserProfilePath=Join-Path $dataRoot ('browser-'+$browserKind)
  Start-Process -FilePath $browser[0] -ArgumentList @(('--user-data-dir="'+$browserProfilePath+'"'),'--no-first-run','--no-default-browser-check',"--app=$baseUrl/pos")|Out-Null
 }
}catch{
 if($NoBrowser){[Console]::Error.WriteLine($_.Exception.Message)}else{
  Add-Type -AssemblyName System.Windows.Forms
  [void][Windows.Forms.MessageBox]::Show($_.Exception.Message,'Oraforge POS',0,16)
 }
 exit 1
}finally{
 if($owned){$mutex.ReleaseMutex()}
 $mutex.Dispose()
}
