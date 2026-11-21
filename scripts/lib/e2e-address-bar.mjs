/**
 * Escritura en la barra de direcciones del panel activo.
 *
 * Vive aquí porque las dos suites instaladas la usan: `ui`/`ui-de` para cada
 * comando y `browser` para abrir su fixture. Las dos sufrían la misma carrera y
 * la arreglaban solo una.
 */

import assert from 'node:assert/strict';
import { waitForExpression } from './installed-app.mjs';

/**
 * Escribe `command` en la barra de direcciones y comprueba que React lo refleje.
 *
 * En un arranque en frío la terminal se monta después de que exista el input y
 * React lo vuelve a pintar: el primer `insertText` aterriza en un nodo que ya no
 * está y la barra queda vacía, que es como fallaba el primer paso de `browser` en
 * CI. Cada intento vuelve a buscar el input y a enfocarlo, en vez de exigir el
 * valor a la primera.
 *
 * `fallbackSelector` es opcional: permite escribir en la barra de cualquier panel
 * cuando el panel activo todavía no tiene una (arranque en el inicio).
 */
export async function typeInAddressBar(
  client,
  command,
  { selector, fallbackSelector = '', attempts = 5, timeoutMs = 1000 } = {},
) {
  assert.ok(selector, 'typeInAddressBar necesita el selector de la barra de direcciones.');
  const address = JSON.stringify(selector);
  const fallback = fallbackSelector ? JSON.stringify(fallbackSelector) : '';
  const node = fallback
    ? `document.querySelector(${address}) ?? document.querySelector(${fallback})`
    : `document.querySelector(${address})`;
  let typed = '';

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await client.evaluate(`(() => {
      const input = ${node};
      if (!input) return false;
      input.focus();
      input.select();
      return document.activeElement === input;
    })()`);
    await client.send('Input.insertText', { text: command });
    typed = await waitForExpression(
      client,
      `document.querySelector(${address})?.value ?? null`,
      (value) => value === command,
      `el comando «${command}» en la barra de direcciones`,
      timeoutMs,
    ).catch(() => '');
    if (typed === command) return;
  }

  assert.fail(`No se pudo escribir «${command}» en la barra de direcciones (quedó «${typed}»).`);
}
