/**
 * Configuración centralizada de rutas de ejecutables para pruebas E2E.
 * 
 * Provee una sola fuente de verdad para la ubicación del ejecutable de Terminus,
 * con soporte para Windows, Linux y macOS. Cada guion E2E puede elegir el modo
 * adecuado (instalado vs. sin instalar) según sus requisitos de plataforma.
 * 
 * Patrones de ruta por plataforma:
 *   Windows:  %LOCALAPPDATA%\Programs\Terminus\Terminus.exe
 *   Linux:    $HOME/.local/share/Terminus/Terminus (o snap/flatpak)
 *   macOS:    $HOME/Library/Application Support/Terminus/Terminus.app/Contents/MacOS/Terminus
 * 
 * Cada script debe usar `resolvedExe` en lugar de duplicar la lógica de fallback.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Resuelve la ruta al ejecutable de Terminus según la plataforma y variables de entorno.
 * 
 * Order of precedence:
 *   1. TERMINUS_INSTALLED_EXE (si está definida, se resuelve absolutamente)
 *   2. Plataforma-specific default paths
 *   3. Fallback: sin ejecutable (lanza error más adelante)
 * 
 * @param options.fallbackToLocalAppData - Si true, usa LOCALAPPDATA en Windows como último recurso.
 *                                           Si false, requiere que TERMINUS_INSTALLED_EXE esté definida.
 * @returns Ruta absolutal al ejecutable de Terminus, o null si no se encuentra.
 */

export function resolvedExe(options = {}) {
  const { fallbackToLocalAppData = true } = options;
  const installedExe = process.env.TERMINUS_INSTALLED_EXE;

  if (installedExe) {
    return path.resolve(installedExe);
  }

  const platform = process.platform;

  // Windows
  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    if (fallbackToLocalAppData && localAppData) {
      return path.join(localAppData, 'Programs', 'Terminus', 'Terminus.exe');
    }
    return null;
  }

  // Linux
  if (platform === 'linux') {
    const home = os.homedir();
    const candidates = [
      path.join(home, '.local', 'share', 'Terminus', 'Terminus'),
      path.join(home, '.config', 'Terminus', 'Terminus'),
      path.join(home, 'bin', 'Terminus'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return path.resolve(candidate);
      }
    }
    return null;
  }

  // macOS
  if (platform === 'darwin') {
    const home = os.homedir();
    const candidates = [
      path.join(home, 'Library', 'Application Support', 'Terminus', 'Terminus.app', 'Contents', 'MacOS', 'Terminus'),
      path.join(home, 'Applications', 'Terminus.app', 'Contents', 'MacOS', 'Terminus'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return path.resolve(candidate);
      }
    }
    return null;
  }

  // Plataforma desconocida
  return null;
}
