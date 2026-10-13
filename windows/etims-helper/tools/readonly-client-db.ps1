param([Parameter(Mandatory=$true)][string]$InstallationDir,[Parameter(Mandatory=$true)][string]$DatabasePath)
$ErrorActionPreference='Stop'
$bin=Join-Path $InstallationDir 'bin'
$handler=[ResolveEventHandler]{param($sender,$eventArgs) try { return [Reflection.Assembly]::ReflectionOnlyLoad([string]$eventArgs.Name) } catch { return $null }}
[AppDomain]::CurrentDomain.add_ReflectionOnlyAssemblyResolve($handler)
[void][Reflection.Assembly]::ReflectionOnlyLoadFrom((Join-Path $bin 'EBM2x.dll'))
[void][Reflection.Assembly]::ReflectionOnlyLoadFrom((Join-Path $bin 'System.Data.SQLite.dll'))
$w=[Reflection.Assembly]::ReflectionOnlyLoadFrom((Join-Path $bin 'EBM2x.WPF.exe'))
$providerType=$w.GetType('EBM2x.WPF.sqlite3.EBM2xSQLiteClientProvider')
$method=$providerType.GetMethod('OpenConnection')
$providerIl=$method.GetMethodBody().GetILAsByteArray()
if($providerIl[41] -ne 0x72){throw 'Unexpected provider instruction'}
$dbOptions=$w.ManifestModule.ResolveString([BitConverter]::ToInt32($providerIl,42))
[void][Reflection.Assembly]::LoadFrom((Join-Path $bin 'System.Data.SQLite.dll'))
$builder=New-Object System.Data.SQLite.SQLiteConnectionStringBuilder
$builder.set_ConnectionString($dbOptions.TrimStart(';'))
$builder.set_DataSource($DatabasePath)
$builder.set_ReadOnly($true);$builder.set_FailIfMissing($true);$builder.set_Pooling($false)
$conn=New-Object System.Data.SQLite.SQLiteConnection($builder.get_ConnectionString())
