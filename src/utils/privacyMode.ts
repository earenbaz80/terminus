/**
 * Terminus - Modo de navegación privada.
 *
 * Con el modo privado activo la sesión funciona igual, pero no deja rastro en
 * disco: ni historial global de navegación ni historial persistente de comandos.
 * El ajuste se guarda para que la elección sobreviva a un reinicio, pero los
 * datos de la sesión privada nunca se escriben.
 */

export const PRIVATE_MODE_STORAGE_KEY = 'terminus_private_mode_v1';
export const PRIVATE_MODE_EVENT = 'terminus-private-mode';

const readStored = (): boolean => {
  try {
    return localStorage.getItem(PRIVATE_MODE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

let privateMode = readStored();

export const isPrivateMode = (): boolean => privateMode;

export const setPrivateMode = (enabled: boolean): boolean => {
  privateMode = enabled;
  try {
    if (enabled) localStorage.setItem(PRIVATE_MODE_STORAGE_KEY, '1');
    else localStorage.removeItem(PRIVATE_MODE_STORAGE_KEY);
  } catch {
    // Sin almacenamiento la elección sigue valiendo para esta sesión.
  }
  try {
    window.dispatchEvent(new CustomEvent(PRIVATE_MODE_EVENT, { detail: enabled }));
  } catch {
    // Sin ventana (tests de Node) no hay a quién avisar.
  }
  return privateMode;
};

export const togglePrivateMode = (): boolean => setPrivateMode(!privateMode);
