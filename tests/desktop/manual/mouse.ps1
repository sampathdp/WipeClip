# Real mouse input for the manual desktop recording check: moves the
# cursor along a few points and optionally left-clicks at the last one.
# Physical pixels (the script makes itself per-monitor DPI aware).
#   powershell -NoProfile -File mouse.ps1 -Points "100,100;400,300" [-Click]
param([string]$Points = "", [switch]$Click, [switch]$Get)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class M {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [StructLayout(LayoutKind.Sequential)] public struct P { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out P p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
}
"@
[void][M]::SetProcessDpiAwarenessContext([IntPtr](-4))
if ($Get) { $c = New-Object M+P; [void][M]::GetCursorPos([ref]$c); "$($c.X),$($c.Y)"; exit }
foreach ($p in $Points.Split(";")) {
  $xy = $p.Split(",")
  [void][M]::SetCursorPos([int]$xy[0], [int]$xy[1])
  Start-Sleep -Milliseconds 120
}
if ($Click) {
  [M]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero) # left down
  Start-Sleep -Milliseconds 60
  [M]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero) # left up
}
