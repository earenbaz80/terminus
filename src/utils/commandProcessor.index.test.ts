import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrowserTab } from '../types';
import { processCommand, type CommandContext } from './commandProcessor';
import { translateConsole } from '../i18n';

const makeTab = () =>
  ({
    id: 'tab_1',
    kind: 'web',
    title: 'Inicio',
    url: 'about:blank',
    displayUrl: 'about:blank',
    history: [],
    historyIndex: 0,
    isLoading: false,
  }) as unknown as BrowserTab;

/** Solo lo que estos comandos tocan; el resto responde como estado vacío. */
const makeContext = () => {
  const seed: Record<string, unknown> = {
    activeTabId: 'tab_1',
    tabs: [makeTab()],
    activityLogs: [],
    locale: 'es',
    tc: (key: Parameters<typeof translateConsole>[1], vars?: Record<string, string | number>) =>
      translateConsole('es', key, vars),
  };
  return new Proxy(seed, {
    get: (target, prop) => {
      if (prop in target) return target[prop as string];
      return () => {};
    },
  }) as unknown as CommandContext;
};

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('indexar', () => {
  it('manda la URL al endpoint y resume el resultado', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({
      ok: true,
      seedUrl: 'https://example.com/',
      pagesVisited: 3,
      pagesIndexed: 2,
      pagesSkipped: 1,
      durationMs: 480,
      errors: [],
      index: { documents: 2 },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const log = await processCommand('indexar https://example.com/', makeContext());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/index');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toMatchObject({ url: 'https://example.com/' });
    expect(log.type).toBe('system');
    expect(log.output).toContain('2 páginas indexadas');
    expect(log.output).toContain('2 documentos');
  });

  it('sin argumentos muestra el estado del índice', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      ok: true,
      index: { documents: 7, hosts: ['example.com'], terms: 120, directory: '/tmp/idx' },
    })));

    const log = await processCommand('indexar', makeContext());

    expect(log.output).toContain('Documentos: 7');
    expect(log.output).toContain('example.com');
  });

  it('vacía el índice con DELETE cuando se pide "indexar vaciar"', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({
        ok: true,
        removed: { documents: 12, terms: 340 },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const log = await processCommand('indexar vaciar', makeContext());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/index');
    expect(init?.method).toBe('DELETE');
    expect(log.type).toBe('system');
    expect(log.output).toContain('12 documentos');
    expect(log.output).toContain('340 términos');
  });

  it('informa del error del servidor sin romper la terminal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(
      { error: 'invalid_url', message: 'Se esperaba una dirección http(s) válida.' },
      400
    )));

    const log = await processCommand('indexar no-es-una-url', makeContext());

    expect(log.type).toBe('stderr');
    expect(log.output).toContain('dirección http(s) válida');
  });
});

describe('buscar local', () => {
  it('consulta el índice y lista los resultados', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({
      ok: true,
      query: 'redes neuronales',
      results: [
        {
          url: 'https://example.com/redes',
          title: 'Redes neuronales',
          snippet: 'Las redes neuronales profundas…',
          host: 'example.com',
          score: 1.2,
        },
      ],
      index: { documents: 4 },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const log = await processCommand('buscar local redes neuronales', makeContext());

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/index?q=redes%20neuronales&limit=10');
    expect(log.type).toBe('system');
    expect(log.output).toContain('Redes neuronales');
    expect(log.output).toContain('https://example.com/redes');
  });

  it('no secuestra `search local`: sigue siendo búsqueda web', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ results: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await processCommand('search local redes', makeContext());

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/search?q=local%20redes');
  });

  it('sin consulta explica el uso y no llama al servidor', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const log = await processCommand('buscar local', makeContext());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(log.type).toBe('stderr');
    expect(log.output).toContain('buscar local');
  });
});
