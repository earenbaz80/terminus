import { describe, expect, it } from 'vitest';
import { siteSessionsForExtensions } from './browserExtensionSessions.cjs';

describe('sesiones para extensiones', () => {
  it('nunca devuelve la sesión por defecto, aunque venga en la lista', () => {
    const defaultSession = { id: 'default' };
    const siteA = { id: 'site-a' };
    const siteB = { id: 'site-b' };

    expect(
      siteSessionsForExtensions({
        defaultSession,
        siteSessions: [defaultSession, siteA, siteB],
      })
    ).toEqual([siteA, siteB]);
  });

  it('deduplica las sesiones de sitio y descarta nulos', () => {
    const site = { id: 'site' };

    expect(
      siteSessionsForExtensions({
        defaultSession: { id: 'default' },
        siteSessions: [site, site, null, undefined],
      })
    ).toEqual([site]);
  });

  it('sin sesiones de sitio no devuelve nada', () => {
    expect(siteSessionsForExtensions({ defaultSession: { id: 'default' } })).toEqual([]);
  });
});
