'use strict';

/**
 * Permisos de los sitios: qué se puede preguntar, qué se recuerda y con qué texto
 * se pregunta. Todo lo de aquí es puro para poder probarlo sin Electron; el
 * diálogo y las sesiones viven en `nativeBrowser.cjs`.
 *
 * La regla es la de un navegador: cámara y micrófono, ubicación, notificaciones y
 * lectura del portapapeles se preguntan una vez por origen; el resto se niega sin
 * molestar. Sin entrada en el almacén la respuesta es «preguntar» (`ask`).
 */

const ASKABLE_PERMISSIONS = new Set(['media', 'geolocation', 'notifications', 'clipboard-read']);
const DECISIONS = new Set(['allow', 'deny']);

/** Origen http(s) del que se pide el permiso; cualquier otra cosa no se pregunta. */
const normalizeOrigin = (value) => {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : '';
  } catch {
    return '';
  }
};

const permissionKey = (origin, permission) => `${origin}|${permission}`;

/** Descarta entradas corruptas, permisos desconocidos y orígenes que no son http(s). */
const decodeStore = (raw) => {
  const store = {};
  if (!raw || typeof raw !== 'object') return store;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key !== 'string' || !DECISIONS.has(value)) continue;
    const separator = key.lastIndexOf('|');
    if (separator <= 0) continue;
    const origin = key.slice(0, separator);
    const permission = key.slice(separator + 1);
    if (!ASKABLE_PERMISSIONS.has(permission)) continue;
    if (normalizeOrigin(origin) !== origin) continue;
    store[permissionKey(origin, permission)] = value;
  }
  return store;
};

/** `allow`, `deny` o `ask`: lo que hay guardado para ese origen y permiso. */
const decidePermission = (store, origin, permission) => {
  if (!ASKABLE_PERMISSIONS.has(permission)) return 'deny';
  const safeOrigin = normalizeOrigin(origin);
  if (!safeOrigin) return 'deny';
  const value = store?.[permissionKey(safeOrigin, permission)];
  return value === 'allow' || value === 'deny' ? value : 'ask';
};

/** Devuelve un almacén nuevo: la respuesta de un origen no habilita otro. */
const recordPermission = (store, origin, permission, decision) => {
  const next = { ...(store || {}) };
  const safeOrigin = normalizeOrigin(origin);
  if (!safeOrigin || !ASKABLE_PERMISSIONS.has(permission) || !DECISIONS.has(decision)) return next;
  next[permissionKey(safeOrigin, permission)] = decision;
  return next;
};

/**
 * Texto del diálogo nativo. No pasa por `src/i18n` porque lo dibuja Electron:
 * español para `es-*`, inglés para el resto.
 */
const permissionPrompt = (locale, origin, permission) => {
  const spanish = /^es/i.test(String(locale || ''));
  const names = spanish
    ? {
        media: 'la cámara y el micrófono',
        geolocation: 'tu ubicación',
        notifications: 'notificaciones',
        'clipboard-read': 'el portapapeles',
      }
    : {
        media: 'your camera and microphone',
        geolocation: 'your location',
        notifications: 'notifications',
        'clipboard-read': 'your clipboard',
      };
  const what = names[permission] || (spanish ? 'este permiso' : 'this permission');
  return {
    message: spanish
      ? `¿Permitir que ${origin} use ${what}?`
      : `Allow ${origin} to use ${what}?`,
    detail: spanish
      ? 'La respuesta se recuerda para este sitio.'
      : 'The answer is remembered for this site.',
    buttons: spanish ? ['Permitir', 'Bloquear'] : ['Allow', 'Block'],
  };
};

const loadPermissionStore = (filePath, fs = require('node:fs')) => {
  try {
    return decodeStore(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    // Sin archivo, ilegible o corrupto: nadie ha decidido nada todavía.
    return {};
  }
};

const savePermissionStore = (filePath, store, fs = require('node:fs')) => {
  try {
    fs.mkdirSync(require('node:path').dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
};

module.exports = {
  ASKABLE_PERMISSIONS,
  decodeStore,
  decidePermission,
  loadPermissionStore,
  normalizeOrigin,
  permissionKey,
  permissionPrompt,
  recordPermission,
  savePermissionStore,
};
