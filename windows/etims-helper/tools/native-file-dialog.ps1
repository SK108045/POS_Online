# Shared implementation, also exercised against isolated Windows file dialogs.
Add-Type -AssemblyName UIAutomationClient
if(-not ('NativeFileChoice' -as [type])){Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;using System.Text;
public class NativeFileChoice{
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,string l);
 [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW",CharSet=CharSet.Unicode,SetLastError=true)]public static extern IntPtr WriteText(IntPtr h,uint m,UIntPtr w,string l,uint flags,uint timeout,out UIntPtr result);
 [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW",CharSet=CharSet.Unicode,SetLastError=true)]public static extern IntPtr ReadText(IntPtr h,uint m,UIntPtr w,StringBuilder l,uint flags,uint timeout,out UIntPtr result);
 [DllImport("user32.dll")]public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 [DllImport("user32.dll")]public static extern bool IsWindowEnabled(IntPtr h);
 [DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
}
'@}
function Find-OraforgeFileDialog {
 param([int]$TargetProcessId,[ValidateSet('Open','Save Print Output As')][string]$DialogTitle,[double]$TimeoutSeconds=30)
 Add-Type -AssemblyName UIAutomationClient
 $condition=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty,$TargetProcessId)
 $cache=New-Object Windows.Automation.CacheRequest
 $cache.TreeFilter=[Windows.Automation.Condition]::TrueCondition
 foreach($property in @([Windows.Automation.AutomationElement]::NameProperty,[Windows.Automation.AutomationElement]::AutomationIdProperty,[Windows.Automation.AutomationElement]::ClassNameProperty,[Windows.Automation.AutomationElement]::NativeWindowHandleProperty,[Windows.Automation.AutomationElement]::ProcessIdProperty)){$cache.Add($property)}
 $scope=$cache.Activate()
 try{
  $end=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do{
   $roots=[Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,$condition)
   $dialogs=@($roots|Where-Object {$_.Cached.Name -ceq $DialogTitle})
   if($dialogs.Count -eq 0 -and $TimeoutSeconds -gt 0 -and [DateTime]::UtcNow.AddSeconds(1) -ge $end){
    $windowCondition=[Windows.Automation.AndCondition]::new([Windows.Automation.Condition[]]@(
     $condition,
     [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty,$DialogTitle),
     [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Window)))
    $dialogs=@(foreach($root in $roots){$root.FindAll([Windows.Automation.TreeScope]::Descendants,$windowCondition)})
   }
   $dialogs=@($dialogs|Sort-Object {$_.Cached.NativeWindowHandle} -Unique)
   if($dialogs.Count -eq 0 -and [DateTime]::UtcNow -lt $end){Start-Sleep -Milliseconds 100}
  }while($dialogs.Count -eq 0 -and [DateTime]::UtcNow -lt $end)
  if($dialogs.Count -eq 0){throw 'Expected file dialog missing before input'}
  if($dialogs.Count -ne 1){throw 'Ambiguous file dialog; no input sent'}
  # Common Item Dialog uses Edit 1001 inside ComboBox 1148. Legacy Open
  # dialogs can expose Edit 1148. Select only Edit controls, never the combo.
  $editIds=[Windows.Automation.OrCondition]::new(
   [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty,'1001'),
   [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty,'1148'))
  $editCondition=[Windows.Automation.AndCondition]::new($editIds,
   [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ClassNameProperty,'Edit'))
  $buttonCondition=[Windows.Automation.AndCondition]::new(
   [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty,'1'),
   [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ClassNameProperty,'Button'))
  $all=$dialogs[0].FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.OrCondition]::new($editCondition,$buttonCondition))
  $edits=@($all|Where-Object {$_.Cached.AutomationId -in @('1001','1148') -and $_.Cached.ClassName -eq 'Edit'})
  $buttons=@($all|Where-Object {$_.Cached.AutomationId -eq '1' -and $_.Cached.ClassName -eq 'Button'})
  if($edits.Count -ne 1 -or $buttons.Count -ne 1){throw 'Observed native file controls missing'}
  return [pscustomobject]@{Dialog=$dialogs[0];Edit=$edits[0];Button=$buttons[0]}
 }finally{$scope.Dispose()}
}

function Set-OraforgeNativeFile {
 param([int]$TargetProcessId,[string]$Path,[string]$DialogTitle='Open')
 if($DialogTitle -eq 'Open' -and -not (Test-Path -LiteralPath $Path -PathType Leaf)){throw 'Input file missing'}
 if($DialogTitle -eq 'Save Print Output As' -and (Test-Path -LiteralPath $Path)){throw 'Output exists; refusing overwrite'}
 $controls=Find-OraforgeFileDialog -TargetProcessId $TargetProcessId -DialogTitle $DialogTitle
 foreach($element in @($controls.Edit,$controls.Button)){
  [uint32]$owner=0
  [void][NativeFileChoice]::GetWindowThreadProcessId([IntPtr]$element.Cached.NativeWindowHandle,[ref]$owner)
  if($owner -ne $TargetProcessId){throw 'Foreign control'}
 }
 if($controls.Edit.Current.IsPassword){throw 'Unexpected password control'}
 [UIntPtr]$written=[UIntPtr]::Zero
 $handle=[IntPtr]$controls.Edit.Cached.NativeWindowHandle
 if([NativeFileChoice]::WriteText($handle,0x000C,[UIntPtr]::Zero,$Path,2,1500,[ref]$written) -eq [IntPtr]::Zero -or $written -eq [UIntPtr]::Zero){throw 'File path was not accepted; no save action sent'}
 # The Windows Print to PDF filename Edit need not implement ValuePattern.
 # Read the real Win32 Edit text after setting it, rather than demanding that
 # optional UIA pattern. Ownership and non-password checks already passed.
 $text=New-Object Text.StringBuilder(32768)
 [UIntPtr]$length=[UIntPtr]::Zero
 if([NativeFileChoice]::ReadText($handle,0x000D,[UIntPtr]::new([uint32]32768),$text,2,1500,[ref]$length) -eq [IntPtr]::Zero -or $text.ToString() -cne $Path){throw 'File path was not accepted; no save action sent'}
 $buttonHandle=[IntPtr]$controls.Button.Cached.NativeWindowHandle
 $end=[DateTime]::UtcNow.AddSeconds(3)
 while(-not [NativeFileChoice]::IsWindowEnabled($buttonHandle)){
  if([DateTime]::UtcNow -ge $end){throw 'File action not available; no save action sent'}
  Start-Sleep -Milliseconds 20
 }
 $invoke=$null
 if($controls.Button.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$invoke)){
  # InvokePattern performs the normal native button action without depending
  # on foreground mouse focus. Dispatch exactly once, including on failure.
  $invoke.Invoke()
 }else{
  if([NativeFileChoice]::GetForegroundWindow() -ne [IntPtr]$controls.Dialog.Cached.NativeWindowHandle){throw 'File dialog has no focus; no save action sent'}
  if(-not [NativeFileChoice]::PostMessage($buttonHandle,0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'Open action failed'}
 }
 # Confirmation only: never click Save/Open again after an unknown outcome.
 $end=[DateTime]::UtcNow.AddSeconds(20)
 while($true){
  try{$null=Find-OraforgeFileDialog -TargetProcessId $TargetProcessId -DialogTitle $DialogTitle -TimeoutSeconds 0}
  catch{if($_.Exception.Message.Contains('Expected file dialog missing')){return};throw}
  if([DateTime]::UtcNow -ge $end){throw 'File action was not confirmed; Save or Open was not repeated'}
  Start-Sleep -Milliseconds 50
 }
}

function Cancel-OraforgeNativeFile {
 param([int]$TargetProcessId,[ValidateSet('Open','Save Print Output As')][string]$DialogTitle)
 $controls=Find-OraforgeFileDialog -TargetProcessId $TargetProcessId -DialogTitle $DialogTitle -TimeoutSeconds 0
 $condition=[Windows.Automation.AndCondition]::new(
  [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty,'2'),
  [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ClassNameProperty,'Button'))
 $buttons=$controls.Dialog.FindAll([Windows.Automation.TreeScope]::Descendants,$condition)
 if($buttons.Count -ne 1){throw 'Native file Cancel button is missing or ambiguous'}
 $button=$buttons[0];$handle=[IntPtr]$button.Current.NativeWindowHandle
 [uint32]$owner=0;[void][NativeFileChoice]::GetWindowThreadProcessId($handle,[ref]$owner)
 if($owner -ne $TargetProcessId -or -not $button.Current.IsEnabled){throw 'Native file Cancel target is unavailable'}
 $invoke=$null
 if($button.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$invoke)){$invoke.Invoke()}
 else{
  if([NativeFileChoice]::GetForegroundWindow() -ne [IntPtr]$controls.Dialog.Cached.NativeWindowHandle){throw 'File dialog has no focus; no cancel action sent'}
  if(-not [NativeFileChoice]::PostMessage($handle,0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'Native file Cancel action failed'}
 }
 $end=[DateTime]::UtcNow.AddSeconds(15)
 while($true){
  try{$null=Find-OraforgeFileDialog -TargetProcessId $TargetProcessId -DialogTitle $DialogTitle -TimeoutSeconds 0}
  catch{if($_.Exception.Message.Contains('Expected file dialog missing')){return};throw}
  if([DateTime]::UtcNow -ge $end){throw 'Native file Cancel was not confirmed; action was not repeated'}
  Start-Sleep -Milliseconds 50
 }
}
