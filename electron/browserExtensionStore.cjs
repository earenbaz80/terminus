'use strict';

/**
 * Helpers puros del catálogo de extensiones de navegador. No tocan Electron:
 * leen el `manifest.json` de una carpeta desempaquetada y guardan solo la ruta
 * y el id que devuelve Chromium, para poder probarlos con Vitest.
 */

const fs = require('node:fs');
const path = require('node:path');

const STORE_FILENAME = 'browser-extensions.json';

const normalizePath = (value) => {
  if (typeof value !== 'string' || !value.trim()) return '';
  return path.resolve(value.trim());
};

/** Nombre y versión visibles; los manifiestos localizados usan `__MSG_*__`. */
const displayName = (manifest, dir) =>
  typeof manifest.name === 'string' && manifest.name.trim() && !manifest.name.startsWith('__MSG_')
    ? manifest.name.trim().slice(0, 120)
    : path.basename(dir).slice(0, 120);

const displayVersion = (manifest) =>
  typeof manifest.version === 'string' && manifest.version.trim() && !manifest.version.startsWith('__MSG_')
    ? manifest.version.trim().slice(0, 40)
    : '0';

/**
 * Devuelve los datos que la interfaz necesita de una extensión, o null si la
 * carpeta no tiene un manifiesto MV2/MV3 utilizable.
 */
const readManifest = (dir) => {
  try {
    const raw = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(raw);
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return null;
    const manifestVersion = Number(manifest.manifest_version);
    if (manifestVersion !== 2 && manifestVersion !== 3) return null;
    if (typeof manifest.name !== 'string' || !manifest.name.trim()) return null;
    if (typeof manifest.version !== 'string' || !manifest.version.trim()) return null;
    return {
      name: displayName(manifest, dir),
      version: displayVersion(manifest),
      manifestVersion,
    };
  } catch {
    return null;
  }
};

/** Acepta `{ extensions: [...] }` o un array; deduplica y descarta lo ilegible. */
const normalizeEntries = (value) => {
  const list = Array.isArray(value)
    ? value
    : Array.isArray(value?.extensions)
      ? value.extensions
      : [];
  const seen = new Set();
  const result = [];
  for (const entry of list) {
    const dir = normalizePath(entry?.path);
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    const manifest = readManifest(dir);
    if (!manifest) continue;
    result.push({
      path: dir,
      id: typeof entry?.id === 'string' && entry.id ? entry.id : undefined,
      ...manifest,
    });
  }
  return result;
};

const loadStore = (file) => {
  try {
    return normalizeEntries(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return [];
  }
};

const saveStore = (file, entries) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        extensions: entries.map((entry) => ({ path: entry.path, id: entry.id })),
      },
      null,
      2
    ),
    'utf8'
  );
};

module.exports = {
  STORE_FILENAME,
  normalizeEntries,
  readManifest,
  loadStore,
  saveStore,
};
