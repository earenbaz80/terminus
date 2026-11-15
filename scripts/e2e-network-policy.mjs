/**
 * E2E de la sección «Red y privacidad»: el interruptor tiene que decir la verdad.
 *
 * Recorre clic → IPC → petición HTTP con la app real en las dos modalidades:
 *
 *   1. App empaquetada (`TERMINUS_BUILD_DIR/Terminus.exe`, por defecto
 *      `release/win-unpacked`). El servidor se carga en el mismo proceso, así que
 *      el cambio rige en la petición siguiente: al activar, `/api/view` contra un
 *      fixture en 127.0.0.1 devuelve el contenido; al desactivar, lo rechaza.
 *   2. `npm run desktop:dev`, donde el servidor es un proceso hijo que heredó el
 *      entorno al arrancar: el menú guarda la decisión, el proxy sigue bloqueando
 *      y aparece el aviso de reinicio. Al relanzar con el mismo perfil, la
 *      decisión guardada se aplica.
 *
 * El fixture se levanta en este proceso, así que la prueba no necesita internet.
 * `/api/view` responde 502 cuando la política rechaza el destino privado: ese es
 * el código esperado del bloqueo, no un fallo (el 403 es solo para metadata).
 *
 * Requisitos: Windows con sesión de escritorio interactiva, dependencias
 * instaladas y un build empaquetado al día (`npm run desktop:build`, o
 * `electron-builder --dir` en un directorio aparte con `TERMINUS_BUILD_DIR`).
 *
 * Códigos de salida: 0 si todo pasa, 1 si hay regresión o falta el build.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';
import { suiteSteps } from './e2e-suites.mjs';

const LOG = '[e2e-network]';
// El ejecutor del CI compara esta cifra con la que declara `scripts/e2e-suites.mjs`.
const TOTAL_STEPS = suiteSteps('network');

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

const artifactsDirectory = () =>
  path.resolve(process.env.TERMINUS_E2E_ARTIFACTS ?? path.join('artifacts', 'e2e'));

const captureFailureScreenshot = async (page, label) => {
  if (!page) return;
  try {
    fs.mkdirSync(artifactsDirectory(), { recursive: true });
    const file = path.join(artifactsDirectory(), `network-policy-failure-${label}.png`);
    await page.screenshot({ path: file });
    console.log(`${LOG} Captura del fallo: ${file}`);
  } catch (error) {
    console.warn(`${LOG} No se pudo capturar la pantalla: ${error instanceof Error ? error.message : error}`);
  }
};

function startFixture() {
  return new Promise((resolve) => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end('<!doctype html><html><body><p>PROBE_OK</p></body></html>');
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/` });
    });
  });
}

const packagedExecutable = () =>
  path.resolve(process.env.TERMINUS_BUILD_DIR ?? path.join('release', 'win-unpacked'), 'Terminus.exe');

const openApp = async (mode, profileDirectory) => {
  const options =
    mode === 'packaged'
      ? { executablePath: packagedExecutable(), args: [`--user-data-dir=${profileDirectory}`] }
      : { args: ['.', `--user-data-dir=${profileDirectory}`], cwd: process.cwd() };

  const app = await electron.launch({ ...options, timeout: LAUNCH_TIMEOUT_MS });
  const page = await app.firstWindow({ timeout: LAUNCH_TIMEOUT_MS });
  await page.waitForSelector('button[aria-haspopup="dialog"]', { timeout: LAUNCH_TIMEOUT_MS });
  return { app, page };
};

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

const probeProxy = (page, target) =>
  page.evaluate(async (url) => {
    const response = await fetch(`/api/view?url=${encodeURIComponent(url)}`);
    const body = await response.text();
    return { status: response.status, served: body.includes('PROBE_OK') };
  }, target);

/** Reintenta hasta ver el estado esperado: el cambio puede llegar en la petición siguiente. */
const settleProxy = async (page, target, expectedStatus, attempts = 20) => {
  let last;
  for (let index = 0; index < attempts; index += 1) {
    last = await probeProxy(page, target);
    if (last.status === expectedStatus) return last;
    await page.waitForTimeout(150);
  }
  return last;
};

async function checkPackaged(fixtureUrl, profileDirectory) {
  console.log(`${LOG} --- app empaquetada: ${packagedExecutable()} ---`);
  let session;
  let page;
  try {
    session = await openApp('packaged', profileDirectory);
    page = session.page;

    await openMenu(page);
    const initial = await menuState(page);
    const blocked = await settleProxy(page, fixtureUrl, BLOCKED_STATUS);
    expectStep(
      initial.pressed === false && blocked.status === BLOCKED_STATUS,
      `arranca INACTIVO y el proxy rechaza 127.0.0.1 (aria-pressed=${initial.pressed}, status=${blocked.status})`
    );
    expectStep(
      initial.hint === false,
      'no hay aviso de reinicio: el servidor corre en el proceso principal'
    );

    await initial.toggle.click();
    const on = await menuState(page);
    const allowed = await settleProxy(page, fixtureUrl, ALLOWED_STATUS);
    expectStep(
      on.pressed === true && allowed.status === ALLOWED_STATUS && allowed.served,
      `al activar el proxy devuelve el fixture (aria-pressed=${on.pressed}, status=${allowed.status})`
    );
    expectStep(
      on.pressed === (allowed.status === ALLOWED_STATUS),
      `el menú muestra el estado que se aplica (aria-pressed=${on.pressed}, status=${allowed.status})`
    );

    await on.toggle.click();
    const off = await menuState(page);
    const blockedAgain = await settleProxy(page, fixtureUrl, BLOCKED_STATUS);
    expectStep(
      off.pressed === false && blockedAgain.status === BLOCKED_STATUS,
      `al desactivar vuelve a INACTIVO y el proxy rechaza (aria-pressed=${off.pressed}, status=${blockedAgain.status})`
    );
  } catch (error) {
    await captureFailureScreenshot(page, 'packaged');
    throw error;
  } finally {
    await session?.app.close().catch(() => undefined);
  }
}

async function runDevSession(profileDirectory, fixtureUrl) {
  let session;
  let page;
  try {
    session = await openApp('dev', profileDirectory);
    page = session.page;

    await openMenu(page);
    const initial = await menuState(page);
    const blocked = await settleProxy(page, fixtureUrl, BLOCKED_STATUS);
    expectStep(
      initial.pressed === false && blocked.status === BLOCKED_STATUS,
      `desktop:dev arranca INACTIVO y el proxy rechaza (aria-pressed=${initial.pressed}, status=${blocked.status})`
    );
    expectStep(initial.hint === true, 'desktop:dev avisa de que el cambio necesita reiniciar');

    await initial.toggle.click();
    const on = await menuState(page);
    const stillBlocked = await settleProxy(page, fixtureUrl, BLOCKED_STATUS);
    expectStep(
      on.pressed === true && stillBlocked.status === BLOCKED_STATUS && !stillBlocked.served,
      `el menú guarda ACTIVO pero el servidor hijo sigue rechazando (status=${stillBlocked.status})`
    );
    expectStep(on.hint === true, 'el menú no finge que el cambio se aplicó');
  } catch (error) {
    await captureFailureScreenshot(page, 'dev');
    throw error;
  } finally {
    await session?.app.close().catch(() => undefined);
  }
}

async function runDevAfterRestart(profileDirectory, fixtureUrl) {
  console.log(`${LOG} --- desktop:dev tras reiniciar con la preferencia guardada ---`);
  let session;
  let page;
  try {
    session = await openApp('dev', profileDirectory);
    page = session.page;

    await openMenu(page);
    const afterRestart = await menuState(page);
    const allowed = await settleProxy(page, fixtureUrl, ALLOWED_STATUS);
    expectStep(
      afterRestart.pressed === true && allowed.status === ALLOWED_STATUS && allowed.served,
      `la decisión guardada se aplica al reiniciar (aria-pressed=${afterRestart.pressed}, status=${allowed.status})`
    );

    await afterRestart.toggle.click();
    await settleProxy(page, fixtureUrl, BLOCKED_STATUS);
    const off = await menuState(page);
    expectStep(off.pressed === false, 'desactivar deja la preferencia guardada en bloqueado');
  } catch (error) {
    await captureFailureScreenshot(page, 'dev-restart');
    throw error;
  } finally {
    await session?.app.close().catch(() => undefined);
  }
}

async function main() {
  const fixture = await startFixture();
  // El prefijo encaja con `scripts/clean-release.cjs`, que barre perfiles huérfanos.
  const packagedProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'terminus-e2e-'));
  const devProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'terminus-e2e-'));
  try {
    await checkPackaged(fixture.url, packagedProfile);
    await runDevSession(devProfile, fixture.url);
    await runDevAfterRestart(devProfile, fixture.url);
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
