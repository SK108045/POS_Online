$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
if (-not ('PosFocus' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class PosFocus {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int nCmd);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h, bool fAltTab);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
'@
}

$windows = [Windows.Automation.AutomationElement]::RootElement.FindAll(
    [Windows.Automation.TreeScope]::Children,
    [Windows.Automation.Condition]::TrueCondition
)

# 1. Look for window by title
$pos = @($windows | Where-Object { $_.Current.Name -eq 'Oraforge POS' -or $_.Current.Name -match '^Oraforge POS' })

# 2. If not found, look by Edge process running Oraforge profile
if ($pos.Count -eq 0) {
    $edgeProcesses = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedge.exe' -and $_.CommandLine -match 'OraforgePOS' -and $_.CommandLine -notmatch '--type=' }
    if ($edgeProcesses) {
        $pids = @($edgeProcesses | ForEach-Object { $_.ProcessId })
        $pos = @($windows | Where-Object { $_.Current.ProcessId -in $pids -and $_.Current.Name -notmatch '^$' })
    }
}

if ($pos.Count -gt 0) {
    $h = [IntPtr]$pos[0].Current.NativeWindowHandle
    if ($h -ne [IntPtr]::Zero) {
        if ([PosFocus]::IsIconic($h)) {
            [void][PosFocus]::ShowWindowAsync($h, 9)
        } else {
            [void][PosFocus]::ShowWindowAsync($h, 5)
        }

        # Unlock foreground lock
        [PosFocus]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
        [PosFocus]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)

        [void][PosFocus]::BringWindowToTop($h)
        [void][PosFocus]::SetForegroundWindow($h)
        [void][PosFocus]::SwitchToThisWindow($h, $true)

        if ([PosFocus]::GetForegroundWindow() -ne $h) {
            $fgPid = 0
            $fgThread = [PosFocus]::GetWindowThreadProcessId([PosFocus]::GetForegroundWindow(), [ref]$fgPid)
            $ourThread = [PosFocus]::GetCurrentThreadId()
            $attached = [PosFocus]::AttachThreadInput($ourThread, $fgThread, $true)
            try {
                [void][PosFocus]::BringWindowToTop($h)
                [void][PosFocus]::SetForegroundWindow($h)
            } finally {
                if ($attached) {
                    [void][PosFocus]::AttachThreadInput($ourThread, $fgThread, $false)
                }
            }
        }
    }
}

# 3. Also trigger browser single-instance focus invocation
$local = $env:LOCALAPPDATA
if ($local) {
    $edgeExe = "$env:ProgramFiles (x86)\Microsoft\Edge\Application\msedge.exe"
    if (-not (Test-Path $edgeExe)) {
        $edgeExe = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
    }
    $userDataDir = Join-Path $local "OraforgePOS\browser-edge"
    if ((Test-Path $edgeExe) -and (Test-Path $userDataDir)) {
        try {
            Start-Process -FilePath $edgeExe -ArgumentList "--user-data-dir=`"$userDataDir`"", "--app=http://localhost:3000/pos" -WindowStyle Normal -ErrorAction SilentlyContinue
        } catch {}
    }
}
