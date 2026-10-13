param([string]$HelperExe,[string]$Pythonw,[switch]$Highest,[switch]$StartOnly)
$ErrorActionPreference='Stop'
$shortcutPath=Join-Path ([Environment]::GetFolderPath('Startup')) 'Oraforge eTIMS Helper.lnk'
if($Highest){
 $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
 $principal=New-Object Security.Principal.WindowsPrincipal($identity)
 if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Administrator approval is required to repair helper startup'}
 if(-not $HelperExe){throw 'Select the bundled helper EXE for administrator startup'}
 $executable=(Resolve-Path -LiteralPath $HelperExe).Path
 $taskName='Oraforge eTIMS Helper-'+$identity.User.Value
 if($StartOnly){Start-ScheduledTask -TaskName $taskName;return}
 $action=New-ScheduledTaskAction -Execute $executable -WorkingDirectory (Split-Path $executable -Parent)
 $trigger=New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
 $owner=New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Highest
 $settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
 Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $owner -Settings $settings -Force | Out-Null
 if(Test-Path -LiteralPath $shortcutPath){
  $backupDirectory=Join-Path (Split-Path $executable -Parent) 'startup-backups'
  New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
  Copy-Item -LiteralPath $shortcutPath -Destination (Join-Path $backupDirectory ('normal-startup-'+[guid]::NewGuid().ToString('N')+'.lnk'))
  Remove-Item -LiteralPath $shortcutPath
 }
 [pscustomobject]@{startup_task=$taskName;startup_mode='scheduled_highest'} | ConvertTo-Json -Compress
 return
}
if($StartOnly){throw 'StartOnly requires the approved administrator startup task'}
$userSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if(Get-ScheduledTask -TaskName ('Oraforge eTIMS Helper-'+$userSid) -ErrorAction SilentlyContinue){throw 'Administrator startup is already configured. Use Repair eTIMS Helper Access to update it.'}
$shell=New-Object -ComObject WScript.Shell
$shortcut=$shell.CreateShortcut($shortcutPath)
if($HelperExe){
 $shortcut.TargetPath=(Resolve-Path -LiteralPath $HelperExe).Path
}else{
 if(-not $Pythonw){$Pythonw=(Get-Command pythonw.exe -ErrorAction Stop).Source}
 $shortcut.TargetPath=(Resolve-Path -LiteralPath $Pythonw).Path
 $shortcut.Arguments='"'+(Join-Path $PSScriptRoot 'server.py')+'"'
}
$shortcut.WorkingDirectory=$PSScriptRoot
$shortcut.WindowStyle=7
$shortcut.Description='Oraforge POS authenticated local eTIMS Windows Helper'
$shortcut.Save()
Write-Output 'eTIMS Helper configured to start in your interactive Windows session after sign-in.'
