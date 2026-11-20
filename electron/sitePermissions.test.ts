import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  decodeStore,
  decidePermission,
  loadPermissionStore,
  normalizeOrigin,
  permissionPrompt,
  recordPermission,
  savePermissionStore,
} from './sitePermissions.cjs';

const tempDirs: string[] = [];

const tempFile = (name = 'permissions.json') => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminus-perms-'));
  tempDirs.push(dir);
  return path.join(dir, name);
};

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('site permissions', () => {
  it('asks only for the permissions a browser asks about', () => {
    expect(decidePermission({}, 'https://a.test', 'media')).toBe('ask');
    expect(decidePermission({}, 'https://a.test', 'geolocation')).toBe('ask');
    expect(decidePermission({}, 'https://a.test', 'notifications')).toBe('ask');
    expect(decidePermission({}, 'https://a.test', 'clipboard-read')).toBe('ask');
    // Nada de pantalla completa, sensores ni luces: se niega sin preguntar.
    expect(decidePermission({}, 'https://a.test', 'midi')).toBe('deny');
    expect(decidePermission({}, 'https://a.test', 'idle-detection')).toBe('deny');
  });

  it('keeps the answer per origin and permission', () => {
    const store = recordPermission({}, 'https://a.test', 'notifications', 'allow');

    expect(decidePermission(store, 'https://a.test', 'notifications')).toBe('allow');
    // El permiso concedido a un origen no habilita otro, ni otro permiso.
    expect(decidePermission(store, 'https://b.test', 'notifications')).toBe('ask');
    expect(decidePermission(store, 'https://a.test', 'media')).toBe('ask');
  });

  it('remembers a denial too', () => {
    const store = recordPermission({}, 'https://a.test', 'geolocation', 'deny');

    expect(decidePermission(store, 'https://a.test', 'geolocation')).toBe('deny');
  });

  it('re-reads the file on startup and drops corrupt entries', () => {
    const file = tempFile();
    fs.writeFileSync(
      file,
      JSON.stringify({
        'https://a.test|notifications': 'allow',
        'https://a.test|geolocation': 'deny',
        // Basura que un archivo editado a mano podría dejar: se descarta entera.
        'https://b.test|notifications': 'maybe',
        'not-an-origin|notifications': 'allow',
        'https://c.test|midi': 'allow',
        'sin-separador': 'allow',
      })
    );

    const store = loadPermissionStore(file);

    expect(store).toEqual({
      'https://a.test|notifications': 'allow',
      'https://a.test|geolocation': 'deny',
    });
  });

  it('survives a missing or broken file', () => {
    expect(loadPermissionStore(tempFile('missing.json'))).toEqual({});

    const broken = tempFile('broken.json');
    fs.writeFileSync(broken, '{ no es json');
    expect(loadPermissionStore(broken)).toEqual({});

    expect(decodeStore(null)).toEqual({});
    expect(decodeStore('texto')).toEqual({});
  });

  it('round-trips through disk', () => {
    const file = tempFile();
    const store = recordPermission({}, 'http://127.0.0.1:8787', 'media', 'allow');

    expect(savePermissionStore(file, store)).toBe(true);
    expect(loadPermissionStore(file)).toEqual(store);
    expect(decidePermission(loadPermissionStore(file), 'http://127.0.0.1:8787', 'media')).toBe('allow');
  });

  it('only accepts http(s) origins', () => {
    expect(normalizeOrigin('https://a.test/path')).toBe('https://a.test');
    expect(normalizeOrigin('file:///C:/Windows')).toBe('');
    expect(normalizeOrigin('about:blank')).toBe('');
    expect(normalizeOrigin('')).toBe('');
    expect(decidePermission({}, 'file:///C:/Windows', 'media')).toBe('deny');
  });

  it('writes the native dialog in Spanish and English', () => {
    const spanish = permissionPrompt('es-419', 'https://a.test', 'media');
    expect(spanish.message).toContain('https://a.test');
    expect(spanish.message).toContain('cámara');
    expect(spanish.buttons).toEqual(['Permitir', 'Bloquear']);

    const english = permissionPrompt('en-US', 'https://a.test', 'notifications');
    expect(english.message).toContain('notifications');
    expect(english.buttons).toEqual(['Allow', 'Block']);
  });
});
