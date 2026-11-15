/**
 * E2E de la sección «Red y privacidad»: el interruptor tiene que decir la verdad.
 *
 * Recorre clic → IPC → petición HTTP con la app real en las dos modalidades,
 * contra `/api/view` y `/api/dns`, que son los dos endpoints que aplican la
 * política:
 *
 *   1. App empaquetada (`TERMINUS_BUILD_DIR/Terminus.exe`, por defecto
 *      `release/win-unpacked`). El servidor se carga en el mismo proceso, así que
 *      el cambio rige en la petición siguiente; además, la decisión guardada se
 *      recupera al relanzar.
 *   2. `electron .`, donde el servidor es un proceso hijo que heredó el entorno
 *      al arrancar: el menú guarda la decisión, el proxy sigue bloqueando y
 *      aparece el aviso de reinicio. Al relanzar, la decisión guardada se aplica.
 *
 * El fixture se levanta en este proceso, así que la prueba no necesita internet.
 * `/api/view` responde 502 cuando la política rechaza el destino privado: ese es
 * el código esperado del bloqueo, no un fallo (el 403 es solo para metadata).
 *
 * Requisitos: Windows con sesión de escritorio interactiva, dependencias
 * instaladas y un build empaquetado al día (`npm run desktop:build`, o
 * `electron-builder --dir` en un directorio aparte con `TERMINUS_BUILD_DIR`).
 *
 * `TERMINUS_E2E_NETWORK_SKIP_DEV=1` omite el tramo de `desktop:dev` (pasos 9-16)
 * y deja solo la app empaquetada, para aislar un runner donde arrancar el
 * servidor en desarrollo es inestable. El total esperado baja a 8 en el mismo
 * módulo que lee el ejecutor, así que el recuento sigue cuadrando.
 *
 * Códigos de salida: 0 si todo pasa, 1 si hay regresión o falta el build.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';
import { NETWORK_SKIP_DEV_ENV, networkSkipsDev, suiteSteps } from './e2e-suites.mjs';

const LOG = '[e2e-network]';
// El ejecutor del CI compara esta cifra con la que declara `scripts/e2e-suites.mjs`.
const TOTAL_STEPS = suiteSteps('network');
const SKIP_DEV = networkSkipsDev();

const BLOCKED_STATUS = 502;
const ALLOWED_STATUS = 200;
const LAUNCH_TIMEOUT_MS = Number(process.env.TERMINUS_E2E_LAUNCH_TIMEOUT_MS ?? 180000);

const TOGGLE_LABELS =
  /Permitir destinos privados|Private Ziele erlauben|Autoriser les destinations privées|Consenti destinazioni private|Allow private destinations/;
const RESTART_HINT =
  /al reiniciar Terminus|nach einem Neustart von Terminus|au redémarrage de Terminus|al riavvio di Terminus|when Terminus restarts/;

let stepsRun = 0;

/** Cuenta el paso y falla con detalle si la condición no se cumple. */
function expectStep(condition, message) {
  assert.ok(condition, `paso ${stepsRun + 1}/${TOTAL_STEPS}: ${message}`);
  stepsRun += 1;
  console.log(`${LOG} PASS ${stepsRun}/${TOTAL_STEPS} ${message}`);
}

const packagedExecutable = () =>
  path.resolve(process.env.TERMINUS_BUILD_DIR ?? path.join('release', 'win-unpacked'), 'Terminus.exe');

const artifactsDirectory = () =>
  path.resolve(process.env.TERMINUS_E2E_ARTIFACTS ?? path.join('artifacts', 'e2e'));

const startFixture = () =>
  new Promise((resolve) => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end('<!doctype html><html><body><p>PROBE_OK</p></body></html>');
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });

const viewUrl = (target) => `/api/view?url=${encodeURIComponent(target)}`;
const dnsUrl = (host) => `/api/dns?host=${encodeURIComponent(host)}`;

/** El endpoint de DNS contesta JSON; si no lo es, el fallo se ve en la aserción. */
const dnsPayload = (body) => {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

/**
 * Espera a que un endpoint del servidor dé el estado esperado. El sondeo lo hace
 * el navegador: tras el clic el IPC es asíncrono, así que la primera petición
 * puede llegar antes de que el proceso principal cambie la política.
 */
async function waitForStatus(page, url, expectedStatus, label) {
  try {
    const handle = await page.waitForFunction(
      async ({ url, status }) => {
        const response = await fetch(url);
        const body = await response.text();
        return response.status === status ? { status, body } : false;
      },
      { url, status: expectedStatus },
      { timeout: 15000, polling: 100 }
    );
    return await handle.jsonValue();
  } catch {
    // Sin el último estado, un timeout no dice si el servidor respondió otra cosa.
    const last = await page.evaluate(async (url) => (await fetch(url)).status, url);
    throw new Error(`${label}: se esperaba ${expectedStatus} en ${url} y respondió ${last}`);
  }
}

const openMenu = async (page) => {
  await page.click('button[aria-haspopup="dialog"]');
  const toggle = page.getByRole('button', { name: TOGGLE_LABELS });
  await toggle.waitFor({ state: 'visible', timeout: 30000 });
  return toggle;
};

const menuState = async (page) => {
  const toggle = page.getByRole('button', { name: TOGGLE_LABELS });
  const dialogText = await page.locator('[role="dialog"]').innerText();
  return {
    toggle,
    pressed: (await toggle.getAttribute('aria-pressed')) === 'true',
    hint: RESTART_HINT.test(dialogText),
  };
};

const launch = async (mode, profileDirectory) => {
  const options =
    mode === 'packaged'
      ? { executablePath: packagedExecutable(), args: [`--user-data-dir=${profileDirectory}`] }
      : { args: ['.', `--user-data-dir=${profileDirectory}`], cwd: process.cwd() };

  const app = await electron.launch({ ...options, timeout: LAUNCH_TIMEOUT_MS });
  const page = await app.firstWindow({ timeout: LAUNCH_TIMEOUT_MS });
  await page.waitForSelector('button[aria-haspopup="dialog"]', { timeout: LAUNCH_TIMEOUT_MS });
  return { app, page };
};

/** Abre la app, ejecuta el tramo y la cierra; solo captura cuando algo falla. */
async function withApp(mode, profileDirectory, label, body) {
  let session;
  try {
    session = await launch(mode, profileDirectory);
    return await body(session.page);
  } catch (error) {
    if (session?.page) {
      try {
        fs.mkdirSync(artifactsDirectory(), { recursive: true });
        const file = path.join(artifactsDirectory(), `network-policy-failure-${label}.png`);
        await session.page.screenshot({ path: file });
        console.log(`${LOG} Captura del fallo: ${file}`);
      } catch (captureError) {
        console.warn(`${LOG} No se pudo capturar la pantalla: ${captureError.message}`);
      }
    }
    throw error;
  } finally {
    await session?.app.close().catch(() => undefined);
  }
}

/** Pasos 1-5: arranque bloqueado, activación en caliente y ambos endpoints de la política. */
async function enablePackaged(page, fixtureUrl, host) {
  await openMenu(page);
  const initial = await menuState(page);
  const blockedView = await waitForStatus(page, viewUrl(fixtureUrl), BLOCKED_STATUS, 'arranque empaquetado');
  expectStep(
    initial.pressed === false && blockedView.status === BLOCKED_STATUS,
    `arranca INACTIVO y el proxy rechaza 127.0.0.1 (aria-pressed=${initial.pressed}, status=${blockedView.status})`
  );

  const blockedDns = await waitForStatus(page, dnsUrl(host), 403, 'dns bloqueado');
  expectStep(
    dnsPayload(blockedDns.body)?.error === 'DNS target blocked by network policy',
    `y /api/dns rechaza ${host} (status=${blockedDns.status})`
  );

  expectStep(initial.hint === false, 'no hay aviso de reinicio: el servidor corre en el proceso principal');

  await initial.toggle.click();
  const on = await menuState(page);
  const allowedView = await waitForStatus(page, viewUrl(fixtureUrl), ALLOWED_STATUS, 'activar empaquetada');
  expectStep(
    on.pressed === true && allowedView.body.includes('PROBE_OK'),
    `al activar el proxy devuelve el fixture (aria-pressed=${on.pressed}, status=${allowedView.status})`
  );

  const allowedDns = await waitForStatus(page, dnsUrl(host), ALLOWED_STATUS, 'dns activado');
  const records = dnsPayload(allowedDns.body)?.records ?? [];
  expectStep(
    records.some((record) => record.address === host),
    `al activar /api/dns resuelve ${host} (status=${allowedDns.status}, ${records.length} registro/s)`
  );
}

/** Pasos 4-5: la decisión guardada se recupera al relanzar y se puede deshacer. */
/** Pasos 6-8: la preferencia sobrevive al relanzar y al desactivar vuelve el bloqueo. */
async function reusePackaged(page, fixtureUrl, host) {
  await openMenu(page);
  const restored = await menuState(page);
  const allowed = await waitForStatus(page, viewUrl(fixtureUrl), ALLOWED_STATUS, 'relanzar empaquetada');
  expectStep(
    restored.pressed === true && allowed.body.includes('PROBE_OK'),
    `al relanzar sigue ACTIVO y el proxy acepta (aria-pressed=${restored.pressed}, status=${allowed.status})`
  );

  await restored.toggle.click();
  const off = await menuState(page);
  const blockedAgain = await waitForStatus(page, viewUrl(fixtureUrl), BLOCKED_STATUS, 'desactivar empaquetada');
  expectStep(
    off.pressed === false && blockedAgain.status === BLOCKED_STATUS,
    `al desactivar vuelve a INACTIVO y el proxy rechaza (aria-pressed=${off.pressed}, status=${blockedAgain.status})`
  );

  const blockedDns = await waitForStatus(page, dnsUrl(host), 403, 'desactivar empaquetada (dns)');
  expectStep(
    dnsPayload(blockedDns.body)?.error === 'DNS target blocked by network policy',
    `y /api/dns vuelve a rechazar ${host} (status=${blockedDns.status})`
  );
}

/** Pasos 9-13: `desktop:dev` guarda la decisión pero el servidor hijo no la recibe. */
async function checkDev(page, fixtureUrl, host) {
  await openMenu(page);
  const initial = await menuState(page);
  const blocked = await waitForStatus(page, viewUrl(fixtureUrl), BLOCKED_STATUS, 'arranque desktop:dev');
  expectStep(
    initial.pressed === false && blocked.status === BLOCKED_STATUS,
    `desktop:dev arranca INACTIVO y el proxy rechaza (aria-pressed=${initial.pressed}, status=${blocked.status})`
  );
  expectStep(initial.hint === true, 'desktop:dev avisa de que el cambio necesita reiniciar');

  await initial.toggle.click();
  const on = await menuState(page);
  const stillBlocked = await waitForStatus(page, viewUrl(fixtureUrl), BLOCKED_STATUS, 'activar desktop:dev');
  expectStep(
    on.pressed === true && stillBlocked.status === BLOCKED_STATUS,
    `el menú guarda ACTIVO pero el servidor hijo sigue rechazando (status=${stillBlocked.status})`
  );

  const stillBlockedDns = await waitForStatus(page, dnsUrl(host), 403, 'activar desktop:dev (dns)');
  expectStep(
    dnsPayload(stillBlockedDns.body)?.error === 'DNS target blocked by network policy',
    `y /api/dns sigue rechazando ${host} en el servidor hijo (status=${stillBlockedDns.status})`
  );

  expectStep(on.hint === true, 'el menú no finge que el cambio se aplicó');
}

/** Pasos 14-16: tras reiniciar, el servidor hijo hereda la preferencia guardada. */
async function checkDevAfterRestart(page, fixtureUrl, host) {
  await openMenu(page);
  const restored = await menuState(page);
  const allowed = await waitForStatus(page, viewUrl(fixtureUrl), ALLOWED_STATUS, 'reiniciar desktop:dev');
  expectStep(
    restored.pressed === true && allowed.body.includes('PROBE_OK'),
    `la decisión guardada se aplica al reiniciar (aria-pressed=${restored.pressed}, status=${allowed.status})`
  );

  const allowedDns = await waitForStatus(page, dnsUrl(host), ALLOWED_STATUS, 'reiniciar desktop:dev (dns)');
  const records = dnsPayload(allowedDns.body)?.records ?? [];
  expectStep(
    records.some((record) => record.address === host),
    `y /api/dns resuelve ${host} tras reiniciar (status=${allowedDns.status}, ${records.length} registro/s)`
  );

  await restored.toggle.click();
  const off = await menuState(page);
  await waitForStatus(page, viewUrl(fixtureUrl), BLOCKED_STATUS, 'desactivar tras reiniciar');
  expectStep(off.pressed === false, 'desactivar deja la preferencia guardada en bloqueado');
}

async function main() {
  const fixture = await startFixture();
  // El host del fixture es también el destino que consulta /api/dns.
  const host = new URL(fixture.url).hostname;
  // El prefijo encaja con `scripts/clean-release.cjs`, que barre perfiles huérfanos.
  const packagedProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'terminus-e2e-'));
  const devProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'terminus-e2e-'));
  try {
    console.log(`${LOG} --- app empaquetada: ${packagedExecutable()} ---`);
    await withApp('packaged', packagedProfile, 'packaged', (page) => enablePackaged(page, fixture.url, host));
    await withApp('packaged', packagedProfile, 'packaged-restart', (page) =>
      reusePackaged(page, fixture.url, host)
    );

    if (SKIP_DEV) {
      // Visible en el log y en el resumen: omitir el tramo no puede pasar inadvertido.
      console.log(`${LOG} OMITIDO desktop:dev (pasos 9-16): ${NETWORK_SKIP_DEV_ENV}=1`);
    } else {
      console.log(`${LOG} --- desktop:dev ---`);
      await withApp('dev', devProfile, 'dev', (page) => checkDev(page, fixture.url, host));
      console.log(`${LOG} --- desktop:dev tras reiniciar ---`);
      await withApp('dev', devProfile, 'dev-restart', (page) =>
        checkDevAfterRestart(page, fixture.url, host)
      );
    }

    assert.equal(stepsRun, TOTAL_STEPS, `pasos ejecutados: ${stepsRun}/${TOTAL_STEPS}`);
  } finally {
    fixture.server.close();
    for (const directory of [packagedProfile, devProfile]) {
      try {
        fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch (error) {
        console.warn(`${LOG} No se pudo borrar el perfil temporal ${directory}: ${error.message}`);
      }
    }
  }
}

try {
  if (process.platform !== 'win32') {
    console.log(`${LOG} SKIP: la prueba lanza la app de escritorio y solo corre en Windows.`);
  } else if (!fs.existsSync(packagedExecutable())) {
    throw new Error(
      `No se encontró ${packagedExecutable()}. Genera el build empaquetado con "npm run desktop:build" ` +
        'o apunta TERMINUS_BUILD_DIR al directorio que salga de "electron-builder --dir".'
    );
  } else {
    await main();
  }
} catch (error) {
  console.error(`${LOG} FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  // El paso del E2E en CI lee esta línea para comparar con el total esperado.
  console.log(`${LOG} STEPS: ${stepsRun}/${TOTAL_STEPS}`);
}
