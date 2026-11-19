'use strict';

/**
 * Update checks and installs for the desktop shell.
 *
 * Terminus ships unsigned, so the update trusts no transport alone: it takes the
 * installer and `SHA256SUMS.txt` from the same release, hashes the file while it
 * streams to disk and only then runs it silently. Nothing is buffered whole: the
 * installer is around 100 MB. The parts that do not need Electron live here so
 * they can be tested without a window or a real release.
 */

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

// The list, not `/latest`: `/latest` skips prereleases, and a preliminary tag is
// precisely how an update is rehearsed before it reaches a stable release. The
// API returns newest first, drafts only with authentication.
const RELEASES_URL = 'https://api.github.com/repos/earenbaz80/terminus/releases?per_page=5';
const UPDATE_MODES = new Set(['auto', 'manual']);
const CHECK_TIMEOUT_MS = 8000;
// GitHub turns the spaces of an asset name into dots (`Terminus Setup 0.3.0.exe`
// is published as `Terminus.Setup.0.3.0.exe`), so both spellings count.
const INSTALLER_ASSET = /^Terminus[ .]Setup[ .].+\.exe$/i;
const SUMS_ASSET = /^SHA256SUMS\.txt$/i;
// Downloads land here first: a partial file is never mistaken for an installer.
const PARTIAL_SUFFIX = '.part';
const REMOVABLE_ASSET = /\.(exe|part)$/i;

/** Versions are compared numerically, ignoring a leading `v` and any suffix. */
const versionParts = (value) =>
  String(value ?? '')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((part) => {
      const number = Number.parseInt(part, 10);
      return Number.isFinite(number) ? number : 0;
    });

/** -1 when `left` is older, 0 when they are the same, 1 when `left` is newer. */
const compareVersions = (left, right) => {
  const a = versionParts(left);
  const b = versionParts(right);
  const length = Math.max(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    const x = a[index] ?? 0;
    const y = b[index] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }

  return 0;
};

const isUpdateMode = (value) => UPDATE_MODES.has(value);

const isHttpsUrl = (value) => {
  try {
    return new URL(String(value)).protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Installer and checksums of a release, or `null` when the release cannot be
 * installed automatically: no asset, no sums, or a download link that is not https.
 */
const updateAssets = (release) => {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const installer = assets.find(
    (asset) => INSTALLER_ASSET.test(String(asset?.name ?? '')) && !String(asset?.name).includes('__uninstaller')
  );
  const sums = assets.find((asset) => SUMS_ASSET.test(String(asset?.name ?? '')));

  if (!installer || !sums) return null;
  if (!isHttpsUrl(installer.browser_download_url) || !isHttpsUrl(sums.browser_download_url)) return null;

  return {
    installer: {
      name: String(installer.name),
      url: String(installer.browser_download_url),
      size: Number(installer.size) || 0,
    },
    sums: { name: String(sums.name), url: String(sums.browser_download_url) },
  };
};

/** Hash of one file in a `SHA256SUMS.txt` (`<hash>  <name>` per line), or `null`. */
const parseSums = (text, name) => {
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line);
    if (match && match[2] === name) return match[1].toLowerCase();
  }
  return null;
};

const matchesSha256Digest = (actual, expected) => {
  const digest = String(expected ?? '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(digest) && String(actual ?? '').toLowerCase() === digest;
};

/**
 * Streams a URL into `destination`, hashing as it writes, so the 100 MB never
 * sit in memory. `onProgress(received, total)` gets every chunk; `total` is 0
 * when the response does not announce a length. The file is written in place
 * (callers use a `.part` name) and only a complete pipeline resolves.
 */
async function downloadToFile({ url, destination, headers = {}, fetchImpl = fetch, onProgress } = {}) {
  const response = await fetchImpl(url, { headers });
  if (!response?.ok) {
    throw new Error(`No se pudo descargar ${url} (${response ? response.status : 'sin respuesta'}).`);
  }
  if (!response.body) throw new Error('La descarga no expone un cuerpo que se pueda volcar a disco.');

  const total = Number(response.headers?.get?.('content-length')) || 0;
  const hash = createHash('sha256');
  let size = 0;

  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      new Transform({
        transform(chunk, _encoding, done) {
          size += chunk.length;
          hash.update(chunk);
          onProgress?.(size, total);
          done(null, chunk);
        },
      }),
      fs.createWriteStream(destination)
    );
  } catch (error) {
    // A cut download must not stay around looking like a file worth keeping.
    await fs.promises.rm(destination, { force: true }).catch(() => {});
    throw error;
  }

  return { size, digest: hash.digest('hex') };
}

/**
 * Deletes installers and partial downloads from earlier attempts so the update
 * folder does not grow with every version. A file locked by a running installer
 * is reported instead of aborting the update; the new download uses its own name.
 */
async function cleanupUpdateAssets(directory) {
  const removed = [];
  const failed = [];

  let entries;
  try {
    entries = await fs.promises.readdir(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return { removed, failed };
    throw error;
  }

  for (const name of entries.filter((entry) => REMOVABLE_ASSET.test(entry))) {
    try {
      await fs.promises.rm(path.join(directory, name), { force: true });
      removed.push(name);
    } catch {
      failed.push(name);
    }
  }

  return { removed, failed };
}

/**
 * Never throws: a failed check is a result with `status: 'error'`, so the menu
 * can say so instead of the caller having to distinguish network from version.
 */
async function checkForUpdate({
  currentVersion,
  url = RELEASES_URL,
  fetchImpl = fetch,
  timeoutMs = CHECK_TIMEOUT_MS,
} = {}) {
  const checkedAt = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `Terminus/${currentVersion || '0.0.0'}`,
      },
      signal: controller.signal,
    });
    if (!response?.ok) {
      throw new Error(`GitHub respondió ${response ? response.status : 'sin respuesta'}.`);
    }

    const payload = await response.json();
    const releases = Array.isArray(payload) ? payload : [payload];
    const release = releases.find((entry) => entry && entry.draft !== true);
    if (!release) throw new Error('No hay ninguna release publicada.');

    const latestVersion = String(release?.tag_name ?? '')
      .replace(/^v/i, '')
      .trim();
    if (!latestVersion) throw new Error('La release publicada no trae versión.');

    return {
      status: compareVersions(latestVersion, currentVersion) > 0 ? 'available' : 'current',
      currentVersion: String(currentVersion ?? ''),
      latestVersion,
      url: typeof release?.html_url === 'string' ? release.html_url : '',
      assets: updateAssets(release),
      checkedAt,
    };
  } catch (error) {
    return {
      status: 'error',
      currentVersion: String(currentVersion ?? ''),
      latestVersion: '',
      url: '',
      assets: null,
      checkedAt,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  RELEASES_URL,
  PARTIAL_SUFFIX,
  compareVersions,
  isUpdateMode,
  updateAssets,
  parseSums,
  matchesSha256Digest,
  downloadToFile,
  cleanupUpdateAssets,
  checkForUpdate,
};
