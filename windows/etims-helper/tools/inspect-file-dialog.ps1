param([Parameter(Mandatory=$true)][int]$TargetProcessId,[ValidateSet('None','Print','Detail')][string]$InvoiceScreen='None')
$ErrorActionPreference='Stop'
if((Get-Process -Id $TargetProcessId).ProcessName -ne 'EBM2x.WPF'){throw 'Unexpected process'}
. "$PSScriptRoot\native-file-dialog.ps1"
$titles=@(foreach($title in @('Open','Save Print Output As')){
 try{$null=Find-OraforgeFileDialog -TargetProcessId $TargetProcessId -DialogTitle $title -TimeoutSeconds 0;$title}
 catch{if(-not $_.Exception.Message.Contains('Expected file dialog missing')){throw}}
})
if($titles.Count -gt 1){throw 'Ambiguous file dialog; no input sent'}
$invoice=$null
if($InvoiceScreen -ne 'None'){
 $condition=[Windows.Automation.AndCondition]::new(
  [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty,$TargetProcessId),
  [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty,'ETIMS1.0'))
 $roots=[Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,$condition)
 if($roots.Count -ne 1){throw 'Main eTIMS window missing or ambiguous'}
 $root=$roots[0];$bounds=$root.Current.BoundingRectangle
 if($bounds.Width -ne 1384 -or $bounds.Height -ne 786){throw 'Unverified window geometry'}
 $x,$y=if($InvoiceScreen -eq 'Print'){@(330,324)}else{@(240,216)}
 $point=New-Object Windows.Point(($bounds.Left+$x),($bounds.Top+$y))
 $edits=$root.FindAll([Windows.Automation.TreeScope]::Descendants,
  [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Edit))
 # Read within the verified WPF subtree. FromPoint would hit the covering
 # system dialog instead. Never focus, enable, close or otherwise change it.
 $matches=@($edits|Where-Object {$_.Current.ProcessId -eq $TargetProcessId -and -not $_.Current.IsPassword -and $_.Current.BoundingRectangle.Contains($point)})
 if($matches.Count -ne 1){throw 'Displayed invoice field is missing or ambiguous'}
 $value=$matches[0].GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).Current.Value
 if($value -cnotmatch '^\d+$'){throw 'Displayed invoice identity is invalid'}
 $invoice=[int]$value
}
[pscustomobject]@{read_only=$true;file_dialog=if($titles.Count){$titles[0]}else{$null};invoice_id=$invoice}|ConvertTo-Json -Compress
