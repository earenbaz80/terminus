#!/usr/bin/env node
/**
 * Banco de inyección real para el flake de «un carácter» de `ctrl-f`.
 *
 * Corre `scripts/e2e-installed-ctrl-f.mjs` como hijo y, pasado un retardo desde el
 * arranque, manda un espacio de verdad con `SendInput` (P/Invoke): otro proceso, la
 * ventana en primer plano y ningún evento de la prueba. Con eso se comprueba que la
 * suite clasifica como ajena una tecla que no envió y se reproduce el fallo del paso 2
 * (el campo amanece con un carácter de más) sin esperar a que ocurra.
 *
 * Uso:
 *   node scripts/e2e-ctrl-f-inject.mjs                          # 3 500 ms, una corrida
 *   node scripts/e2e-ctrl-f-inject.mjs --delays 3000,3500 --runs 3
 *
 * Deja la salida de cada corrida en `artifacts/injection/` (ignorado por git).
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SEND_SCRIPT = path.join(import.meta.dirname, 'lib', 'win-send-input.ps1');
const OUT_DIR = path.join('artifacts', 'injection');
const SUITE = 'scripts/e2e-installed-ctrl-f.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const delays = option('delays', '3500')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value));
const runs = Number(option('runs', '1'));
if (delays.length === 0 || runs < 1) throw new Error('Retardos o corridas inválidos.');

fs.mkdirSync(OUT_DIR, { recursive: true });

/** Última línea de la salida de PowerShell, que es el JSON del envío. */
const lastJsonLine = (text) =>
  text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .pop();

/** Manda un espacio real; si Terminus no está delante, PowerShell sale con 1 igualmente. */
const sendSpace = () => {
  const powerShellArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SEND_SCRIPT];
  try {
    return JSON.parse(lastJsonLine(execFileSync('powershell.exe', powerShellArgs, { encoding: 'utf8', windowsHide: true })));
  } catch (error) {
    if (error.stdout) return JSON.parse(lastJsonLine(error.stdout));
    throw error;
  }
};

const runOnce = (delay) =>
  new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [SUITE], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    let injection = null;
    let injectionError = null;
    const timer = setTimeout(() => {
      try {
        injection = sendSpace();
      } catch (error) {
        injectionError = String(error?.message ?? error);
      }
    }, delay);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ delay, code, output, injection, injectionError, elapsedMs: Date.now() - started });
    });
  });

const summarize = (output) => {
  const lines = output.split(/\r?\n/);
  const pick = (needle) => {
    const line = lines.filter((entry) => entry.includes(needle)).pop();
    return line ? line.slice(line.indexOf(needle)) : null;
  };
  return { steps: pick('STEPS:'), fail: pick('FAIL:'), stray: pick('Teclas no enviadas') };
};

const results = [];
for (const delay of delays) {
  for (let run = 1; run <= runs; run += 1) {
    const result = await runOnce(delay);
    const summary = summarize(result.output);
    const file = path.join(OUT_DIR, `ctrl-f-${delay}ms-${run}.log`);
    fs.writeFileSync(file, result.output, 'utf8');
    results.push({ ...result, summary, file });
    console.log(
      [
        `[inject] retardo ${delay} ms · corrida ${run}`,
        `exit=${result.code}`,
        summary.steps ?? 'sin STEPS',
        summary.fail ? `FALLO: ${summary.fail}` : 'sin FAIL',
        `envío=${result.injection ? JSON.stringify(result.injection) : `error: ${result.injectionError}`}`,
        summary.stray ?? 'sin línea de teclas ajenas',
        `(${result.elapsedMs} ms)`,
        `log=${file}`,
      ].join(' · '),
    );
  }
}

const failed = results.filter((result) => result.code !== 0 || result.summary.fail).length;
const classified = results.filter((result) => result.summary.stray && !result.summary.stray.includes('[]')).length;
console.log(
  `[inject] resumen: ${results.length} corrida(s), ${failed} con fallo, ${classified} con teclas ajenas registradas.`,
);
