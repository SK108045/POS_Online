param([Parameter(Mandatory=$true)][int]$TargetProcessId,[Parameter(Mandatory=$true)][ValidateSet('Open','Save Print Output As')][string]$DialogTitle)
$ErrorActionPreference='Stop'
if((Get-Process -Id $TargetProcessId).ProcessName -ne 'EBM2x.WPF'){throw 'Unexpected process'}
. "$PSScriptRoot\native-file-dialog.ps1"
Cancel-OraforgeNativeFile -TargetProcessId $TargetProcessId -DialogTitle $DialogTitle
