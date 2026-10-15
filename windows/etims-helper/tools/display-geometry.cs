using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;

// All coordinates are physical pixels. DPI scope belongs to this worker thread,
// never the customer's display settings or the eTIMS process.
public static class OraforgeDisplay {
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; public int Width {get{return Right-Left;}} public int Height {get{return Bottom-Top;}} }
 [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; }
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct MonitorInfo {
  public int Size; public Rect Monitor,Work; public uint Flags;
  [MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)] public string Device;
 }
 public sealed class Geometry {
  public long Handle,MonitorHandle; public Rect Window,Client,Monitor,Work;
  public int ClientX,ClientY,Scale,WindowDpi; public bool Minimized; public string Device;
 }
 [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")] static extern IntPtr GetThreadDpiAwarenessContext();
 [DllImport("user32.dll")] static extern int GetAwarenessFromDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h,ref Point p);
 [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h,uint flags);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr h,ref MonitorInfo info);
 [DllImport("shcore.dll")] static extern int GetScaleFactorForMonitor(IntPtr h,out int scale);
 [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point p);
 [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h,uint flags);
 delegate bool MonitorCallback(IntPtr monitor,IntPtr dc,ref Rect rect,IntPtr data);
 [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr dc,IntPtr clip,MonitorCallback callback,IntPtr data);
 public sealed class DisplayInfo { public Rect Bounds,Work; public int Scale; public bool Primary; public string Device; }
 public static DisplayInfo[] Displays() {
  List<DisplayInfo> result=new List<DisplayInfo>();
  MonitorCallback callback=delegate(IntPtr monitor,IntPtr dc,ref Rect rect,IntPtr data){
   MonitorInfo info=new MonitorInfo();info.Size=Marshal.SizeOf(typeof(MonitorInfo));int scale;
   if(!GetMonitorInfo(monitor,ref info)||GetScaleFactorForMonitor(monitor,out scale)!=0) throw new InvalidOperationException("Unsupported display settings");
   result.Add(new DisplayInfo{Bounds=info.Monitor,Work=info.Work,Scale=scale,Primary=(info.Flags&1)!=0,Device=info.Device});return true;
  };
  if(!EnumDisplayMonitors(IntPtr.Zero,IntPtr.Zero,callback,IntPtr.Zero)) throw new InvalidOperationException("Unsupported display settings");
  return result.ToArray();
 }
 public static IntPtr Enter() {
  IntPtr previous=SetThreadDpiAwarenessContext(new IntPtr(-4));
  if(previous==IntPtr.Zero || GetAwarenessFromDpiAwarenessContext(GetThreadDpiAwarenessContext())!=2)
   throw new InvalidOperationException("Unsupported display settings: per-monitor DPI context unavailable");
  return previous;
 }
 public static void Leave(IntPtr previous) { if(previous!=IntPtr.Zero) SetThreadDpiAwarenessContext(previous); }
 public static Geometry Observe(IntPtr h) {
  if(!IsWindow(h)) throw new InvalidOperationException("Target window changed");
  Rect window,client; Point origin=new Point();
  if(!GetWindowRect(h,out window)||!GetClientRect(h,out client)||!ClientToScreen(h,ref origin))
   throw new InvalidOperationException("Unverified window geometry");
  IntPtr monitor=MonitorFromWindow(h,2); MonitorInfo info=new MonitorInfo(); info.Size=Marshal.SizeOf(typeof(MonitorInfo)); int scale;
  if(!GetMonitorInfo(monitor,ref info)||GetScaleFactorForMonitor(monitor,out scale)!=0)
   throw new InvalidOperationException("Unsupported display settings: monitor DPI unavailable");
  return new Geometry {Handle=h.ToInt64(),MonitorHandle=monitor.ToInt64(),Window=window,Client=client,
   ClientX=origin.X,ClientY=origin.Y,Monitor=info.Monitor,Work=info.Work,Scale=scale,
   WindowDpi=(int)GetDpiForWindow(h),Minimized=IsIconic(h),Device=info.Device};
 }
 public static string Problem(Geometry g,bool normalized,int width,int height,int minWidth,int minHeight) {
  // Scaling is not a multiplier for target points. A candidate display must
  // still pass the unchanged physical-pixel screen profile BEFORE any input.
  if((g.Scale!=100 && g.Scale!=125 && g.Scale!=150) || g.WindowDpi<=0)
   return "Unsupported display settings: run the machine check for this monitor/scaling combination";
  if(g.Monitor.Width<minWidth || g.Monitor.Height<minHeight) return "Unsupported display settings: target monitor must be at least 1366 x 768 physical pixels";
  if(g.Minimized) return "Unverified window geometry: eTIMS is minimized";
  if(normalized && (g.Window.Width!=width || g.Window.Height!=height)) return "Unverified window geometry";
  int borderMargin=16;
  if(normalized && (g.ClientX<g.Monitor.Left-borderMargin || g.ClientY<g.Monitor.Top-borderMargin ||
    g.ClientX+g.Client.Width>g.Monitor.Right+borderMargin || g.ClientY+g.Client.Height>g.Monitor.Bottom+borderMargin))
   return "Unsupported display settings: eTIMS content must fit on one monitor";
  return null;
 }
 public static void Require(Geometry g,bool normalized,int width,int height,int minWidth,int minHeight) {
  string problem=Problem(g,normalized,width,height,minWidth,minHeight);
  if(problem!=null) throw new InvalidOperationException(problem);
 }
 public static bool Same(Geometry a,Geometry b) {
  return a.Handle==b.Handle && a.MonitorHandle==b.MonitorHandle && a.Scale==b.Scale && a.WindowDpi==b.WindowDpi &&
   a.Window.Left==b.Window.Left && a.Window.Top==b.Window.Top && a.Window.Width==b.Window.Width && a.Window.Height==b.Window.Height &&
   a.ClientX==b.ClientX && a.ClientY==b.ClientY && a.Client.Width==b.Client.Width && a.Client.Height==b.Client.Height && a.Minimized==b.Minimized;
 }
 public static Point Target(Geometry g,int x,int y) {
  // Profiles include non-client borders. Convert that verified frame point to
  // the ACTUAL client origin rather than mixing UIA logical/window coordinates.
  int clientX=x-(g.ClientX-g.Window.Left),clientY=y-(g.ClientY-g.Window.Top);
  if(clientX<0 || clientY<0 || clientX>=g.Client.Width || clientY>=g.Client.Height)
   throw new InvalidOperationException("Point outside observed content area");
  return new Point {X=g.ClientX+clientX,Y=g.ClientY+clientY};
 }
 public static void RequireHit(IntPtr window,Point p) {
  if(GetAncestor(WindowFromPoint(p),2)!=window) throw new InvalidOperationException("Target has no keyboard/mouse focus");
 }
}
