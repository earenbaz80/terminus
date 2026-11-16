#!/usr/bin/env node
/**
 * Banco de inyección real para el flake de «un carácter» de `ctrl-f`.
 *
 * Corre `scripts/e2e-installed-ctrl-f.mjs` como hijo y, pasado un retardo desde el
 * arranque, manda una pulsación de verdad con `SendInput` (P/Invoke): otro proceso, una
 * ventana en primer plano y ningún evento de la prueba. Sirve para dos cosas:
 *
 *   - comprobar que la suite clasifica como ajena una tecla que no envió (`sentByTest`
 *     en `false`, con su `code` y `keyCode`), y
 *   - intentar reproducir el fallo del paso 2 (el campo amanece con un carácter de más)
 *     sin depender de que ocurra por casualidad.
 *
 * Uso:
 *   node scripts/e2e-ctrl-f-inject.mjs --delays 1500,2000,2500,3000
 *   node scripts/e2e-ctrl-f-inject.mjs --delays 2500 --vk 32 --times 1
 *   node scripts/e2e-ctrl-f-inject.mjs --delays 2500 --text "x"
 *
 * Deja la salida de cada corrida en `artifacts/injection/` (ignorado por git).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { sendRealKey } from './lib/e2e-real-keys.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const delays = option('delays', '2500')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value));
const text = option('text', '');
const vk = Number(option('vk', '0'));
const times = Number(option('times', '1'));
const runs = Number(option('runs', '1'));
const suite = option('suite', 'scripts/e2e-installed-ctrl-f.mjs');
const outDir = path.join('artifacts', 'injection');

if (delays.length === 0) throw new Error('Sin retardos que probar.');
if (!text && !vk) throw new Error('Hay que indicar --text o --vk.');

fs.mkdirSync(outDir, { recursive: true });

const runOnce = (delay) =>
  new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [suite], { stdio: ['ignore', 'pipe', 'pipe'] });
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
        injection = sendRealKey({ text, vk, times });
      } catch (error) {
        injectionError = String(error?.message ?? error);
      }
    }, delay);

    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ delay, code, output, injection, injectionError, elapsedMs: Date.now() - started });
    });
  });

const summarize = (result) => {
  const lines = result.output.split(/\r?\n/);
  const steps = lines.find((line) => /STEPS: \d+\/\d+/.test(line));
  const fail = lines.filter((line) => line.includes('FAIL:'));
  const stray = lines.filter((line) => line.includes('Teclas no enviadas'));
  return {
    steps: steps ? steps.slice(steps.indexOf('STEPS:')) : null,
    fail: fail.length > 0 ? fail[fail.length - 1].slice(fail[fail.length - 1].indexOf('FAIL:')) : null,
    stray: stray.length > 0 ? stray[stray.length - 1].slice(stray[stray.length - 1].indexOf('Teclas no enviadas')) : null,
  };
};

const results = [];
for (const delay of delays) {
  for (let run = 1; run <= runs; run += 1) {
    const result = await runOnce(delay);
    const summary = summarize(result);
    const file = path.join(outDir, `ctrl-f-${delay}ms-${run}.log`);
    fs.writeFileSync(file, result.output, 'utf8');
    results.push({ ...result, summary, file });
    console.log(
      [
        `[inject] retardo ${delay} ms · corrida ${run}`,
        `exit=${result.code}`,
        `${summary.steps ?? 'sin STEPS'}`,
        summary.fail ? `FALLO: ${summary.fail}` : 'sin FAIL',
        `inyección=${result.injection ? JSON.stringify(result.injection) : `error: ${result.injectionError}`}`,
        summary.stray ? summary.stray : 'sin línea de teclas ajenas',
        `(${result.elapsedMs} ms)`,
        `log=${file}`,
      ].join(' · '),
    );
  }
}

const failed = results.filter((result) => result.code !== 0 || result.summary.fail).length;
const classified = results.filter((result) => result.summary.stray && !/\[\]/.test(result.summary.stray)).length;
console.log(
  `[inject] resumen: ${results.length} corrida(s), ${failed} con fallo, ${classified} con teclas ajenas registradas.`,
);
