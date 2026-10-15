using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public class GhostOverlay : Form {
    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_TOPMOST = 0x00000008;
    private const int WS_EX_TRANSPARENT = 0x00000020;
    private const int WS_EX_LAYERED = 0x00080000;
    private const int WS_EX_NOACTIVATE = 0x08000000;

    private const int WH_KEYBOARD_LL = 13;
    private const int WH_MOUSE_LL = 14;

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int x, y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSLLHOOKSTRUCT {
        public POINT pt;
        public uint mouseData;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    private delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint crKey, byte bAlpha, uint dwFlags);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    private const uint SWP_SHOWWINDOW = 0x0040;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint LWA_ALPHA = 0x02;

    // Static references to prevent GC collection of delegates
    private static HookProc _mouseProc;
    private static HookProc _keyboardProc;
    private static IntPtr _mouseHook = IntPtr.Zero;
    private static IntPtr _keyboardHook = IntPtr.Zero;
    private static int _escCount = 0;

    // UI state
    private int _progress = 15;
    private string _stageText = "Initializing fiscal engine...";
    private float _spinnerAngle = 0f;
    private System.Windows.Forms.Timer _animTimer;
    private System.Windows.Forms.Timer _watchdogTimer;

    public GhostOverlay(Rectangle bounds, int timeoutSeconds) {
        this.FormBorderStyle = FormBorderStyle.None;
        this.WindowState = FormWindowState.Normal;
        this.StartPosition = FormStartPosition.Manual;
        this.Bounds = bounds;
        this.TopMost = true;
        this.ShowInTaskbar = false;
        this.BackColor = Color.FromArgb(15, 23, 42); // Slate 900
        this.DoubleBuffered = true;
        this.Opacity = 0.999; // Ensure WinForms initializes layered window alpha

        // 60 FPS animation timer
        _animTimer = new System.Windows.Forms.Timer();
        _animTimer.Interval = 16;
        _animTimer.Tick += (s, e) => {
            _spinnerAngle = (_spinnerAngle + 6f) % 360f;
            this.Invalidate();
        };
        _animTimer.Start();

        // Safety watchdog timer (releases hooks and closes even if parent fails)
        _watchdogTimer = new System.Windows.Forms.Timer();
        _watchdogTimer.Interval = Math.Max(10, timeoutSeconds) * 1000;
        _watchdogTimer.Tick += (s, e) => {
            _watchdogTimer.Stop();
            Application.Exit();
        };
        _watchdogTimer.Start();
    }

    protected override CreateParams CreateParams {
        get {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= WS_EX_TOPMOST;
            cp.ExStyle |= WS_EX_TRANSPARENT;
            cp.ExStyle |= WS_EX_LAYERED;
            cp.ExStyle |= WS_EX_NOACTIVATE;
            return cp;
        }
    }

    protected override bool ShowWithoutActivation {
        get { return true; }
    }

    protected override void OnHandleCreated(EventArgs e) {
        base.OnHandleCreated(e);
        // Explicitly set alpha to 255 (fully opaque) so WS_EX_LAYERED is composited by DWM
        SetLayeredWindowAttributes(this.Handle, 0, 255, LWA_ALPHA);
        SetWindowPos(this.Handle, HWND_TOPMOST, this.Bounds.X, this.Bounds.Y, this.Bounds.Width, this.Bounds.Height, SWP_SHOWWINDOW | SWP_NOACTIVATE);
    }

    public void UpdateProgress(int progress, string stageText) {
        if (this.InvokeRequired) {
            this.BeginInvoke(new Action(() => UpdateProgress(progress, stageText)));
            return;
        }
        _progress = Math.Max(0, Math.Min(100, progress));
        if (!string.IsNullOrEmpty(stageText)) _stageText = stageText;
        this.Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e) {
        base.OnPaint(e);
        Graphics g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

        int cx = this.ClientSize.Width / 2;
        int cy = this.ClientSize.Height / 2 - 20;

        // Circular spinner track
        int radius = 55;
        Rectangle spinnerRect = new Rectangle(cx - radius, cy - radius - 40, radius * 2, radius * 2);

        using (Pen trackPen = new Pen(Color.FromArgb(40, 56, 84), 7)) {
            g.DrawEllipse(trackPen, spinnerRect);
        }

        // Circular animated arc
        using (Pen arcPen = new Pen(Color.FromArgb(6, 182, 212), 7)) { // Vibrant Cyan
            arcPen.StartCap = LineCap.Round;
            arcPen.EndCap = LineCap.Round;
            g.DrawArc(arcPen, spinnerRect, _spinnerAngle, 100f);
        }

        // Percentage text inside spinner
        using (Font pctFont = new Font("Segoe UI", 16, FontStyle.Bold))
        using (Brush pctBrush = new SolidBrush(Color.FromArgb(248, 250, 252))) {
            string pctText = _progress + "%";
            SizeF pctSize = g.MeasureString(pctText, pctFont);
            g.DrawString(pctText, pctFont, pctBrush, cx - (pctSize.Width / 2), cy - 40 - (pctSize.Height / 2));
        }

        // Title
        using (Font titleFont = new Font("Segoe UI", 20, FontStyle.Bold))
        using (Brush titleBrush = new SolidBrush(Color.White)) {
            string title = "Issuing eTIMS Tax Invoice";
            SizeF titleSize = g.MeasureString(title, titleFont);
            g.DrawString(title, titleFont, titleBrush, cx - (titleSize.Width / 2), cy + radius - 15);
        }

        // Stage Description
        using (Font stageFont = new Font("Segoe UI", 13, FontStyle.Regular))
        using (Brush stageBrush = new SolidBrush(Color.FromArgb(103, 232, 249))) { // Light Cyan
            SizeF stageSize = g.MeasureString(_stageText, stageFont);
            g.DrawString(_stageText, stageFont, stageBrush, cx - (stageSize.Width / 2), cy + radius + 25);
        }

        // Subtitle
        using (Font subFont = new Font("Segoe UI", 11, FontStyle.Regular))
        using (Brush subBrush = new SolidBrush(Color.FromArgb(148, 163, 184))) { // Slate 400
            string sub = "Please wait while your fiscal invoice is being recorded...";
            SizeF subSize = g.MeasureString(sub, subFont);
            g.DrawString(sub, subFont, subBrush, cx - (subSize.Width / 2), cy + radius + 55);
        }

        // Security footnote
        using (Font footFont = new Font("Segoe UI", 9, FontStyle.Regular))
        using (Brush footBrush = new SolidBrush(Color.FromArgb(71, 85, 105))) { // Slate 600
            string foot = "🔒 POS terminal protected during invoice issuance • Esc x3 to cancel";
            SizeF footSize = g.MeasureString(foot, footFont);
            g.DrawString(foot, footFont, footBrush, cx - (footSize.Width / 2), this.ClientSize.Height - 45);
        }
    }

    private static IntPtr MouseHookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0) {
            MSLLHOOKSTRUCT hook = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
            // Check if input was programmatically injected (LLMHF_INJECTED = 0x01 or LLMHF_LOWER_IL_INJECTED = 0x02)
            bool isInjected = (hook.flags & 1) != 0 || (hook.flags & 2) != 0;
            if (!isInjected) {
                // Drop physical mouse clicks and moves from user hands!
                return (IntPtr)1;
            }
        }
        return CallNextHookEx(_mouseHook, nCode, wParam, lParam);
    }

    private static IntPtr KeyboardHookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
        if (nCode >= 0) {
            KBDLLHOOKSTRUCT hook = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
            // Esc x 3 emergency cancellation
            if (hook.vkCode == 0x1B) {
                _escCount++;
                if (_escCount >= 3) {
                    Application.Exit();
                    return (IntPtr)1;
                }
            }
            // Check if input was programmatically injected (LLKHF_INJECTED = 0x10 or 0x02)
            bool isInjected = (hook.flags & 0x10) != 0 || (hook.flags & 2) != 0;
            if (!isInjected) {
                // Drop physical keyboard keystrokes from user hands!
                return (IntPtr)1;
            }
        }
        return CallNextHookEx(_keyboardHook, nCode, wParam, lParam);
    }

    private static void InstallHooks() {
        _mouseProc = MouseHookCallback;
        _keyboardProc = KeyboardHookCallback;
        using (Process curProcess = Process.GetCurrentProcess())
        using (ProcessModule curModule = curProcess.MainModule) {
            IntPtr hMod = GetModuleHandle(curModule.ModuleName);
            _mouseHook = SetWindowsHookEx(WH_MOUSE_LL, _mouseProc, hMod, 0);
            _keyboardHook = SetWindowsHookEx(WH_KEYBOARD_LL, _keyboardProc, hMod, 0);
        }
    }

    private static void RemoveHooks() {
        if (_mouseHook != IntPtr.Zero) {
            UnhookWindowsHookEx(_mouseHook);
            _mouseHook = IntPtr.Zero;
        }
        if (_keyboardHook != IntPtr.Zero) {
            UnhookWindowsHookEx(_keyboardHook);
            _keyboardHook = IntPtr.Zero;
        }
    }

    [STAThread]
    public static void Main(string[] args) {
        int timeout = 90;
        Rectangle bounds = Screen.PrimaryScreen.Bounds;

        if (args.Length >= 4) {
            int x, y, w, h;
            if (int.TryParse(args[0], out x) && int.TryParse(args[1], out y) &&
                int.TryParse(args[2], out w) && int.TryParse(args[3], out h)) {
                bounds = new Rectangle(x, y, w, h);
            }
        }
        if (args.Length >= 5) {
            int t;
            if (int.TryParse(args[4], out t) && t > 0) timeout = t;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        GhostOverlay form = new GhostOverlay(bounds, timeout);

        // Install selective input hooks
        InstallHooks();

        // Stdin listener thread for live progress updates
        Thread listener = new Thread(() => {
            try {
                string line;
                while ((line = Console.ReadLine()) != null) {
                    line = line.Trim();
                    if (string.Equals(line, "QUIT", StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(line, "CLOSE", StringComparison.OrdinalIgnoreCase)) {
                        break;
                    }
                    if (line.StartsWith("PROGRESS:", StringComparison.OrdinalIgnoreCase)) {
                        string[] parts = line.Split(new char[] { ':' }, 3);
                        int p = 0;
                        if (parts.Length >= 2 && int.TryParse(parts[1], out p)) {
                            string msg = parts.Length >= 3 ? parts[2] : "";
                            form.UpdateProgress(p, msg);
                        }
                    }
                }
            } catch {
            } finally {
                form.BeginInvoke(new Action(() => Application.Exit()));
            }
        });
        listener.IsBackground = true;
        listener.Start();

        try {
            form.Show();
            Application.Run(form);
        } finally {
            RemoveHooks();
        }
    }
}
