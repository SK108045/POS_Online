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
$temp=Join-Path ([IO.Path]::GetTempPath()) ('etims-screen-'+[Guid]::NewGuid().ToString('N')+'.png')
try{
 & "$tools\invoice-ui.ps1" -Action Snapshot -TargetProcessId $p.pid -ImageOnly -OutputPath $temp
 Add-Type -AssemblyName System.Drawing
 if(-not ('OraforgeScreenGuard' -as [type])){Add-Type -Path "$tools\screen-guard.cs" -ReferencedAssemblies System.Drawing}
 $actual=[Drawing.Bitmap]::FromFile($temp)
 $reference=[Drawing.Bitmap]::FromFile([string]$p.reference)
 try{
  foreach($region in $p.regions){
   [OraforgeScreenGuard]::Verify($actual,$reference,[int]$region[0],[int]$region[1],[int]$region[2],[int]$region[3])
  }
 }finally{$actual.Dispose();$reference.Dispose()}
 if($p.action -notin @('Click','Text','Read','Complete')){throw 'Unsupported UI action'}
 & "$tools\invoice-ui.ps1" -Action $p.action -TargetProcessId $p.pid -X $p.x -Y $p.y -Text $p.text
}finally{Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue}
