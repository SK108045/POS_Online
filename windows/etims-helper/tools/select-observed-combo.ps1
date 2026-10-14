param([Parameter(Mandatory=$true)][int]$TargetProcessId,[int]$X,[int]$Y,[string]$Option)
$ErrorActionPreference='Stop'
. "$PSScriptRoot\display-geometry.ps1"
$previous=[OraforgeDisplay]::Enter()
try{
Add-Type -AssemblyName UIAutomationClient
$app=Get-Process -Id $TargetProcessId
if($app.ProcessName -ne 'EBM2x.WPF'){throw 'Unexpected target'}
$root=[Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
$geometry=[OraforgeDisplay]::Observe($app.MainWindowHandle)
Assert-OraforgeGeometry $geometry
$physical=[OraforgeDisplay]::Target($geometry,$X,$Y)
$point=New-Object Windows.Point($physical.X,$physical.Y)
$condition=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::ComboBox)
$boxes=@($root.FindAll([Windows.Automation.TreeScope]::Descendants,$condition)|Where-Object {$_.Current.BoundingRectangle.Contains($point)})
if($boxes.Count -ne 1 -or -not $boxes[0].Current.IsEnabled){throw 'Expected enabled combo not found'}
$box=$boxes[0]
$expand=[Windows.Automation.ExpandCollapsePattern]$box.GetCurrentPattern([Windows.Automation.ExpandCollapsePattern]::Pattern)
if(-not [OraforgeDisplay]::Same($geometry,[OraforgeDisplay]::Observe($app.MainWindowHandle))){throw 'Target window changed'}
$expand.Expand()
try{
 $condition=New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty,$Option)
 $options=@($box.FindAll([Windows.Automation.TreeScope]::Descendants,$condition)|Where-Object {$_.Current.ControlType -eq [Windows.Automation.ControlType]::ListItem})
 if($options.Count -ne 1){throw 'Requested option is absent or ambiguous'}
 $select=[Windows.Automation.SelectionItemPattern]$options[0].GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern)
 $select.Select()
}finally{$expand.Collapse()}
$selected=([Windows.Automation.SelectionPattern]$box.GetCurrentPattern([Windows.Automation.SelectionPattern]::Pattern)).Current.GetSelection()
if($selected.Count -ne 1 -or $selected[0].Current.Name -cne $Option){throw 'Selection not confirmed'}
}finally{[OraforgeDisplay]::Leave($previous)}
