import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  E2E_SUITES,
  NETWORK_SKIP_DEV_ENV,
  NETWORK_STEPS,
  NETWORK_STEPS_WITHOUT_DEV,
  networkSkipsDev,
  networkSteps,
  selectSuites,
  suiteSteps,
} from '../e2e-suites.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { scripts } = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));

describe('suites del E2E instalado', () => {
  it('no repite etiquetas ni ficheros de log', () => {
    const labels = E2E_SUITES.map((suite) => suite.label);
    const logs = E2E_SUITES.map((suite) => suite.log);

    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(logs).size).toBe(logs.length);
  });

  it('sin etiquetas devuelve todas y con etiquetas solo las pedidas', () => {
    expect(selectSuites([]).map((suite) => suite.label)).toEqual(E2E_SUITES.map((suite) => suite.label));
    expect(selectSuites(['ui-de']).map((suite) => suite.label)).toEqual(['ui-de']);
    expect(selectSuites(['ctrl-f', 'ui']).map((suite) => suite.label)).toEqual(['ctrl-f', 'ui']);
  });

  it('rechaza una suite desconocida', () => {
    expect(() => selectSuites(['ui-fr'])).toThrow(/Suite desconocida: ui-fr/);
    expect(() => suiteSteps('ui-fr')).toThrow(/Suite desconocida/);
  });

  it('omite desktop:dev solo con la variable en 1, y ajusta el recuento', () => {
    expect(networkSkipsDev({})).toBe(false);
    expect(networkSkipsDev({ [NETWORK_SKIP_DEV_ENV]: '0' })).toBe(false);
    expect(networkSkipsDev({ [NETWORK_SKIP_DEV_ENV]: 'true' })).toBe(false);
    expect(networkSkipsDev({ [NETWORK_SKIP_DEV_ENV]: '1' })).toBe(true);

    expect(networkSteps({})).toBe(NETWORK_STEPS);
    expect(networkSteps({ [NETWORK_SKIP_DEV_ENV]: '1' })).toBe(NETWORK_STEPS_WITHOUT_DEV);
    // El total que declara la lista y el que lee el guion salen del mismo sitio.
    expect(suiteSteps('network')).toBe(networkSteps());
  });

  // Renombrar una suite o su script de npm dejaría al ejecutor llamando a un
  // comando inexistente, y el fallo aparecería en el CI como un E2E roto.
  it('cada suite apunta a un script de npm que existe', () => {
    const missing = E2E_SUITES.filter((suite) => typeof scripts[suite.script] !== 'string').map(
      (suite) => `${suite.label} → ${suite.script}`,
    );

    expect(missing, 'suites sin script en package.json').toEqual([]);
  });
});
