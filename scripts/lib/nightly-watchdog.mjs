/**
 * Lógica del watchdog del nocturno.
 *
 * El CI tiene un cron diario (`30 3 * * *`) con las cuatro suites del E2E. Si
 * GitHub deja de dispararlo —el cron se desactiva por inactividad, el YAML deja
 * de validar, o alguien renombra el workflow— no hay nada en el repositorio que
 * lo note: simplemente dejan de existir corridas y el verde de los PRs sigue
 * tapando el hueco.
 *
 * Tampoco lo nota nadie si el nocturno dispara y sale rojo: no hay PR al que
 * comentar el resumen y el correo de GitHub es fácil de ignorar. Por eso el
 * veredicto mira las dos cosas, la antigüedad y la conclusión de esa última
 * corrida. Una corrida en curso cuenta como disparo vivo: el resultado lo dirá
 * la pasada siguiente.
 *
 * Este módulo decide, a partir de las corridas programadas del workflow de CI,
 * si la última es demasiado vieja o si terminó mal. Es puro para poder probarlo
 * sin red y sin depender del reloj real.
 */

export const DEFAULT_MAX_AGE_HOURS = 36;

const HOUR_MS = 60 * 60 * 1000;

/** Normaliza una corrida de la API a lo poco que hace falta aquí. */
function summarizeRun(run) {
  return {
    id: run.id ?? null,
    createdAt: run.created_at ?? run.createdAt ?? null,
    conclusion: run.conclusion ?? null,
    status: run.status ?? null,
    url: run.html_url ?? null,
  };
}

/**
 * @param {Array<object>} runs corridas ya filtradas por `event=schedule`
 * @param {{ now?: number | Date, maxAgeHours?: number }} [options]
 * @returns {{
 *   ok: boolean,
 *   problem: 'none' | 'missing' | 'stale' | 'red',
 *   maxAgeHours: number,
 *   lastRun: { id: number | null, createdAt: string, ageHours: number, conclusion: string | null, status: string | null, url: string | null } | null,
 *   runs: Array<object>,
 *   reason: string,
 * }}
 */
export function evaluateNightlyRuns(runs, { now = Date.now(), maxAgeHours = DEFAULT_MAX_AGE_HOURS } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const known = (Array.isArray(runs) ? runs : [])
    .map(summarizeRun)
    .filter((run) => run.createdAt && Number.isFinite(Date.parse(run.createdAt)))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));

  if (known.length === 0) {
    return {
      ok: false,
      problem: 'missing',
      maxAgeHours,
      lastRun: null,
      runs: [],
      reason: `no hay ninguna corrida programada registrada (máximo permitido: ${maxAgeHours} h entre corridas)`,
    };
  }

  const latest = known[0];
  const ageHours = (nowMs - Date.parse(latest.createdAt)) / HOUR_MS;
  const roundedAge = Math.round(ageHours * 10) / 10;
  const lastRun = { ...latest, ageHours: roundedAge };

  // La antigüedad manda sobre el color: si el cron lleva dos días parado, lo que
  // hay que arreglar es el disparo, no el último resultado.
  if (ageHours > maxAgeHours) {
    return {
      ok: false,
      problem: 'stale',
      maxAgeHours,
      lastRun,
      runs: known,
      reason: `la última corrida programada es de hace ${roundedAge} h, más que el límite de ${maxAgeHours} h`,
    };
  }

  // Sin conclusión todavía: disparó y sigue en curso (o en cola, o pidiendo un
  // runner). El disparo está vivo; el resultado no se puede juzgar aún.
  if (!latest.conclusion) {
    return {
      ok: true,
      problem: 'none',
      maxAgeHours,
      lastRun,
      runs: known,
      reason: `la última corrida programada es de hace ${roundedAge} h (límite ${maxAgeHours} h) y sigue ${latest.status ?? 'sin terminar'}`,
    };
  }

  if (latest.conclusion !== 'success') {
    return {
      ok: false,
      problem: 'red',
      maxAgeHours,
      lastRun,
      runs: known,
      reason: `la última corrida programada es de hace ${roundedAge} h y terminó en ${latest.conclusion}: ${latest.url ?? 'sin enlace'}`,
    };
  }

  return {
    ok: true,
    problem: 'none',
    maxAgeHours,
    lastRun,
    runs: known,
    reason: `la última corrida programada es de hace ${roundedAge} h (límite ${maxAgeHours} h) y terminó en verde`,
  };
}
