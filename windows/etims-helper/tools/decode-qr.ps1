param([Parameter(Mandatory=$true)][string]$Path,[Parameter(Mandatory=$true)][string]$InstallationDir)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
[void][Reflection.Assembly]::LoadFrom((Join-Path $InstallationDir 'bin\zxing.dll'))
$bitmap=[Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $Path).Path)
try{
 $reader=New-Object ZXing.BarcodeReader
 $reader.Options.TryHarder=$true
 $result=$reader.Decode($bitmap)
 if($result -and $result.BarcodeFormat.ToString() -eq 'QR_CODE'){
  [pscustomobject]@{format='QR_CODE';text=$result.Text;points=@($result.ResultPoints|ForEach-Object {[pscustomobject]@{x=$_.X;y=$_.Y}})}|ConvertTo-Json -Depth 3 -Compress
 }else{'null'}
}finally{$bitmap.Dispose()}
