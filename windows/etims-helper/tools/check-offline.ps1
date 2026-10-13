param([Parameter(Mandatory=$true)][string]$InstallationDir)
$ErrorActionPreference='Stop'
$OutputEncoding=[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
# Read-only inspection of effective Windows Firewall policy. Never add,
# disable, remove or alter rules, profiles, services or network connections.
function Is-Any($Values){return (@($Values).Count -eq 1 -and [string]@($Values)[0] -eq 'Any')}
$profiles=@(Get-NetFirewallProfile -PolicyStore ActiveStore)
$profilesEnabled=($profiles.Count -eq 3 -and @($profiles|Where-Object {$_.Enabled -ne 'True'}).Count -eq 0)
$serviceRunning=((Get-Service -Name mpssvc).Status -eq 'Running')
$programs=@((Join-Path $InstallationDir 'bin\EBM2x.WPF.exe'),(Join-Path $InstallationDir 'EBM2xLauncher.exe'))
$blocked=@{}
foreach($program in $programs){$blocked[[IO.Path]::GetFullPath($program)]=$false}
$rules=@(Get-NetFirewallRule -PolicyStore ActiveStore -Enabled True -Direction Outbound -Action Block)
foreach($rule in $rules){
 if([int]$rule.Profile -ne 0){continue} # Rule must apply to every profile.
 $app=$rule|Get-NetFirewallApplicationFilter
 if(-not $app.Program -or $app.Program -eq 'Any'){continue}
 $program=[IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables([string]$app.Program))
 if(-not $blocked.ContainsKey($program)){continue}
 $ports=$rule|Get-NetFirewallPortFilter
 $addresses=$rule|Get-NetFirewallAddressFilter
 $interfaces=$rule|Get-NetFirewallInterfaceFilter
 $types=$rule|Get-NetFirewallInterfaceTypeFilter
 $services=$rule|Get-NetFirewallServiceFilter
 $security=$rule|Get-NetFirewallSecurityFilter
 if(-not (Is-Any $ports.Protocol) -or -not (Is-Any $ports.LocalPort) -or -not (Is-Any $ports.RemotePort)){continue}
 if(-not (Is-Any $addresses.LocalAddress) -or -not (Is-Any $addresses.RemoteAddress)){continue}
 if(-not (Is-Any $interfaces.InterfaceAlias) -or [int]$types.InterfaceType -ne 0){continue}
 if(-not (Is-Any $services.Service) -or ($app.Package -and $app.Package -ne 'Any')){continue}
 if([int]$security.Authentication -ne 0 -or [int]$security.Encryption -ne 0){continue}
 if(-not (Is-Any $security.LocalUser) -or -not (Is-Any $security.RemoteUser) -or -not (Is-Any $security.RemoteMachine)){continue}
 $blocked[$program]=$true
}
$count=@($blocked.Values|Where-Object {$_}).Count
[pscustomobject]@{offline_verified=($profilesEnabled -and $serviceRunning -and $count -eq 2);firewall_profiles_enabled=$profilesEnabled;firewall_service_running=$serviceRunning;blocked_programs=$count;required_programs=2}|ConvertTo-Json -Compress
