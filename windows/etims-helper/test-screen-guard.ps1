$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -Path "$PSScriptRoot\tools\screen-guard.cs" -ReferencedAssemblies System.Drawing
$actual=New-Object Drawing.Bitmap(1384,786)
$reference=New-Object Drawing.Bitmap(10,10)
try{
 [OraforgeScreenGuard]::Verify($actual,$reference,10,10,10,10)
 $actual.SetPixel(10,10,[Drawing.Color]::FromArgb(24,24,24))
 [OraforgeScreenGuard]::Verify($actual,$reference,10,10,10,10)
 $actual.SetPixel(10,10,[Drawing.Color]::FromArgb(25,0,0))
 $rejected=$false
 try{[OraforgeScreenGuard]::Verify($actual,$reference,10,10,10,10)}catch{$rejected=$_.Exception.Message.Contains('Screen does not match')}
 if(-not $rejected){throw 'Changed screen accepted'}
 $rejected=$false
 try{[OraforgeScreenGuard]::Verify($actual,$reference,1380,10,10,10)}catch{$rejected=$true}
 if(-not $rejected){throw 'Out-of-window region accepted'}
 $wrong=New-Object Drawing.Bitmap(100,100)
 try{
  $rejected=$false
  try{[OraforgeScreenGuard]::Verify($wrong,$reference,10,10,10,10)}catch{$rejected=$_.Exception.Message.Contains('Unverified window geometry')}
  if(-not $rejected){throw 'Changed geometry accepted'}
 }finally{$wrong.Dispose()}
 Write-Output 'PASS: compiled screen guard preserves tolerance, mismatch, bounds and window geometry checks.'
}finally{$actual.Dispose();$reference.Dispose()}
