/* global window */
/**
 * E2E del navegador nativo (<webview>) sobre la app empaquetada.
 *
 * Comprueba dos cosas que no se pueden simular en un test de unidad:
 *   1. La pestaña carga la página en un motor Chromium real (petición con el
 *      User-Agent de Chrome, no con el del proxy de Terminus).
 *   2. Cada sitio tiene su propia sesión: la cookie que deja `127.0.0.1` no se
 *      envía a `localhost`, y sí vuelve a enviarse al regresar al primer sitio.
 *
 * Códigos: 0 = E2E_NATIVE_OK, 2 = falta el build o el puerto, 1 = regresión.
 */
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const appPath = path.resolve('release/win-unpacked/Terminus.exe');

if (!fs.existsSync(appPath)) {
  console.error('E2E_NATIVE_SKIP: falta release/win-unpacked/Terminus.exe (npm run desktop:dir).');
  process.exit(2);
}

const requests = [];
const reports = [];

const startFixture = () =>
  new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      const host = String(request.headers.host || '').split(':')[0];
      if (request.url === '/favicon.ico') {
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.url.startsWith('/ad-report')) {
        const params = new URL(request.url, 'http://fixture').searchParams;
        reports.push({
          host: params.get('host') || '',
          blocked: params.get('blocked') || '',
          at: Date.now(),
        });
        response.writeHead(204);
        response.end();
        return;
      }
      requests.push({
        host,
        cookie: request.headers.cookie || '',
        userAgent: request.headers['user-agent'] || '',
        path: request.url || '/',
        at: Date.now(),
      });
      const cookieName = `native_${host.replace(/[^a-z0-9]/gi, '_')}`;
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie': `${cookieName}=1; Path=/; SameSite=Lax`,
      });
      // Petición publicitaria real contra un dominio de EasyList, resuelto a
      // este mismo servidor: si el bloqueador actúa, no llega ninguna petición
      // con Host doubleclick.net y el fetch falla; si no actúa, llega y resuelve.
      response.end(
        `<!doctype html><html><head><meta charset="utf-8"><title>Nativo ${host}</title></head>` +
          `<body><h1>Fixture nativo ${host}</h1><p id="host">${host}</p>` +
          `<script>
            fetch('http://doubleclick.net:${server.address().port}/pagead/ads?client=terminus-native-e2e', { mode: 'no-cors' })
              .then(function () { fetch('/ad-report?blocked=0&host=' + encodeURIComponent(location.hostname)); })
              .catch(function () { fetch('/ad-report?blocked=1&host=' + encodeURIComponent(location.hostname)); });
          </script></body></html>`
      );
    });
    server.listen(0, '0.0.0.0', () => resolve({ server, port: server.address().port }));
  });

const nativeRequests = () => requests.filter((entry) => !/Terminus\//i.test(entry.userAgent));

const waitFor = async (predicate, label, timeoutMs = 20000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timeout esperando ${label}`);
};

const { server, port } = await startFixture();
const hostA = '127.0.0.1';
const hostB = 'localhost';
const urlA = `http://${hostA}:${port}/`;
const urlB = `http://${hostB}:${port}/`;
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminus-native-'));

let electronApp;
let exitCode = 1;

try {
  electronApp = await electron.launch({
    executablePath: appPath,
    args: [`--user-data-dir=${profileDir}`, '--host-resolver-rules=MAP doubleclick.net 127.0.0.1'],
    env: { ...process.env, TERMINUS_ALLOW_PRIVATE: '1' },
    timeout: 60000,
  });
  electronApp.process().stdout?.on('data', (chunk) => process.stdout.write(`[main] ${chunk}`));
  electronApp.process().stderr?.on('data', (chunk) => process.stderr.write(`[main:err] ${chunk}`));

  const page = await electronApp.firstWindow({ timeout: 60000 });
  page.on('pageerror', (error) => console.log('PAGE_ERROR', error.message));

  const address = page.getByRole('textbox', { name: 'Barra de direcciones y búsqueda' });
  await address.waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);

  const go = async (url) => {
    await address.click();
    await address.fill(url);
    await address.press('Enter');
    await page.waitForTimeout(4500);
  };

  await go(urlA);
  const nativeButton = page.locator('[data-e2e="view-mode-native"]');
  await nativeButton.waitFor({ timeout: 15000 });
  // En escritorio una página externa debe abrir ya en NATIVO: no se elige a mano.
  const pressed = await nativeButton.getAttribute('aria-pressed');
  if (pressed !== 'true') {
    throw new Error(`La pestaña externa no abrió en NATIVO por defecto (aria-pressed=${pressed}).`);
  }
  await nativeButton.click();

  await waitFor(
    () => nativeRequests().some((entry) => entry.host === hostA),
    'la vista nativa cargue el primer sitio'
  );

  // 1. Con el bloqueador activo, la petición publicitaria debe quedar cancelada.
  await waitFor(
    () => reports.some((report) => report.host === hostA && report.blocked === '1'),
    'el bloqueo del anuncio en el primer sitio'
  );
  const adHitsBlocked = requests.filter((entry) => entry.host === 'doubleclick.net').length;
  if (adHitsBlocked !== 0) {
    throw new Error(`El anuncio llegó al servidor con el bloqueador activo: ${adHitsBlocked} peticiones.`);
  }

  // 2. Control: al desactivar el bloqueador la misma petición sí llega. Esto
  // prueba que la sonda detecta la diferencia y que el interruptor alcanza las
  // particiones nativas ya creadas.
  await page.evaluate(() => window.terminusDesktop.setAdblockEnabled(false));
  await page.waitForTimeout(500);
  await go(urlB);
  await waitFor(
    () => reports.some((report) => report.host === hostB && report.blocked === '0'),
    'la petición sin bloqueo en el segundo sitio'
  );
  const adHitsWithoutGuard = requests.filter((entry) => entry.host === 'doubleclick.net').length;
  if (adHitsWithoutGuard === 0) {
    throw new Error('La sonda no detecta peticiones cuando el bloqueador está apagado.');
  }

  // 3. Al reactivarlo, las sesiones por sitio existentes vuelven a bloquear.
  await page.evaluate(() => window.terminusDesktop.setAdblockEnabled(true));
  await page.waitForTimeout(500);
  const adHitsBeforeReenable = requests.filter((entry) => entry.host === 'doubleclick.net').length;
  const blockedReportsB = reports.filter(
    (report) => report.host === hostB && report.blocked === '1'
  ).length;
  // URL distinta para forzar una recarga real de la vista nativa.
  await go(`${urlB}?reenable=1`);
  await waitFor(
    () =>
      reports.filter((report) => report.host === hostB && report.blocked === '1').length >
      blockedReportsB,
    'el bloqueo tras reactivar el interruptor'
  );
  const adHitsAfterReenable =
    requests.filter((entry) => entry.host === 'doubleclick.net').length - adHitsBeforeReenable;
  if (adHitsAfterReenable !== 0) {
    throw new Error(`El anuncio volvió a pasar tras reactivar: ${adHitsAfterReenable} peticiones.`);
  }

  await waitFor(
    () => nativeRequests().some((entry) => entry.host === hostB),
    'la vista nativa cargue el segundo sitio'
  );

  const toB = nativeRequests().filter((entry) => entry.host === hostB);
  const leaked = toB.some((entry) => entry.cookie.includes('native_127_0_0_1'));
  if (leaked) throw new Error('La sesión de 127.0.0.1 se filtró a localhost.');

  const beforeReturn = nativeRequests().length;
  await go(urlA);
  await waitFor(
    () => nativeRequests().slice(beforeReturn).some((entry) => entry.host === hostA),
    'la vista nativa vuelva al primer sitio'
  );

  const backToA = nativeRequests().slice(beforeReturn).filter((entry) => entry.host === hostA);
  const keptCookie = backToA.some((entry) => entry.cookie.includes('native_127_0_0_1'));
  if (!keptCookie) throw new Error('La cookie del sitio no se conservó en su propia sesión.');

  const chromeDriven = nativeRequests().length > 0;
  if (!chromeDriven) throw new Error('La página no se cargó en el motor nativo.');

  console.log(
    'NATIVE_STATE',
    JSON.stringify({
      nativeRequests: nativeRequests().length,
      adBlockedWithGuard: adHitsBlocked === 0,
      adPassedWithoutGuard: adHitsWithoutGuard > 0,
      adBlockedAfterToggle: adHitsAfterReenable === 0,
      isolationChecked: true,
      cookieKept: keptCookie,
      partitions: [
        ...new Set(
          nativeRequests()
            .map((entry) => entry.host)
            .filter((host) => host !== 'doubleclick.net')
        ),
      ],
    })
  );
  console.log('E2E_NATIVE_OK');
  exitCode = 0;
} catch (error) {
  console.error(
    'FIXTURE_STATE',
    JSON.stringify({
      requests: requests.map((entry) => ({ host: entry.host, path: entry.path })),
      reports,
    })
  );
  console.error('E2E_NATIVE_FAIL', error instanceof Error ? error.message : String(error));
} finally {
  try {
    await electronApp?.close();
  } catch {
    // La app pudo cerrarse sola.
  }
  server.close();
  fs.rmSync(profileDir, { recursive: true, force: true });
  process.exit(exitCode);
}
