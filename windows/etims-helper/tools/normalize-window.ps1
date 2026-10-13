param([Parameter(Mandatory=$true)][int]$TargetProcessId)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
if(-not ('EtimsBounds' -as [type])){Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class EtimsBounds {
 [DllImport("user32.dll")]public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int n);
 [DllImport("user32.dll")]public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
 [DllImport("user32.dll")]public static extern int GetSystemMetrics(int index);
 [StructLayout(LayoutKind.Sequential)]public struct Rect {public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out Rect r);
}
'@
}
[void][EtimsBounds]::SetProcessDPIAware()
$app=Get-Process -Id $TargetProcessId
if($app.ProcessName -ne 'EBM2x.WPF'){throw 'Unexpected process'}
if([EtimsBounds]::GetSystemMetrics(0) -lt 1366 -or [EtimsBounds]::GetSystemMetrics(1) -lt 768){throw 'Display must support at least 1366 x 768 pixels'}
$condition=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty,$TargetProcessId)
$windows=[Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,$condition)
$main=@($windows|Where-Object {$_.Current.Name -ceq 'ETIMS1.0'})
if($main.Count -ne 1){throw 'Log in normally to one eTIMS client'}
$h=[IntPtr]$main[0].Current.NativeWindowHandle
$rect=New-Object EtimsBounds+Rect
[void][EtimsBounds]::GetWindowRect($h,[ref]$rect)
if(($rect.Right-$rect.Left) -eq 1384 -and ($rect.Bottom-$rect.Top) -eq 786){return}
if([EtimsBounds]::GetSystemMetrics(0) -eq 1366 -and [EtimsBounds]::GetSystemMetrics(1) -eq 768){[void][EtimsBounds]::ShowWindow($h,3);Start-Sleep -Milliseconds 400;return}
[void][EtimsBounds]::ShowWindow($h,9)
if(-not [EtimsBounds]::SetWindowPos($h,[IntPtr]::Zero,0,0,1384,786,0x0040)){throw 'Could not normalize eTIMS bounds'}
Start-Sleep -Milliseconds 400
