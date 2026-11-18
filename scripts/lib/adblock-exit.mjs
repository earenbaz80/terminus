/**
 * Códigos de salida del E2E de adblock, en un solo sitio.
 *
 * Los emite `scripts/e2e-adblock-electron.mjs` y los interpretan dos consumidores
 * que antes tenían cada uno su copia del criterio: el paso normal del job
 * (código 2 = fallo de red, se avisa y el job sigue verde) y los ensayos de
 * clasificación (código 2 con su motivo = clasificación correcta). El 1 es una
 * regresión del producto en los dos casos; cualquier otro código tampoco es
 * verde.
 */

export const EXIT_OK = 0;
export const EXIT_REGRESSION = 1;
export const EXIT_NETWORK = 2;

/**
 * @param {number | null | undefined} code código de salida del E2E
 * @returns {'ok' | 'regression' | 'network' | 'unexpected' | 'unknown'}
 */
export function classifyAdblockExit(code) {
  if (!Number.isInteger(code)) return 'unknown';
  if (code === EXIT_OK) return 'ok';
  if (code === EXIT_REGRESSION) return 'regression';
  if (code === EXIT_NETWORK) return 'network';
  return 'unexpected';
}
