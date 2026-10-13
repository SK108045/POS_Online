param([int]$TargetProcessId,[string]$OutputPath,[long]$WindowHandle=0,[switch]$InMemory)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Drawing
if(-not ('ResearchPrintWindow' -as [type])){Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class ResearchPrintWindow{[DllImport("user32.dll")]public static extern bool PrintWindow(IntPtr window,IntPtr dc,uint flags);}'}
$p=Get-Process -Id $TargetProcessId -ErrorAction Stop
$handle=if($WindowHandle){[IntPtr]$WindowHandle}else{$p.MainWindowHandle}
$root=[Windows.Automation.AutomationElement]::FromHandle($handle)
if($root.Current.ProcessId -ne $TargetProcessId){throw 'Unexpected capture target'}
$bounds=$root.Current.BoundingRectangle
if([double]::IsInfinity($bounds.Width) -or [double]::IsInfinity($bounds.Height) -or [double]::IsNaN($bounds.Width) -or [double]::IsNaN($bounds.Height) -or $bounds.Width -le 0 -or $bounds.Height -le 0){throw 'Window bounds unavailable; verify helper administrator access'}
$bitmap=New-Object Drawing.Bitmap([int]$bounds.Width,[int]$bounds.Height)
$graphics=[Drawing.Graphics]::FromImage($bitmap)
$dc=$graphics.GetHdc()
try{$captured=[ResearchPrintWindow]::PrintWindow($handle,$dc,2)}finally{$graphics.ReleaseHdc($dc)}
$transferred=$false
try{
 if(-not $captured){throw 'Window capture failed'}
 if($InMemory){$transferred=$true;Write-Output -NoEnumerate $bitmap}else{$bitmap.Save($OutputPath,[Drawing.Imaging.ImageFormat]::Png)}
}finally{$graphics.Dispose();if(-not $transferred){$bitmap.Dispose()}}
