/**
 * Fuente única de verdad de las suites del E2E instalado.
 *
 * El mismo módulo lo leen el ejecutor del CI (`scripts/e2e-run.mjs`), los dos
 * guiones (para su total de pasos) y las pruebas, así que el recuento esperado
 * no puede desincronizarse del que declara cada guion.
 *
 * `locale` vacío significa que la suite corre con el idioma por defecto de la app.
 * El CI no elige suites por evento: cuando pide el E2E instalado corre todas, así
 * que la lista no se duplica en el workflow. La de alemán no se restringe porque
 * cuesta lo mismo que `ui` (12 s cada una sobre la app instalada, 14 s `ctrl-f`).
 *
 * `network` tiene dos tramos: la app empaquetada (8 pasos) y `desktop:dev` (8).
 * `TERMINUS_E2E_NETWORK_SKIP_DEV=1` deja solo el primero para aislar un runner
 * donde el tramo de desarrollo es inestable. La lista no cambia con el entorno:
 * siempre declara 16; lo que cambia es lo que esa corrida espera, y eso lo dice
 * `expectedSteps()`, que leen tanto el guion como el recuento de `e2e-report`.
 */

export const NETWORK_SKIP_DEV_ENV = 'TERMINUS_E2E_NETWORK_SKIP_DEV';
/** Los pasos 9-16 de `network` son el tramo de `desktop:dev`. */
const NETWORK_DEV_STEPS = 8;

export const networkSkipsDev = (env = process.env) => env[NETWORK_SKIP_DEV_ENV] === '1';

/** Pasos que esta corrida espera de la suite; sin variable, lo que declara la lista. */
export const expectedSteps = (suite, env = process.env) =>
  suite.label === 'network' && networkSkipsDev(env) ? suite.steps - NETWORK_DEV_STEPS : suite.steps;

export const E2E_SUITES = [
  {
    label: 'ctrl-f',
    script: 'test:e2e:installed',
    log: 'e2e-installed.log',
    locale: '',
    steps: 6,
  },
  {
    label: 'ui',
    script: 'test:e2e:installed:ui',
    log: 'e2e-installed-ui.log',
    locale: '',
    steps: 12,
  },
  {
    label: 'ui-de',
    script: 'test:e2e:installed:ui',
    log: 'e2e-installed-ui-de.log',
    locale: 'de',
    steps: 12,
  },
  // No usa el instalador: el build de `release/win-unpacked` y el árbol de trabajo.
  {
    label: 'network',
    script: 'test:e2e:network',
    log: 'e2e-network-policy.log',
    locale: '',
    steps: 16,
  },
];

/** Devuelve las suites pedidas por etiqueta; sin etiquetas, todas. */
export function selectSuites(labels = []) {
  const wanted = labels.map((label) => label.trim()).filter(Boolean);
  if (!wanted.length) return E2E_SUITES;

  const unknown = wanted.filter((label) => !E2E_SUITES.some((suite) => suite.label === label));
  if (unknown.length) {
    throw new Error(
      `Suite desconocida: ${unknown.join(', ')}. Válidas: ${E2E_SUITES.map((suite) => suite.label).join(', ')}.`,
    );
  }

  const set = new Set(wanted);
  return E2E_SUITES.filter((suite) => set.has(suite.label));
}

/** Total de pasos que esta corrida espera de la suite con esa etiqueta. */
export function suiteSteps(label, env = process.env) {
  const suite = E2E_SUITES.find((item) => item.label === label);
  if (!suite) throw new Error(`Suite desconocida: ${label}.`);
  return expectedSteps(suite, env);
}
