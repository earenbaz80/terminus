import { describe, expect, it } from 'vitest';
import { DRILLS } from './adblock-drills.mjs';
import { E2E_LOG, runDrill } from './adblock-drill-runner.mjs';

const LOG_MOTOR = 'E2E_ADBLOCK_UNREACHABLE: motor sin listas (listas vacías o incompletas: 0 filtros de red y 0 cosméticos)';
const LOG_SIN_RED = 'E2E_ADBLOCK_UNREACHABLE: Sin red para el E2E: http://127.0.0.1:9/ (TypeError: fetch failed)';

/** Runner falso: devuelve el código que se le pida y registra lo que recibe. */
function fakeDrill({ code = 2, log = LOG_MOTOR } = {}) {
  const calls = { run: [], copyLog: [], readLog: [] };
  return {
    calls,
    deps: {
      run: (env) => {
        calls.run.push(env);
        return code;
      },
      copyLog: (from, to) => calls.copyLog.push([from, to]),
      readLog: (file) => {
        calls.readLog.push(file);
        return log;
      },
    },
  };
}

// Aquí sólo se prueba el cableado: qué código llega al veredicto, con qué
// variables se lanza el E2E y qué log se juzga. La clasificación vive en
// `adblock-drill-verdict.test.mjs` y la configuración en `adblock-drills.test.mjs`.
describe('runner de los ensayos de adblock', () => {
  it('deja en verde el motor sin listas cuando sale 2 con su motivo', () => {
    const { calls, deps } = fakeDrill({ code: 2, log: LOG_MOTOR });
    const result = runDrill({ kind: 'engine', ...deps });

    expect(result.ok).toBe(true);
    expect(result.code).toBe(2);
    expect(calls.run).toEqual([DRILLS.engine.env]);
  });

  it('lanza el destino inalcanzable con la red simulada', () => {
    const { calls, deps } = fakeDrill({ code: 2, log: LOG_SIN_RED });
    const result = runDrill({ kind: 'offline', ...deps });

    expect(result.ok).toBe(true);
    expect(calls.run).toEqual([DRILLS.offline.env]);
  });

  it('lleva al veredicto el código 1 de una regresión', () => {
    // El cableado que importa: el código del E2E llega al veredicto y pone el paso
    // en rojo, con el log bueno delante.
    const { deps } = fakeDrill({ code: 1, log: LOG_MOTOR });
    const result = runDrill({ kind: 'engine', ...deps });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('regresión del producto');
  });

  it('copia el log del E2E al nombre del ensayo y juzga ese', () => {
    const { calls, deps } = fakeDrill();
    runDrill({ kind: 'offline', ...deps });

    expect(calls.copyLog).toEqual([[E2E_LOG, DRILLS.offline.logPath]]);
    expect(calls.readLog).toEqual([DRILLS.offline.logPath]);
  });

  it('no corre nada con un ensayo desconocido', () => {
    const { calls, deps } = fakeDrill();
    const result = runDrill({ kind: 'cualquiera', ...deps });

    expect(result.ok).toBe(false);
    expect(result.code).toBeNull();
    expect(result.reason).toContain('ensayo desconocido');
    expect(calls.run).toHaveLength(0);
    expect(calls.copyLog).toHaveLength(0);
  });
});
