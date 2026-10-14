param([string]$DiagnosticDirectory = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'OraforgePOS\etims\diagnostics'))
$ErrorActionPreference='Stop'
. "$PSScriptRoot\display-geometry.ps1"
$previous=[OraforgeDisplay]::Enter()
$actual=$null
try{
 $result=[ordered]@{read_only=$true;displays=@([OraforgeDisplay]::Displays());default_printer=@();ready=$false;
  profiles=@(foreach($profile in $global:OraforgeUiMap.screens.psobject.Properties){@{profile=$profile.Name;status='not_tested_no_client'}});normalization_performed=$false}
 try{$result.default_printer=@(Get-CimInstance Win32_Printer -Filter 'Default=True' | Select-Object -ExpandProperty Name)}catch{$result.printer_check='unavailable'}
 $apps=@(Get-Process -Name EBM2x.WPF -ErrorAction SilentlyContinue)
 if($apps.Count -ne 1){$result.problem='Open exactly one eTIMS client and log in normally';$result|ConvertTo-Json -Depth 7 -Compress;return}
 Add-Type -AssemblyName UIAutomationClient,System.Drawing
 $condition=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty,$apps[0].Id)
 $roots=@([Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,$condition)|Where-Object {$_.Current.Name -ceq 'ETIMS1.0'})
 if($roots.Count -ne 1){$result.problem='Logged-in eTIMS window is missing or ambiguous';$result|ConvertTo-Json -Depth 7 -Compress;return}
 $h=[IntPtr]$roots[0].Current.NativeWindowHandle
 $geometry=[OraforgeDisplay]::Observe($h);$layout=$global:OraforgeUiMap.layout
 $result.geometry=$geometry
 $result.expected_normalized_size=@($layout.width,$layout.height)
 $problem=[OraforgeDisplay]::Problem($geometry,$true,$layout.width,$layout.height,$layout.minimum_monitor_width,$layout.minimum_monitor_height)
 $result.normalized=(-not $problem)
 if($problem){
  $result.problem=$problem
  $result.profiles=@(foreach($profile in $global:OraforgeUiMap.screens.psobject.Properties){@{profile=$profile.Name;status='not_tested_geometry'}})
  $result|ConvertTo-Json -Depth 7 -Compress;return
 }
 $actual=& "$PSScriptRoot\capture-app-window.ps1" -TargetProcessId $apps[0].Id -WindowHandle $h.ToInt64() -InMemory
 if(-not ('OraforgeScreenGuard' -as [type])){Add-Type -Path "$PSScriptRoot\screen-guard.cs" -ReferencedAssemblies System.Drawing}
 $best=$null;$bestScore=-1.0;$matched=@()
 $result.profiles=@(foreach($profile in $global:OraforgeUiMap.screens.psobject.Properties){
  $r=$profile.Value.region;$reference=Join-Path "$PSScriptRoot\..\profiles" ($profile.Name+'.png')
  $score=[OraforgeScreenGuard]::ScoreFile($actual,$reference,$r[0],$r[1],$r[2],$r[3])
  if($profile.Name -notlike 'toolbar-*'){
   if($score -gt $bestScore){$best=$profile;$bestScore=$score}
   if($score -ge 0.996 -and $profile.Value.runtime -ne $false){$matched+=$profile.Name}
  }
  @{profile=$profile.Name;status=if($score -ge 0.996){'match'}else{'mismatch_with_current_page'};score=[Math]::Round($score,6)}
 })
 $result.matched_screens=$matched
 $result.ready=$matched.Count -gt 0 -and $result.default_printer.Count -eq 1 -and $result.default_printer[0] -ceq 'Microsoft Print to PDF'
 if($matched.Count -eq 0 -and $best){
  $r=$best.Value.region;$reference=Join-Path "$PSScriptRoot\..\profiles" ($best.Name+'.png')
  $null=[OraforgeScreenGuard]::SaveComparison($actual,$reference,$r[0],$r[1],$r[2],$r[3],$DiagnosticDirectory)
  $result.problem='Unrecognized current screen; comparison saved privately. Best profile: '+$best.Name+'; score: '+$bestScore.ToString('F6',[Globalization.CultureInfo]::InvariantCulture)
 }
 # Discover only identifiers/control types. Never return Names, Values, PINs,
 # text contents, screenshots or customer records through console diagnostics.
 $result.uia_identifiers=@($roots[0].FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition) |
   Where-Object {-not $_.Current.IsPassword -and $_.Current.AutomationId} |
   ForEach-Object {@{automation_id=$_.Current.AutomationId;control_type=$_.Current.ControlType.ProgrammaticName}})
 $result|ConvertTo-Json -Depth 7 -Compress
}finally{if($actual){$actual.Dispose()};[OraforgeDisplay]::Leave($previous)}
