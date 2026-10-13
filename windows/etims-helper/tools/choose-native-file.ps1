param([Parameter(Mandatory=$true)][int]$TargetProcessId,[string]$Path,[string]$DialogTitle='Open')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
if(-not ('NativeFileChoice' -as [type])){Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public class NativeFileChoice{
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,string l);
 [DllImport("user32.dll")]public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
}
'@
}
if($DialogTitle -eq 'Open' -and -not (Test-Path -LiteralPath $Path -PathType Leaf)){throw 'Input file missing'}
if($DialogTitle -eq 'Save Print Output As' -and (Test-Path -LiteralPath $Path)){throw 'Output exists; refusing overwrite'}
$app=Get-Process -Id $TargetProcessId
if($app.ProcessName -ne 'EBM2x.WPF'){throw 'Unexpected process'}
$condition=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty,$TargetProcessId)
$cache=New-Object Windows.Automation.CacheRequest
foreach($property in @([Windows.Automation.AutomationElement]::NameProperty,[Windows.Automation.AutomationElement]::AutomationIdProperty,[Windows.Automation.AutomationElement]::ClassNameProperty,[Windows.Automation.AutomationElement]::NativeWindowHandleProperty,[Windows.Automation.AutomationElement]::ProcessIdProperty)){$cache.Add($property)}
$scope=$cache.Activate()
try{
 $discoveryEnd=[DateTime]::UtcNow.AddSeconds(30)
 do{
 $roots=[Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,$condition)
 $dialogs=@($roots|Where-Object {$_.Cached.Name -ceq $DialogTitle})
 if($dialogs.Count -eq 0){
  $windowCondition=[Windows.Automation.AndCondition]::new([Windows.Automation.Condition[]]@(
   $condition,
   [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty,$DialogTitle),
   [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Window)))
  $dialogs=@(foreach($root in $roots){$root.FindAll([Windows.Automation.TreeScope]::Descendants,$windowCondition)})
 }
 # One dialog can be discoverable through more than one top-level root.
 $dialogs=@($dialogs|Sort-Object {$_.Cached.NativeWindowHandle} -Unique)
 if($dialogs.Count -eq 0 -and [DateTime]::UtcNow -lt $discoveryEnd){Start-Sleep -Milliseconds 100}
 }while($dialogs.Count -eq 0 -and [DateTime]::UtcNow -lt $discoveryEnd)
 if($dialogs.Count -eq 0){throw 'Expected file dialog missing before input'}
 if($dialogs.Count -ne 1){throw 'Ambiguous file dialog; no input sent'}
 $editId=if($DialogTitle -eq 'Save Print Output As'){'1001'}else{'1148'}
 $editCondition=[Windows.Automation.AndCondition]::new([Windows.Automation.Condition[]]@(
  [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty,$editId),
  [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ClassNameProperty,'Edit')))
 $buttonCondition=[Windows.Automation.AndCondition]::new([Windows.Automation.Condition[]]@(
  [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty,'1'),
  [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ClassNameProperty,'Button')))
 $wanted=[Windows.Automation.OrCondition]::new($editCondition,$buttonCondition)
 $all=$dialogs[0].FindAll([Windows.Automation.TreeScope]::Descendants,$wanted)
}finally{$scope.Dispose()}
$editId=if($DialogTitle -eq 'Save Print Output As'){'1001'}else{'1148'}
$edits=@($all|Where-Object {$_.Cached.AutomationId -eq $editId -and $_.Cached.ClassName -eq 'Edit'})
$buttons=@($all|Where-Object {$_.Cached.AutomationId -eq '1' -and $_.Cached.ClassName -eq 'Button'})
if($edits.Count -ne 1 -or $buttons.Count -ne 1){throw 'Observed native file controls missing'}
foreach($element in @($edits[0],$buttons[0])){[uint32]$pidOwner=0;[void][NativeFileChoice]::GetWindowThreadProcessId([IntPtr]$element.Cached.NativeWindowHandle,[ref]$pidOwner);if($pidOwner -ne $TargetProcessId){throw 'Foreign control'}}
if($edits[0].Current.IsPassword){throw 'Unexpected password control'}
[void][NativeFileChoice]::SendMessage([IntPtr]$edits[0].Cached.NativeWindowHandle,0x000C,[IntPtr]::Zero,$Path)
$value=$edits[0].GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
if($value.Current.Value -cne $Path){throw 'File path was not accepted; no save action sent'}
if(-not [NativeFileChoice]::PostMessage([IntPtr]$buttons[0].Cached.NativeWindowHandle,0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'Open action failed'}
