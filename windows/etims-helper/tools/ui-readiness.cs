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
    void Responsive() {
        uint owner;
        if (GetWindowThreadProcessId(window, out owner) == 0 || owner != process)
            throw new InvalidOperationException("Target window changed");
        UIntPtr result;
        // WM_NULL is read only. A hung target is never sent another action.
        if (SendMessageTimeout(window, 0, IntPtr.Zero, IntPtr.Zero, 2, 1500, out result) == IntPtr.Zero)
            throw new InvalidOperationException("Target did not become responsive");
    }
    public void Settle() {
        Responsive();
        if (!observing) { Thread.Sleep(500); Responsive(); return; }
        while (true) {
            long now = Stopwatch.GetTimestamp();
            double age = (now - Interlocked.Read(ref armed)) * 1000.0 / Stopwatch.Frequency;
            double quiet = (now - Interlocked.Read(ref changed)) * 1000.0 / Stopwatch.Frequency;
            if (age >= 120 && quiet >= 80) { Responsive(); return; }
            if (age >= 1500) throw new InvalidOperationException("Target did not become quiet");
            Thread.Sleep(15);
        }
    }
    public void Dispose() { stopping.Set(); thread.Join(2000); }
}
