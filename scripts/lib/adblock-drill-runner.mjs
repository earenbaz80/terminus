/**
 * Runner de los ensayos de clasificación del E2E de adblock.
 *
 * Cada ensayo es un comando y nada más: corre el E2E con el fallo sembrado, copia
 * su log al nombre del ensayo y aplica el veredicto de `adblock-drill-verdict.mjs`.
 * Las variables que siembran el fallo y el nombre del log salen de
 * `adblock-drills.mjs`, la misma configuración que usa el veredicto.
 *
 * Antes eso lo hacía PowerShell en varios comandos —leer `$LASTEXITCODE`, copiar
 * el log, llamar al clasificador y decidir cómo terminaba el paso—, así que el
 * cableado sólo se podía probar en un runner de Windows. Con las dependencias
 * inyectadas, la matriz se prueba en vitest con un runner falso, sin `pwsh` y sin
 * lanzar Electron.
 */

import { DRILLS, drillConfig } from './adblock-drills.mjs';
import { evaluateDrillVerdict } from './adblock-drill-verdict.mjs';

/** Log que escribe el E2E, sea cual sea el ensayo. */
export const E2E_LOG = 'artifacts/e2e/adblock-electron.log';

/**
 * Corre el E2E del ensayo y aplica el veredicto.
 *
 * @param {{
 *   kind: string,
 *   run: (env: object) => number,
 *   copyLog: (from: string, to: string) => void,
 *   readLog: (path: string) => string | null,
 * }} input
 * @returns {{ ok: boolean, code: number | null, reason: string }}
 */
export function runDrill({ kind, run, copyLog, readLog } = {}) {
  const drill = drillConfig(kind);
  if (!drill) {
    const validos = Object.keys(DRILLS).join(', ');
    return { ok: false, code: null, reason: `ensayo desconocido «${kind}»; los válidos son: ${validos}.` };
  }

  const code = run(drill.env);
  copyLog(E2E_LOG, drill.logPath);

  // Se juzga el log copiado, no el del E2E: es el que se publica en el artefacto.
  const { ok, reason } = evaluateDrillVerdict({ kind, code, log: readLog(drill.logPath) });
  return { ok, code, reason };
}
