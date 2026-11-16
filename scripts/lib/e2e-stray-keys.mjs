/**
 * Marca de las teclas de la prueba y lista de teclas ajenas, compartida por las suites.
 *
 * Cada suite abre una ventana (`window.__e2eSyntheticUntil`) justo antes de cada tecla que
 * envía y la cierra en cuanto se procesó; lo que llega fuera de esa ventana no lo envió la
 * prueba y se anota en `window.__e2eStrayKeys`. `isTrusted` no sirve como discriminante:
 * las teclas que inyecta CDP también llegan como confiables.
 */

/** Nombre de la lista en el renderer; las dos suites usan el mismo. */
export const STRAY_LIST = '__e2eStrayKeys';

/** Expresión que abre la ventana. `ms` cubre el viaje de la tecla hasta la app. */
export function markTestKeys(ms = 400) {
  return `window.__e2eSyntheticUntil = performance.now() + ${ms}`;
}

/** Expresión que la cierra: a partir de aquí, toda tecla es ajena. */
export const CLEAR_TEST_KEYS = 'window.__e2eSyntheticUntil = 0';

/** Dentro del listener: si la tecla cae en la ventana, la envió la prueba. */
export const SENT_BY_TEST =
  "typeof window.__e2eSyntheticUntil === 'number' && performance.now() <= window.__e2eSyntheticUntil";

/** Lectura de la lista; vacía lo leído para que una tecla no se informe dos veces. */
export const READ_STRAY_KEYS = `window.${STRAY_LIST} ? window.${STRAY_LIST}.splice(0) : []`;

/** La línea de cierre, con el mismo formato en todas las suites. */
export function strayKeysLine(log, label, keys) {
  return `${log} Teclas no enviadas por la prueba (${label}): ${JSON.stringify(keys)}`;
}
