import { describe, expect, it } from 'vitest';
import { DRILLS, E2E_NPM_ARGS, OFFLINE_PROBE_URLS, drillConfig } from './adblock-drills.mjs';

// Las líneas reales que escribe el E2E en cada ensayo (runs 44256099032 y
// 44262210379): si un marcador deja de casar con ellas, el ensayo se pone rojo
// sin que el producto haya cambiado.
const LOG_MOTOR = 'E2E_ADBLOCK_UNREACHABLE: motor sin listas (listas vacías o incompletas: 0 filtros de red y 0 cosméticos)';
const LOG_SIN_RED = 'E2E_ADBLOCK_UNREACHABLE: Sin red para el E2E: http://127.0.0.1:9/ (TypeError: fetch failed)';

describe('configuración de los ensayos de adblock', () => {
  it('sólo existen los dos ensayos que corren en el workflow', () => {
    expect(Object.keys(DRILLS).sort()).toEqual(['engine', 'offline']);
  });

  it('cada ensayo trae lo que necesitan el runner y el veredicto', () => {
    for (const drill of Object.values(DRILLS)) {
      expect(drill.label.length).toBeGreaterThan(0);
      expect(drill.marker).toBeInstanceOf(RegExp);
      expect(drill.markerLabel.length).toBeGreaterThan(0);
      expect(Object.keys(drill.env)).toHaveLength(1);
      expect(Object.values(drill.env)[0].length).toBeGreaterThan(0);
      expect(drill.logPath).toMatch(/^artifacts\/e2e\/adblock-drill-.+\.log$/);
    }
  });

  it('comparte con el paso normal el comando y el destino inalcanzable', () => {
    expect(E2E_NPM_ARGS).toEqual(['run', 'test:e2e:adblock']);
    expect(DRILLS.offline.env).toEqual({ TERMINUS_E2E_ADBLOCK_PROBE_URLS: OFFLINE_PROBE_URLS });
  });

  it('los dos ensayos no comparten log', () => {
    const paths = Object.values(DRILLS).map((drill) => drill.logPath);

    expect(new Set(paths).size).toBe(paths.length);
  });

  it('cada marcador casa con la línea de su ensayo y no con la del otro', () => {
    expect(DRILLS.engine.marker.test(LOG_MOTOR)).toBe(true);
    expect(DRILLS.engine.marker.test(LOG_SIN_RED)).toBe(false);
    expect(DRILLS.offline.marker.test(LOG_SIN_RED)).toBe(true);
  });

  it('drillConfig no se traga nombres del prototipo', () => {
    expect(drillConfig('engine')).toBe(DRILLS.engine);
    expect(drillConfig('nada')).toBeNull();
    expect(drillConfig('toString')).toBeNull();
    expect(drillConfig(undefined)).toBeNull();
  });
});
