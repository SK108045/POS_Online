if(-not ('OraforgeDisplay' -as [type])){Add-Type -Path "$PSScriptRoot\display-geometry.cs"}
if(-not $global:OraforgeUiMap){$global:OraforgeUiMap=Get-Content -LiteralPath "$PSScriptRoot\..\profiles\ui-map.json" -Raw | ConvertFrom-Json}
function Assert-OraforgeGeometry($Geometry,[bool]$Normalized=$true){
 $layout=$global:OraforgeUiMap.layout
 [OraforgeDisplay]::Require($Geometry,$Normalized,$layout.width,$layout.height,$layout.minimum_monitor_width,$layout.minimum_monitor_height)
}
