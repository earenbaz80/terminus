'use strict';

/**
 * Extensiones de navegador desempaquetadas: se cargan en cada sesión de sitio
 * (y en la compartida) con `session.loadExtension`. Electron soporta un
 * subconjunto de la API de Chrome y no hay actualizaciones automáticas: la
 * carpeta la elige el usuario y el catálogo solo guarda su ruta.
 */

const { app, session } = require('electron');
const path = require('node:path');
const {
  STORE_FILENAME,
  loadStore,
  normalizeEntries,
  readManifest,
  saveStore,
} = require('./browserExtensionStore.cjs');

let entries = null;
// Qué rutas ya se cargaron en cada sesión, para no repetir `loadExtension`.
const sessionLoads = new WeakMap();

const storeFile = () => path.join(app.getPath('userData'), STORE_FILENAME);

const getEntries = () => {
  if (!entries) entries = loadStore(storeFile());
  return entries;
};

const persist = () => saveStore(storeFile(), getEntries());

const sessionSet = (target) => {
  if (!sessionLoads.has(target)) sessionLoads.set(target, new Set());
  return sessionLoads.get(target);
};

const listBrowserExtensions = () =>
  getEntries().map(({ path: dir, id, name, version, manifestVersion }) => ({
    path: dir,
    id,
    name,
    version,
    manifestVersion,
  }));

const sessionsToConfigure = () => {
  const list = [session.defaultSession];
  try {
    const { listNativeSessions } = require('./nativeBrowser.cjs');
    list.push(...listNativeSessions());
  } catch {
    // Sin invitados todavía: la sesión por defecto alcanza.
  }
  return [...new Set(list)];
};

/** Carga las extensiones guardadas en una sesión; repetir la llamada no duplica. */
const loadBrowserExtensionsIntoSession = async (target) => {
  if (!target) return;
  const loaded = sessionSet(target);
  for (const entry of getEntries()) {
    if (loaded.has(entry.path)) continue;
    try {
      const extension = await target.loadExtension(entry.path, { allowFileAccess: true });
      loaded.add(entry.path);
      if (extension?.id && extension.id !== entry.id) {
        entry.id = extension.id;
        persist();
      }
    } catch (error) {
      // Una extensión incompatible no puede tumbar la sesión que la contiene.
      loaded.add(entry.path);
      console.warn('[Terminus] Extensión no cargada:', entry.path, error?.message || error);
    }
  }
};

const loadIntoOpenSessions = async () => {
  for (const target of sessionsToConfigure()) {
    await loadBrowserExtensionsIntoSession(target);
  }
};

const addBrowserExtension = async (dir) => {
  const manifest = readManifest(dir);
  if (!manifest) return { ok: false, error: 'manifest' };

  const current = getEntries();
  if (!current.some((entry) => entry.path === dir)) {
    current.push({ path: dir, id: undefined, ...manifest });
    entries = normalizeEntries(current);
    persist();
  }
  await loadIntoOpenSessions();
  return { ok: true, extensions: listBrowserExtensions() };
};

const removeBrowserExtension = async (idOrPath) => {
  const entry = getEntries().find(
    (candidate) => candidate.id === idOrPath || candidate.path === idOrPath
  );
  if (!entry) return { ok: false, error: 'not-found' };

  entries = getEntries().filter((candidate) => candidate !== entry);
  persist();

  for (const target of sessionsToConfigure()) {
    try {
      sessionSet(target).delete(entry.path);
      if (entry.id) target.removeExtension(entry.id);
    } catch {
      // La sesión pudo cerrarse entre la lista y la retirada.
    }
  }
  return { ok: true, extensions: listBrowserExtensions() };
};

module.exports = {
  addBrowserExtension,
  listBrowserExtensions,
  loadBrowserExtensionsIntoSession,
  removeBrowserExtension,
};
