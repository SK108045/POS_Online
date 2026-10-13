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
 $temp=Join-Path ([IO.Path]::GetTempPath()) ('oraforge-guard-'+[Guid]::NewGuid().ToString('N')+'.png')
 try{
  $actual.SetPixel(10,10,[Drawing.Color]::Black)
  $reference.Save($temp,[Drawing.Imaging.ImageFormat]::Png)
  if(-not [OraforgeScreenGuard]::MatchesFile($actual,$temp,10,10,10,10)){throw 'Cached screen match rejected'}
  $reference.SetPixel(0,0,[Drawing.Color]::White)
  $reference.Save($temp,[Drawing.Imaging.ImageFormat]::Png)
  [IO.File]::SetLastWriteTimeUtc($temp,[DateTime]::UtcNow.AddSeconds(2))
  if([OraforgeScreenGuard]::MatchesFile($actual,$temp,10,10,10,10)){throw 'Updated reference reused stale pixels'}
 }finally{if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp -Force}}
 Write-Output 'PASS: compiled screen guard preserves tolerance, mismatch, bounds and window geometry checks.'
}finally{$actual.Dispose();$reference.Dispose()}
