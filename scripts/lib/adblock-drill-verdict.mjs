/**
 * Veredicto de los ensayos de clasificación del E2E de adblock.
 *
 * Los ensayos siembran un fallo del arnés —motor vacío o destino inalcanzable—
 * y esperan que el E2E salga con código 2, para comprobar que un fallo de red no
 * se confunde con una regresión del producto. Las etiquetas y los marcadores
 * salen de `adblock-drills.mjs`, y el significado de cada código de
 * `adblock-exit.mjs`: las mismas piezas que usa el paso normal del job.
 *
 * Esto vive aquí, y no dentro de los pasos de PowerShell, por dos motivos: el
 * veredicto es lógica pura y se puede probar sin `pwsh`, y un código que no se
 * espera —sobre todo el 1 de una regresión real— tiene que poner el paso en rojo
 * en vez de colarse por un `exit 0` mal puesto (PR #109).
 */

import { DRILLS, drillConfig } from './adblock-drills.mjs';
import { EXIT_NETWORK, classifyAdblockExit } from './adblock-exit.mjs';

/**
 * @param {{ kind?: string, code?: number, log?: string | null }} input
 *   `log` es el contenido del log del E2E, no su ruta: la función es pura.
 * @returns {{ ok: boolean, reason: string }}
 */
export function evaluateDrillVerdict({ kind, code, log } = {}) {
  const drill = drillConfig(kind);
  if (!drill) {
    const known = Object.keys(DRILLS).join(', ');
    return { ok: false, reason: `ensayo desconocido «${kind}»; los válidos son: ${known}.` };
  }

  const exit = classifyAdblockExit(code);

  if (exit === 'unknown') {
    return { ok: false, reason: `no llegó un código de salida utilizable (${JSON.stringify(code)}).` };
  }

  if (exit === 'regression') {
    return {
      ok: false,
      reason: `el E2E salió con código 1 en el ensayo «${drill.label}»: es una regresión del producto, no un fallo de red. Un fallo real tiene que poner el paso en rojo.`,
    };
  }

  if (exit !== 'network') {
    return {
      ok: false,
      reason: `el ensayo «${drill.label}» debía salir con código ${EXIT_NETWORK} (se clasifica como red) y salió con ${code}.`,
    };
  }

  if (typeof log !== 'string' || log.trim() === '') {
    return { ok: false, reason: `el ensayo «${drill.label}» salió con código 2, pero no hay log que atribuya el fallo.` };
  }

  if (!drill.marker.test(log)) {
    return {
      ok: false,
      reason: `el ensayo «${drill.label}» salió con código 2, pero el log no trae «${drill.markerLabel}».`,
    };
  }

  return { ok: true, reason: `ensayo «${drill.label}»: código 2 y «${drill.markerLabel}» en el log, como se esperaba.` };
}
