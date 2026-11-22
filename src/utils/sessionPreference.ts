/**
 * Cookie session mode shared by the renderer surfaces.
 *
 * Isolated is the default and the safe state: every host keeps its own
 * `persist:terminus-site-<host>` partition. Sharing puts every site in one
 * `persist:terminus-shared` partition so a login or SSO that crosses domains
 * behaves like a desktop browser, at the cost of that isolation.
 *
 * The choice only affects which partition the `<webview>` is created with, so
 * localStorage is enough; `SHARED_SESSION_EVENT` tells the open surfaces to
 * recreate their guest with the new partition.
 */
export const SHARED_SESSION_KEY = 'terminus.session.shared.v1';
export const SHARED_SESSION_EVENT = 'terminus:session-mode';

export const isSharedSessionEnabled = (): boolean => {
  try {
    return localStorage.getItem(SHARED_SESSION_KEY) === '1';
  } catch {
    return false;
  }
};

export const setSharedSessionEnabled = (enabled: boolean): void => {
  try {
    localStorage.setItem(SHARED_SESSION_KEY, enabled ? '1' : '0');
  } catch {
    // Storage unavailable: the surfaces stay on the isolated default.
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SHARED_SESSION_EVENT, { detail: enabled }));
  }
};
