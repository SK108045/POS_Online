param([Parameter(Mandatory=$true)][int]$TargetProcessId)
$ErrorActionPreference='Stop'
. "$PSScriptRoot\display-geometry.ps1"
Add-Type -AssemblyName UIAutomationClient
if(-not ('EtimsBounds' -as [type])){Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class EtimsBounds {
 [DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int n);
 [DllImport("user32.dll")]public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
}
'@
}
$previous=[OraforgeDisplay]::Enter()
try{
$app=Get-Process -Id $TargetProcessId
if($app.ProcessName -ne 'EBM2x.WPF'){throw 'Unexpected process'}
$condition=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty,$TargetProcessId)
$windows=[Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,$condition)
$main=@($windows|Where-Object {$_.Current.Name -ceq 'ETIMS1.0'})
if($main.Count -ne 1){throw 'Log in normally to one eTIMS client'}
$h=[IntPtr]$main[0].Current.NativeWindowHandle
$geometry=[OraforgeDisplay]::Observe($h)
$layout=$global:OraforgeUiMap.layout
if($geometry.Minimized -or [OraforgeDisplay]::Problem($geometry,$true,$layout.width,$layout.height,$layout.minimum_monitor_width,$layout.minimum_monitor_height)){
 if($geometry.Monitor.Width -eq $layout.minimum_monitor_width -and $geometry.Monitor.Height -eq $layout.minimum_monitor_height){
  [void][EtimsBounds]::ShowWindow($h,3)
 }else{
  [void][EtimsBounds]::ShowWindow($h,9)
  if(-not [EtimsBounds]::SetWindowPos($h,[IntPtr]::Zero,$geometry.Work.Left,$geometry.Work.Top,$layout.width,$layout.height,0x0040)){throw 'Could not normalize eTIMS bounds'}
 }
 [void][EtimsBounds]::ShowWindow($h,3)
 Start-Sleep -Milliseconds 400
 $geometry=[OraforgeDisplay]::Observe($h)
}
Assert-OraforgeGeometry $geometry
}finally{[OraforgeDisplay]::Leave($previous)}
