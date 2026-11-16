/**
 * Inyección real de teclas desde otro proceso, con `SendInput` por P/Invoke
 * (`scripts/lib/win-send-input.ps1`). Es la vía que faltaba para la caza de la tecla
 * ajena: `SendKeys` de .NET quedaba bloqueado y CDP no es entrada del sistema, así que
 * solo esto produce una pulsación que llega al renderer como teclado físico.
 *
 * La ventana destino tiene que estar en primer plano: si no lo está, el script reenfoca
 * el proceso por nombre antes de enviar y lo informa en el resultado.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const SCRIPT = path.join(import.meta.dirname, 'win-send-input.ps1');

/**
 * Envía una tecla real y devuelve `{ foreground, refocused, sent, vk, text, times }`.
 * `sent` son los eventos aceptados por SendInput: 0 significa que no llegó nada.
 */
export function sendRealKey({
  text = '',
  vk = 0,
  times = 1,
  delayMs = 80,
  processName = 'Terminus',
} = {}) {
  if (process.platform !== 'win32') throw new Error('SendInput solo existe en Windows.');
  const stdout = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      SCRIPT,
      '-Text',
      text,
      '-Vk',
      String(vk),
      '-Times',
      String(times),
      '-DelayMs',
      String(delayMs),
      '-ProcessName',
      processName,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  const line = stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .pop();
  try {
    return JSON.parse(line);
  } catch {
    throw new Error(`Salida inesperada de win-send-input.ps1: ${stdout.trim()}`);
  }
}
