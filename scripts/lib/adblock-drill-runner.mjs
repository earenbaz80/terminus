/**
 * Runner de los ensayos de clasificación del E2E de adblock.
 *
 * Cada ensayo es un comando y nada más: corre `npm run test:e2e:adblock` con el
 * fallo sembrado, copia el log del E2E al nombre del ensayo y aplica el veredicto
 * de `adblock-drill-verdict.mjs`. Antes eso lo hacía PowerShell en varios comandos
 * —leer `$LASTEXITCODE`, copiar el log, llamar al clasificador y decidir cómo
 * terminaba el paso—, así que el cableado sólo se podía probar en un runner de
 * Windows. Con las dependencias inyectadas, la matriz se prueba en vitest con un
 * runner falso, sin `pwsh` y sin lanzar Electron.
 */

import { evaluateDrillVerdict } from './adblock-drill-verdict.mjs';

/** Lo que se ejecuta de verdad para producir el fallo sembrado. */
export const DRILL_NPM_ARGS = ['run', 'test:e2e:adblock'];

/** Log que escribe el E2E, sea cual sea el ensayo. */
export const E2E_LOG = 'artifacts/e2e/adblock-electron.log';

export const DRILL_PROFILES = {
  engine: {
    env: { TERMINUS_E2E_ADBLOCK_SEED_EMPTY_ENGINE: '1' },
    logPath: 'artifacts/e2e/adblock-drill-engine.log',
  },
  offline: {
    env: { TERMINUS_E2E_ADBLOCK_PROBE_URLS: 'http://127.0.0.1:9/' },
    logPath: 'artifacts/e2e/adblock-drill-offline.log',
  },
};

/** Perfil del ensayo, o `null` si el nombre no existe. */
export function drillProfile(kind) {
  return Object.prototype.hasOwnProperty.call(DRILL_PROFILES, kind) ? DRILL_PROFILES[kind] : null;
}

/**
 * Corre el E2E del ensayo y aplica el veredicto.
 *
 * @param {{
 *   kind: string,
 *   run: (env: object) => number,
 *   copyLog: (from: string, to: string) => void,
 *   readLog: (path: string) => string | null,
 *   write?: (message: string) => void,
 * }} input
 * @returns {{ ok: boolean, code: number | null, reason: string, logPath: string | null }}
 */
export function runDrill({ kind, run, copyLog, readLog, write = () => {} } = {}) {
  const profile = drillProfile(kind);
  if (!profile) {
    const validos = Object.keys(DRILL_PROFILES).join(', ');
    return { ok: false, code: null, reason: `ensayo desconocido «${kind}»; los válidos son: ${validos}.`, logPath: null };
  }

  write(`Ejecutando \`npm ${DRILL_NPM_ARGS.join(' ')}\` como ensayo «${kind}».`);
  const code = run(profile.env);
  copyLog(E2E_LOG, profile.logPath);

  // Se juzga el log copiado, no el del E2E: es el que se publica en el artefacto.
  const { ok, reason } = evaluateDrillVerdict({ kind, code, log: readLog(profile.logPath) });
  return { ok, code, reason, logPath: profile.logPath };
}
