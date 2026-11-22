import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadStore, readManifest, saveStore } from './browserExtensionStore.cjs';

const dirs: string[] = [];

const makeExtension = (manifest: Record<string, unknown>): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminus-ext-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
};

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('catálogo de extensiones', () => {
  it('lee un manifiesto MV3 válido', () => {
    const dir = makeExtension({ name: 'Demo', version: '1.2.3', manifest_version: 3 });

    expect(readManifest(dir)).toEqual({ name: 'Demo', version: '1.2.3', manifestVersion: 3 });
  });

  it('rechaza carpetas sin manifiesto o con versión desconocida', () => {
    const dir = makeExtension({ name: 'Demo', version: '1.0.0', manifest_version: 1 });

    expect(readManifest(path.join(dir, 'missing'))).toBeNull();
    expect(readManifest(dir)).toBeNull();
  });

  it('guarda y relee solo rutas e ids, sin duplicados', () => {
    const first = makeExtension({ name: 'Uno', version: '1.0.0', manifest_version: 3 });
    const second = makeExtension({ name: 'Dos', version: '2.0.0', manifest_version: 2 });
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'terminus-ext-store-')), 'store.json');

    saveStore(file, [
      { path: first, id: 'ext-one', name: 'Uno', version: '1.0.0', manifestVersion: 3 },
      { path: first, id: 'ext-one', name: 'Uno', version: '1.0.0', manifestVersion: 3 },
      { path: second, id: '', name: 'Dos', version: '2.0.0', manifestVersion: 2 },
    ]);

    const loaded = loadStore(file);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]).toMatchObject({ path: first, id: 'ext-one', name: 'Uno' });
    expect(loaded[1]).toMatchObject({ path: second, name: 'Dos' });
    expect(loaded[1].id).toBeUndefined();

    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });
});
