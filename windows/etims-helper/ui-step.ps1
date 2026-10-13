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
 $actual=[Drawing.Bitmap]::FromFile($temp)
 $reference=[Drawing.Bitmap]::FromFile([string]$p.reference)
 try{
  if($actual.Width -ne 1384 -or $actual.Height -ne 786){throw 'Unverified window geometry'}
  foreach($region in $p.regions){
   if($reference.Width -ne [int]$region[2] -or $reference.Height -ne [int]$region[3]){throw 'Invalid reference dimensions'}
   $different=0;$count=0
   for($y=[int]$region[1];$y -lt ([int]$region[1]+[int]$region[3]);$y+=2){for($x=[int]$region[0];$x -lt ([int]$region[0]+[int]$region[2]);$x+=2){
    $a=$actual.GetPixel($x,$y);$b=$reference.GetPixel(($x-[int]$region[0]),($y-[int]$region[1]));$count++
    if([Math]::Abs([int]$a.R-[int]$b.R) -gt 24 -or [Math]::Abs([int]$a.G-[int]$b.G) -gt 24 -or [Math]::Abs([int]$a.B-[int]$b.B) -gt 24){$different++}
   }}
   if($count -eq 0 -or ($different/[double]$count) -gt 0.004){throw 'Screen does not match the verified workflow; no action sent'}
  }
 }finally{$actual.Dispose();$reference.Dispose()}
 if($p.action -notin @('Click','Text','Read')){throw 'Unsupported UI action'}
 & "$tools\invoice-ui.ps1" -Action $p.action -TargetProcessId $p.pid -X $p.x -Y $p.y -Text $p.text
}finally{Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue}
