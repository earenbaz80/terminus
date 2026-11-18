/**
 * Veredicto de los ensayos de clasificación del E2E de adblock.
 *
 * Los ensayos siembran un fallo del arnés —motor vacío o destino inalcanzable—
 * y esperan que `scripts/e2e-adblock-electron.mjs` salga con código 2, para
 * comprobar que un fallo de red no se confunde con una regresión del producto.
 *
 * Esto vive aquí, y no dentro de los pasos de PowerShell, por dos motivos: el
 * veredicto es lógica pura y se puede probar sin `pwsh`, y un código que no se
 * espera —sobre todo el 1 de una regresión real— tiene que poner el paso en rojo
 * en vez de colarse por un `exit 0` mal puesto (PR #109).
 */

export const DRILLS = {
  engine: { label: 'motor sin listas', marker: /motor sin listas/i, markerLabel: 'motor sin listas' },
  offline: { label: 'destino inalcanzable', marker: /E2E_ADBLOCK_UNREACHABLE/, markerLabel: 'E2E_ADBLOCK_UNREACHABLE' },
};

export const UNEXPECTED_CODE = 2;

/**
 * @param {{ kind?: string, code?: number, log?: string | null }} input
 *   `log` es el contenido del log del E2E, no su ruta: la función es pura.
 * @returns {{ ok: boolean, reason: string }}
 */
export function evaluateDrillVerdict({ kind, code, log } = {}) {
  const drill = DRILLS[kind];
  if (!drill) {
    const known = Object.keys(DRILLS).join(', ');
    return { ok: false, reason: `ensayo desconocido «${kind}»; los válidos son: ${known}.` };
  }

  if (!Number.isInteger(code)) {
    return { ok: false, reason: `no llegó un código de salida utilizable (${JSON.stringify(code)}).` };
  }

  if (code === 1) {
    return {
      ok: false,
      reason: `el E2E salió con código 1 en el ensayo «${drill.label}»: es una regresión del producto, no un fallo de red. Un fallo real tiene que poner el paso en rojo.`,
    };
  }

  if (code !== UNEXPECTED_CODE) {
    return {
      ok: false,
      reason: `el ensayo «${drill.label}» debía salir con código ${UNEXPECTED_CODE} (se clasifica como red) y salió con ${code}.`,
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
