param([ValidateSet('Click','Close','Text','Read','Snapshot','Complete')][string]$Action,[int]$X,[int]$Y,[string]$Text,[Parameter(Mandatory=$true)][int]$TargetProcessId,[string]$OutputPath,[switch]$ImageOnly,[switch]$InMemory,$ObservedGeometry,$Selector)
$ErrorActionPreference='Stop'
. "$PSScriptRoot\display-geometry.ps1"
$previous=[OraforgeDisplay]::Enter()
try{
$OutputEncoding=[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
if(-not ('InvoiceUi' -as [type])){Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public class InvoiceUi {
 [DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,uint data,UIntPtr extra);
 [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("kernel32.dll")]public static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")]public static extern bool AttachThreadInput(uint a,uint b,bool attach);
 [DllImport("user32.dll")]public static extern bool BringWindowToTop(IntPtr h);
}
'@
}
$app=Get-Process -Id $TargetProcessId
if($app.ProcessName -ne 'EBM2x.WPF'){throw 'Unexpected target process'}
Add-Type -AssemblyName UIAutomationClient
$windows=[Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,(New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty,$TargetProcessId)))
$main=@($windows|Where-Object {$_.Current.Name -ceq 'ETIMS1.0'})
if($main.Count -ne 1){throw 'Main eTIMS window missing or ambiguous'}
$h=[IntPtr]$main[0].Current.NativeWindowHandle
if($Action -eq 'Snapshot'){
 & "$PSScriptRoot\capture-app-window.ps1" -TargetProcessId $TargetProcessId -WindowHandle $h.ToInt64() -OutputPath $OutputPath -InMemory:$InMemory
 if(-not $ImageOnly -and -not $InMemory){& "$PSScriptRoot\inspect_ui.ps1" -TargetProcessId $TargetProcessId -OutputPath ($OutputPath -replace '\.png$','.uia.json') | Out-Null}
 return
}
$geometry=[OraforgeDisplay]::Observe($h)
Assert-OraforgeGeometry $geometry
if($ObservedGeometry -and -not [OraforgeDisplay]::Same($ObservedGeometry,$geometry)){throw 'Target window changed'}
$target=[OraforgeDisplay]::Target($geometry,$X,$Y)
if(-not $main[0].Current.IsEnabled){throw 'Client has an active modal dialog'}
if([InvoiceUi]::GetForegroundWindow() -ne $h){
 [void][InvoiceUi]::SetForegroundWindow($h)
 try{$main[0].SetFocus()}catch{}
 $focusEnd=[DateTime]::UtcNow.AddMilliseconds(200)
 while([InvoiceUi]::GetForegroundWindow() -ne $h -and [DateTime]::UtcNow -lt $focusEnd){Start-Sleep -Milliseconds 20}
}
if([InvoiceUi]::GetForegroundWindow() -ne $h){
 [uint32]$fgPid=0;$fgThread=[InvoiceUi]::GetWindowThreadProcessId([InvoiceUi]::GetForegroundWindow(),[ref]$fgPid);$ourThread=[InvoiceUi]::GetCurrentThreadId()
 $attached=[InvoiceUi]::AttachThreadInput($ourThread,$fgThread,$true)
 try{[void][InvoiceUi]::BringWindowToTop($h);[void][InvoiceUi]::SetForegroundWindow($h)}finally{if($attached){[void][InvoiceUi]::AttachThreadInput($ourThread,$fgThread,$false)}}
}
if([InvoiceUi]::GetForegroundWindow() -ne $h){throw 'Target has no keyboard/mouse focus'}
if($Action -ne 'Read'){
 $observer=& "$PSScriptRoot\observe-ui.ps1" -WindowHandle $h -TargetProcessId $TargetProcessId
 $observer.BeforeInput()
 $global:OraforgeReady.Arm()
}
if(-not [OraforgeDisplay]::Same($geometry,[OraforgeDisplay]::Observe($h))){throw 'Target window changed'}
[OraforgeDisplay]::RequireHit($h,$target)
$selected=$null
if($Selector){
 # A verified selector must resolve uniquely; never guess on selector failure.
 if(-not $Selector.automation_id){throw 'Observed UIA selector missing or ambiguous'}
 $condition=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::AutomationIdProperty,[string]$Selector.automation_id)
 $matches=@($main[0].FindAll([Windows.Automation.TreeScope]::Descendants,$condition)|Where-Object {
   $_.Current.ProcessId -eq $TargetProcessId -and -not $_.Current.IsPassword -and $_.Current.IsEnabled -and -not $_.Current.IsOffscreen -and
   $_.Current.ControlType.ProgrammaticName -ceq ('ControlType.'+[string]$Selector.control_type) -and
   (-not $Selector.name -or $_.Current.Name -ceq $Selector.name)
 })
 if($matches.Count -ne 1){throw 'Observed UIA selector missing or ambiguous'}
 $selected=$matches[0]
}
if($Action -in @('Click','Close')){
 if($selected){
  $invoke=$null
  if(-not $selected.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$invoke)){throw 'Observed UIA selector missing or ambiguous'}
  $invoke.Invoke()
 }else{
  [void][InvoiceUi]::SetCursorPos($target.X,$target.Y)
  [InvoiceUi]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 20
  [InvoiceUi]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
 }
}else{
 $root=[Windows.Automation.AutomationElement]::FromHandle($h)
 $point=New-Object Windows.Point($target.X,$target.Y)
 $entry=if($selected){$selected}else{[Windows.Automation.AutomationElement]::FromPoint($point)}
 if($entry.Current.ProcessId -ne $TargetProcessId -or $entry.Current.ControlType -ne [Windows.Automation.ControlType]::Edit -or $entry.Current.IsPassword){throw 'Observed point is not an allowed target Edit control'}
 $value=$entry.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
 if($Action -eq 'Read'){[pscustomobject]@{value=$value.Current.Value;read_only=$value.Current.IsReadOnly}|ConvertTo-Json -Compress;return}
 if($value.Current.IsReadOnly){throw 'Field is read-only'}
 $entry.SetFocus()
 if(-not ('ResearchKeyboardInput' -as [type])){Add-Type -Path "$PSScriptRoot\unicode-input.cs"}
 if($Action -eq 'Complete'){
  [ResearchKeyboardInput]::Complete($h)
 }else{
  [ResearchKeyboardInput]::Clear($h)
  [ResearchKeyboardInput]::BulkPhysicalText($h,$Text)
 }
}
$observer.Settle()
}finally{[OraforgeDisplay]::Leave($previous)}
