#!/usr/bin/env node
/**
 * Suite `browser` del E2E instalado: permisos por origen.
 *
 * Tres pasos sobre un fixture local que llama a `Notification.requestPermission()`:
 *
 *   1. con `TERMINUS_E2E_PERMISSION_ANSWER=deny` la promesa resuelve «denied» y la
 *      respuesta queda guardada en `permissions.json`, igual que si se hubiera
 *      pulsado el diálogo nativo;
 *   2. al recargar —proceso nuevo, mismo perfil y sin gancho— ya no se pregunta:
 *      `Notification.permission` es «denied» antes de pedir y la petición vuelve a
 *      resolver «denied» sin que aparezca el cuadro nativo, que colgaría la promesa
 *      porque CDP no puede pulsarlo;
 *   3. con el gancho en `allow`, sobre esa misma decisión guardada, resuelve «granted».
 *
 * El perfil se conserva entre los tres arranques: lo que se mide es la persistencia
 * del almacén por origen, no solo el cableado del canal.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { resolvedExe } from './lib/e2e-executable.mjs';
import { suiteSteps } from './e2e-suites.mjs';
import {
  assertInstalledMatchesBuild,
  captureFailureScreenshot,
  launchInstalledApp,
  sleep,
  waitForExpression,
} from './lib/installed-app.mjs';

const LOG = '[e2e-installed-browser]';
const TOTAL_STEPS = suiteSteps('browser');
let stepsRun = 0;

const installedExe = resolvedExe({ fallbackToLocalAppData: true }) || path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Terminus', 'Terminus.exe');

// Cada pestaña web monta su superficie: el invitado y la barra que interesan son los
// del panel visible, no los primeros del documento.
const ACTIVE_PANE = '[data-e2e="browser-pane"][data-active="true"]';
const ADDRESS_SELECTOR = `${ACTIVE_PANE} input[aria-controls="terminus-address-suggestions"]`;
const GUEST_SELECTOR = `${ACTIVE_PANE} webview`;

/** Ejecuta código dentro del invitado y devuelve lo que resuelva la promesa. */
const guestExpression = (code) => `(() => {
  const view = document.querySelector(${JSON.stringify(GUEST_SELECTOR)}) ?? document.querySelector('webview');
  if (!view) return Promise.resolve(null);
  return Promise.resolve(view.executeJavaScript(${JSON.stringify(code)}, true));
})()`;

const GUEST_STATE_EXPRESSION = `(() => {
  const view = document.querySelector(${JSON.stringify(GUEST_SELECTOR)}) ?? document.querySelector('webview');
  return { url: view?.getURL?.() ?? null, ready: document.readyState };
})()`;

// El clic se manda con eventos de ratón del invitado: un `click()` por
// `executeJavaScript` no lleva gesto de usuario y Chromium lo descarta.
const PERMISSION_CLICK_SCRIPT =
  '(() => { const button = document.getElementById("permiso"); if (!button) return null; ' +
  'const box = button.getBoundingClientRect(); const x = Math.round(box.left + box.width / 2); ' +
  'const y = Math.round(box.top + box.height / 2); ' +
  'const hit = document.elementFromPoint(x, y); ' +
  'return { x, y, hit: hit?.id || hit?.tagName || null }; })()';

/** Fixture local: un botón que pide permiso de notificaciones y guarda la respuesta. */
function startPermissionFixture() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8">
    <title>Terminus E2E permisos</title>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; }
      #permiso { position: absolute; top: 16px; left: 16px; width: 220px; height: 40px; }
    </style>
  </head>
  <body>
    <button id="permiso" type="button">Pedir notificaciones</button>
    <p id="resultado"></p>
    <script>
      window.__permiso = null;
      document.getElementById('permiso').addEventListener('click', function () {
        Notification.requestPermission().then(function (answer) {
          window.__permiso = answer;
          document.getElementById('resultado').textContent = answer;
        });
      });
    </script>
  </body>
</html>`);
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      if (!port) {
        server.close();
        reject(new Error('El fixture de permisos no pudo abrir un puerto.'));
        return;
      }
      resolve({ server, pageUrl: `http://127.0.0.1:${port}/` });
    });
  });
}

/** Anota un paso superado, lo numera sobre el total y registra lo que tardó. */
const startedAt = Date.now();
function pass(message) {
  stepsRun += 1;
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1).replace('.', ',');
  console.log(`${LOG} PASS ${stepsRun}/${TOTAL_STEPS}: ${message} (${elapsed} s en total)`);
}

let app = null;
let fixture = null;
let profileDir = '';

/**
 * Navega el panel activo por su barra de direcciones, como cualquier comando: al
 * arrancar, la app está en el inicio y todavía no hay `<webview>` que cargar.
 */
async function openFixture(client, url) {
  const address = JSON.stringify(ADDRESS_SELECTOR);
  // El foco puede aplicarse en el frame siguiente; se reintenta hasta que el
  // documento lo refleje, en vez de exigirlo en la misma evaluación.
  await waitForExpression(
    client,
    `(() => {
      const input = document.querySelector(${address}) ??
        document.querySelector('input[aria-controls="terminus-address-suggestions"]');
      if (!input) return false;
      input.focus();
      input.select();
      return document.activeElement === input;
    })()`,
    (focused) => focused === true,
    'la barra de direcciones enfocada',
    5000,
  );

  const command = `goto ${url}`;
  await client.send('Input.insertText', { text: command });
  await waitForExpression(
    client,
    `document.querySelector(${address})?.value ?? null`,
    (value) => value === command,
    `el comando «${command}» en la barra de direcciones`,
    5000,
  );
  // Deja que React aplique el valor antes de enviar Enter.
  await sleep(200);
  const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    ...key,
    text: '\r',
    unmodifiedText: '\r',
  });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });

  await waitForExpression(
    client,
    GUEST_STATE_EXPRESSION,
    (state) => state.url === url && state.ready === 'complete',
    `el fixture de permisos en el invitado (${url})`,
    30000,
  );
}

/** Pulsa el botón del fixture con entrada real dentro del invitado. */
async function clickPermissionButton(client) {
  const clicked = await client.evaluate(`(() => {
    const view = document.querySelector(${JSON.stringify(GUEST_SELECTOR)});
    if (!view || typeof view.sendInputEvent !== 'function') {
      return { ok: false, reason: 'el invitado no expone sendInputEvent' };
    }
    return Promise.resolve(
      view.executeJavaScript(${JSON.stringify(PERMISSION_CLICK_SCRIPT)}, true)
    ).then((point) => {
      if (!point) return { ok: false, reason: 'el fixture no tiene el botón' };
      if (point.hit !== 'permiso') {
        return {
          ok: false,
          reason: 'el clic caería sobre ' + point.hit + ' en ' + point.x + ',' + point.y,
        };
      }
      view.focus();
      view.sendInputEvent({ type: 'mouseMove', x: point.x, y: point.y });
      view.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      view.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      return { ok: true };
    });
  })()`);
  assert.equal(clicked.ok, true, `No se pudo pulsar el botón de permiso (${clicked.reason}).`);
}

/** Pulsa el botón y espera la respuesta que el fixture guarda en `window.__permiso`. */
async function requestPermission(client) {
  await clickPermissionButton(client);
  return waitForExpression(
    client,
    guestExpression('window.__permiso ?? null'),
    (answer) => answer === 'granted' || answer === 'denied',
    'la respuesta de Notification.requestPermission()',
    15000,
  );
}

/** Recarga la página del invitado y espera al documento nuevo. */
async function reloadGuest(client) {
  const reloaded = await client.evaluate(`(() => {
    const view = document.querySelector(${JSON.stringify(GUEST_SELECTOR)});
    if (!view || typeof view.reload !== 'function') return false;
    view.reload();
    return true;
  })()`);
  assert.equal(reloaded, true, 'No se pudo recargar el invitado.');
  // El fixture arranca con `__permiso` en null: así se distingue el documento nuevo.
  await waitForExpression(
    client,
    guestExpression('document.readyState + ":" + (window.__permiso === null ? "nuevo" : "viejo")'),
    (state) => state === 'complete:nuevo',
    'el fixture recargado',
    20000,
  );
}

async function main() {
  assertInstalledMatchesBuild({ exe: installedExe });
  console.log(`${LOG} Instalación verificada: el app.asar es el del build local.`);
  console.log(`${LOG} Ejecutable instalado: ${installedExe}`);

  fixture = await startPermissionFixture();
  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminus-e2e-browser-'));
  const baseEnv = {
    // El fixture vive en 127.0.0.1; la política de red no debe estorbar.
    TERMINUS_BLOCK_PRIVATE: '0',
    TERMINUS_NETWORK_POLICY: 'local',
  };

  // Paso 1: el gancho responde como el diálogo y guarda la decisión.
  app = await launchInstalledApp({
    exe: installedExe,
    profileDir,
    env: { ...baseEnv, TERMINUS_E2E_PERMISSION_ANSWER: 'deny' },
  });
  await openFixture(app.client, fixture.pageUrl);
  const denied = await requestPermission(app.client);
  assert.equal(denied, 'denied', `Con el gancho en deny la página recibió «${denied}».`);
  pass(
    `con TERMINUS_E2E_PERMISSION_ANSWER=deny, Notification.requestPermission() resuelve «${denied}».`,
  );
  // `stop()` conserva el perfil: el siguiente arranque tiene que ver esta decisión.
  await app.stop();

  // Paso 2: mismo perfil y sin gancho, así contesta la decisión guardada.
  app = await launchInstalledApp({
    exe: installedExe,
    profileDir,
    env: { ...baseEnv, TERMINUS_E2E_PERMISSION_ANSWER: '' },
  });
  await openFixture(app.client, fixture.pageUrl);
  await reloadGuest(app.client);
  const remembered = await app.client.evaluate(guestExpression('Notification.permission'));
  assert.equal(
    remembered,
    'denied',
    `Tras recargar el permiso quedó en «${remembered}»: la decisión no se recordó y volvería a preguntarse.`,
  );
  const askedAgain = await requestPermission(app.client);
  assert.equal(askedAgain, 'denied', `Tras recargar la petición resolvió «${askedAgain}».`);
  pass(
    'tras recargar, y sin gancho que conteste, no vuelve a preguntar: Notification.permission ya es «denied» y la petición resuelve «denied» sin diálogo.',
  );
  await app.stop();

  // Paso 3: el gancho manda sobre la decisión guardada y la reescribe.
  app = await launchInstalledApp({
    exe: installedExe,
    profileDir,
    env: { ...baseEnv, TERMINUS_E2E_PERMISSION_ANSWER: 'allow' },
  });
  await openFixture(app.client, fixture.pageUrl);
  const granted = await requestPermission(app.client);
  assert.equal(granted, 'granted', `Con el gancho en allow la página recibió «${granted}».`);
  pass(
    `con TERMINUS_E2E_PERMISSION_ANSWER=allow, sobre la decisión deny guardada, la petición resuelve «${granted}».`,
  );

  // Paso 4: geolocalización con allow
  app = await launchInstalledApp({
    exe: installedExe,
    profileDir,
    env: { ...baseEnv, TERMINUS_E2E_GEO_ANSWER: 'allow' },
  });
  await openFixture(app.client, fixture.pageUrl);
  // Esperamos que el fixture tenga el input de geolocalización
  await waitForGeolocationInput(app.client);
  const geo = await requestGeolocation(app.client);
  // El fixture debería haber guardado la decisión; verificamos que no sea null.
  assert.notStrictEqual(geo, null, 'Geolocalización debería haber sido solicitada y responder.');
  pass(
    `geolocalización solicitada con TERMINUS_E2E_GEO_ANSWER=allow, respuesta: "${geo}".`,
  );
  await app.stop();

  // Paso 5: cámara con allow
  app = await launchInstalledApp({
    exe: installedExe,
    profileDir,
    env: { ...baseEnv, TERMINUS_E2E_CAM_ANSWER: 'allow' },
  });
  await openFixture(app.client, fixture.pageUrl);
  // Esperamos que el fixture tenga el input de cámara
  await waitForCameraInput(app.client);
  const cam = await requestCamera(app.client);
  // El fixture debería haber guardado la decisión; verificamos que no sea null.
  assert.notStrictEqual(cam, null, 'Cámara debería haber sido solicitada y responder.');
  pass(
    `cámara solicitada con TERMINUS_E2E_CAM_ANSWER=allow, respuesta: "${cam}".`,
  );
  assert.equal(stepsRun, TOTAL_STEPS, 'pasos ejecutados: ' + stepsRun + '/' + TOTAL_STEPS);
}

try {
  if (process.platform !== 'win32') {
    console.log(`${LOG} SKIP: la prueba arranca el instalador y solo corre en Windows.`);
  } else {
    await main();
  }
} catch (error) {
  console.error(`${LOG} FAIL: ${error instanceof Error ? error.message : String(error)}`);
  if (app?.logs().trim()) {
    console.error(`${LOG} Log de la app (cola):\n${app.logs().trim()}`);
  }
  await captureFailureScreenshot(app?.client, 'browser');
  process.exitCode = 1;
} finally {
  // El paso del E2E en CI lee esta línea para comparar con el total esperado.
  console.log(LOG + ' STEPS: ' + stepsRun + '/' + TOTAL_STEPS);
  await app?.cleanup();
  fixture?.server?.close();
  if (profileDir) {
    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      console.warn(
        `No se pudo borrar el perfil ${profileDir}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
