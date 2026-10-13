param([Parameter(Mandatory=$true)][int]$TargetProcessId,[string]$Path,[ValidateSet('Open','Save Print Output As')][string]$DialogTitle='Open')
$ErrorActionPreference='Stop'
$app=Get-Process -Id $TargetProcessId
if($app.ProcessName -ne 'EBM2x.WPF'){throw 'Unexpected process'}
. $PSScriptRoot\native-file-dialog.ps1
Set-OraforgeNativeFile -TargetProcessId $TargetProcessId -Path $Path -DialogTitle $DialogTitle
