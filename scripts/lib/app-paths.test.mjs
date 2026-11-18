import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APP_PATH_PATTERN,
  APP_PATH_RULES,
  decideBuild,
  isAppPath,
  runCli,
  touchesApp,
} from './app-paths.mjs';

// La raíz es el directorio desde el que corre Vitest; con `import.meta.url` el
// runner entrega una URL que no siempre es `file:`, y `readFileSync` la rechaza.
const raiz = process.cwd();
const leer = (ruta) => readFileSync(join(raiz, ruta), 'utf8');

const README = leer('README.md');
const DOCS_E2E = leer('docs/e2e-installed-windows.md');
const WORKFLOW = leer('.github/workflows/ci.yml');

/** Stdin falsa: `for await` sobre un único trozo, como el pipe del workflow. */
async function* entrada(texto) {
  yield Buffer.from(texto);
}

describe('patrón de rutas que empaqueta la app', () => {
  it('se deriva de las reglas, sin copia a mano', () => {
    expect(APP_PATH_PATTERN).toBe(
      '^(src/|electron/|scripts/|assets/|index\\.html$|package(-lock)?\\.json$|vite\\.config\\.|vitest\\.config\\.|tsconfig[^/]*\\.json$|electron-builder)'
    );
    for (const { regla } of APP_PATH_RULES) {
      expect(APP_PATH_PATTERN, regla).toContain(regla);
    }
    expect(() => new RegExp(APP_PATH_PATTERN)).not.toThrow();
  });

  it('reconoce lo que se empaqueta', () => {
    const empaquetadas = [
      'src/main.ts',
      'electron/main.cjs',
      'scripts/e2e-run.mjs',
      'scripts/lib/adblock-engine-state.mjs',
      'assets/icon.png',
      'index.html',
      'package.json',
      'package-lock.json',
      'vite.config.ts',
      'vitest.config.ts',
      'tsconfig.json',
      'tsconfig.web.json',
      'electron-builder.yml',
    ];

    for (const ruta of empaquetadas) {
      expect(isAppPath(ruta), ruta).toBe(true);
    }
  });

  it('no confunde documentación ni configuración del repo con la app', () => {
    const ajenas = [
      'README.md',
      'ROADMAP.md',
      'LICENSE',
      '.gitignore',
      'docs/e2e-installed-windows.md',
      '.github/workflows/ci.yml',
      'shared/networkPolicyEnv.cjs',
      'srcfoo/inicio.ts',
      'index.html.bak',
      '',
    ];

    for (const ruta of ajenas) {
      expect(isAppPath(ruta), ruta).toBe(false);
    }
    expect(touchesApp([])).toBe(false);
    expect(touchesApp(['README.md', 'docs/e2e-installed-windows.md'])).toBe(false);
    expect(touchesApp(['README.md', 'src/main.ts'])).toBe(true);
  });
});

describe('decisión de compilar', () => {
  it('compila en todo lo que no es un PR', () => {
    const { appChanged, motivo } = decideBuild({ evento: 'push', archivos: [] });

    expect(appChanged).toBe(true);
    expect(motivo).toBe('no es un PR: se compila');
  });

  it('compila si no se pudo inspeccionar el PR', () => {
    expect(decideBuild({ evento: 'pull_request', archivos: [], consultaFallo: true })).toEqual({
      appChanged: true,
      motivo: 'la consulta de ficheros falló: se compila',
    });
    expect(decideBuild({ evento: 'pull_request', archivos: [] })).toEqual({
      appChanged: true,
      motivo: 'la consulta no devolvió ficheros: se compila',
    });
  });

  it('compila cuando el PR toca la app y lo omite cuando es solo documentación', () => {
    expect(decideBuild({ evento: 'pull_request', archivos: ['README.md', 'src/main.ts'] })).toEqual({
      appChanged: true,
      motivo: 'el PR toca la app',
    });
    expect(
      decideBuild({ evento: 'pull_request', archivos: ['README.md', 'docs/e2e-installed-windows.md'] })
    ).toEqual({
      appChanged: false,
      motivo: 'PR sin cambios de app: se omite el build de Windows',
    });
  });
});

describe('CLI del job cambios', () => {
  it('escribe el output y el motivo del resumen, y los repite en el log', async () => {
    const directorio = mkdtempSync(join(tmpdir(), 'app-paths-'));
    const salida = join(directorio, 'output');
    const resumen = join(directorio, 'summary');

    try {
      const resultado = await runCli(
        ['--evento', 'pull_request'],
        { GITHUB_OUTPUT: salida, GITHUB_STEP_SUMMARY: resumen },
        entrada('README.md\ndocs/e2e-installed-windows.md\n')
      );

      expect(resultado).toEqual({
        appChanged: false,
        motivo: 'PR sin cambios de app: se omite el build de Windows',
      });
      expect(readFileSync(salida, 'utf8')).toBe('app_changed=false\n');
      expect(readFileSync(resumen, 'utf8')).toBe(
        '- **Build de Windows:** PR sin cambios de app: se omite el build de Windows\n'
      );
    } finally {
      rmSync(directorio, { recursive: true, force: true });
    }
  });

  it('acepta el aviso de consulta fallida y rechaza opciones que no entiende', async () => {
    const directorio = mkdtempSync(join(tmpdir(), 'app-paths-'));
    const salida = join(directorio, 'output');

    try {
      const resultado = await runCli(
        ['--evento', 'pull_request', '--consulta-fallo'],
        { GITHUB_OUTPUT: salida },
        entrada('')
      );

      expect(resultado.appChanged).toBe(true);
      expect(readFileSync(salida, 'utf8')).toBe('app_changed=true\n');
      await expect(runCli(['--otra-cosa'], {}, entrada(''))).rejects.toThrow(
        'Opción desconocida: --otra-cosa'
      );
    } finally {
      rmSync(directorio, { recursive: true, force: true });
    }
  });
});

describe('la regla no puede desincronizarse entre workflow, README y docs', () => {
  it('el workflow delega en el módulo y no guarda una copia del patrón', () => {
    expect(WORKFLOW).toContain('node scripts/lib/app-paths.mjs');
    expect(WORKFLOW).not.toContain('^(src/|electron/');
  });

  it('los docs nombran el módulo como fuente única', () => {
    expect(README).toContain('`scripts/lib/app-paths.mjs`');
    expect(DOCS_E2E).toContain('`scripts/lib/app-paths.mjs`');
  });

  it('README y docs del E2E listan cada token documentado', () => {
    for (const { doc } of APP_PATH_RULES) {
      expect(README, `README: ${doc}`).toContain(doc);
      expect(DOCS_E2E, `docs: ${doc}`).toContain(doc);
    }
  });
});
