import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  advisoriesDe,
  AUDIT_WAIVERS,
  evaluarAudit,
  formatear,
  runCli,
  SEVERIDADES_QUE_FALLAN,
} from './audit-gate.mjs';

const WORKFLOW = () => readFileSync(join(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

const PERMITIDO = 'GHSA-fc5q-39xc-vjpf';

/** Informe mínimo con la forma que devuelve `npm audit --json`. */
function informe(vulnerabilidades) {
  return { auditReportVersion: 2, vulnerabilities: vulnerabilidades };
}

function vulnerable(nombre, severidad, advisories) {
  return {
    name: nombre,
    severity: severidad,
    via: advisories.map(({ id, titulo = 'advisory' }) => ({
      source: 1,
      name: nombre,
      dependency: nombre,
      title: titulo,
      url: `https://github.com/advisories/${id}`,
      severity: severidad,
    })),
  };
}

const AVISO_PERMITIDO = { id: PERMITIDO };
const OTRO_AVISO = { id: 'GHSA-aaaa-bbbb-cccc', titulo: 'Otro advisory de prueba' };

describe('puerta de npm audit', () => {
  it('deja pasar solo el advisory excluido y lo dice con su fecha de revisión', () => {
    const resultado = evaluarAudit(informe({ picomatch: vulnerable('picomatch', 'high', [AVISO_PERMITIDO]) }), {
      ahora: new Date('2026-11-18T12:00:00Z'),
    });

    expect(resultado.fallos).toEqual([]);
    expect(resultado.permitidos).toEqual([
      { id: PERMITIDO, paquete: 'picomatch', revisar: AUDIT_WAIVERS[0].revisar },
    ]);
    expect(formatear(resultado)).toContain('EXCLUIDO GHSA-fc5q-39xc-vjpf');
    expect(formatear(resultado)).toContain(AUDIT_WAIVERS[0].revisar);
  });

  it('falla con cualquier advisory nuevo de severidad moderate o mayor', () => {
    const resultado = evaluarAudit(
      informe({
        picomatch: vulnerable('picomatch', 'high', [AVISO_PERMITIDO]),
        otra: vulnerable('otra', 'moderate', [OTRO_AVISO]),
      }),
      { ahora: new Date('2026-11-18T12:00:00Z') }
    );

    expect(resultado.fallos).toEqual([
      {
        tipo: 'advisory',
        id: 'GHSA-aaaa-bbbb-cccc',
        paquete: 'otra',
        severidad: 'moderate',
        detalle: 'Otro advisory de prueba',
      },
    ]);
    expect(formatear(resultado)).toContain('FALLO GHSA-aaaa-bbbb-cccc');
  });

  it('ignora severidades por debajo del umbral estricto', () => {
    const resultado = evaluarAudit(informe({ baja: vulnerable('baja', 'low', [OTRO_AVISO]) }), {
      ahora: new Date('2026-11-18T12:00:00Z'),
    });

    expect(SEVERIDADES_QUE_FALLAN).toEqual(['moderate', 'high', 'critical']);
    expect(resultado.fallos).toEqual([]);
    expect(resultado.advisories).toHaveLength(1);
  });

  it('vuelve a fallar cuando la exclusión vence, aunque el advisory sea el mismo', () => {
    const resultado = evaluarAudit(
      informe({ picomatch: vulnerable('picomatch', 'high', [AVISO_PERMITIDO]) }),
      { ahora: new Date('2027-03-01T00:00:00Z') }
    );

    expect(resultado.permitidos).toEqual([]);
    expect(resultado.fallos).toHaveLength(1);
    expect(resultado.fallos[0]).toMatchObject({ tipo: 'vencido', id: PERMITIDO });
    expect(resultado.fallos[0].detalle).toContain(AUDIT_WAIVERS[0].revisar);
  });

  it('avisa si la exclusión ya no corresponde a ningún advisory', () => {
    const resultado = evaluarAudit(informe({}), {
      ahora: new Date('2026-11-18T12:00:00Z'),
    });

    expect(resultado.fallos).toEqual([]);
    expect(resultado.avisos).toHaveLength(AUDIT_WAIVERS.length);
    expect(formatear(resultado)).toContain('AVISO GHSA-fc5q-39xc-vjpf');
  });

  it('cuenta cada advisory una sola vez aunque lo repitan varios paquetes', () => {
    const avisos = advisoriesDe(
      informe({
        vite: vulnerable('vite', 'high', [AVISO_PERMITIDO]),
        tinyglobby: vulnerable('tinyglobby', 'high', [AVISO_PERMITIDO]),
      })
    );

    expect(avisos).toHaveLength(1);
    expect(avisos[0].id).toBe(PERMITIDO);
  });

  it('la CLI sale con 0 si solo queda lo excluido y con 1 si hay algo nuevo', async () => {
    const directorio = mkdtempSync(join(tmpdir(), 'audit-gate-'));
    const permitido = join(directorio, 'permitido.json');
    const nuevo = join(directorio, 'nuevo.json');

    try {
      writeFileSync(
        permitido,
        JSON.stringify(informe({ picomatch: vulnerable('picomatch', 'high', [AVISO_PERMITIDO]) }))
      );
      writeFileSync(
        nuevo,
        JSON.stringify(informe({ otra: vulnerable('otra', 'critical', [OTRO_AVISO]) }))
      );

      await expect(runCli([permitido])).resolves.toBe(0);
      await expect(runCli([nuevo])).resolves.toBe(1);
      await expect(runCli([join(directorio, 'no-existe.json')])).rejects.toThrow();
    } finally {
      rmSync(directorio, { recursive: true, force: true });
    }
  });

  it('no convierte un informe roto en un verde sin auditar', () => {
    const resultado = evaluarAudit({ error: 'ENOTFOUND registry.npmjs.org' }, {
      ahora: new Date('2026-11-18T12:00:00Z'),
    });

    expect(resultado.fallos).toHaveLength(1);
    expect(resultado.fallos[0].tipo).toBe('informe');
    expect(formatear(resultado)).toContain('npm audit no se completó');
  });

  it('el workflow conserva el nivel estricto y delega en el módulo', () => {
    const workflow = WORKFLOW();

    expect(workflow).toContain('npm audit --json');
    expect(workflow).toContain('node scripts/lib/audit-gate.mjs');
    expect(workflow).not.toContain('audit-level=high');
  });
});
