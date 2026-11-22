#!/usr/bin/env node
/**
 * Suite `browser` del E2E instalado: permisos por origen.
 *
 * Cinco pasos sobre un fixture local que pide notificaciones, ubicación y cámara:
 *
 *   1. con `TERMINUS_E2E_PERMISSION_ANSWER=deny` la promesa de notificaciones resuelve
 *      «denied» y la respuesta queda guardada en `permissions.json`, igual que si se
 *      hubiera pulsado el diálogo nativo;
 *   2. al recargar —proceso nuevo, mismo perfil y sin gancho— ya no se pregunta:
 *      `Notification.permission` es «denied» antes de pedir y la petición vuelve a
 *      resolver «denied» sin que aparezca el cuadro nativo, que colgaría la promesa
 *      porque CDP no puede pulsarlo;
 *   3. con el gancho en `allow`, sobre esa misma decisión guardada, resuelve «granted»;
 *   4. con `TERMINUS_E2E_GEO_ANSWER=allow` la ubicación queda concedida para el
  *      origen y devuelve una posición real: CDP fija la coordenada en el invitado
 *      (`Emulation.setGeolocationOverride`), así un runner sin proveedor también la
 *      entrega y el paso mide posición, no solo permiso;
 *   5. con `TERMINUS_E2E_CAM_ANSWER=allow` `getUserMedia` entrega una pista de video;
 *      la app arranca con un dispositivo falso de Chromium para que el runner, que
 *      no tiene cámara, pueda ejecutar el camino real.
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
  connectCdp,
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
import { typeInAddressBar } from './lib/e2e-address-bar.mjs';

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
const fixtureClickScript = (id) =>
  `(() => { const button = document.getElementById(${JSON.stringify(id)}); if (!button) return null; ` +
  `const box = button.getBoundingClientRect(); const x = Math.round(box.left + box.width / 2); ` +
  `const y = Math.round(box.top + box.height / 2); ` +
  `const hit = document.elementFromPoint(x, y); ` +
  `return { x, y, hit: hit?.id || hit?.tagName || null }; })()`;

/** Punto donde caería el clic sobre un botón del fixture, leído dentro del invitado. */
const fixtureClickPoint = (id) => `(() => {
  const view = document.querySelector(${JSON.stringify(GUEST_SELECTOR)});
  if (!view || typeof view.executeJavaScript !== 'function') return Promise.resolve(null);
  return Promise.resolve(view.executeJavaScript(${JSON.stringify(fixtureClickScript(id))}, true));
})()`;

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
      button { position: absolute; left: 16px; width: 220px; height: 40px; }
      #permiso { top: 16px; }
      #geo { top: 64px; }
      #cam { top: 112px; }
      p { position: absolute; left: 16px; margin: 0; }
      #resultado { top: 152px; }
      #resultado-geo { top: 176px; }
      #resultado-cam { top: 200px; }
    </style>
  </head>
  <body>
    <button id="permiso" type="button">Pedir notificaciones</button>
    <button id="geo" type="button">Pedir ubicacion</button>
    <button id="cam" type="button">Pedir camara</button>
    <p id="resultado"></p>
    <p id="resultado-geo"></p>
    <p id="resultado-cam"></p>
    <script>
      window.__permiso = null;
      window.__geo = null;
      window.__cam = null;
      var show = function (id, text) { document.getElementById(id).textContent = text; };
      document.getElementById('permiso').addEventListener('click', function () {
        Notification.requestPermission().then(function (answer) {
          window.__permiso = answer;
          show('resultado', answer);
        });
      });
      // La ubicacion se pide de verdad: eso dispara el permiso de la app. La posicion
      // puede faltar (un runner no tiene proveedor), pero el estado del permiso si
      // existe, y eso es lo que mide la suite.
      document.getElementById('geo').addEventListener('click', function () {
        var done = function (position, error) {
          navigator.permissions.query({ name: 'geolocation' }).then(function (status) {
            window.__geo = JSON.stringify({
              state: status.state,
              position: position,
              error: error,
            });
            show('resultado-geo', status.state + (position ? ' ' + position : ''));
          });
        };
        navigator.geolocation.getCurrentPosition(
          function (result) {
            done(result.coords.latitude + ',' + result.coords.longitude, null);
          },
          function (failure) {
            done(null, failure.code);
          },
          { timeout: 3000, maximumAge: 0 },
        );
      });
      document.getElementById('cam').addEventListener('click', function () {
        navigator.mediaDevices.getUserMedia({ video: true }).then(function (stream) {
          var tracks = stream.getVideoTracks().length;
          stream.getTracks().forEach(function (track) { track.stop(); });
          window.__cam = JSON.stringify({ state: 'ok', tracks: tracks, name: null });
          show('resultado-cam', 'ok ' + tracks);
        }).catch(function (error) {
          window.__cam = JSON.stringify({ state: 'error', tracks: 0, name: error.name });
          show('resultado-cam', error.name);
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
  await typeInAddressBar(client, `goto ${url}`, {
    selector: ADDRESS_SELECTOR,
    // Al arrancar, la app está en el inicio y el panel activo aún no tiene barra.
    fallbackSelector: 'input[aria-controls="terminus-address-suggestions"]',
  });
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

/** Pulsa un botón del fixture con entrada real dentro del invitado. */
async function clickFixtureButton(client, id) {
  const clicked = await client.evaluate(`(() => {
    const view = document.querySelector(${JSON.stringify(GUEST_SELECTOR)});
    if (!view || typeof view.sendInputEvent !== 'function') {
      return { ok: false, reason: 'el invitado no expone sendInputEvent' };
    }
    return Promise.resolve(
      view.executeJavaScript(${JSON.stringify(fixtureClickScript(id))}, true)
    ).then((point) => {
      if (!point) return { ok: false, reason: 'el fixture no tiene el botón' };
      if (point.hit !== ${JSON.stringify(id)}) {
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
  assert.equal(clicked.ok, true, `No se pudo pulsar el botón ${id} del fixture (${clicked.reason}).`);
}

/** Pulsa el botón de notificaciones y espera la respuesta de la página. */
async function requestPermission(client) {
  await clickFixtureButton(client, 'permiso');
  return waitForExpression(
    client,
    guestExpression('window.__permiso ?? null'),
    (answer) => answer === 'granted' || answer === 'denied',
    'la respuesta de Notification.requestPermission()',
    15000,
  );
}

/** Espera a que el fixture pinte el botón de ubicación en un punto pulsable. */
async function waitForGeolocationInput(client) {
  await waitForExpression(
    client,
    fixtureClickPoint('geo'),
    (point) => Boolean(point) && point.hit === 'geo',
    'el botón de ubicación del fixture',
    20000,
  );
}

/** Pulsa «Pedir ubicación» y devuelve `{ state, position, error }` del fixture. */
async function requestGeolocation(client) {
  await clickFixtureButton(client, 'geo');
  const raw = await waitForExpression(
    client,
    guestExpression('window.__geo ?? null'),
    (value) => typeof value === 'string' && value.length > 0,
    'la respuesta de geolocalización del fixture',
    20000,
  );
  return JSON.parse(raw);
}

/** Coordenada que entrega el paso 4; se puede cambiar desde el entorno del CI. */
const geolocationCoordinates = () => ({
  latitude: Number(process.env.TERMINUS_E2E_GEO_LAT || 41.3851),
  longitude: Number(process.env.TERMINUS_E2E_GEO_LON || 2.1734),
  accuracy: Number(process.env.TERMINUS_E2E_GEO_ACC || 100),
});

/**
 * Fija la posición del invitado por CDP antes de pedirla.
 *
 * `navigator.geolocation` responde con el proveedor de Chromium, que un runner no
 * tiene: el permiso concedido por la app no basta y `getCurrentPosition` acaba en
 * error. `Emulation.setGeolocationOverride` sobre el target del invitado —no sobre
 * la página de la app, que es otro target— entrega la coordenada configurada.
 */
async function applyGeolocationOverride(client, port, pageUrl, coordinates) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(3000),
  });
  assert.equal(response.ok, true, `No se pudo listar los targets CDP (${response.status}).`);
  const targets = await response.json();
  // La app también se sirve en 127.0.0.1: el invitado se reconoce por su tipo, no
  // por el origen, o el override acabaría en la página de la app.
  const guest =
    targets.find((target) => target.type === 'webview' && target.webSocketDebuggerUrl) ??
    targets.find((target) => target.url === pageUrl && target.webSocketDebuggerUrl);
  assert.ok(guest, `No hay target del invitado para ${pageUrl} en el puerto CDP ${port}.`);

  const guestClient = await connectCdp(guest.webSocketDebuggerUrl, client.state);
  try {
    await guestClient.send('Emulation.setGeolocationOverride', coordinates);
  } catch (error) {
    guestClient.close();
    throw error;
  }
  // Quien llama mantiene la sesión abierta hasta terminar el paso: al desconectar,
  // Chromium revierte el override y la posición vuelve a depender del proveedor.
  return guestClient;
}

/** Espera a que el fixture pinte el botón de cámara en un punto pulsable. */
async function waitForCameraInput(client) {
  await waitForExpression(
    client,
    fixtureClickPoint('cam'),
    (point) => Boolean(point) && point.hit === 'cam',
    'el botón de cámara del fixture',
    20000,
  );
}

/** Pulsa «Pedir cámara» y devuelve `{ state, tracks, name }` del fixture. */
async function requestCamera(client) {
  await clickFixtureButton(client, 'cam');
  const raw = await waitForExpression(
    client,
    guestExpression('window.__cam ?? null'),
    (value) => typeof value === 'string' && value.length > 0,
    'la respuesta de cámara del fixture',
    30000,
  );
  return JSON.parse(raw);
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
  // Sin cerrar esta instancia, el arranque del paso 4 choca con el lock de instancia
  // única y muere antes de exponer CDP.
  await app.stop();

  // Paso 4: geolocalización con allow
  app = await launchInstalledApp({
    exe: installedExe,
    profileDir,
    env: { ...baseEnv, TERMINUS_E2E_GEO_ANSWER: 'allow' },
  });
  await openFixture(app.client, fixture.pageUrl);
  await waitForGeolocationInput(app.client);
  const geoSession = await applyGeolocationOverride(
    app.client,
    app.cdpPort,
    fixture.pageUrl,
    geolocationCoordinates(),
  );
  try {
    const geo = await requestGeolocation(app.client);
    assert.equal(
      geo.state,
      'granted',
      `Con TERMINUS_E2E_GEO_ANSWER=allow el permiso de ubicación quedó en «${geo.state}».`,
    );
    // Confirma que también hay coordenadas reales (no solo "sin proveedor").
    assert.ok(
      geo.position,
      'Con TERMINUS_E2E_GEO_ANSWER=allow debe venir posición real, no solo permiso concedido.',
    );
    pass(
      `geolocalización con TERMINUS_E2E_GEO_ANSWER=allow: permiso «${geo.state}» + posición ${geo.position}`,
    );
  } finally {
    geoSession.close();
  }
  await app.stop();

  // Paso 5: cámara con allow
  app = await launchInstalledApp({
    exe: installedExe,
    profileDir,
    env: { ...baseEnv, TERMINUS_E2E_CAM_ANSWER: 'allow' },
  });
  await openFixture(app.client, fixture.pageUrl);
  await waitForCameraInput(app.client);
  const cam = await requestCamera(app.client);
  assert.equal(
    cam.state,
    'ok',
    `Con TERMINUS_E2E_CAM_ANSWER=allow getUserMedia respondió «${cam.name ?? cam.state}».`,
  );
  assert.ok(cam.tracks >= 1, `La cámara entregó ${cam.tracks} pista(s) de video.`);
  pass(
    `cámara con TERMINUS_E2E_CAM_ANSWER=allow: getUserMedia entrega ${cam.tracks} pista(s) de video.`,
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
