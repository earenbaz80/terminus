/**
 * Regla de «este PR toca la app» que decide si el CI compila el instalador.
 *
 * El job `cambios` del workflow y este módulo son la única definición: el YAML
 * solo consulta los ficheros del PR con `gh` y le pasa la lista al CLI, y el
 * README y los docs del E2E listan los mismos tokens. `app-paths.test.mjs` falla
 * si una de las tres piezas se separa de las demás, así que no hace falta que
 * nadie recuerde mantenerlas a mano.
 *
 * Falla del lado seguro en `decideBuild`: un PR que no se puede inspeccionar se
 * compila, porque un verde sin build es peor que un build de más.
 */

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Cada regla es una alternativa del patrón, sin el ancla `^`, más el token con
 * el que se documenta. El token se usa en las pruebas para comparar con el
 * README y con `docs/e2e-installed-windows.md`.
 */
export const APP_PATH_RULES = [
  { regla: 'src/', doc: '`src/`' },
  { regla: 'electron/', doc: '`electron/`' },
  { regla: 'scripts/', doc: '`scripts/`' },
  { regla: 'assets/', doc: '`assets/`' },
  { regla: 'index\\.html$', doc: '`index.html`' },
  { regla: 'package(-lock)?\\.json$', doc: '`package.json`/`package-lock.json`' },
  { regla: 'vite\\.config\\.', doc: '`vite.config.`' },
  { regla: 'vitest\\.config\\.', doc: '`vitest.config.`' },
  { regla: 'tsconfig[^/]*\\.json$', doc: '`tsconfig*.json`' },
  { regla: 'electron-builder', doc: '`electron-builder`' },
];

/** Patrón único de rutas, derivado de `APP_PATH_RULES`. */
export const APP_PATH_PATTERN = `^(${APP_PATH_RULES.map(({ regla }) => regla).join('|')})`;

const PATRON = new RegExp(APP_PATH_PATTERN);

/** True si la ruta del PR se empaqueta en la app. */
export function isAppPath(ruta) {
  return typeof ruta === 'string' && PATRON.test(ruta);
}

/** True si alguna de las rutas se empaqueta; sin ficheros, false. */
export function touchesApp(rutas) {
  return rutas.some((ruta) => isAppPath(ruta));
}

/**
 * Decide si hay que compilar. `consultaFallo` es la vía del CI cuando `gh api`
 * no responde; los ficheros vacíos cuentan como «no se pudo inspeccionar».
 */
export function decideBuild({ evento, archivos, consultaFallo = false }) {
  if (evento !== 'pull_request') {
    return { appChanged: true, motivo: 'no es un PR: se compila' };
  }
  if (consultaFallo) {
    return { appChanged: true, motivo: 'la consulta de ficheros falló: se compila' };
  }
  if (archivos.length === 0) {
    return { appChanged: true, motivo: 'la consulta no devolvió ficheros: se compila' };
  }
  if (touchesApp(archivos)) {
    return { appChanged: true, motivo: 'el PR toca la app' };
  }
  return { appChanged: false, motivo: 'PR sin cambios de app: se omite el build de Windows' };
}

function parseOptions(argv, env) {
  const opciones = { evento: env.EVENT_NAME ?? '', consultaFallo: false };
  for (let i = 0; i < argv.length; i += 1) {
    const argumento = argv[i];
    if (argumento === '--evento') {
      opciones.evento = argv[i + 1] ?? '';
      i += 1;
    } else if (argumento === '--consulta-fallo') {
      opciones.consultaFallo = true;
    } else {
      throw new Error(`Opción desconocida: ${argumento}`);
    }
  }
  return opciones;
}

/**
 * CLI del job `cambios`: lee las rutas por stdin (una por línea) y escribe el
 * output y el resumen del paso. Sin `GITHUB_OUTPUT` imprime el output a mano,
 * para poder probarlo desde la terminal.
 */
export async function runCli(argv = [], env = process.env, stdin = process.stdin) {
  const opciones = parseOptions(argv, env);
  const trozos = [];
  for await (const trozo of stdin) trozos.push(trozo);
  const archivos = Buffer.concat(trozos)
    .toString('utf8')
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter(Boolean);

  const { appChanged, motivo } = decideBuild({
    evento: opciones.evento,
    archivos,
    consultaFallo: opciones.consultaFallo,
  });

  const output = `app_changed=${appChanged}`;
  if (env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, `${output}\n`);
  } else {
    process.stdout.write(`${output}\n`);
  }
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `- **Build de Windows:** ${motivo}\n`);
  }
  process.stdout.write(`cambios: app_changed=${appChanged} (${motivo})\n`);

  return { appChanged, motivo };
}

const ejecutadoDirectamente =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (ejecutadoDirectamente) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
