param([int]$TargetProcessId=0)
$ErrorActionPreference='Stop'
. "$PSScriptRoot\display-geometry.ps1"
$previous=[OraforgeDisplay]::Enter()
try{
 if(-not $TargetProcessId){[pscustomobject]@{read_only=$true;displays=@([OraforgeDisplay]::Displays())}|ConvertTo-Json -Depth 5 -Compress;return}
 $process=Get-Process -Id $TargetProcessId
 if($process.ProcessName -ne 'EBM2x.WPF'){throw 'Unexpected target process'}
 $geometry=[OraforgeDisplay]::Observe($process.MainWindowHandle)
 $layout=$global:OraforgeUiMap.layout
 $problem=[OraforgeDisplay]::Problem($geometry,$false,$layout.width,$layout.height,$layout.minimum_monitor_width,$layout.minimum_monitor_height)
 [pscustomobject]@{read_only=$true;geometry=$geometry;ready=(-not $problem);problem=$problem}|ConvertTo-Json -Depth 5 -Compress
}finally{[OraforgeDisplay]::Leave($previous)}
