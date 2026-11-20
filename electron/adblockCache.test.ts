import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { FiltersEngine } from '@ghostery/adblocker';

/**
 * Contrato de caché de @ghostery/adblocker: `fromLists(fetch, urls, config,
 * caching)` recibe el objeto `Caching` como CUARTO argumento. El primer arranque
 * descarga las listas y escribe el motor serializado; el segundo lo lee del
 * disco sin tocar la red.
 */
const LIST_TEXT = '||ads.example^$script\n##.ad-banner\n';

const responseWith = (body: string) =>
  ({ text: async () => body }) as unknown as Response;

describe('adblock cache', () => {
  it('escribe el motor serializado y lo reutiliza sin red', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'terminus-adblock-cache-'));
    const cachePath = path.join(directory, 'adblock-engine.bin');
    const caching = {
      path: cachePath,
      read: (file: string) => readFile(file),
      write: (file: string, buffer: Uint8Array) => writeFile(file, buffer),
    };

    try {
      const firstCalls: string[] = [];
      const firstFetch = async (url: string) => {
        firstCalls.push(url);
        return responseWith(url.endsWith('resources.json') ? '[]' : LIST_TEXT);
      };

      const first = await FiltersEngine.fromLists(
        firstFetch as unknown as typeof fetch,
        ['https://lists.example/easylist.txt'],
        {},
        caching
      );

      expect(firstCalls.length).toBeGreaterThan(0);
      const serialized = await readFile(cachePath);
      expect(serialized.byteLength).toBeGreaterThan(0);
      expect(first.serialize().byteLength).toBeGreaterThan(0);

      // Sin red: si la caché no se leyera, este fetch haría fallar la creación.
      const offlineCalls: string[] = [];
      const offlineFetch = async (url: string) => {
        offlineCalls.push(url);
        throw new Error(`sin red: ${url}`);
      };

      const second = await FiltersEngine.fromLists(
        offlineFetch as unknown as typeof fetch,
        ['https://lists.example/easylist.txt'],
        {},
        caching
      );

      expect(offlineCalls).toHaveLength(0);
      expect(second.serialize().byteLength).toBe(first.serialize().byteLength);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
