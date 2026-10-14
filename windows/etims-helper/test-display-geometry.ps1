$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing,System.Windows.Forms,UIAutomationClient
. "$PSScriptRoot\tools\display-geometry.ps1"
if(-not ('OraforgeScreenGuard' -as [type])){Add-Type -Path "$PSScriptRoot\tools\screen-guard.cs" -ReferencedAssemblies System.Drawing}
function Geometry([int]$width,[int]$height,[int]$scale,[int]$left=0){
 $g=New-Object OraforgeDisplay+Geometry
 $g.Handle=123;$g.MonitorHandle=456;$g.Scale=$scale;$g.WindowDpi=96
 $g.Monitor=[OraforgeDisplay+Rect]@{Left=$left;Top=0;Right=$left+$width;Bottom=$height}
 $g.Work=$g.Monitor
 $g.Window=[OraforgeDisplay+Rect]@{Left=$left-9;Top=-9;Right=$left+1375;Bottom=777}
 $g.Client=[OraforgeDisplay+Rect]@{Left=0;Top=0;Right=1366;Bottom=768}
 $g.ClientX=$left;$g.ClientY=0
 return $g
}
$matrix=@()
foreach($size in @(@(1366,768),@(1920,1080))){
 foreach($scale in @(100,125,150)){
  foreach($left in @(0,-1920)){
   $g=Geometry $size[0] $size[1] $scale $left
   [OraforgeDisplay]::Require($g,$true,1384,786,1366,768)
   $point=[OraforgeDisplay]::Target($g,705,530)
   if($point.X -ne ($left-9+705) -or $point.Y -ne 521){throw 'Physical point mapping changed'}
   $moved=Geometry $size[0] $size[1] $scale ($left+1)
   if([OraforgeDisplay]::Same($g,$moved)){throw 'Window movement after observation was accepted'}
   $moved=Geometry $size[0] $size[1] $scale $left;$moved.MonitorHandle++
   if([OraforgeDisplay]::Same($g,$moved)){throw 'Monitor transition after observation was accepted'}
   $moved=Geometry $size[0] $size[1] $scale $left;$moved.Scale=200
   if([OraforgeDisplay]::Same($g,$moved)){throw 'DPI transition after observation was accepted'}
   $matrix+=@{resolution=($size -join 'x');scale=$scale;origin_x=$left;test='synthetic_geometry';passed=$true}
  }
 }
}
foreach($g in @((Geometry 1280 720 100),(Geometry 1920 1080 200))){
 if(-not [OraforgeDisplay]::Problem($g,$true,1384,786,1366,768)){throw 'Unsupported display accepted'}
}
$clipped=Geometry 1920 1080 100;$clipped.ClientX=900
if(-not [OraforgeDisplay]::Problem($clipped,$true,1384,786,1366,768)){throw 'Clipped client accepted'}
$rejected=$false
try{[OraforgeDisplay]::Target((Geometry 1920 1080 100),0,0)|Out-Null}catch{$rejected=$true}
if(-not $rejected){throw 'Non-client target accepted'}

# Same exact layout can be valid at another DPI. Stretched reference pixels
# cannot be legitimized by multiplying coordinates or resizing a screenshot.
$reference=New-Object Drawing.Bitmap("$PSScriptRoot\profiles\sales.png")
try{
 foreach($scale in @(100,125,150)){
  $actual=New-Object Drawing.Bitmap(1384,786);$graphics=[Drawing.Graphics]::FromImage($actual)
  try{
   $graphics.DrawImageUnscaled($reference,35,57)
   if(-not [OraforgeScreenGuard]::Matches($actual,$reference,35,57,500,60)){throw 'Identical profile rejected'}
   if($scale -gt 100){
    $graphics.Clear([Drawing.Color]::Black)
    $graphics.DrawImage($reference,35,57,[int](500*$scale/100),[int](60*$scale/100))
    if([OraforgeScreenGuard]::Matches($actual,$reference,35,57,500,60)){throw 'Stretched layout accepted'}
   }
  }finally{$graphics.Dispose();$actual.Dispose()}
 }
}finally{$reference.Dispose()}

# Actual Windows APIs, on the CURRENT display only. The private invisible
# fixture's bounds may move; no eTIMS or customer display setting is changed.
$previous=[OraforgeDisplay]::Enter();$form=New-Object Windows.Forms.Form
try{
 $form.StartPosition='Manual';$form.SetBounds(30,30,500,300)
 $handle=$form.Handle;$observed=[OraforgeDisplay]::Observe($handle)
 $uia=[Windows.Automation.AutomationElement]::FromHandle($handle).Current.BoundingRectangle
 if($observed.Window.Width -ne [int]$uia.Width -or $observed.Window.Height -ne [int]$uia.Height -or $observed.Window.Left -ne [int]$uia.Left){throw 'Win32 and UIA physical bounds differ'}
 $form.Left+=10
 if([OraforgeDisplay]::Same($observed,[OraforgeDisplay]::Observe($handle))){throw 'Actual fixture movement not detected'}
 $display=([OraforgeDisplay]::Displays())[0]
 $form.SetBounds($display.Bounds.Left-9,$display.Bounds.Top-9,1384,786)
 $capture=& "$PSScriptRoot\tools\capture-app-window.ps1" -TargetProcessId $PID -WindowHandle $handle.ToInt64() -InMemory
 try{
  if($capture.Width -ne 1384 -or $capture.Height -ne 786 -or -not $capture.Tag){throw 'Capture lost its physical frame or geometry token'}
  if(-not [OraforgeDisplay]::Same($capture.Tag,[OraforgeDisplay]::Observe($handle))){throw 'Capture geometry did not match actual window'}
 }finally{$capture.Dispose()}
 $timer=[Diagnostics.Stopwatch]::StartNew()
 for($i=0;$i -lt 1000;$i++){$null=[OraforgeDisplay]::Observe($handle)}
 $timer.Stop()
 [pscustomobject]@{passed=$true;synthetic_matrix=$matrix;actual_windows_display=@([OraforgeDisplay]::Displays());
  actual_uia_win32_bounds_equal=$true;actual_fixture_move_detected=$true;actual_physical_capture=$true;observe_mean_ms=($timer.Elapsed.TotalMilliseconds/1000);
  changed_desktop_settings=$false;real_etims_input=$false}|ConvertTo-Json -Depth 7 -Compress
}finally{$form.Dispose();[OraforgeDisplay]::Leave($previous)}
