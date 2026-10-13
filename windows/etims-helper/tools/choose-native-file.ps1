param([Parameter(Mandatory=$true)][int]$TargetProcessId,[string]$Path,[string]$DialogTitle='Open')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public class NativeFileChoice{
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,string l);
 [DllImport("user32.dll")]public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
}
'@
if($DialogTitle -eq 'Open' -and -not (Test-Path -LiteralPath $Path -PathType Leaf)){throw 'Input file missing'}
if($DialogTitle -eq 'Save Print Output As' -and (Test-Path -LiteralPath $Path)){throw 'Output exists; refusing overwrite'}
$app=Get-Process -Id $TargetProcessId
if($app.ProcessName -ne 'EBM2x.WPF'){throw 'Unexpected process'}
$condition=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty,$TargetProcessId)
$roots=[Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,$condition)
$dialogs=@(foreach($root in $roots){
 if($root.Current.Name -ceq $DialogTitle){$root}
 $root.FindAll([Windows.Automation.TreeScope]::Descendants,(New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Window)))|Where-Object {$_.Current.Name -ceq $DialogTitle -and $_.Current.ProcessId -eq $TargetProcessId}
})
if($dialogs.Count -ne 1){throw 'Expected file dialog missing or ambiguous'}
$all=$dialogs[0].FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
$editId=if($DialogTitle -eq 'Save Print Output As'){'1001'}else{'1148'}
$edits=@($all|Where-Object {$_.Current.AutomationId -eq $editId -and $_.Current.ClassName -eq 'Edit'})
$buttons=@($all|Where-Object {$_.Current.AutomationId -eq '1' -and $_.Current.ClassName -eq 'Button'})
if($edits.Count -ne 1 -or $buttons.Count -ne 1){throw 'Observed native file controls missing'}
foreach($element in @($edits[0],$buttons[0])){[uint32]$pidOwner=0;[void][NativeFileChoice]::GetWindowThreadProcessId([IntPtr]$element.Current.NativeWindowHandle,[ref]$pidOwner);if($pidOwner -ne $TargetProcessId){throw 'Foreign control'}}
[void][NativeFileChoice]::SendMessage([IntPtr]$edits[0].Current.NativeWindowHandle,0x000C,[IntPtr]::Zero,$Path)
if(-not [NativeFileChoice]::PostMessage([IntPtr]$buttons[0].Current.NativeWindowHandle,0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'Open action failed'}
