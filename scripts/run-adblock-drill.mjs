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
import { DRILL_NPM_ARGS, runDrill } from './lib/adblock-drill-runner.mjs';

const LOG = '[adblock-drill]';

function option(name) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}

const kind = option('--kind') ?? '';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const result = runDrill({
  kind,
  run: (env) => {
    const child = spawnSync(npm, DRILL_NPM_ARGS, {
      stdio: 'inherit',
      env: { ...process.env, ...env },
      // En Windows `npm` es un `.cmd`: sin shell no se puede lanzar.
      shell: process.platform === 'win32',
    });
    if (child.error) {
      console.error(`${LOG} No se pudo lanzar ${npm}: ${child.error.message}`);
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
  write: (message) => console.log(`${LOG} ${message}`),
});

if (result.ok) {
  console.log(`${LOG} OK: ${result.reason}`);
} else {
  console.error(`${LOG} FAIL: ${result.reason}`);
  console.error(`::error title=Ensayo de adblock en rojo::${result.reason}`);
  process.exitCode = 1;
}
