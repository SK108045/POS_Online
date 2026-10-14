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
  $best=$null;$bestScore=-1.0
  foreach($profile in $p.profiles){
   $region=$profile.region
   $score=[OraforgeScreenGuard]::ScoreFile($actual,[string]$profile.reference,[int]$region[0],[int]$region[1],[int]$region[2],[int]$region[3])
   if($score -gt $bestScore){$best=$profile;$bestScore=$score}
   if($score -ge 0.996){
    [pscustomobject]@{screen=[string]$profile.screen}|ConvertTo-Json -Compress
    return
   }
  }
  throw ('Unrecognized eTIMS screen [profile='+$best.screen+'; score='+$bestScore.ToString('F6',[Globalization.CultureInfo]::InvariantCulture)+']')
 }
 if($p.action -eq 'Diagnose'){
  $best=$null;$bestScore=-1.0
  foreach($profile in $p.profiles){
   $r=$profile.region;$score=[OraforgeScreenGuard]::ScoreFile($actual,$profile.reference,$r[0],$r[1],$r[2],$r[3])
   if($score -gt $bestScore){$best=$profile;$bestScore=$score}
  }
  if($best){$r=$best.region;$null=[OraforgeScreenGuard]::SaveComparison($actual,$best.reference,$r[0],$r[1],$r[2],$r[3],$p.directory)}
  return
 }
 foreach($region in $p.regions){
  $score=[OraforgeScreenGuard]::ScoreFile($actual,[string]$p.reference,[int]$region[0],[int]$region[1],[int]$region[2],[int]$region[3])
  if($score -lt 0.996){throw ('Screen does not match the verified workflow [profile='+[IO.Path]::GetFileNameWithoutExtension($p.reference)+'; score='+$score.ToString('F6',[Globalization.CultureInfo]::InvariantCulture)+']')}
 }
 if($p.action -eq 'Close'){
  $region=$p.navigation_region
  if($region.Count -ne 4 -or $p.x -lt $region[0] -or $p.x -ge ($region[0]+$region[2]) -or $p.y -lt $region[1] -or $p.y -ge ($region[1]+$region[3])){throw 'Observed page navigation button missing; no input sent'}
  $score=[OraforgeScreenGuard]::ScoreFile($actual,[string]$p.navigation_reference,[int]$region[0],[int]$region[1],[int]$region[2],[int]$region[3])
  if($score -lt 0.996){throw ('Screen does not match the verified workflow [profile='+[IO.Path]::GetFileNameWithoutExtension($p.navigation_reference)+'; score='+$score.ToString('F6',[Globalization.CultureInfo]::InvariantCulture)+']')}
 }
 if($p.action -notin @('Click','Close','Text','Read','Complete')){throw 'Unsupported UI action'}
 & "$tools\invoice-ui.ps1" -Action $p.action -TargetProcessId $p.pid -X $p.x -Y $p.y -Text $p.text -ObservedGeometry $actual.Tag -Selector $p.selector
}finally{if($actual){$actual.Dispose()}}
