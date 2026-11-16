#!/usr/bin/env node
/**
 * Banco de inyección real para el flake de «un carácter» de `ctrl-f`.
 *
 * Corre la suite indicada (`--suite`; por defecto `scripts/e2e-installed-ctrl-f.mjs`)
 * como hijo y, pasado un retardo o al ver una línea suya, manda teclas de verdad con
 * `SendInput` (P/Invoke): otro proceso, la ventana en primer plano y ningún evento de la
 * prueba. Así se comprueba que la suite clasifica como ajena una tecla que no envió y se
 * reproduce el fallo del paso 2 (el campo amanece con un carácter de más) sin esperar a
 * que ocurra.
 *
 * Uso:
 *   node scripts/e2e-ctrl-f-inject.mjs                                   # 3 500 ms, una corrida
 *   node scripts/e2e-ctrl-f-inject.mjs --delays 3000,3500 --runs 3
 *   node scripts/e2e-ctrl-f-inject.mjs --vk 84                           # la letra «t» (KeyT)
 *   node scripts/e2e-ctrl-f-inject.mjs --suite scripts/e2e-installed-ui.mjs --on 'PASS 8/12' --vk 84
 *
 * `--vk` acepta una secuencia (`--vk 9,84` manda Tab y luego «t», útil para llevar el foco al
 * campo de resultados) y `--on` espera un trozo de la salida de la suite en vez de un retardo. Deja la salida de cada corrida en `artifacts/injection/`
 * (ignorado por git).
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SEND_SCRIPT = path.join(import.meta.dirname, 'lib', 'win-send-input.ps1');
const OUT_DIR = path.join('artifacts', 'injection');
const DEFAULT_SUITE = 'scripts/e2e-installed-ctrl-f.mjs';

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
const vkList = option('vk', '32')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);
const suite = option('suite', DEFAULT_SUITE);
const onMarker = option('on', '');

if (delays.length === 0 || runs < 1) throw new Error('Retardos o corridas inválidos.');
if (vkList.length === 0) throw new Error('--vk necesita al menos una tecla válida (32 = espacio, 84 = «t»).');
if (onMarker && args.includes('--delays')) throw new Error('--on y --delays se excluyen: el envío lo dispara uno u otro.');
if (!fs.existsSync(suite)) throw new Error(`No existe la suite ${suite}.`);

fs.mkdirSync(OUT_DIR, { recursive: true });

/** Última línea de la salida de PowerShell, que es el JSON del envío. */
const lastJsonLine = (text) =>
  text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .pop();

/** Manda una tecla real; si Terminus no está delante, PowerShell sale con 1 igualmente. */
const sendKey = (vk) => {
  const powerShellArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SEND_SCRIPT, '-Vk', String(vk)];
  try {
    return JSON.parse(lastJsonLine(execFileSync('powershell.exe', powerShellArgs, { encoding: 'utf8', windowsHide: true })));
  } catch (error) {
    if (error.stdout) return JSON.parse(lastJsonLine(error.stdout));
    throw error;
  }
};

/** Manda la secuencia de teclas pedida, en orden. */
const sendKeys = () => vkList.map(sendKey);

const runOnce = (delay) =>
  new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [suite], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let injection = null;
    let injectionError = null;
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      try {
        injection = sendKeys();
      } catch (error) {
        injectionError = String(error?.message ?? error);
      }
    };
    // Con `--on` el envío lo dispara una línea de la suite y no el reloj: el arranque de
    // Electron varía entre corridas y con retardos fijos el foco cae en cajas distintas.
    const timer = onMarker ? null : setTimeout(fire, delay);
    const collect = (chunk) => {
      output += chunk;
      if (onMarker && !fired && output.includes(onMarker)) fire();
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ delay, code: 1, output, injection, injectionError: String(error?.message ?? error), elapsedMs: Date.now() - started });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      // Un marcador que nunca aparece dejaría la corrida sin envío y sin explicación.
      if (onMarker && !fired) injectionError = `el marcador «${onMarker}» no apareció en la salida`;
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

const label = path.basename(suite, '.mjs');
const stamp = onMarker ? `on-${onMarker.replace(/[^A-Za-z0-9]+/g, '')}` : '';
const results = [];
for (const delay of onMarker ? [null] : delays) {
  for (let run = 1; run <= runs; run += 1) {
    const result = await runOnce(delay);
    const summary = summarize(result.output);
    const file = path.join(OUT_DIR, `${label}-${stamp || `${delay}ms`}-${run}.log`);
    fs.writeFileSync(file, result.output, 'utf8');
    results.push({ ...result, summary, file });
    console.log(
      [
        `[inject] ${onMarker ? `al ver «${onMarker}»` : `retardo ${delay} ms`} · corrida ${run}`,
        `exit=${result.code}`,
        summary.steps ?? 'sin STEPS',
        summary.fail ? `FALLO: ${summary.fail}` : 'sin FAIL',
        result.injection
          ? `envío=${JSON.stringify(result.injection.length === 1 ? result.injection[0] : result.injection)}`
          : `sin envío: ${result.injectionError ?? 'la corrida terminó antes del retardo'}`,
        summary.stray ?? 'sin línea de teclas ajenas',
        `(${result.elapsedMs} ms)`,
        `log=${file}`,
      ].join(' · '),
    );
  }
}

const failed = results.filter((result) => result.code !== 0 || result.summary.fail).length;
const classified = results.filter((result) => result.summary.stray && !result.summary.stray.includes('[]')).length;
const withoutInjection = results.filter((result) => !result.injection).length;
console.log(
  `[inject] resumen: ${results.length} corrida(s), ${failed} con fallo, ${classified} con teclas ajenas registradas` +
    `${withoutInjection ? `, ${withoutInjection} sin envío` : ''}.`,
);
