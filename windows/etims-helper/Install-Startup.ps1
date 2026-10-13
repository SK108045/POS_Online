param([string]$HelperExe,[string]$Pythonw)
$ErrorActionPreference='Stop'
$shortcutPath=Join-Path ([Environment]::GetFolderPath('Startup')) 'Oraforge eTIMS Helper.lnk'
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
