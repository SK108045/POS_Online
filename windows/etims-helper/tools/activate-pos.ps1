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
    $edgeProcesses = Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" | Where-Object { $_.CommandLine -match 'OraforgePOS' }
    if ($edgeProcesses) {
        $pids = @($edgeProcesses | ForEach-Object { $_.ProcessId })
        $pos = @($windows | Where-Object { $_.Current.ProcessId -in $pids -and $_.Current.Name -notmatch '^$' })
    }
}

if ($pos.Count -gt 0) {
    $h = [IntPtr]$pos[0].Current.NativeWindowHandle
    if ($h -ne [IntPtr]::Zero) {
        [void][PosFocus]::ShowWindowAsync($h, 9)
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
