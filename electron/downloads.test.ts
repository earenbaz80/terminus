import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  DOWNLOAD_DIR_ENV,
  MAX_ITEMS,
  attachDownloadHandler,
  createDownloadStore,
  isFinalState,
  progressPercent,
  safeDownloadName,
  uniqueFilePath,
} = require('./downloads.cjs') as {
  DOWNLOAD_DIR_ENV: string;
  MAX_ITEMS: number;
  attachDownloadHandler: (options: {
    session: EventEmitter;
    store: ReturnType<typeof createDownloadStoreFactory>;
    notify?: (items: unknown[]) => void;
    downloadDir?: string | null;
    saveDialogTitle?: string;
    unique?: (directory: string, name: string) => string;
  }) => () => void;
  createDownloadStore: typeof createDownloadStoreFactory;
  isFinalState: (state: unknown) => boolean;
  progressPercent: (received: number, total: number) => number | null;
  safeDownloadName: (raw: unknown, fallback?: string) => string;
  uniqueFilePath: (
    directory: string,
    name: string,
    exists?: (file: string) => boolean,
  ) => string;
};

interface StoreEntry {
  id: string;
  name: string;
  url: string;
  host: string;
  state: string;
  received: number;
  total: number;
  percent: number | null;
  savePath: string;
  startedAt: number;
  endedAt: number | null;
  error: string;
}

interface Store {
  list: () => StoreEntry[];
  add: (input?: { name?: string; url?: string; state?: string }) => string;
  update: (id: string, patch?: Partial<StoreEntry>) => StoreEntry | null;
  find: (id: string) => StoreEntry | null;
  registerCancel: (id: string, cancel: () => void) => void;
  cancel: (id: string) => boolean;
  forgetCancel: (id: string) => void;
}

function createDownloadStoreFactory(options?: { limit?: number; now?: () => number }): Store {
  return createDownloadStore(options) as Store;
}

/** Item de Electron falso: eventos más los getters que lee el handler. */
class FakeItem extends EventEmitter {
  filename: string;
  url: string;
  savePath = '';
  dialogOptions: { title?: string; defaultPath?: string } | null = null;
  received = 0;
  total = 0;
  cancel = vi.fn();

  constructor(filename = 'informe.pdf', url = 'https://example.test/informe.pdf') {
    super();
    this.filename = filename;
    this.url = url;
  }

  getFilename() {
    return this.filename;
  }

  getURL() {
    return this.url;
  }

  getSavePath() {
    return this.savePath;
  }

  setSavePath(value: string) {
    this.savePath = value;
  }

  setSaveDialogOptions(value: { title?: string; defaultPath?: string }) {
    this.dialogOptions = value;
  }

  getReceivedBytes() {
    return this.received;
  }

  getTotalBytes() {
    return this.total;
  }
}

const temporaryDirectories: string[] = [];
const makeTemporaryDirectory = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'terminus-downloads-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

/** Engancha el handler y devuelve el item que el proceso principal recibiría. */
const dispatchDownload = (
  options: { downloadDir?: string | null; item?: FakeItem } = {},
) => {
  const session = new EventEmitter();
  const store = createDownloadStoreFactory({ now: () => 1000 });
  const notify = vi.fn();
  const item = options.item ?? new FakeItem();
  attachDownloadHandler({
    session,
    store,
    notify,
    downloadDir: options.downloadDir ?? null,
  });
  session.emit('will-download', {}, item);
  return { session, store, notify, item, entry: store.list()[0] };
};

describe('descargas del navegador nativo', () => {
  it('nombra el archivo sin separadores, sin nombres reservados y conservando la extensión', () => {
    expect(safeDownloadName('../../etc/passwd')).not.toMatch(/[\\/]/);
    expect(safeDownloadName('C:\\Windows\\evil.exe')).not.toMatch(/[\\/:]/);
    expect(safeDownloadName('CON.txt')).toBe('_CON.txt');
    expect(safeDownloadName('   ')).toBe('descarga');
    expect(safeDownloadName(undefined, 'archivo.bin')).toBe('archivo.bin');
    expect(safeDownloadName('reporte<final>.pdf')).toBe('reporte_final_.pdf');

    const long = `${'a'.repeat(200)}.pdf`;
    const trimmed = safeDownloadName(long);
    expect(trimmed.length).toBeLessThanOrEqual(120);
    expect(trimmed.endsWith('.pdf')).toBe(true);
  });

  it('calcula el porcentaje solo con un total conocido', () => {
    expect(progressPercent(50, 100)).toBe(50);
    expect(progressPercent(0, 0)).toBeNull();
    expect(progressPercent(120, 100)).toBe(100);
    expect(progressPercent(10, -5)).toBeNull();
    expect(progressPercent(Number.NaN, 100)).toBeNull();
  });

  it('reconoce los tres estados finales', () => {
    expect(isFinalState('completed')).toBe(true);
    expect(isFinalState('cancelled')).toBe(true);
    expect(isFinalState('interrupted')).toBe(true);
    expect(isFinalState('progressing')).toBe(false);
  });

  it('no pisa un archivo existente: añade (1), (2)…', () => {
    const directory = makeTemporaryDirectory();
    const exists = (file: string) => fs.existsSync(file);
    expect(uniqueFilePath(directory, 'informe.pdf', exists)).toBe(path.join(directory, 'informe.pdf'));
    fs.writeFileSync(path.join(directory, 'informe.pdf'), 'x');
    expect(uniqueFilePath(directory, 'informe.pdf', exists)).toBe(
      path.join(directory, 'informe (1).pdf'),
    );
    fs.writeFileSync(path.join(directory, 'informe (1).pdf'), 'x');
    expect(uniqueFilePath(directory, 'informe.pdf', exists)).toBe(
      path.join(directory, 'informe (2).pdf'),
    );
    expect(uniqueFilePath(directory, 'sin-extension', exists)).toBe(
      path.join(directory, 'sin-extension'),
    );
  });

  it('guarda la lista en orden reciente, recorta el límite y sella el final', () => {
    const store = createDownloadStoreFactory({ limit: 2, now: () => 500 });
    const first = store.add({ name: 'uno.txt', url: 'https://example.test/uno.txt' });
    const second = store.add({ name: 'dos.txt', url: 'https://example.test/dos.txt' });
    const third = store.add({ name: 'tres.txt', url: 'https://example.test/tres.txt' });

    expect(store.list().map((item) => item.id)).toEqual([third, second]);
    expect(store.list()).toHaveLength(2);
    expect(MAX_ITEMS).toBeGreaterThanOrEqual(2);

    const updated = store.update(third, { received: 25, total: 100 });
    expect(updated?.percent).toBe(25);
    expect(updated?.endedAt).toBeNull();

    const done = store.update(third, { state: 'completed' });
    expect(done?.endedAt).toBe(500);
    expect(store.find(first)).toBeNull();
  });

  it('solo cancela descargas en curso y con handler registrado', () => {
    const store = createDownloadStoreFactory();
    const id = store.add({ name: 'lento.bin' });
    const cancel = vi.fn();

    expect(store.cancel(id)).toBe(false);
    store.registerCancel(id, cancel);
    expect(store.cancel(id)).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);

    store.update(id, { state: 'completed' });
    expect(store.cancel(id)).toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(store.cancel('dl-no-existe')).toBe(false);
  });

  it('sin carpeta forzada deja que Chromium abra su diálogo de guardado', () => {
    const { item, entry, notify } = dispatchDownload();

    expect(item.dialogOptions?.defaultPath).toBe('informe.pdf');
    expect(item.dialogOptions?.title).toBeTruthy();
    expect(item.savePath).toBe('');
    expect(entry?.name).toBe('informe.pdf');
    expect(entry?.host).toBe('example.test');
    expect(entry?.state).toBe('progressing');
    expect(notify).toHaveBeenCalled();
  });

  it('con carpeta forzada escribe ahí, sin diálogo', () => {
    const directory = makeTemporaryDirectory();
    const { item, entry } = dispatchDownload({ downloadDir: directory });

    expect(item.dialogOptions).toBeNull();
    expect(item.savePath).toBe(path.join(directory, 'informe.pdf'));
    expect(entry?.savePath).toBe(path.join(directory, 'informe.pdf'));
  });

  it('sigue el progreso y cierra con el estado del `done`', () => {
    const { item, store, notify } = dispatchDownload();
    const id = store.list()[0].id as string;

    item.total = 200;
    item.received = 50;
    item.emit('updated', {}, 'progressing');
    expect(store.find(id)?.percent).toBe(25);

    item.received = 200;
    item.emit('done', {}, 'completed');
    expect(store.find(id)?.state).toBe('completed');
    expect(store.find(id)?.percent).toBe(100);
    expect(store.find(id)?.error).toBe('');
    expect(notify).toHaveBeenCalledTimes(3);
  });

  it('distingue cancelada de interrumpida y deja de poder cancelarse', () => {
    const { item, store } = dispatchDownload();
    const id = store.list()[0].id as string;
    item.emit('done', {}, 'cancelled');
    expect(store.find(id)?.state).toBe('cancelled');
    expect(store.cancel(id)).toBe(false);

    const second = dispatchDownload();
    const otherId = second.store.list()[0].id as string;
    second.item.emit('done', {}, 'interrupted');
    expect(second.store.find(otherId)?.state).toBe('interrupted');
    expect(second.store.find(otherId)?.error).toMatch(/interrumpi/i);
  });

  it('el id de cancelación mata la transferencia de Electron', () => {
    const { item, store } = dispatchDownload();
    const id = store.list()[0].id as string;
    expect(store.cancel(id)).toBe(true);
    expect(item.cancel).toHaveBeenCalledTimes(1);
  });

  it('la variable de carpeta forzada tiene nombre estable', () => {
    expect(DOWNLOAD_DIR_ENV).toBe('TERMINUS_DOWNLOAD_DIR');
  });
});
