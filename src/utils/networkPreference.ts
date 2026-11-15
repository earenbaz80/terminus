/**
 * Private-network exception shared by the renderer and the desktop shell.
 *
 * The switch is enforced where the policy lives: the proxy and DNS endpoints of
 * the local server, the REAL forward proxy and Electron's request guard. The
 * desktop shell owns the decision, so the renderer mirrors it and only falls
 * back to localStorage when the desktop bridge is not available.
 *
 * Blocked is the default and the safe state: enabling this makes the app able to
 * reach loopback, RFC1918, link-local and CGNAT destinations.
 */
export const NETWORK_PREFERENCE_KEY = 'terminus.network.v1';

export interface NetworkState {
  allowPrivate: boolean;
  available: boolean;
}

const desktopApi = () =>
  typeof window !== 'undefined' ? window.terminusDesktop : undefined;

export const readAllowPrivatePreference = (): boolean => {
  try {
    return localStorage.getItem(NETWORK_PREFERENCE_KEY) === '1';
  } catch {
    return false;
  }
};

export const writeAllowPrivatePreference = (allowPrivate: boolean): void => {
  try {
    localStorage.setItem(NETWORK_PREFERENCE_KEY, allowPrivate ? '1' : '0');
  } catch {
    // Storage unavailable: the desktop shell still holds the real state.
  }
};

export async function readNetworkState(): Promise<NetworkState> {
  const api = desktopApi();
  if (!api?.getNetworkState) {
    return { allowPrivate: readAllowPrivatePreference(), available: false };
  }
  try {
    const state = await api.getNetworkState();
    writeAllowPrivatePreference(state.allowPrivate);
    return state;
  } catch {
    return { allowPrivate: readAllowPrivatePreference(), available: false };
  }
}

export async function applyAllowPrivateNetworks(allowPrivate: boolean): Promise<NetworkState> {
  writeAllowPrivatePreference(allowPrivate);
  const api = desktopApi();
  if (!api?.setAllowPrivateNetworks) {
    return { allowPrivate, available: false };
  }
  try {
    const state = await api.setAllowPrivateNetworks(allowPrivate);
    writeAllowPrivatePreference(state.allowPrivate);
    return state;
  } catch {
    return { allowPrivate, available: false };
  }
}
