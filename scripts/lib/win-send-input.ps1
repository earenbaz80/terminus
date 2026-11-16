# Inyección de una tecla real con SendInput (P/Invoke), para la caza de la tecla ajena.
#
# A diferencia de SendKeys de .NET y de CDP, esto entra por el mismo camino que un teclado
# físico: SendInput entrega la pulsación a la ventana en primer plano, con `isTrusted`
# verdadero y sin pasar por el renderer de la prueba.
#
# Solo envía el espacio (VK 32), que es lo que se cuela en el fallo de «un carácter». Si
# Terminus no está en primer plano no reenfoca nada: se niega a escribir en otra ventana y
# sale con código 1, informando cuál tenía el foco.
#
# Uso:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/lib/win-send-input.ps1
#
# Imprime una línea JSON con el proceso en primer plano, los eventos aceptados por
# SendInput (0 = bloqueado), el tamaño de `INPUT` y el error de Win32 si lo hubo.
param(
  [int]$Vk = 32,
  [int]$DelayMs = 80
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

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    // SendInput compara `cbSize` con el tamaño de la unión, que es el de su miembro mayor
    // (MOUSEINPUT, 32 bytes en x64). Declarando solo KEYBDINPUT, INPUT mide 32 en vez de
    // 40 y la llamada devuelve 0 con ERROR_INVALID_PARAMETER (87), sin más pista.
    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint uCode, uint uMapType);

    public static string ForegroundProcess()
    {
        uint pid;
        GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        try { return Process.GetProcessById((int)pid).ProcessName; } catch { return ""; }
    }

    public static int InputSize() { return Marshal.SizeOf(typeof(INPUT)); }

    public static uint SendVirtualKey(ushort vk, int delayMs)
    {
        ushort scan = (ushort)MapVirtualKey(vk, 0);
        uint sent = SendInput(1, new[] { Key(vk, scan, 0) }, Marshal.SizeOf(typeof(INPUT)));
        System.Threading.Thread.Sleep(delayMs);
        sent += SendInput(1, new[] { Key(vk, scan, 0x0002) }, Marshal.SizeOf(typeof(INPUT)));
        return sent;
    }

    private static INPUT Key(ushort vk, ushort scan, uint flags)
    {
        INPUT input = new INPUT();
        input.type = 1; // INPUT_KEYBOARD
        input.U.ki = new KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags };
        return input;
    }
}
"@

$foreground = [RealKeys]::ForegroundProcess()
$base = [ordered]@{
  foreground = $foreground
  target     = 'Terminus'
  sent       = 0
  inputSize  = [RealKeys]::InputSize()
  error      = 0
  vk         = $Vk
}

if ($foreground -ne 'Terminus') {
  $base | ConvertTo-Json -Compress
  exit 1
}

$base.sent = [RealKeys]::SendVirtualKey([uint16]$Vk, $DelayMs)
if ($base.sent -eq 0) { $base.error = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error() }
$base | ConvertTo-Json -Compress
