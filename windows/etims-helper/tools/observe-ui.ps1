param([Parameter(Mandatory=$true)][IntPtr]$WindowHandle,[Parameter(Mandatory=$true)][int]$TargetProcessId)
$ErrorActionPreference='Stop'
if(-not ('OraforgeUiReadiness' -as [type])){
 Add-Type -Path "$PSScriptRoot\ui-readiness.cs" -ReferencedAssemblies UIAutomationClient,UIAutomationTypes,WindowsBase
}
if(-not $global:OraforgeReady -or $global:OraforgeReadyHandle -ne $WindowHandle -or $global:OraforgeReadyPid -ne $TargetProcessId){
 if($global:OraforgeReady){$global:OraforgeReady.Dispose()}
 $global:OraforgeReady=New-Object OraforgeUiReadiness($WindowHandle,$TargetProcessId)
 $global:OraforgeReadyHandle=$WindowHandle;$global:OraforgeReadyPid=$TargetProcessId
}
Write-Output -NoEnumerate $global:OraforgeReady
