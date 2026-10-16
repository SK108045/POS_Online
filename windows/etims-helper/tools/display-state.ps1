param([int]$TargetProcessId=0)
$ErrorActionPreference='Stop'
. "$PSScriptRoot\display-geometry.ps1"
$previous=[OraforgeDisplay]::Enter()
try{
 if(-not $TargetProcessId){[pscustomobject]@{read_only=$true;displays=@([OraforgeDisplay]::Displays())}|ConvertTo-Json -Depth 5 -Compress;return}
 $process=Get-Process -Id $TargetProcessId
 if($process.ProcessName -ne 'EBM2x.WPF'){throw 'Unexpected target process'}
 Add-Type -AssemblyName UIAutomationClient
 $condition=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty,$TargetProcessId)
 $windows=[Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,$condition)
 $main=@($windows|Where-Object {$_.Current.Name -ceq 'ETIMS1.0'})
 $h=if($main.Count -eq 1){[IntPtr]$main[0].Current.NativeWindowHandle}else{[IntPtr]$process.MainWindowHandle}
 if(-not ('EtimsBounds' -as [type])){Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class EtimsBounds {
 [DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int n);
 [DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);
}
'@
 }
 $geometry=[OraforgeDisplay]::Observe($h)
 $layout=$global:OraforgeUiMap.layout
 if($geometry.Minimized){
  [void][EtimsBounds]::ShowWindow($h,3)
  [void][EtimsBounds]::SetForegroundWindow($h)
  Start-Sleep -Milliseconds 400
  $geometry=[OraforgeDisplay]::Observe($h)
 }
 $problem=[OraforgeDisplay]::Problem($geometry,$false,$layout.width,$layout.height,$layout.minimum_monitor_width,$layout.minimum_monitor_height)
 [pscustomobject]@{read_only=$true;geometry=$geometry;ready=(-not $problem);problem=$problem}|ConvertTo-Json -Depth 5 -Compress
}finally{[OraforgeDisplay]::Leave($previous)}
