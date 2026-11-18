import { describe, expect, it } from 'vitest';
import { EXIT_NETWORK, EXIT_OK, EXIT_REGRESSION, classifyAdblockExit } from './adblock-exit.mjs';

describe('códigos del E2E de adblock', () => {
  it('los tres códigos con significado son los del guion', () => {
    expect([EXIT_OK, EXIT_REGRESSION, EXIT_NETWORK]).toEqual([0, 1, 2]);
    expect(classifyAdblockExit(0)).toBe('ok');
    expect(classifyAdblockExit(1)).toBe('regression');
    expect(classifyAdblockExit(2)).toBe('network');
  });

  it('cualquier otro código es un fallo sin clasificación', () => {
    for (const code of [-1, 3, 127, 134]) {
      expect(classifyAdblockExit(code)).toBe('unexpected');
    }
  });

  it('sin un código utilizable no se inventa una clasificación', () => {
    for (const code of [undefined, null, '2', 2.5, NaN]) {
      expect(classifyAdblockExit(code)).toBe('unknown');
    }
  });
});
