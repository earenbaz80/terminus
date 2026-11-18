/**
 * Qué hace el paso «E2E de adblock en Electron» con el código de salida del E2E.
 *
 * La regla vive aquí y no en el `run:` del workflow: código 0 deja el job verde,
 * código 2 (fallo de red) también, con un `::warning` y `skipped=true` para que
 * el resumen diga «Omitido (sin red)», y cualquier otro código pone el paso rojo
 * con ese mismo código. El significado de cada código está en `adblock-exit.mjs`,
 * compartido con los ensayos de clasificación.
 */

import { classifyAdblockExit } from './adblock-exit.mjs';

export const NETWORK_REASONS = {
  forced: 'Ensayo sin red pedido con workflow_dispatch (destino inalcanzable, código 2); el comportamiento es el de un runner sin red.',
  real: 'El runner no alcanzó example.com o las listas de EasyList (código 2); no se puede distinguir una regresión de un fallo de red.',
};

/**
 * @param {{ code?: number | null, offline?: boolean }} input
 *   `offline`: el run se pidió con `adblock_offline`, así que el código 2 es el
 *   que se buscaba.
 * @returns {{ exit: string, exitCode: number, skipped: boolean, warning: string | null }}
 */
export function decideE2eStep({ code, offline = false } = {}) {
  const exit = classifyAdblockExit(code);

  if (exit === 'ok') {
    return { exit, exitCode: 0, skipped: false, warning: null };
  }

  if (exit === 'network') {
    return {
      exit,
      exitCode: 0,
      skipped: true,
      warning: offline ? NETWORK_REASONS.forced : NETWORK_REASONS.real,
    };
  }

  return { exit, exitCode: Number.isInteger(code) ? code : 1, skipped: false, warning: null };
}
