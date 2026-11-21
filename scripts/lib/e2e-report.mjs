/**
 * Recuento de pasos del E2E instalado.
 *
 * Cada guion cierra con «STEPS: ejecutados/esperados»; este módulo comprueba que
 * cada suite lo declara y que el número coincide con el que espera la lista de
 * suites. Vive fuera del workflow para poder probarlo con vitest: un log corto,
 * una línea ausente o un guion que sale con 0 sin haber corrido todo tienen que
 * ponerse en rojo igual.
 */

import fs from 'node:fs';
import path from 'node:path';
import { E2E_SUITES, expectedSteps } from '../e2e-suites.mjs';

/** Última línea «STEPS: n/m» del log; la primera puede venir de una ejecución previa. */
export const STEPS_PATTERN = /STEPS: (\d+)\/(\d+)/g;

/** Línea donde la suite cuenta qué paso falló, para no dejar el check mudo. */
export const FAILURE_LINE_PATTERN = /^.*\bFAIL\b.*$/gm;

/**
 * Última línea de fallo del log, recortada a una anotación legible.
 *
 * Sin esto el check solo dice «declara 0/5 pasos» y la causa —el paso y su
 * mensaje— queda enterrada en el log del job, que en un PR no se lee.
 */
export function lastFailureLine(text) {
  FAILURE_LINE_PATTERN.lastIndex = 0;
  const matches = [...String(text).matchAll(FAILURE_LINE_PATTERN)];
  if (!matches.length) return '';
  const line = matches[matches.length - 1][0].replace(/\s+/g, ' ').trim();
  return line.length > 300 ? `${line.slice(0, 297)}…` : line;
}

/** Mensaje del problema, con la última línea de fallo cuando la hay. */
const problemMessage = (text, base) => {
  const detail = lastFailureLine(text);
  return detail ? `${base} Último fallo del log: ${detail}` : base;
};

/** Resume las suites leyendo su log con `readLog(suite)`. */
export function summarizeSuites(suites, readLog) {
  const problems = [];
  const reports = [];

  for (const suite of suites) {
    const text = readLog(suite) ?? '';
    STEPS_PATTERN.lastIndex = 0;
    const matches = [...String(text).matchAll(STEPS_PATTERN)];
    const match = matches.length ? matches[matches.length - 1] : null;

    if (!match) {
      problems.push({
        log: suite.log,
        message: problemMessage(text, `${suite.log} no informó de los pasos ejecutados.`),
      });
      reports.push(`${suite.label} sin recuento`);
      continue;
    }

    // `expectedSteps` baja el total cuando una suite omite un tramo en este entorno.
    const expected = expectedSteps(suite);
    const counts = `${match[1]}/${match[2]}`;
    if (counts !== `${expected}/${expected}`) {
      problems.push({
        log: suite.log,
        message: problemMessage(
          text,
          `${suite.log} declara ${counts} pasos; se esperaban ${expected}/${expected}.`,
        ),
      });
    }
    reports.push(`${suite.label} ${counts}`);
  }

  const code = problems.length ? 1 : 0;
  return {
    code,
    result: code === 0 ? 'PASS' : 'FAIL',
    text: reports.join(' · '),
    problems,
  };
}

/** Sello único por corrida, sin caracteres que Windows no acepta en un nombre. */
export function runStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

/**
 * Copia el log de las suites que fallaron a `failure-<label>-<sello>.log`.
 *
 * El log de cada suite se reescribe en cada corrida, así que el diagnóstico de un
 * fallo intermitente (la traza del campo del paso 4, por ejemplo) se perdía en la
 * corrida siguiente. La copia lleva sello para no pisar la de otro fallo, y solo
 * se hace de las suites que fallaron: una corrida en verde no deja copias.
 *
 * Cuenta como fallida tanto la suite que salió con código distinto de 0 como la
 * que salió con 0 pero cuyo recuento de pasos no cuadra (`problems`).
 */
export function preserveFailureLogs(directory, suites, { codes = new Map(), problems = [], stamp } = {}) {
  const failedLogs = new Set([
    ...suites.filter((suite) => (codes.get(suite.label) ?? 0) !== 0).map((suite) => suite.log),
    ...problems.map((problem) => problem.log),
  ]);
  const saved = [];

  for (const suite of suites) {
    if (!failedLogs.has(suite.log)) continue;
    const source = path.join(directory, suite.log);
    if (!fs.existsSync(source)) continue;
    const target = path.join(directory, `failure-${suite.label}-${stamp}.log`);
    fs.copyFileSync(source, target);
    saved.push(target);
  }

  return saved;
}

/** Recuento sobre los logs que hay en `directory`. */
export function summarizeLogs(directory, suites = E2E_SUITES) {
  return summarizeSuites(suites, (suite) => {
    const file = path.join(directory, suite.log);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  });
}
