#!/usr/bin/env node
/**
 * Paso «E2E de adblock en Electron»: corre el E2E y decide cómo termina.
 *
 * Uso:
 *   node scripts/run-adblock-e2e.mjs               # corrida normal
 *   ADBLOCK_OFFLINE=true node scripts/run-adblock-e2e.mjs   # ensayo sin red
 *
 * Marca `forced=true` y apunta el E2E a un destino inalcanzable cuando el run se
 * pidió con `adblock_offline`. Con código 2 avisa con un `::warning` y deja el
 * job verde escribiendo `skipped=true`; con cualquier otro código el paso sale
 * rojo con ese mismo código. La regla está en `lib/adblock-e2e-step.mjs`.
 */

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { E2E_NPM_ARGS, OFFLINE_PROBE_URLS } from './lib/adblock-drills.mjs';
import { decideE2eStep } from './lib/adblock-e2e-step.mjs';

const offline = process.env.ADBLOCK_OFFLINE === 'true';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** Salidas del paso; sin `GITHUB_OUTPUT` se pierde el resumen, no el veredicto. */
function output(line) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  try {
    fs.appendFileSync(file, `${line}\n`, 'utf8');
  } catch {
    // Sin fichero de salidas el resumen se queda sin el matiz, pero el paso sigue.
  }
}

const env = { ...process.env };
if (offline) {
  env.TERMINUS_E2E_ADBLOCK_PROBE_URLS = OFFLINE_PROBE_URLS;
  output('forced=true');
  console.log(`Ensayo sin red: TERMINUS_E2E_ADBLOCK_PROBE_URLS=${OFFLINE_PROBE_URLS}`);
}

const child = spawnSync(npm, E2E_NPM_ARGS, {
  stdio: 'inherit',
  env,
  // En Windows `npm` es un `.cmd`: sin shell no se puede lanzar.
  shell: process.platform === 'win32',
});
if (child.error) {
  console.error(`No se pudo lanzar ${npm}: ${child.error.message}`);
}
const code = child.error ? 1 : child.status ?? 1;

const step = decideE2eStep({ code, offline });
if (step.skipped) {
  output('skipped=true');
  console.log(`::warning title=E2E de adblock omitido::${step.warning}`);
}
process.exitCode = step.exitCode;
