import { describe, expect, it } from 'vitest';
import { evaluateDrillVerdict } from './adblock-drill-verdict.mjs';

const LOG_MOTOR = [
  '2026-11-18T07:10:25 E2E_ADBLOCK_UNREACHABLE: motor sin listas (listas vacías o incompletas:',
  '0 filtros de red y 0 cosméticos (mínimos 1000/1000))',
].join('\n');

const LOG_SIN_RED = '2026-11-18T07:10:31 E2E_ADBLOCK_UNREACHABLE: Sin red para el E2E: http://127.0.0.1:9/ (TypeError: fetch failed)';
const LOG_VERDE = '2026-11-18T07:10:00 E2E_ADBLOCK_OK';

describe('veredicto de los ensayos de adblock', () => {
  it('acepta el motor vacío con código 2 y su motivo', () => {
    const result = evaluateDrillVerdict({ kind: 'engine', code: 2, log: LOG_MOTOR });

    expect(result.ok).toBe(true);
    expect(result.reason).toContain('motor sin listas');
  });

  it('acepta el destino inalcanzable con código 2 y su marcador', () => {
    const result = evaluateDrillVerdict({ kind: 'offline', code: 2, log: LOG_SIN_RED });

    expect(result.ok).toBe(true);
    expect(result.reason).toContain('E2E_ADBLOCK_UNREACHABLE');
  });

  it('pone en rojo una regresión del producto (código 1)', () => {
    // El caso que el `exit 0` del PR #109 podía tapar: un fallo real del producto
    // sale con 1 y el paso tiene que ponerse rojo, aunque el log parezca de red.
    for (const kind of ['engine', 'offline']) {
      const result = evaluateDrillVerdict({ kind, code: 1, log: LOG_MOTOR });

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('regresión del producto');
    }
  });

  it('pone en rojo un código 0: el ensayo dejó de sembrar el fallo', () => {
    const result = evaluateDrillVerdict({ kind: 'engine', code: 0, log: LOG_VERDE });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('debía salir con código 2');
  });

  it('pone en rojo cualquier otro código', () => {
    for (const code of [-1, 3, 127, 134]) {
      const result = evaluateDrillVerdict({ kind: 'offline', code, log: LOG_SIN_RED });

      expect(result.ok).toBe(false);
      expect(result.reason).toContain(`salió con ${code}`);
    }
  });

  it('pone en rojo el código 2 sin el marcador de su ensayo', () => {
    // Cada ensayo exige el suyo: un log verde no vale para ninguno de los dos.
    for (const kind of ['engine', 'offline']) {
      const result = evaluateDrillVerdict({ kind, code: 2, log: LOG_VERDE });

      expect(result.ok).toBe(false);
    }
  });

  it('pone en rojo el código 2 sin log', () => {
    for (const log of [null, undefined, '', '   ']) {
      const result = evaluateDrillVerdict({ kind: 'engine', code: 2, log });

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('no hay log');
    }
  });

  it('rechaza un ensayo desconocido', () => {
    const result = evaluateDrillVerdict({ kind: 'cualquiera', code: 2, log: LOG_MOTOR });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('ensayo desconocido');
  });

  it('rechaza un código que no es un entero', () => {
    for (const code of [undefined, null, '2', 2.5, NaN]) {
      const result = evaluateDrillVerdict({ kind: 'engine', code, log: LOG_MOTOR });

      expect(result.ok).toBe(false);
      expect(result.reason).toContain('código de salida utilizable');
    }
  });
});
