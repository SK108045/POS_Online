param([int]$TargetProcessId,[string]$OutputPath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$condition=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty,$TargetProcessId)
$windows=[Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,$condition)
if($windows.Count -eq 0){
 $proc=Get-Process -Id $TargetProcessId -ErrorAction Stop
 if($proc.MainWindowHandle -ne [IntPtr]::Zero){$windows=@([Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle))}
}
$records=New-Object Collections.Generic.List[object]
function Inspect-Node($node,[string]$parent,[int]$depth) {
 if($depth -gt 35 -or $records.Count -ge 5000){return}
 try {
  $c=$node.Current;$id=($node.GetRuntimeId() -join '.')
  $name=if($c.IsPassword){'[PASSWORD CONTROL]'}elseif($c.ControlType -eq [Windows.Automation.ControlType]::Edit -or $c.ClassName -match 'FormsTextBox|PasswordBox'){'[EDIT CONTROL NAME WITHHELD]'}else{[string]$c.Name}
  $name=$name -replace '\b[AP]\d{9}[A-Z]\b','[TAXPAYER PIN WITHHELD]'
  if($name.Length -gt 250){$name=$name.Substring(0,250)+'[TRUNCATED]'}
  $r=$c.BoundingRectangle
  $records.Add([pscustomobject]@{RuntimeId=$id;Parent=$parent;Depth=$depth;ControlType=$c.ControlType.ProgrammaticName;AutomationId=$c.AutomationId;Name=$name;ClassName=$c.ClassName;FrameworkId=$c.FrameworkId;NativeWindowHandle=$c.NativeWindowHandle;IsEnabled=$c.IsEnabled;IsOffscreen=$c.IsOffscreen;IsPassword=$c.IsPassword;Bounds=@($r.X,$r.Y,$r.Width,$r.Height);Patterns=@($node.GetSupportedPatterns()|ForEach-Object {$_.ProgrammaticName})})
  $child=[Windows.Automation.TreeWalker]::RawViewWalker.GetFirstChild($node)
  while($null -ne $child){Inspect-Node $child $id ($depth+1);$child=[Windows.Automation.TreeWalker]::RawViewWalker.GetNextSibling($child)}
 } catch {$records.Add([pscustomobject]@{Parent=$parent;Depth=$depth;ReadError=$_.Exception.GetType().FullName})}
}
foreach($window in $windows){Inspect-Node $window '' 0}
$json=ConvertTo-Json -InputObject $records.ToArray() -Depth 8
if($OutputPath){[IO.File]::WriteAllText($OutputPath,$json,(New-Object Text.UTF8Encoding($false)))}
$records | Select-Object Depth,ControlType,AutomationId,Name,ClassName,NativeWindowHandle,IsPassword,@{Name='Patterns';Expression={$_.Patterns -join ','}} | Format-Table -AutoSize | Out-String -Width 220
