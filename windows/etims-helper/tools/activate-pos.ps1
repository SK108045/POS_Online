param([int]$EtimsPid = 0)

$ErrorActionPreference = 'SilentlyContinue'

if (-not ('PosActivator' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class PosActivator {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();

    public static IntPtr FindPosWindow() {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hWnd, lParam) => {
            var sb = new StringBuilder(512);
            GetWindowText(hWnd, sb, 512);
            string title = sb.ToString();
            if (title.IndexOf("Oraforge POS", StringComparison.OrdinalIgnoreCase) >= 0) {
                found = hWnd;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static void FocusWindow(IntPtr hWnd) {
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

        IntPtr HWND_TOPMOST = new IntPtr(-1);
        IntPtr HWND_NOTOPMOST = new IntPtr(-2);
        SetWindowPos(hWnd, HWND_TOPMOST, 0, 0, 0, 0, 0x0043);
        SetWindowPos(hWnd, HWND_NOTOPMOST, 0, 0, 0, 0, 0x0043);
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

# 1. Minimize eTIMS window so it leaves the screen immediately
Add-Type -AssemblyName UIAutomationClient
if ($EtimsPid -le 0) {
    $etimsProc = Get-Process -Name 'EBM2x.WPF' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($etimsProc) { $EtimsPid = [int]$etimsProc.Id }
}
if ($EtimsPid -gt 0) {
    try {
        $cond = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty, $EtimsPid)
        $wins = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children, $cond)
        $main = @($wins | Where-Object { $_.Current.Name -ceq 'ETIMS1.0' })
        if ($main.Count -gt 0) {
            $eH = [IntPtr]$main[0].Current.NativeWindowHandle
            if ($eH -ne [IntPtr]::Zero) {
                [void][PosActivator]::ShowWindow($eH, 6) # SW_MINIMIZE = 6
            }
        }
    } catch {}
}

# 2. Find POS window via EnumWindows
$posHwnd = [PosActivator]::FindPosWindow()

# 3. If not found by EnumWindows, try UIAutomation search
if ($posHwnd -eq [IntPtr]::Zero) {
    try {
        $all = [Windows.Automation.AutomationElement]::RootElement.FindAll(
            [Windows.Automation.TreeScope]::Children,
            [Windows.Automation.Condition]::TrueCondition
        )
        foreach ($w in $all) {
            if ($w.Current.Name -match 'Oraforge POS') {
                $posHwnd = [IntPtr]$w.Current.NativeWindowHandle
                try { $w.SetFocus() } catch {}
                break
            }
        }
    } catch {}
}

# 4. Bring the existing POS window to foreground
if ($posHwnd -ne [IntPtr]::Zero) {
    [PosActivator]::FocusWindow($posHwnd)
}
