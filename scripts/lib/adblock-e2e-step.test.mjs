import { describe, expect, it } from 'vitest';
import { NETWORK_REASONS, decideE2eStep } from './adblock-e2e-step.mjs';

describe('paso del E2E de adblock', () => {
  it('código 0 deja el paso verde y no escribe salidas', () => {
    const step = decideE2eStep({ code: 0 });

    expect(step.exitCode).toBe(0);
    expect(step.skipped).toBe(false);
    expect(step.warning).toBeNull();
  });

  it('código 2 deja el paso verde, avisa y marca la omisión', () => {
    const step = decideE2eStep({ code: 2 });

    expect(step.exitCode).toBe(0);
    expect(step.skipped).toBe(true);
    expect(step.warning).toBe(NETWORK_REASONS.real);
  });

  it('con adblock_offline el aviso es el del ensayo pedido', () => {
    const step = decideE2eStep({ code: 2, offline: true });

    expect(step.exitCode).toBe(0);
    expect(step.warning).toBe(NETWORK_REASONS.forced);
  });

  it('una regresión (código 1) pone el paso rojo', () => {
    const step = decideE2eStep({ code: 1 });

    expect(step.exitCode).toBe(1);
    expect(step.skipped).toBe(false);
    expect(step.warning).toBeNull();
  });

  it('un código inesperado pone el paso rojo con ese código', () => {
    expect(decideE2eStep({ code: 134 }).exitCode).toBe(134);
    expect(decideE2eStep({ code: -1 }).exitCode).toBe(-1);
  });

  it('sin código utilizable el paso también sale rojo', () => {
    for (const code of [undefined, null, '2']) {
      expect(decideE2eStep({ code }).exitCode).toBe(1);
    }
  });
});
