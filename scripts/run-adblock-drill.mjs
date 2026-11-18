#!/usr/bin/env node
/**
 * Corre un ensayo de adblock y aplica su veredicto.
 *
 * Uso:
 *   node scripts/run-adblock-drill.mjs --kind=engine
 *   node scripts/run-adblock-drill.mjs --kind=offline
 *
 * Sale con 0 sólo cuando el E2E se clasificó como fallo de red (código 2 y su
 * motivo en el log). Cualquier otro código —el 1 de una regresión incluido—
 * termina con 1, así que el paso del workflow se pone rojo sin que PowerShell
 * tenga que leer ni interpretar nada.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { DRILL_NPM_ARGS, runDrill } from './lib/adblock-drill-runner.mjs';

const { values } = parseArgs({ options: { kind: { type: 'string' } }, strict: false });
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const result = runDrill({
  kind: values.kind ?? '',
  run: (env) => {
    const child = spawnSync(npm, DRILL_NPM_ARGS, {
      stdio: 'inherit',
      env: { ...process.env, ...env },
      // En Windows `npm` es un `.cmd`: sin shell no se puede lanzar.
      shell: process.platform === 'win32',
    });
    if (child.error) {
      console.error(`No se pudo lanzar ${npm}: ${child.error.message}`);
      return 1;
    }
    return child.status ?? 1;
  },
  copyLog: (from, to) => {
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    } catch {
      // Sin copia el veredicto se queda sin log y sale rojo: no se tapa el fallo.
    }
  },
  readLog: (file) => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  },
});

// Una sola línea en el fallo: la anotación del check, que además queda en el log.
if (result.ok) {
  console.log(`Ensayo de adblock OK: ${result.reason}`);
} else {
  console.log(`::error title=Ensayo de adblock en rojo::${result.reason}`);
  process.exitCode = 1;
}
