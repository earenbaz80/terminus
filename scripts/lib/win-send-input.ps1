# Inyección real de teclas con SendInput (P/Invoke), para la caza de la tecla ajena.
#
# A diferencia de SendKeys de .NET y de `Input.dispatchKeyEvent` de CDP, esto entra por
# el mismo camino que un teclado físico: SendInput entrega la pulsación a la ventana en
# primer plano, con `isTrusted` verdadero y sin pasar por el renderer de la prueba.
#
# Uso:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/lib/win-send-input.ps1 `
#     -Text " " -ProcessName Terminus
#   ... -Vk 32 -Times 2          # tecla virtual (espacio), dos pulsaciones
#
# Imprime una línea JSON con el proceso que tenía el primer plano, si se reenfocó y
# cuántos eventos aceptó SendInput (0 = bloqueado o sin ventana).
param(
  [string]$Text = "",
  [int]$Vk = 0,
  [int]$Times = 1,
  [int]$DelayMs = 80,
  [string]$ProcessName = "Terminus"
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class RealKeys
{
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT { public uint type; public InputUnion U; }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT
    {
        public uint uMsg;
        public ushort wParamL;
        public ushort wParamH;
    }

    // La unión tiene que medir lo que el mayor de sus miembros (MOUSEINPUT, 32 bytes en
    // x64): si solo se declara KEYBDINPUT, INPUT mide 32 en vez de 40 y SendInput
    // devuelve 0 con ERROR_INVALID_PARAMETER.
    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint uCode, uint uMapType);

    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const uint KEYEVENTF_UNICODE = 0x0004;

    public static string ForegroundProcess()
    {
        IntPtr hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return "";
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        try { return Process.GetProcessById((int)pid).ProcessName; } catch { return ""; }
    }

    public static bool Focus(string name)
    {
        foreach (Process p in Process.GetProcessesByName(name))
        {
            if (p.MainWindowHandle == IntPtr.Zero || !IsWindowVisible(p.MainWindowHandle)) continue;
            SetForegroundWindow(p.MainWindowHandle);
            return true;
        }
        return false;
    }

    private static INPUT Key(ushort vk, ushort scan, uint flags)
    {
        INPUT input = new INPUT();
        input.type = 1; // INPUT_KEYBOARD
        input.U.ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags, time = 0, dwExtraInfo = IntPtr.Zero };
        return input;
    }

    public static int InputSize() { return Marshal.SizeOf(typeof(INPUT)); }

    public static uint SendVirtualKey(ushort vk, int times, int delayMs)
    {
        uint sent = 0;
        ushort scan = (ushort)MapVirtualKey(vk, 0);
        for (int i = 0; i < times; i++)
        {
            sent += SendInput(1, new[] { Key(vk, scan, 0) }, Marshal.SizeOf(typeof(INPUT)));
            System.Threading.Thread.Sleep(delayMs);
            sent += SendInput(1, new[] { Key(vk, scan, KEYEVENTF_KEYUP) }, Marshal.SizeOf(typeof(INPUT)));
            System.Threading.Thread.Sleep(delayMs);
        }
        return sent;
    }

    public static uint SendUnicode(char c, int times, int delayMs)
    {
        uint sent = 0;
        for (int i = 0; i < times; i++)
        {
            sent += SendInput(1, new[] { Key(0, (ushort)c, KEYEVENTF_UNICODE) }, Marshal.SizeOf(typeof(INPUT)));
            System.Threading.Thread.Sleep(delayMs);
            sent += SendInput(1, new[] { Key(0, (ushort)c, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP) }, Marshal.SizeOf(typeof(INPUT)));
            System.Threading.Thread.Sleep(delayMs);
        }
        return sent;
    }
}
"@

$before = [RealKeys]::ForegroundProcess()
$refocused = $false
if ($ProcessName -and $before -ne $ProcessName) {
  $refocused = [RealKeys]::Focus($ProcessName)
  Start-Sleep -Milliseconds 150
}
$after = [RealKeys]::ForegroundProcess()

$sent = 0
if ($Vk -ne 0) {
  $sent = [RealKeys]::SendVirtualKey([uint16]$Vk, $Times, $DelayMs)
} elseif ($Text.Length -gt 0) {
  foreach ($ch in $Text.ToCharArray()) {
    $sent += [RealKeys]::SendUnicode($ch, $Times, $DelayMs)
  }
} else {
  throw "Sin -Text ni -Vk no hay nada que enviar."
}

$result = [ordered]@{
  foreground = $after
  refocused  = $refocused
  sent       = $sent
  inputSize  = [RealKeys]::InputSize()
  error      = if ($sent -eq 0) { [System.Runtime.InteropServices.Marshal]::GetLastWin32Error() } else { 0 }
  vk         = $Vk
  text       = $Text
  times      = $Times
}
$result | ConvertTo-Json -Compress
