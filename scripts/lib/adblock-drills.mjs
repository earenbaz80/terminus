/**
 * Configuración compartida del E2E de adblock.
 *
 * El comando que lo ejecuta y el destino inalcanzable los usan tanto el paso
 * normal del job como los ensayos de clasificación. Cada ensayo es además una
 * entrada de `DRILLS` con todo lo que necesitan el runner y el veredicto: qué
 * fallo siembra (las variables de entorno), dónde deja su log, cómo se llama en
 * los mensajes y qué marcador tiene que traer ese log para contar como fallo de
 * red. Añadir un ensayo es añadir una entrada aquí y su `--kind` en el workflow;
 * antes había una tabla en el runner y otra en el veredicto.
 */

/** Lo que ejecuta el E2E: el mismo comando para el paso normal y los ensayos. */
export const E2E_NPM_ARGS = ['run', 'test:e2e:adblock'];

/** Destino que no existe: simula un runner sin red sin cortarle la red. */
export const OFFLINE_PROBE_URLS = 'http://127.0.0.1:9/';

export const DRILLS = {
  engine: {
    label: 'motor sin listas',
    marker: /motor sin listas/i,
    markerLabel: 'motor sin listas',
    env: { TERMINUS_E2E_ADBLOCK_SEED_EMPTY_ENGINE: '1' },
    logPath: 'artifacts/e2e/adblock-drill-engine.log',
  },
  offline: {
    label: 'destino inalcanzable',
    marker: /E2E_ADBLOCK_UNREACHABLE/,
    markerLabel: 'E2E_ADBLOCK_UNREACHABLE',
    env: { TERMINUS_E2E_ADBLOCK_PROBE_URLS: OFFLINE_PROBE_URLS },
    logPath: 'artifacts/e2e/adblock-drill-offline.log',
  },
};

/** Configuración del ensayo, o `null` si el nombre no existe. */
export function drillConfig(kind) {
  return Object.prototype.hasOwnProperty.call(DRILLS, kind) ? DRILLS[kind] : null;
}
