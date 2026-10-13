using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;

// Observes the target only. Events contain no retained values or customer data.
// This is a short settling hint, never a substitute for the next screen/value guard.
public sealed class OraforgeUiReadiness : IDisposable {
    [DllImport("user32.dll", SetLastError=true)]
    static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr w,
        IntPtr l, uint flags, uint timeout, out UIntPtr result);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr h);
    readonly IntPtr window;
    readonly int process;
    readonly ManualResetEvent initialized = new ManualResetEvent(false);
    readonly ManualResetEvent stopping = new ManualResetEvent(false);
    readonly Thread thread;
    long changed;
    long armed;
    long notifications;
    volatile bool observing;
    public bool Observing { get { return observing; } }
    public long Notifications { get { return Interlocked.Read(ref notifications); } }
    public string Status { get; private set; }

    public OraforgeUiReadiness(IntPtr window, int process) {
        this.window = window; this.process = process;
        thread = new Thread(Observe); thread.IsBackground = true;
        thread.SetApartmentState(ApartmentState.MTA); thread.Start();
        initialized.WaitOne(1500);
    }
    void Changed() {
        Interlocked.Exchange(ref changed, Stopwatch.GetTimestamp());
        Interlocked.Increment(ref notifications);
    }
    void Observe() {
        AutomationElement root = null;
        bool structureAdded = false, propertyAdded = false;
        StructureChangedEventHandler structure = delegate(object sender, StructureChangedEventArgs args) { Changed(); };
        AutomationPropertyChangedEventHandler property = delegate(object sender, AutomationPropertyChangedEventArgs args) { Changed(); };
        try {
            root = AutomationElement.FromHandle(window);
            if (root.Current.ProcessId != process) return;
            Automation.AddStructureChangedEventHandler(root, TreeScope.Subtree, structure); structureAdded = true;
            Automation.AddAutomationPropertyChangedEventHandler(root, TreeScope.Subtree, property,
                ValuePattern.ValueProperty, AutomationElement.IsEnabledProperty, AutomationElement.NameProperty);
            propertyAdded = true; observing = true; initialized.Set();
            stopping.WaitOne();
        } catch { /* Provider without events: retain the conservative settling delay. */ }
        finally {
            observing = false; initialized.Set();
            // Register and unregister on this same, windowless MTA thread.
            try { if (propertyAdded) Automation.RemoveAutomationPropertyChangedEventHandler(root, property); } catch { }
            try { if (structureAdded) Automation.RemoveStructureChangedEventHandler(root, structure); } catch { }
        }
    }
    public void Arm() {
        long now = Stopwatch.GetTimestamp();
        Interlocked.Exchange(ref armed, now); Interlocked.Exchange(ref changed, now);
    }
    bool Responsive() {
        uint owner;
        if (GetWindowThreadProcessId(window, out owner) == 0 || owner != process)
            throw new InvalidOperationException("Target window changed");
        // A native file dialog disables its WPF owner, whose dispatcher may
        // synchronously wait for the dialog. WM_NULL to that owner can time out
        // during a successful Import click. The next operation must validate
        // its own exact modal/window; settling must not abort this transition.
        if (!IsWindowEnabled(window)) return true;
        UIntPtr result;
        // WM_NULL is read only. A hung target is never sent another action.
        if (SendMessageTimeout(window, 0, IntPtr.Zero, IntPtr.Zero, 2, 1500, out result) == IntPtr.Zero) {
            if (GetWindowThreadProcessId(window, out owner) == 0 || owner != process)
                throw new InvalidOperationException("Target window changed");
            if (!IsWindowEnabled(window)) return true;
            return false;
        }
        return true;
    }
    public void BeforeInput() {
        // This check happens before any click/key input. The caller may retry
        // only this explicit pre-input category after rechecking the screen.
        if (!Responsive() || !IsWindowEnabled(window))
            throw new InvalidOperationException("Target not ready before input");
    }
    public void Settle() {
        Status = "pending";
        // Input has already been dispatched. A temporarily busy dispatcher
        // is not evidence that it failed. Leave the normal DB/page/value
        // verification to establish the outcome; never replay this input.
        if (!Responsive()) return;
        if (!IsWindowEnabled(window)) { Status = "modal"; return; }
        if (!observing) { Thread.Sleep(500); if (Responsive()) Status = "ready"; return; }
        while (true) {
            long now = Stopwatch.GetTimestamp();
            double age = (now - Interlocked.Read(ref armed)) * 1000.0 / Stopwatch.Frequency;
            double quiet = (now - Interlocked.Read(ref changed)) * 1000.0 / Stopwatch.Frequency;
            if (age >= 120 && quiet >= 80) { if (Responsive()) Status = "ready"; return; }
            if (!IsWindowEnabled(window)) { Responsive(); Status = "modal"; return; }
            if (age >= 1500) { Responsive(); return; }
            Thread.Sleep(15);
        }
    }
    public void Dispose() { stopping.Set(); thread.Join(2000); }
}
