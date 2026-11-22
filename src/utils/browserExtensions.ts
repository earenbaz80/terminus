import type { BrowserExtensionInfo, BrowserExtensionResult } from '../types';

/**
 * Browser extensions live in the Electron shell: it owns the folders, loads
 * them into every guest session and persists the catalog. The web build has no
 * bridge, so these helpers degrade to an empty catalog.
 */
const desktopApi = () => (typeof window !== 'undefined' ? window.terminusDesktop : undefined);

export async function readBrowserExtensions(): Promise<BrowserExtensionInfo[]> {
  try {
    return (await desktopApi()?.listBrowserExtensions?.()) ?? [];
  } catch {
    return [];
  }
}

export async function addBrowserExtension(): Promise<BrowserExtensionResult> {
  const add = desktopApi()?.addBrowserExtension;
  if (!add) return { ok: false, error: 'unavailable' };
  try {
    return await add();
  } catch {
    return { ok: false, error: 'failed' };
  }
}

export async function removeBrowserExtension(id: string): Promise<BrowserExtensionResult> {
  const remove = desktopApi()?.removeBrowserExtension;
  if (!remove) return { ok: false, error: 'unavailable' };
  try {
    return await remove(id);
  } catch {
    return { ok: false, error: 'failed' };
  }
}
