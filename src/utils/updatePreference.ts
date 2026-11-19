/**
 * Update check shared by the settings menu and the desktop shell.
 *
 * The shell owns the decision and the network call; the renderer mirrors the
 * state and only keeps the mode in localStorage when there is no desktop bridge.
 * Nothing is downloaded or installed: a check only reports whether the latest
 * published release is newer than this build.
 */
export const UPDATE_PREFERENCE_KEY = 'terminus.updates.v1';

export type UpdateMode = 'auto' | 'manual';

export interface UpdateCheckResult {
  status: 'available' | 'current' | 'error';
  currentVersion: string;
  latestVersion: string;
  url: string;
  checkedAt: string;
  message?: string;
}

export interface UpdateState {
  mode: UpdateMode;
  available: boolean;
  currentVersion: string;
  lastCheck: UpdateCheckResult | null;
}

export type UpdatePhase = 'downloading' | 'verifying' | 'installing' | 'error';

export interface UpdateProgress {
  phase: UpdatePhase;
  message?: string;
  /** Bytes written so far while downloading; the installer is ~100 MB. */
  received?: number;
  /** Announced size, or 0 when the response does not send one. */
  total?: number;
  /** 0-100, or null when the size is unknown. */
  percent?: number | null;
}

export interface UpdateInstallResult {
  status: 'installing' | 'error';
  message?: string;
}

const desktopApi = () => (typeof window !== 'undefined' ? window.terminusDesktop : undefined);

const normalizeMode = (value: unknown): UpdateMode => (value === 'manual' ? 'manual' : 'auto');

export const readUpdateMode = (): UpdateMode => {
  try {
    return normalizeMode(localStorage.getItem(UPDATE_PREFERENCE_KEY));
  } catch {
    return 'auto';
  }
};

export const writeUpdateMode = (mode: UpdateMode): void => {
  try {
    localStorage.setItem(UPDATE_PREFERENCE_KEY, mode);
  } catch {
    // Storage unavailable: the desktop shell still holds the real decision.
  }
};

const offlineState = (): UpdateState => ({
  mode: readUpdateMode(),
  available: false,
  currentVersion: '',
  lastCheck: null,
});

export async function readUpdateState(): Promise<UpdateState> {
  const api = desktopApi();
  if (!api?.getUpdateState) return offlineState();
  try {
    const state = await api.getUpdateState();
    const mode = normalizeMode(state.mode);
    writeUpdateMode(mode);
    return { ...state, mode, lastCheck: state.lastCheck ?? null };
  } catch {
    return offlineState();
  }
}

export async function applyUpdateMode(mode: UpdateMode): Promise<UpdateState> {
  writeUpdateMode(mode);
  const api = desktopApi();
  if (!api?.setUpdateMode) return { ...offlineState(), mode };
  try {
    const state = await api.setUpdateMode(mode);
    const nextMode = normalizeMode(state.mode);
    writeUpdateMode(nextMode);
    return { ...state, mode: nextMode, lastCheck: state.lastCheck ?? null };
  } catch {
    return { ...offlineState(), mode };
  }
}

export async function checkForUpdates(): Promise<UpdateState> {
  const api = desktopApi();
  if (!api?.checkForUpdates) return offlineState();
  try {
    return await api.checkForUpdates();
  } catch {
    return offlineState();
  }
}

export async function installUpdate(): Promise<UpdateInstallResult> {
  const api = desktopApi();
  if (!api?.installUpdate) {
    return { status: 'error', message: 'La actualización se instala solo desde la aplicación de escritorio.' };
  }
  try {
    return await api.installUpdate();
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

export const onUpdateProgress = (listener: (progress: UpdateProgress) => void): (() => void) => {
  const api = desktopApi();
  if (!api?.onUpdateProgress) return () => {};
  return api.onUpdateProgress(listener);
};
