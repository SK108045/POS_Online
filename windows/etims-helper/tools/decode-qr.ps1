param([Parameter(Mandatory=$true)][string]$Path,[Parameter(Mandatory=$true)][string]$InstallationDir,[ValidateSet('Fast','Thorough')][string]$Mode='Fast')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
[void][Reflection.Assembly]::LoadFrom((Join-Path $InstallationDir 'bin\zxing.dll'))
$bitmap=[Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $Path).Path)
try{
 $reader=New-Object ZXing.BarcodeReader
 $reader.Options.TryHarder=($Mode -eq 'Thorough')
 $formats=New-Object 'System.Collections.Generic.List[ZXing.BarcodeFormat]'
 $formats.Add([ZXing.BarcodeFormat]::QR_CODE)
 $reader.Options.PossibleFormats=$formats
 $result=$reader.Decode($bitmap)
 if($result -and $result.BarcodeFormat.ToString() -eq 'QR_CODE'){
  [pscustomobject]@{format='QR_CODE';text=$result.Text;points=@($result.ResultPoints|ForEach-Object {[pscustomobject]@{x=$_.X;y=$_.Y}})}|ConvertTo-Json -Depth 3 -Compress
 }else{'null'}
}finally{$bitmap.Dispose()}
