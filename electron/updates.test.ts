import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  compareVersions,
  isUpdateMode,
  updateAssets,
  parseSums,
  matchesSha256Digest,
  downloadToFile,
  cleanupUpdateAssets,
  checkForUpdate,
} = require('./updates.cjs') as {
  compareVersions: (left: string, right: string) => number;
  isUpdateMode: (value: unknown) => boolean;
  updateAssets: (release: unknown) => {
    installer: { name: string; url: string; size: number };
    sums: { name: string; url: string };
  } | null;
  parseSums: (text: string, name: string) => string | null;
  matchesSha256Digest: (actual: string, expected: string) => boolean;
  downloadToFile: (options: {
    url: string;
    destination: string;
    fetchImpl?: unknown;
    onProgress?: (received: number, total: number) => void;
  }) => Promise<{ size: number; digest: string }>;
  cleanupUpdateAssets: (directory: string) => Promise<{ removed: string[]; failed: string[] }>;
  checkForUpdate: (options: {
    currentVersion: string;
    fetchImpl?: unknown;
    url?: string;
  }) => Promise<{
    status: 'available' | 'current' | 'error';
    latestVersion: string;
    url: string;
    assets: unknown;
    message?: string;
  }>;
};

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const releaseEntry = (tagName: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tagName,
  html_url: 'https://github.com/earenbaz80/terminus/releases/tag/v0.4.0',
  assets: [
    { name: 'Terminus.Setup.0.4.0.exe', browser_download_url: 'https://example.test/Terminus.Setup.0.4.0.exe', size: 1234 },
    { name: 'SHA256SUMS.txt', browser_download_url: 'https://example.test/SHA256SUMS.txt', size: 90 },
    { name: 'Terminus.Setup.0.4.0.exe.__uninstaller.exe', browser_download_url: 'https://example.test/uninstaller.exe', size: 10 },
  ],
  ...extra,
});

const releaseWithAssets = (tagName: string) =>
  vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [releaseEntry(tagName)],
  });

const temporaryDirectories: string[] = [];
const makeTemporaryDirectory = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'terminus-updates-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('electron updates', () => {
  it('compara versiones numéricamente, con prefijo v y sin él', () => {
    expect(compareVersions('0.4.0', '0.3.0')).toBe(1);
    expect(compareVersions('v0.3.0', '0.3.0')).toBe(0);
    expect(compareVersions('0.3.0', '0.3.1')).toBe(-1);
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.4.0-beta.1', '0.4.0')).toBe(0);
  });

  it('solo acepta los dos modos de la preferencia', () => {
    expect(isUpdateMode('auto')).toBe(true);
    expect(isUpdateMode('manual')).toBe(true);
    expect(isUpdateMode('sometimes')).toBe(false);
    expect(isUpdateMode(undefined)).toBe(false);
  });

  it('encuentra el instalador publicado y sus hashes, sin el desinstalador', () => {
    const assets = updateAssets({
      assets: [
        { name: 'Terminus.Setup.0.4.0.exe', browser_download_url: 'https://example.test/installer.exe', size: 1234 },
        { name: 'Terminus.Setup.0.4.0.exe.__uninstaller.exe', browser_download_url: 'https://example.test/uninstaller.exe' },
        { name: 'SHA256SUMS.txt', browser_download_url: 'https://example.test/SHA256SUMS.txt' },
      ],
    });
    expect(assets?.installer.name).toBe('Terminus.Setup.0.4.0.exe');
    expect(assets?.installer.size).toBe(1234);
    expect(assets?.sums.name).toBe('SHA256SUMS.txt');
  });

  it('no acepta una release sin instalador, sin hashes ni con enlaces que no son https', () => {
    expect(updateAssets({ assets: [{ name: 'SHA256SUMS.txt', browser_download_url: 'https://example.test/s' }] })).toBeNull();
    expect(updateAssets({ assets: [] })).toBeNull();
    expect(updateAssets(null)).toBeNull();
    expect(
      updateAssets({
        assets: [
          { name: 'Terminus.Setup.0.4.0.exe', browser_download_url: 'http://insecure.test/installer.exe' },
          { name: 'SHA256SUMS.txt', browser_download_url: 'https://example.test/s' },
        ],
      })
    ).toBeNull();
  });

  it('lee el hash del fichero nombrado y compara digests', () => {
    const sums = `${'a'.repeat(64)}  Otro.exe\r\n${'b'.repeat(64)}  Terminus.Setup.0.4.0.exe\r\n`;
    expect(parseSums(sums, 'Terminus.Setup.0.4.0.exe')).toBe('b'.repeat(64));
    expect(parseSums(sums, 'NoExiste.exe')).toBeNull();
    expect(parseSums('', 'Terminus.Setup.0.4.0.exe')).toBeNull();

    expect(matchesSha256Digest('b'.repeat(64), 'B'.repeat(64))).toBe(true);
    expect(matchesSha256Digest('c'.repeat(64), 'b'.repeat(64))).toBe(false);
    expect(matchesSha256Digest('b'.repeat(64), 'no-es-un-hash')).toBe(false);
  });

  it('vuelca la descarga a disco por trozos, informando el progreso', async () => {
    const directory = makeTemporaryDirectory();
    const destination = path.join(directory, 'Terminus.Setup.0.4.0.exe.part');
    const progress: number[] = [];
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => '10' },
      body: Readable.toWeb(Readable.from([Buffer.from('hola '), Buffer.from('mundo')])),
    });

    const result = await downloadToFile({
      url: 'https://example.test/installer.exe',
      destination,
      fetchImpl,
      onProgress: (received: number) => progress.push(received),
    });

    expect(progress).toEqual([5, 10]);
    expect(result.size).toBe(10);
    expect(result.digest).toBe(sha256('hola mundo'));
    expect(fs.readFileSync(destination, 'utf8')).toBe('hola mundo');
  });

  it('no deja fichero cuando la descarga falla a mitad', async () => {
    const directory = makeTemporaryDirectory();
    const destination = path.join(directory, 'roto.part');
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from('parcial'));
        controller.error(new Error('corte de red'));
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, headers: { get: () => '0' }, body });

    await expect(
      downloadToFile({ url: 'https://example.test/installer.exe', destination, fetchImpl })
    ).rejects.toThrow();
    expect(fs.existsSync(destination)).toBe(false);
  });

  it('una respuesta sin cuerpo o sin 200 tampoco se escribe', async () => {
    const directory = makeTemporaryDirectory();
    const destination = path.join(directory, 'vacio.part');
    await expect(
      downloadToFile({
        url: 'https://example.test/installer.exe',
        destination,
        fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 404 }),
      })
    ).rejects.toThrow(/404/);
    await expect(
      downloadToFile({
        url: 'https://example.test/installer.exe',
        destination,
        fetchImpl: vi.fn().mockResolvedValue({ ok: true, headers: { get: () => '0' } }),
      })
    ).rejects.toThrow();
    expect(fs.existsSync(destination)).toBe(false);
  });

  it('borra instaladores y descargas parciales anteriores y respeta los hashes', async () => {
    const directory = makeTemporaryDirectory();
    fs.writeFileSync(path.join(directory, 'Terminus.Setup.0.3.0.exe'), 'viejo');
    fs.writeFileSync(path.join(directory, 'Terminus.Setup.0.4.0.exe.part'), 'a medias');
    fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), 'hash');

    const result = await cleanupUpdateAssets(directory);

    expect(result.removed.sort()).toEqual(['Terminus.Setup.0.3.0.exe', 'Terminus.Setup.0.4.0.exe.part']);
    expect(result.failed).toEqual([]);
    expect(fs.readdirSync(directory)).toEqual(['SHA256SUMS.txt']);
  });

  it('un directorio que no existe no es un fallo', async () => {
    const result = await cleanupUpdateAssets(path.join(os.tmpdir(), 'terminus-no-existe-' + Date.now()));
    expect(result).toEqual({ removed: [], failed: [] });
  });

  it('avisa cuando la release publicada es más nueva y trae sus assets', async () => {
    const result = await checkForUpdate({ currentVersion: '0.3.0', fetchImpl: releaseWithAssets('v0.4.0') });
    expect(result.status).toBe('available');
    expect(result.latestVersion).toBe('0.4.0');
    expect(result.assets).not.toBeNull();
  });

  it('se queda en verde cuando ya es la última', async () => {
    const result = await checkForUpdate({ currentVersion: '0.3.0', fetchImpl: releaseWithAssets('v0.3.0') });
    expect(result.status).toBe('current');
  });

  it('toma la release más nueva de la lista, incluidos los preliminares, y salta los borradores', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        releaseEntry('v0.3.1-rc.1', { draft: true }),
        releaseEntry('v0.3.1-rc.1'),
        releaseEntry('v0.3.0'),
      ],
    });

    const result = await checkForUpdate({ currentVersion: '0.3.0', fetchImpl });
    expect(result.status).toBe('available');
    expect(result.latestVersion).toBe('0.3.1-rc.1');
    expect(result.url).toContain('/releases/tag/v0.4.0');
  });

  it('una respuesta que no es 200 o un fallo de red salen como error, sin lanzar', async () => {
    const forbidden = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    expect((await checkForUpdate({ currentVersion: '0.3.0', fetchImpl: forbidden })).status).toBe('error');

    const offline = vi.fn().mockRejectedValue(new Error('sin red'));
    const result = await checkForUpdate({ currentVersion: '0.3.0', fetchImpl: offline });
    expect(result.status).toBe('error');
    expect(result.message).toContain('sin red');
  });

  it('una lista vacía o una release sin tag tampoco se dan por buenas', async () => {
    const empty = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    expect((await checkForUpdate({ currentVersion: '0.3.0', fetchImpl: empty })).status).toBe('error');

    const noTag = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ assets: [] }] });
    expect((await checkForUpdate({ currentVersion: '0.3.0', fetchImpl: noTag })).status).toBe('error');
  });
});
