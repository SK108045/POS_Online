using System;
using System.Runtime.InteropServices;
public static class ResearchKeyboardInput {
 [StructLayout(LayoutKind.Sequential)]public struct Keyboard {public ushort virtualKey,scan;public uint flags,time;public UIntPtr extra;}
 [StructLayout(LayoutKind.Explicit,Size=40)]public struct Input {[FieldOffset(0)]public uint type;[FieldOffset(8)]public Keyboard keyboard;}
 [DllImport("user32.dll",SetLastError=true)]static extern uint SendInput(uint count,Input[] inputs,int size);
 [DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern short VkKeyScan(char c);
 [DllImport("user32.dll")]static extern short GetKeyState(int key);
 public static void BulkPhysicalText(IntPtr expectedWindow,string text){
  var keys=new System.Collections.Generic.List<Input>();
  foreach(char c in text){short mapped=VkKeyScan(c);if(mapped==-1||((GetKeyState(0x14)&1)!=0&&char.IsLetter(c))){keys.Add(new Input{type=1,keyboard=new Keyboard{scan=c,flags=4}});keys.Add(new Input{type=1,keyboard=new Keyboard{scan=c,flags=6}});continue;}
   int mods=(mapped>>8)&255;if((mods&1)!=0)keys.Add(Key(0x10,0));if((mods&2)!=0)keys.Add(Key(0x11,0));if((mods&4)!=0)keys.Add(Key(0x12,0));keys.Add(Key((ushort)(mapped&255),0));keys.Add(Key((ushort)(mapped&255),2));if((mods&4)!=0)keys.Add(Key(0x12,2));if((mods&2)!=0)keys.Add(Key(0x11,2));if((mods&1)!=0)keys.Add(Key(0x10,2));
  }
  if(GetForegroundWindow()!=expectedWindow)throw new InvalidOperationException("Expected client does not have focus");
  if(SendInput((uint)keys.Count,keys.ToArray(),40)!=keys.Count)throw new InvalidOperationException("Keyboard input was not accepted");
 }
 public static void PhysicalText(IntPtr expectedWindow,string text){
  if(GetForegroundWindow()!=expectedWindow)throw new InvalidOperationException("Expected client does not have focus");
  foreach(char c in text){if(GetForegroundWindow()!=expectedWindow)throw new InvalidOperationException("Client focus changed");short mapped=VkKeyScan(c);if(mapped==-1||((GetKeyState(0x14)&1)!=0&&char.IsLetter(c))){Text(expectedWindow,c.ToString());continue;}
   var keys=new System.Collections.Generic.List<Input>();int mods=(mapped>>8)&255;
   if((mods&1)!=0)keys.Add(Key(0x10,0));if((mods&2)!=0)keys.Add(Key(0x11,0));if((mods&4)!=0)keys.Add(Key(0x12,0));
   keys.Add(Key((ushort)(mapped&255),0));keys.Add(Key((ushort)(mapped&255),2));
   if((mods&4)!=0)keys.Add(Key(0x12,2));if((mods&2)!=0)keys.Add(Key(0x11,2));if((mods&1)!=0)keys.Add(Key(0x10,2));
   if(SendInput((uint)keys.Count,keys.ToArray(),40)!=keys.Count)throw new InvalidOperationException("Keyboard input was not accepted");System.Threading.Thread.Sleep(100);
  }
 }
 public static void Text(IntPtr expectedWindow,string text) {
  if(GetForegroundWindow()!=expectedWindow)throw new InvalidOperationException("Expected client does not have focus");
  foreach(char c in text){if(GetForegroundWindow()!=expectedWindow)throw new InvalidOperationException("Client focus changed");var k=new Input[]{new Input{type=1,keyboard=new Keyboard{scan=c,flags=4}},new Input{type=1,keyboard=new Keyboard{scan=c,flags=6}}};if(SendInput(2,k,40)!=2)throw new InvalidOperationException("Keyboard input was not accepted");System.Threading.Thread.Sleep(35);}
 }
 public static void Clear(IntPtr expectedWindow){if(GetForegroundWindow()!=expectedWindow)throw new InvalidOperationException("Expected client does not have focus");var k=new Input[]{Key(0x11,0),Key(0x41,0),Key(0x41,2),Key(0x11,2),Key(0x08,0),Key(0x08,2)};if(SendInput((uint)k.Length,k,40)!=k.Length)throw new InvalidOperationException("Keyboard clear was not accepted");}
 public static void Complete(IntPtr expectedWindow){if(GetForegroundWindow()!=expectedWindow)throw new InvalidOperationException("Expected client does not have focus");var keys=new Input[]{Key(0x0D,0),Key(0x0D,2)};if(SendInput((uint)keys.Length,keys,40)!=keys.Length)throw new InvalidOperationException("Keyboard completion was not accepted");}
 static Input Key(ushort key,uint flags){return new Input{type=1,keyboard=new Keyboard{virtualKey=key,flags=flags}};}
}
