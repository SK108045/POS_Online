param([ValidateSet('Click','Close','Text','Read','Snapshot','Complete')][string]$Action,[int]$X,[int]$Y,[string]$Text,[Parameter(Mandatory=$true)][int]$TargetProcessId,[int]$ExpectedWidth=1384,[int]$ExpectedHeight=786,[string]$OutputPath,[switch]$ImageOnly,[switch]$InMemory)
$ErrorActionPreference='Stop'
$OutputEncoding=[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
if(-not ('InvoiceUi' -as [type])){Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public class InvoiceUi {
 [StructLayout(LayoutKind.Sequential)]public struct Rect{public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,uint data,UIntPtr extra);
 [DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("kernel32.dll")]public static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")]public static extern bool AttachThreadInput(uint a,uint b,bool attach);
 [DllImport("user32.dll")]public static extern bool BringWindowToTop(IntPtr h);
 [DllImport("user32.dll")]public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")]public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int n);
}
'@
}
[void][InvoiceUi]::SetProcessDPIAware()
$app=Get-Process -Id $TargetProcessId
if($app.ProcessName -ne 'EBM2x.WPF'){throw 'Unexpected target process'}
Add-Type -AssemblyName UIAutomationClient
$windows=[Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,(New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty,$TargetProcessId)))
$main=@($windows|Where-Object {$_.Current.Name -ceq 'ETIMS1.0'})
if($main.Count -ne 1){throw 'Main eTIMS window missing or ambiguous'}
$h=[IntPtr]$main[0].Current.NativeWindowHandle
if([InvoiceUi]::IsIconic($h)){[void][InvoiceUi]::ShowWindow($h,9);Start-Sleep -Milliseconds 400}
if($Action -eq 'Snapshot'){
 & "$PSScriptRoot\capture-app-window.ps1" -TargetProcessId $TargetProcessId -WindowHandle $h.ToInt64() -OutputPath $OutputPath -InMemory:$InMemory
 if(-not $ImageOnly -and -not $InMemory){& "$PSScriptRoot\inspect_ui.ps1" -TargetProcessId $TargetProcessId -OutputPath ($OutputPath -replace '\.png$','.uia.json') | Out-Null}
 return
}
$rect=New-Object InvoiceUi+Rect
if(-not [InvoiceUi]::GetWindowRect($h,[ref]$rect)){throw 'Window bounds unavailable'}
if(($rect.Right-$rect.Left) -ne $ExpectedWidth -or ($rect.Bottom-$rect.Top) -ne $ExpectedHeight){throw 'Window size changed; observe new screenshot first'}
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
if($Action -in @('Click','Close')){
 if($X -lt 0 -or $Y -lt 0 -or $X -ge $ExpectedWidth -or $Y -ge $ExpectedHeight){throw 'Point outside observed window'}
 [void][InvoiceUi]::SetCursorPos($rect.Left+$X,$rect.Top+$Y)
 [InvoiceUi]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
 Start-Sleep -Milliseconds 20
 [InvoiceUi]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
}else{
 $root=[Windows.Automation.AutomationElement]::FromHandle($h)
 $point=New-Object Windows.Point(($rect.Left+$X),($rect.Top+$Y))
 $entry=[Windows.Automation.AutomationElement]::FromPoint($point)
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
