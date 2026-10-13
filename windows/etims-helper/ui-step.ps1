param([Parameter(Mandatory=$true)][string]$Instruction)
$ErrorActionPreference='Stop'
$OutputEncoding=[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$p=Get-Content -LiteralPath $Instruction -Raw|ConvertFrom-Json
$tools=Join-Path $PSScriptRoot 'tools'
if($p.action -eq 'File'){
 & "$tools\choose-native-file.ps1" -TargetProcessId $p.pid -DialogTitle 'Save Print Output As' -Path $p.path
 return
}
if($p.action -eq 'Snapshot'){
 & "$tools\invoice-ui.ps1" -Action Snapshot -TargetProcessId $p.pid -ImageOnly -OutputPath $p.path
 return
}
$actual=$null
try{
 $actual=& "$tools\invoice-ui.ps1" -Action Snapshot -TargetProcessId $p.pid -ImageOnly -InMemory
 Add-Type -AssemblyName System.Drawing
 if(-not ('OraforgeScreenGuard' -as [type])){Add-Type -Path "$tools\screen-guard.cs" -ReferencedAssemblies System.Drawing}
 if($p.action -eq 'Detect'){
  if($actual.Width -ne 1384 -or $actual.Height -ne 786){throw 'Unverified window geometry'}
  foreach($profile in $p.profiles){
   $region=$profile.region
   if([OraforgeScreenGuard]::MatchesFile($actual,[string]$profile.reference,[int]$region[0],[int]$region[1],[int]$region[2],[int]$region[3])){
    [pscustomobject]@{screen=[string]$profile.screen}|ConvertTo-Json -Compress
    return
   }
  }
  throw 'Unrecognized eTIMS screen'
 }
 foreach($region in $p.regions){
  [OraforgeScreenGuard]::VerifyFile($actual,[string]$p.reference,[int]$region[0],[int]$region[1],[int]$region[2],[int]$region[3])
 }
 if($p.action -eq 'Close'){
  $region=$p.navigation_region
  if($region.Count -ne 4 -or $p.x -lt $region[0] -or $p.x -ge ($region[0]+$region[2]) -or $p.y -lt $region[1] -or $p.y -ge ($region[1]+$region[3])){throw 'Observed page navigation button missing; no input sent'}
  [OraforgeScreenGuard]::VerifyFile($actual,[string]$p.navigation_reference,[int]$region[0],[int]$region[1],[int]$region[2],[int]$region[3])
 }
 if($p.action -notin @('Click','Close','Text','Read','Complete')){throw 'Unsupported UI action'}
 & "$tools\invoice-ui.ps1" -Action $p.action -TargetProcessId $p.pid -X $p.x -Y $p.y -Text $p.text
}finally{if($actual){$actual.Dispose()}}
