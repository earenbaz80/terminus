'use strict';

/**
 * Descargas reales de los sitios.
 *
 * Cada `will-download` de una sesión vigilada se convierte en una entrada de una
 * lista pequeña que el renderer pinta y puede cancelar. El módulo no requiere
 * `electron`: el proceso principal inyecta la carpeta de destino y el aviso al
 * renderer, así que toda la lógica —nombres seguros, progreso y transiciones—
 * se prueba con Vitest como el resto de la política del navegador.
 *
 * El diálogo de guardado es el de Chromium (`setSaveDialogOptions`), que se abre
 * antes de empezar a escribir; cuando `TERMINUS_DOWNLOAD_DIR` está definido se
 * guarda directo ahí, para que el E2E no dependa de pulsar una ventana nativa.
 */

/** Carpeta forzada: la usan el E2E y quien quiera descargas sin diálogo. */
const DOWNLOAD_DIR_ENV = 'TERMINUS_DOWNLOAD_DIR';
/** Cuántas descargas se recuerdan en la lista. */
const MAX_ITEMS = 50;
const MAX_NAME_LENGTH = 120;
/** Nombres que Windows no admite como fichero, con o sin extensión. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const FINAL_STATES = new Set(['completed', 'cancelled', 'interrupted']);

/**
 * Nombre de fichero seguro a partir del que propone el sitio: sin separadores ni
 * caracteres reservados, sin nombres de dispositivo de Windows y con la extensión
 * conservada al recortar.
 */
function safeDownloadName(raw, fallback = 'descarga') {
  let value = String(raw ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  value = value.replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (!value) value = fallback;
  if (WINDOWS_RESERVED.test(value)) value = `_${value}`;
  if (value.length > MAX_NAME_LENGTH) {
    const dot = value.lastIndexOf('.');
    const extension = dot > 0 && value.length - dot <= 10 ? value.slice(dot) : '';
    value = `${value.slice(0, MAX_NAME_LENGTH - extension.length)}${extension}`;
  }
  return value;
}

/** Porcentaje entero de 0 a 100, o `null` mientras el sitio no anuncia el total. */
function progressPercent(received, total) {
  const done = Number(received);
  const size = Number(total);
  if (!Number.isFinite(done) || !Number.isFinite(size) || size <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((done / size) * 100)));
}

const isFinalState = (state) => FINAL_STATES.has(String(state));

const hostOfUrl = (url) => {
  try {
    return new URL(String(url)).hostname;
  } catch {
    return '';
  }
};

/** Estado que se puede mandar por IPC: sin objetos de Electron dentro. */
function createDownloadStore({ limit = MAX_ITEMS, now = () => Date.now() } = {}) {
  const items = [];
  const cancels = new Map();
  let sequence = 0;
  const find = (id) => items.find((entry) => entry.id === id) || null;

  const list = () => items.map((item) => ({ ...item }));

  const add = ({ name, url = '', state = 'progressing' } = {}) => {
    sequence += 1;
    const id = `dl-${sequence}`;
    items.unshift({
      id,
      name: safeDownloadName(name),
      url: String(url),
      host: hostOfUrl(url),
      state,
      received: 0,
      total: 0,
      percent: null,
      savePath: '',
      startedAt: now(),
      endedAt: null,
      error: '',
    });
    if (items.length > limit) items.length = limit;
    return id;
  };

  const update = (id, patch = {}) => {
    const item = find(id);
    if (!item) return null;
    Object.assign(item, patch);
    if ('received' in patch || 'total' in patch) {
      item.percent = progressPercent(item.received, item.total);
    }
    if (isFinalState(item.state) && item.endedAt === null) item.endedAt = now();
    return item;
  };

  const registerCancel = (id, cancel) => {
    if (typeof cancel === 'function') cancels.set(id, cancel);
  };

  const cancel = (id) => {
    const handler = cancels.get(id);
    const item = find(id);
    if (!handler || !item || isFinalState(item.state)) return false;
    try {
      handler();
    } catch {
      return false;
    }
    return true;
  };

  const forgetCancel = (id) => cancels.delete(id);

  return { list, add, update, find, registerCancel, cancel, forgetCancel };
}

/** Primer nombre libre: `informe.pdf`, `informe (1).pdf`, … dentro de la carpeta. */
function uniqueFilePath(directory, name, exists = (file) => require('node:fs').existsSync(file)) {
  const base = safeDownloadName(name);
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const extension = dot > 0 ? base.slice(dot) : '';
  const path = require('node:path');
  let candidate = path.join(directory, base);
  for (let attempt = 1; exists(candidate) && attempt <= 99; attempt += 1) {
    candidate = path.join(directory, `${stem} (${attempt})${extension}`);
  }
  return candidate;
}

/**
 * Engancha `will-download` en una sesión. Idempotente por llamada: el proceso
 * principal decide qué sesiones vigila y no repite las que ya tienen handler.
 *
 * `downloadDir` fuerza el destino (sin diálogo); sin él, Chromium abre su diálogo
 * de guardado con el nombre del sitio como propuesta.
 */
function attachDownloadHandler({
  session,
  store,
  notify = () => {},
  downloadDir = null,
  saveDialogTitle = 'Guardar descarga',
  unique = uniqueFilePath,
} = {}) {
  if (!session || typeof session.on !== 'function' || !store) return () => {};

  const onWillDownload = (_event, item) => {
    const url = typeof item.getURL === 'function' ? item.getURL() : '';
    const id = store.add({ name: item.getFilename?.(), url });

    if (downloadDir) {
      try {
        item.setSavePath(unique(downloadDir, item.getFilename?.() || 'descarga'));
      } catch {
        // Sin `setSavePath` el diálogo de abajo sigue siendo válido.
      }
    }
    if (typeof item.setSaveDialogOptions === 'function' && (!downloadDir || !item.getSavePath?.())) {
      item.setSaveDialogOptions({
        title: saveDialogTitle,
        defaultPath: safeDownloadName(item.getFilename?.() || 'descarga'),
      });
    }

    store.registerCancel(id, () => item.cancel?.());
    store.update(id, { savePath: typeof item.getSavePath === 'function' ? item.getSavePath() || '' : '' });
    notify(store.list());

    item.on?.('updated', (_updatedEvent, state) => {
      if (state !== 'progressing') return;
      store.update(id, {
        state: 'progressing',
        received: item.getReceivedBytes?.() ?? 0,
        total: item.getTotalBytes?.() ?? 0,
      });
      notify(store.list());
    });

    item.once?.('done', (_doneEvent, state) => {
      const finalState =
        state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted';
      store.update(id, {
        state: finalState,
        received: item.getReceivedBytes?.() ?? 0,
        total: item.getTotalBytes?.() ?? 0,
        savePath: (typeof item.getSavePath === 'function' ? item.getSavePath() : '') || store.find(id)?.savePath || '',
        error: finalState === 'interrupted' ? 'La descarga se interrumpió.' : '',
      });
      store.forgetCancel(id);
      notify(store.list());
    });
  };

  session.on('will-download', onWillDownload);
  return () => {
    if (typeof session.removeListener === 'function') session.removeListener('will-download', onWillDownload);
    else if (typeof session.off === 'function') session.off('will-download', onWillDownload);
  };
}

module.exports = {
  DOWNLOAD_DIR_ENV,
  MAX_ITEMS,
  attachDownloadHandler,
  createDownloadStore,
  isFinalState,
  progressPercent,
  safeDownloadName,
  uniqueFilePath,
};
