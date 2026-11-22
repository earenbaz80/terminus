/**
 * Escritura en la barra de direcciones del panel activo.
 *
 * Vive aquí porque las dos suites instaladas la usan: `ui`/`ui-de` para cada
 * comando y `browser` para abrir su fixture. Las dos sufrían la misma carrera y
 * la arreglaba solo una.
 */

import assert from 'node:assert/strict';
import { waitForExpression } from './installed-app.mjs';

/** Intentos antes de darse por vencido; cada uno espera `VERIFY_TIMEOUT_MS`. */
const ATTEMPTS = 5;
const VERIFY_TIMEOUT_MS = 1000;

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
 * cuando el panel activo todavía no tiene una (arranque en el inicio). El valor se
 * verifica sobre el selector que se enfocó de verdad, porque al arrancar la barra
 * del panel activo puede no existir todavía.
 */
export async function typeInAddressBar(client, command, { selector, fallbackSelector = '' } = {}) {
  assert.ok(selector, 'typeInAddressBar necesita el selector de la barra de direcciones.');

  const candidates = fallbackSelector ? [selector, fallbackSelector] : [selector];
  let typed = '';

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    // Devuelve qué selector coincidió: dentro del invitado solo hay un input que
    // enfocar, y verificarlo en Node evita leer una barra distinta de la escrita.
    const focused = await client.evaluate(`(() => {
      const candidates = ${JSON.stringify(candidates)};
      const input = candidates.map((candidate) => document.querySelector(candidate)).find(Boolean);
      if (!input) return '';
      input.focus();
      input.select();
      if (document.activeElement !== input) return '';
      return candidates.find((candidate) => document.querySelector(candidate) === input) ?? '';
    })()`);

    if (!focused) {
      // La barra puede no existir todavía (arranque en el inicio): se le da el
      // mismo margen que a la verificación antes de contar otro intento.
      await waitForExpression(
        client,
        `(${JSON.stringify(candidates)}).some((candidate) => document.querySelector(candidate))` +
          ' ? true : null',
        (found) => found === true,
        'la barra de direcciones',
        VERIFY_TIMEOUT_MS,
      ).catch(() => '');
      continue;
    }

    await client.send('Input.insertText', { text: command });
    typed = await waitForExpression(
      client,
      `document.querySelector(${JSON.stringify(focused)})?.value ?? null`,
      (value) => value === command,
      `el comando «${command}» en la barra de direcciones`,
      VERIFY_TIMEOUT_MS,
    ).catch(() => '');
    if (typed === command) return;
  }

  assert.fail(`No se pudo escribir «${command}» en la barra de direcciones (quedó «${typed}»).`);
}
