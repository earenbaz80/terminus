import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { E2E_SUITES, NETWORK_SKIP_DEV_ENV, selectSuites, suiteSteps } from '../e2e-suites.mjs';
import { preserveFailureLogs, runStamp, summarizeSuites } from './e2e-report.mjs';

const suites = [
  { label: 'ctrl-f', log: 'e2e-installed.log', steps: 3 },
  { label: 'ui', log: 'e2e-installed-ui.log', steps: 6 },
];

const readFrom = (logs) => (suite) => logs[suite.log] ?? '';

describe('summarizeSuites', () => {
  it('da el resumen por suite cuando los recuentos coinciden', () => {
    const summary = summarizeSuites(
      suites,
      readFrom({
        'e2e-installed.log': '[e2e] PASS 3/3\r\n[e2e] STEPS: 3/3\r\n',
        'e2e-installed-ui.log': '[e2e] STEPS: 6/6\r\n',
      }),
    );

    expect(summary).toEqual({
      code: 0,
      result: 'PASS',
      text: 'ctrl-f 3/3 · ui 6/6',
      problems: [],
    });
  });

  it('falla cuando un guion ejecutó menos pasos de los esperados', () => {
    const summary = summarizeSuites(
      suites,
      readFrom({
        'e2e-installed.log': 'STEPS: 2/3\r\n',
        'e2e-installed-ui.log': 'STEPS: 6/6\r\n',
      }),
    );

    expect(summary.code).toBe(1);
    expect(summary.result).toBe('FAIL');
    expect(summary.problems).toEqual([
      {
        log: 'e2e-installed.log',
        message: 'e2e-installed.log declara 2/3 pasos; se esperaban 3/3.',
      },
    ]);
    expect(summary.text).toBe('ctrl-f 2/3 · ui 6/6');
  });

  it('falla cuando el guion sale sin línea de recuento', () => {
    const summary = summarizeSuites(
      suites,
      readFrom({ 'e2e-installed-ui.log': 'STEPS: 6/6\r\n' }),
    );

    expect(summary.code).toBe(1);
    expect(summary.problems[0].message).toBe(
      'e2e-installed.log no informó de los pasos ejecutados.',
    );
    expect(summary.text).toBe('ctrl-f sin recuento · ui 6/6');
  });

  it('se queda con la última línea de recuento del log', () => {
    const summary = summarizeSuites(
      suites,
      readFrom({
        'e2e-installed.log': 'STEPS: 1/3\r\nSTEPS: 3/3\r\n',
        'e2e-installed-ui.log': 'STEPS: 6/6\r\n',
      }),
    );

    expect(summary.code).toBe(0);
    expect(summary.text).toBe('ctrl-f 3/3 · ui 6/6');
  });

  it('acepta los 8 pasos de network solo con el tramo de dev omitido', () => {
    const network = [E2E_SUITES.find((suite) => suite.label === 'network')];
    const logs = readFrom({ 'e2e-network-policy.log': 'STEPS: 8/8\r\n' });

    process.env[NETWORK_SKIP_DEV_ENV] = '1';
    try {
      expect(summarizeSuites(network, logs)).toEqual({
        code: 0,
        result: 'PASS',
        text: 'network 8/8',
        problems: [],
      });
    } finally {
      delete process.env[NETWORK_SKIP_DEV_ENV];
    }

    // Sin la variable, 8/8 está incompleto aunque el guion saliera con 0.
    const incomplete = summarizeSuites(network, logs);
    expect(incomplete.code).toBe(1);
    expect(incomplete.problems[0].message).toBe(
      'e2e-network-policy.log declara 8/8 pasos; se esperaban 16/16.',
    );
  });

  it('añade a la anotación la última línea de fallo del log', () => {
    const summary = summarizeSuites(
      suites,
      readFrom({
        'e2e-installed.log': 'FAIL 1/3: no arrancó\r\nFAIL 2/3: sigue sin arrancar\r\nSTEPS: 1/3\r\n',
        'e2e-installed-ui.log': 'STEPS: 6/6\r\n',
      }),
    );

    expect(summary.problems[0].message).toBe(
      'e2e-installed.log declara 1/3 pasos; se esperaban 3/3. Último fallo del log: FAIL 2/3: sigue sin arrancar',
    );
  });

  it('no inventa detalle cuando el log no tiene línea de fallo', () => {
    const summary = summarizeSuites(suites, readFrom({ 'e2e-installed.log': 'STEPS: 0/3\r\n' }));

    expect(summary.problems[0].message).toBe(
      'e2e-installed.log declara 0/3 pasos; se esperaban 3/3.',
    );
  });

  it('acepta un total mayor que el esperado como fallo', () => {
    const summary = summarizeSuites(
      suites,
      readFrom({
        'e2e-installed.log': 'STEPS: 4/4\r\n',
        'e2e-installed-ui.log': 'STEPS: 6/6\r\n',
      }),
    );

    expect(summary.code).toBe(1);
    expect(summary.problems[0].message).toBe(
      'e2e-installed.log declara 4/4 pasos; se esperaban 3/3.',
    );
  });
});

describe('preserveFailureLogs', () => {
  const makeDir = (logs) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-report-'));
    for (const [name, text] of Object.entries(logs)) fs.writeFileSync(path.join(directory, name), text);
    return directory;
  };

  it('conserva solo el log de la suite que falló', () => {
    const logs = {
      'e2e-installed.log': 'STEPS: 3/3\r\n',
      'e2e-installed-ui.log': 'FAIL 4/11: traza\r\nSTEPS: 3/11\r\n',
    };
    const directory = makeDir(logs);

    try {
      const saved = preserveFailureLogs(directory, suites, {
        codes: new Map([['ctrl-f', 0], ['ui', 1]]),
        stamp: 'sellito',
      });

      expect(saved).toEqual([path.join(directory, 'failure-ui-sellito.log')]);
      expect(fs.readFileSync(saved[0], 'utf8')).toBe(logs['e2e-installed-ui.log']);
      expect(fs.readdirSync(directory).sort()).toEqual([
        'e2e-installed-ui.log',
        'e2e-installed.log',
        'failure-ui-sellito.log',
      ]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('no deja nada cuando todas salieron con 0 y los recuentos cuadran', () => {
    const directory = makeDir({
      'e2e-installed.log': 'STEPS: 3/3\r\n',
      'e2e-installed-ui.log': 'STEPS: 6/6\r\n',
    });

    try {
      const saved = preserveFailureLogs(directory, suites, {
        codes: new Map([['ctrl-f', 0], ['ui', 0]]),
        stamp: 'sellito',
      });

      expect(saved).toEqual([]);
      expect(fs.readdirSync(directory).sort()).toEqual(['e2e-installed-ui.log', 'e2e-installed.log']);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('conserva el log de una suite que salió con 0 pero perdió pasos', () => {
    const directory = makeDir({
      'e2e-installed.log': 'STEPS: 2/3\r\n',
      'e2e-installed-ui.log': 'STEPS: 6/6\r\n',
    });

    try {
      const saved = preserveFailureLogs(directory, suites, {
        codes: new Map([['ctrl-f', 0], ['ui', 0]]),
        problems: [{ log: 'e2e-installed.log', message: 'x' }],
        stamp: 'sellito',
      });

      expect(saved).toEqual([path.join(directory, 'failure-ctrl-f-sellito.log')]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('usa un sello apto para nombres de archivo en Windows', () => {
    expect(runStamp(new Date('2026-11-15T13:50:07.123Z'))).toBe('2026-11-15T13-50-07-123Z');
  });
});

describe('selectSuites', () => {
  it('devuelve todas las suites sin etiquetas', () => {
    expect(selectSuites()).toHaveLength(E2E_SUITES.length);
    expect(selectSuites([])).toEqual(E2E_SUITES);
  });

  it('filtra por etiqueta respetando el orden de la lista', () => {
    expect(selectSuites(['ui']).map((suite) => suite.label)).toEqual(['ui']);
    expect(selectSuites([' ui ', 'ctrl-f']).map((suite) => suite.label)).toEqual([
      'ctrl-f',
      'ui',
    ]);
  });

  it('falla con una etiqueta desconocida', () => {
    expect(() => selectSuites(['ctrlf'])).toThrow(/Suite desconocida: ctrlf/);
  });

  it('expone el total de pasos de cada suite', () => {
    for (const suite of E2E_SUITES) {
      expect(suiteSteps(suite.label)).toBe(suite.steps);
    }
    expect(() => suiteSteps('otra')).toThrow(/Suite desconocida/);
  });

});
