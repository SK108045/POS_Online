$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
if (-not ('PosFocus' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class PosFocus {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_SHOWWINDOW = 0x0040;

    public static void Activate(IntPtr hWnd) {
        if (hWnd == IntPtr.Zero) return;

        if (IsIconic(hWnd)) {
            ShowWindow(hWnd, 9); // SW_RESTORE
        } else {
            ShowWindow(hWnd, 5); // SW_SHOW
        }

        keybd_event(0x12, 0, 0, UIntPtr.Zero);
        keybd_event(0x12, 0, 2, UIntPtr.Zero);

        BringWindowToTop(hWnd);
        SetForegroundWindow(hWnd);
        SwitchToThisWindow(hWnd, true);

        SetWindowPos(hWnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
        SetWindowPos(hWnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
        SetForegroundWindow(hWnd);

        IntPtr fg = GetForegroundWindow();
        if (fg != hWnd) {
            uint fgPid;
            uint fgThread = GetWindowThreadProcessId(fg, out fgPid);
            uint ourThread = GetCurrentThreadId();
            bool attached = false;
            if (fgThread != 0 && fgThread != ourThread) {
                attached = AttachThreadInput(ourThread, fgThread, true);
            }
            try {
                BringWindowToTop(hWnd);
                SetForegroundWindow(hWnd);
            } finally {
                if (attached) AttachThreadInput(ourThread, fgThread, false);
            }
        }
    }
}
'@
}

$h = [IntPtr]::Zero

# 1. Find by Edge process ID running OraforgePOS / localhost:3000
$edgeProcs = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'msedge.exe' -and
    $_.CommandLine -notmatch '--type=' -and
    ($_.CommandLine -match 'localhost:3000' -or $_.CommandLine -match 'OraforgePOS')
}

foreach ($ep in $edgeProcs) {
    try {
        $cond = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$ep.ProcessId)
        $wins = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, $cond)
        foreach ($w in $wins) {
            $handle = [IntPtr]$w.Current.NativeWindowHandle
            if ($handle -ne [IntPtr]::Zero -and -not [string]::IsNullOrWhiteSpace($w.Current.Name)) {
                $h = $handle
                break
            }
        }
    } catch {}
    if ($h -ne [IntPtr]::Zero) { break }
}

# 2. If not found, look by window title "Oraforge POS"
if ($h -eq [IntPtr]::Zero) {
    try {
        $cond = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty, 'Oraforge POS')
        $wins = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, $cond)
        if ($wins.Count -gt 0) {
            $h = [IntPtr]$wins[0].Current.NativeWindowHandle
        }
    } catch {}
}

# 3. General scan for any window whose title contains "Oraforge POS"
if ($h -eq [IntPtr]::Zero) {
    try {
        $all = [Windows.Automation.AutomationElement]::RootElement.FindAll(
            [Windows.Automation.TreeScope]::Children,
            [Windows.Automation.Condition]::TrueCondition
        )
        foreach ($w in $all) {
            if ($w.Current.Name -match 'Oraforge POS') {
                $h = [IntPtr]$w.Current.NativeWindowHandle
                break
            }
        }
    } catch {}
}

if ($h -ne [IntPtr]::Zero) {
    [PosFocus]::Activate($h)
}
