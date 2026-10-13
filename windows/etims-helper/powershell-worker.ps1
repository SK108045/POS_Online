$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$encoding=New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding=$encoding
$OutputEncoding=[Console]::OutputEncoding=$encoding
$allowed=@('read-state.ps1','ui-step.ps1','tools/check-offline.ps1','tools/normalize-window.ps1','tools/select-observed-combo.ps1','tools/choose-native-file.ps1','tools/decode-qr.ps1','tools/check-ui-ready.ps1')
# Private stdin/stdout transport only. No listener, temporary request files,
# transcript, command-line customer data, or arbitrary PowerShell evaluation.
while($null -ne ($line=[Console]::ReadLine())){
 $request=$null
 try{
  $request=$line|ConvertFrom-Json
  if($request.script -cnotin $allowed){throw 'Unsupported helper script'}
  $scriptPath=Join-Path $PSScriptRoot ([string]$request.script)
  $values=@($request.args)
  if($values.Count % 2 -ne 0){throw 'Expected named helper arguments'}
  $arguments=@{}
  for($i=0;$i -lt $values.Count;$i+=2){
   $name=[string]$values[$i]
   if($name -cnotmatch '^-[A-Za-z][A-Za-z0-9]*$' -or $arguments.ContainsKey($name.Substring(1))){throw 'Invalid helper argument'}
   $arguments[$name.Substring(1)]=[string]$values[$i+1]
  }
  $output=@(& $scriptPath @arguments)
  $response=@{id=$request.id;ok=$true;output=($output -join "`n");error=''}
 }catch{
  # Arbitrary exceptions may contain entered values; transmit categories only.
  $safe='Windows operation failed'
  foreach($reason in @('Screen does not match the verified workflow','Target has no keyboard/mouse focus','Client has an active modal dialog','Observed point is not an allowed target Edit control','Unverified window geometry','Unrecognized eTIMS screen','Expected file dialog missing')){
   if($_.Exception.Message.Contains($reason)){$safe=$reason;break}
  }
  $response=@{id=$request.id;ok=$false;output='';error=$safe}
 }
 [Console]::WriteLine(($response|ConvertTo-Json -Depth 4 -Compress))
}
