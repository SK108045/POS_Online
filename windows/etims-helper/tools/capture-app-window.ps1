param([int]$TargetProcessId,[string]$OutputPath,[long]$WindowHandle=0,[switch]$InMemory)
$ErrorActionPreference='Stop'
. "$PSScriptRoot\display-geometry.ps1"
$previous=[OraforgeDisplay]::Enter()
try{
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Drawing
if(-not ('ResearchPrintWindow' -as [type])){Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class ResearchPrintWindow{[DllImport("user32.dll")]public static extern bool PrintWindow(IntPtr window,IntPtr dc,uint flags);}'}
$p=Get-Process -Id $TargetProcessId -ErrorAction Stop
$handle=if($WindowHandle){[IntPtr]$WindowHandle}else{$p.MainWindowHandle}
$root=[Windows.Automation.AutomationElement]::FromHandle($handle)
if($root.Current.ProcessId -ne $TargetProcessId){throw 'Unexpected capture target'}
$geometry=[OraforgeDisplay]::Observe($handle)
Assert-OraforgeGeometry $geometry
$bitmap=New-Object Drawing.Bitmap($geometry.Window.Width,$geometry.Window.Height)
$bitmap.Tag=$geometry
$graphics=[Drawing.Graphics]::FromImage($bitmap)
$dc=$graphics.GetHdc()
try{$captured=[ResearchPrintWindow]::PrintWindow($handle,$dc,2)}finally{$graphics.ReleaseHdc($dc)}
$transferred=$false
try{
 if(-not $captured){throw 'Window capture failed'}
 if(-not [OraforgeDisplay]::Same($geometry,[OraforgeDisplay]::Observe($handle))){throw 'Target window changed'}
 if($InMemory){$transferred=$true;Write-Output -NoEnumerate $bitmap}else{$bitmap.Save($OutputPath,[Drawing.Imaging.ImageFormat]::Png)}
}finally{$graphics.Dispose();if(-not $transferred){$bitmap.Dispose()}}
}finally{[OraforgeDisplay]::Leave($previous)}
