$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase,PresentationFramework,PresentationCore
Add-Type -Path "$PSScriptRoot\tools\ui-readiness.cs" -ReferencedAssemblies UIAutomationClient,UIAutomationTypes,WindowsBase
# Separate, off-screen WPF fixture. Never access eTIMS or send user input.
$folder=Join-Path ([IO.Path]::GetTempPath()) ('oraforge-readiness-fixture-'+[Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($folder)
$exe=Join-Path $folder 'ReadinessFixture.exe'
$ready=Join-Path $folder 'ready.txt'
Add-Type -OutputAssembly $exe -OutputType WindowsApplication -ReferencedAssemblies PresentationFramework,PresentationCore,WindowsBase,System.Xaml -TypeDefinition @'
using System;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Threading;
using System.Threading;
using System.Runtime.InteropServices;
public static class OraforgeReadinessFixture {
 [DllImport("user32.dll")]static extern bool EnableWindow(IntPtr window,bool enabled);
 [STAThread] public static void Main(string[] args) {
  var application = new Application();
  var window = new Window {Title="Oraforge readiness fixture",Width=300,Height=100,Left=-10000,Top=-10000,ShowActivated=false,ShowInTaskbar=false};
  var field = new TextBox {Text="Initial"}; window.Content=field;
  int sequence=0;
  var timer = new DispatcherTimer {Interval=TimeSpan.FromMilliseconds(400)};
  timer.Tick += delegate {
   sequence++;field.Text=sequence.ToString();window.Title="Oraforge readiness fixture "+sequence;
   if(args.Length>1 && File.Exists(args[1])){
    IntPtr handle=new WindowInteropHelper(window).Handle;EnableWindow(handle,false);
    File.WriteAllText(args[1]+".disabled","ready");Thread.Sleep(3000);EnableWindow(handle,true);File.Delete(args[1]);
   }
   if(args.Length>2 && File.Exists(args[2])){
    File.WriteAllText(args[2]+".busy","ready");Thread.Sleep(5500);File.Delete(args[2]);
   }
  };
  window.Loaded += delegate {
   File.WriteAllText(args[0],new WindowInteropHelper(window).Handle.ToInt64().ToString());timer.Start();
  };
  application.Run(window);
 }
}
'@
$info=New-Object Diagnostics.ProcessStartInfo
$block=Join-Path $folder 'block-owner.txt'
$busy=Join-Path $folder 'busy-owner.txt'
$info.FileName=$exe;$info.Arguments='"'+$ready+'" "'+$block+'" "'+$busy+'"';$info.UseShellExecute=$false;$info.CreateNoWindow=$true
$fixture=[Diagnostics.Process]::Start($info)
$observer=$null
try{
 $deadline=[DateTime]::UtcNow.AddSeconds(20)
 while(-not (Test-Path -LiteralPath $ready)){
  if($fixture.HasExited -or [DateTime]::UtcNow -ge $deadline){throw 'Fixture window did not start'}
  Start-Sleep -Milliseconds 50
 }
 $handle=[IntPtr][long](Get-Content -LiteralPath $ready -Raw)
 $observer=New-Object OraforgeUiReadiness($handle,$fixture.Id)
 $deadline=[DateTime]::UtcNow.AddSeconds(3)
 while(-not $observer.Observing -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 20}
 if(-not $observer.Observing){throw 'WPF event subscription unavailable'}
 $observer.Arm()
 $watch=[Diagnostics.Stopwatch]::StartNew();$observer.Settle();$elapsed=$watch.Elapsed.TotalMilliseconds
 $deadline=[DateTime]::UtcNow.AddSeconds(3)
 while($observer.Notifications -eq 0 -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 20}
 if($observer.Notifications -eq 0){throw 'WPF changes did not raise observed UIA events'}
 if($elapsed -gt 1600){throw 'Bounded settling exceeded its deadline'}
 [IO.File]::WriteAllText($block,'request fixture modal owner')
 $deadline=[DateTime]::UtcNow.AddSeconds(3)
 while(-not (Test-Path -LiteralPath ($block+'.disabled'))){
  if([DateTime]::UtcNow -gt $deadline){throw 'Fixture owner did not enter modal wait'}
  Start-Sleep -Milliseconds 20
 }
 $observer.Arm();$modalWatch=[Diagnostics.Stopwatch]::StartNew();$observer.Settle()
 if($modalWatch.ElapsedMilliseconds -gt 700){throw 'Disabled modal owner blocked the next file-dialog operation'}
 if($observer.Status -ne 'modal'){throw 'Disabled owner was not reported as modal'}
 $rejected=$false
 try{$observer.BeforeInput()}catch{if($_.Exception.InnerException.Message -ne 'Target not ready before input'){throw};$rejected=$true}
 if(-not $rejected){throw 'Input was allowed to a disabled modal owner'}
 Write-Output 'PASS: disabled WPF owner in a synchronous modal wait does not abort successful input.'
 $deadline=[DateTime]::UtcNow.AddSeconds(6)
 while(Test-Path -LiteralPath $block){if([DateTime]::UtcNow -gt $deadline){throw 'Fixture modal wait did not end'};Start-Sleep -Milliseconds 20}
 [IO.File]::WriteAllText($busy,'request enabled dispatcher wait')
 $deadline=[DateTime]::UtcNow.AddSeconds(3)
 while(-not (Test-Path -LiteralPath ($busy+'.busy'))){if([DateTime]::UtcNow -gt $deadline){throw 'Fixture dispatcher did not enter busy wait'};Start-Sleep -Milliseconds 20}
 $observer.Arm();$busyWatch=[Diagnostics.Stopwatch]::StartNew();$observer.Settle()
 if($observer.Status -ne 'pending' -or $busyWatch.ElapsedMilliseconds -gt 2100){throw 'Busy enabled owner caused a false post-input failure'}
 $rejected=$false
 try{$observer.BeforeInput()}catch{if($_.Exception.InnerException.Message -ne 'Target not ready before input'){throw};$rejected=$true}
 if(-not $rejected){throw 'New input was allowed during a busy dispatcher wait'}
 Write-Output 'PASS: busy enabled WPF dispatcher returns pending after dispatch and rejects new input before dispatch.'
 $deadline=[DateTime]::UtcNow.AddSeconds(7)
 while(Test-Path -LiteralPath $busy){if([DateTime]::UtcNow -gt $deadline){throw 'Fixture busy wait did not end'};Start-Sleep -Milliseconds 20}
 $observer.BeforeInput()
 $foreign=New-Object OraforgeUiReadiness($handle,($fixture.Id+100000))
 try{
  $foreign.Arm();$rejected=$false
  try{$foreign.Settle()}catch{$rejected=$true}
  if(-not $rejected){throw 'Foreign process window accepted'}
 }finally{$foreign.Dispose()}
 Write-Output ('PASS: real WPF events observed; bounded settling '+[math]::Round($elapsed)+' ms; foreign process rejected; no eTIMS access.')
}finally{
 if($observer){$observer.Dispose()}
 if(-not $fixture.HasExited){$fixture.Kill();$fixture.WaitForExit(3000)|Out-Null}
 $fixture.Dispose()
 $absolute=[IO.Path]::GetFullPath($folder)
 if(-not $absolute.StartsWith(([IO.Path]::GetTempPath()),[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $absolute -Leaf) -notlike 'oraforge-readiness-fixture-*'){throw 'Unexpected fixture cleanup path'}
 Remove-Item -LiteralPath $absolute -Recurse -Force
}
