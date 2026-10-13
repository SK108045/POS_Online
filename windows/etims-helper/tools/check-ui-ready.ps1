param([Parameter(Mandatory=$true)][int]$TargetProcessId)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
$process=Get-Process -Id $TargetProcessId
if($process.ProcessName -ne 'EBM2x.WPF'){throw 'Unexpected target'}
$condition=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty,$TargetProcessId)
$windows=[Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,$condition)
$main=@($windows|Where-Object {$_.Current.Name -ceq 'ETIMS1.0'})
if($main.Count -ne 1){throw 'Main eTIMS window missing or ambiguous'}
$observer=& "$PSScriptRoot\observe-ui.ps1" -WindowHandle ([IntPtr]$main[0].Current.NativeWindowHandle) -TargetProcessId $TargetProcessId
$preInput=[Diagnostics.Stopwatch]::StartNew()
$observer.BeforeInput()
$preInput.Stop()
$observer.Arm()
$watch=[Diagnostics.Stopwatch]::StartNew()
$observer.Settle()
[pscustomobject]@{read_only=$true;events_available=$observer.Observing;before_input_seconds=$preInput.Elapsed.TotalSeconds;settle_seconds=$watch.Elapsed.TotalSeconds;status=$observer.Status}|ConvertTo-Json -Compress
