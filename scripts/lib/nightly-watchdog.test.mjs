import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_AGE_HOURS, evaluateNightlyRuns } from './nightly-watchdog.mjs';

const NOW = Date.parse('2026-11-15T09:00:00Z');
const hoursAgo = (hours) => new Date(NOW - hours * 60 * 60 * 1000).toISOString();

const run = (hours, overrides = {}) => ({
  id: Math.round(hours * 100),
  created_at: hoursAgo(hours),
  conclusion: 'success',
  status: 'completed',
  html_url: `https://github.com/earenbaz80/terminus/actions/runs/${Math.round(hours * 100)}`,
  ...overrides,
});

describe('watchdog del nocturno', () => {
  it('falla cuando no hay ninguna corrida programada', () => {
    const result = evaluateNightlyRuns([], { now: NOW });

    expect(result.ok).toBe(false);
    expect(result.problem).toBe('missing');
    expect(result.lastRun).toBeNull();
    expect(result.reason).toMatch(/no hay ninguna corrida programada/);
    expect(result.maxAgeHours).toBe(DEFAULT_MAX_AGE_HOURS);
  });

  it('una corrida reciente y verde mantiene la vigilancia viva', () => {
    const result = evaluateNightlyRuns([run(5)], { now: NOW });

    expect(result.ok).toBe(true);
    expect(result.problem).toBe('none');
    expect(result.lastRun.ageHours).toBe(5);
    expect(result.reason).toContain('límite 36 h');
    expect(result.reason).toContain('terminó en verde');
  });

  it('pasa del límite cuando la última es vieja', () => {
    const result = evaluateNightlyRuns([run(40)], { now: NOW });

    expect(result.ok).toBe(false);
    expect(result.problem).toBe('stale');
    expect(result.lastRun.ageHours).toBe(40);
    expect(result.reason).toContain('más que el límite de 36 h');
  });

  it('acepta justo el límite y rechaza una hora más', () => {
    expect(evaluateNightlyRuns([run(36)], { now: NOW }).ok).toBe(true);
    expect(evaluateNightlyRuns([run(37)], { now: NOW }).ok).toBe(false);
  });

  it('respeta una ventana distinta pedida a mano', () => {
    expect(evaluateNightlyRuns([run(100)], { now: NOW, maxAgeHours: 120 }).ok).toBe(true);
    expect(evaluateNightlyRuns([run(100)], { now: NOW, maxAgeHours: 48 }).ok).toBe(false);
  });

  it('mira la más reciente aunque lleguen desordenadas', () => {
    const result = evaluateNightlyRuns([run(50), run(2), run(26)], { now: NOW });

    expect(result.ok).toBe(true);
    expect(result.lastRun.ageHours).toBe(2);
    expect(result.runs).toHaveLength(3);
  });

  it('falla cuando la última corrida terminó en rojo', () => {
    // Antes el watchdog solo vigilaba que el cron disparase: los nocturnos del
    // 16 y 17 de noviembre estuvieron rojos y nadie lo vio. Un rojo es un
    // veredicto, no un disparo vivo.
    const result = evaluateNightlyRuns([run(6, { conclusion: 'failure' })], { now: NOW });

    expect(result.ok).toBe(false);
    expect(result.problem).toBe('red');
    expect(result.reason).toContain('failure');
    expect(result.reason).toContain('https://github.com/earenbaz80/terminus/actions/runs/600');
  });

  it('trata como rojo cualquier final que no sea success', () => {
    for (const conclusion of ['cancelled', 'timed_out', 'action_required', 'neutral']) {
      const result = evaluateNightlyRuns([run(6, { conclusion })], { now: NOW });

      expect(result.ok).toBe(false);
      expect(result.problem).toBe('red');
      expect(result.reason).toContain(conclusion);
    }
  });

  it('una corrida en curso cuenta como disparo vivo', () => {
    for (const status of ['in_progress', 'queued']) {
      const result = evaluateNightlyRuns([run(2, { conclusion: null, status })], { now: NOW });

      expect(result.ok).toBe(true);
      expect(result.problem).toBe('none');
      expect(result.reason).toContain(status);
    }
  });

  it('la antigüedad gana al color cuando el cron lleva días parado', () => {
    const result = evaluateNightlyRuns([run(60, { conclusion: 'failure' })], { now: NOW });

    expect(result.ok).toBe(false);
    expect(result.problem).toBe('stale');
    expect(result.reason).toContain('más que el límite de 36 h');
  });

  it('un rojo de ayer se reporta como rojo aunque haya corridas más nuevas en curso', () => {
    const result = evaluateNightlyRuns(
      [run(30, { conclusion: 'failure' }), run(20, { conclusion: null, status: 'in_progress' })],
      { now: NOW },
    );

    expect(result.ok).toBe(true);
    expect(result.reason).toContain('in_progress');
  });

  it('ignora entradas sin fecha utilizable', () => {
    const result = evaluateNightlyRuns([{ id: 1 }, { created_at: 'no es una fecha' }, run(4)], { now: NOW });

    expect(result.ok).toBe(true);
    expect(result.runs).toHaveLength(1);
  });

  it('admite el instante actual como Date', () => {
    const result = evaluateNightlyRuns([run(10)], { now: new Date(NOW) });

    expect(result.ok).toBe(true);
    expect(result.lastRun.ageHours).toBe(10);
  });
});
