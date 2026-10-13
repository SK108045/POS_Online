$ErrorActionPreference='Stop'
. "$PSScriptRoot\tools\native-file-dialog.ps1"
Add-Type -Path "$PSScriptRoot\tools\ui-readiness.cs" -ReferencedAssemblies UIAutomationClient,UIAutomationTypes,WindowsBase
$folder=Join-Path ([IO.Path]::GetTempPath()) ('oraforge-file-fixture-'+[Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($folder)
$exe=Join-Path $folder 'OraforgeFileFixture.exe'
Add-Type -OutputAssembly $exe -OutputType WindowsApplication -ReferencedAssemblies PresentationFramework,PresentationCore,WindowsBase,System.Xaml -TypeDefinition @'
using System;
using System.IO;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Threading;
public static class FileFixture {
 [STAThread]public static void Main(string[] args){
  var app=new Application();
  var window=new Window{Title="Oraforge isolated file fixture",Width=300,Height=120,Left=-10000,Top=-10000,ShowActivated=false,ShowInTaskbar=false};
  var timer=new DispatcherTimer{Interval=TimeSpan.FromMilliseconds(250)};
  window.Loaded+=delegate{File.WriteAllText(args[1],new WindowInteropHelper(window).Handle.ToInt64().ToString());timer.Start();};
  timer.Tick+=delegate{
   timer.Stop();Microsoft.Win32.FileDialog dialog;
   if(args[0]=="Open")dialog=new Microsoft.Win32.OpenFileDialog();else dialog=new Microsoft.Win32.SaveFileDialog();
   dialog.Title=args[0];dialog.InitialDirectory=Path.GetDirectoryName(args[1]);dialog.AddExtension=false;
   if(dialog.ShowDialog(window)==true){
    File.WriteAllText(args[2],dialog.FileName);
    if(args[0]!="Open")File.WriteAllText(dialog.FileName,"isolated fixture, no fiscal data");
   }
   window.Close();
  };
  app.Run(window);
 }
}
'@
try{
 foreach($title in @('Open','Save Print Output As')){
  $ready=Join-Path $folder 'ready.txt';$done=Join-Path $folder 'done.txt'
  foreach($old in @($ready,$done)){if(Test-Path -LiteralPath $old){Remove-Item -LiteralPath $old -Force}}
  $path=Join-Path $folder $(if($title -eq 'Open'){'fixture-products.xlsx'}else{'fixture-invoice.pdf'})
  if($title -eq 'Open'){[IO.File]::WriteAllText($path,'isolated fixture input')}
  $info=New-Object Diagnostics.ProcessStartInfo
  $info.FileName=$exe;$info.Arguments='"'+$title+'" "'+$ready+'" "'+$done+'"';$info.UseShellExecute=$false;$info.CreateNoWindow=$true
  $process=[Diagnostics.Process]::Start($info);$observer=$null
  try{
   $end=[DateTime]::UtcNow.AddSeconds(20)
   while(-not (Test-Path -LiteralPath $ready)){
    if($process.HasExited -or [DateTime]::UtcNow -ge $end){throw 'Fixture did not open'}
    Start-Sleep -Milliseconds 50
   }
   $handle=[IntPtr][long](Get-Content -LiteralPath $ready -Raw)
   $observer=New-Object OraforgeUiReadiness($handle,$process.Id)
   $observer.Arm()
   $controls=Find-OraforgeFileDialog -TargetProcessId $process.Id -DialogTitle $title -TimeoutSeconds 10
   $observer.Settle()
   Write-Output ($title+': verified filename Edit id='+$controls.Edit.Cached.AutomationId)
   Set-OraforgeNativeFile -TargetProcessId $process.Id -DialogTitle $title -Path $path
   $end=[DateTime]::UtcNow.AddSeconds(10)
   while(-not (Test-Path -LiteralPath $done)){
    if($process.HasExited -or [DateTime]::UtcNow -ge $end){throw 'Single file dispatch did not complete'}
    Start-Sleep -Milliseconds 50
   }
   if((Get-Content -LiteralPath $done -Raw) -cne $path){throw 'Fixture selected the wrong path'}
   if($title -ne 'Open' -and -not (Test-Path -LiteralPath $path)){throw 'Fixture PDF save did not complete'}
   Write-Output ('PASS: '+$title+' chose the exact fixture file once; no eTIMS process accessed.')
  }finally{
   if($observer){$observer.Dispose()}
   if(-not $process.HasExited){$process.Kill();$process.WaitForExit(3000)|Out-Null}
   $process.Dispose()
  }
 }
}finally{
 $absolute=[IO.Path]::GetFullPath($folder)
 if(-not $absolute.StartsWith([IO.Path]::GetTempPath(),[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $absolute -Leaf) -notlike 'oraforge-file-fixture-*'){throw 'Unexpected fixture cleanup path'}
 Remove-Item -LiteralPath $absolute -Recurse -Force
}
