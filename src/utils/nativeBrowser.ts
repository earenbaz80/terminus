/**
 * Página nativa del navegador de escritorio.
 *
 * Una `WebContentsView` se dibuja en una capa de la ventana que siempre queda
 * por encima del documento: no hay `z-index` que ponga un menú delante de ella.
 * Por eso la página se incrusta con la etiqueta `<webview>`, que forma parte del
 * DOM: ocupa su hueco exacto del layout y la interfaz se pinta encima.
 */

export const NATIVE_PARTITION_PREFIX = 'persist:terminus-site-';

/** Cada sitio recibe su propia sesión persistente: cookies y storage no se mezclan. */
export const partitionForUrl = (value: string): string => {
  let host: string;
  try {
    host = new URL(String(value)).hostname.toLowerCase();
  } catch {
    host = '';
  }
  const safe = host.replace(/[^a-z0-9.-]/g, '_');
  return `${NATIVE_PARTITION_PREFIX}${safe || 'unknown'}`;
};

/** Lo que la superficie usa del elemento `<webview>` de Electron. */
export interface NativeWebviewElement extends HTMLElement {
  loadURL?(url: string): Promise<void> | void;
  getURL?(): string;
  getTitle?(): string;
  setZoomFactor?(factor: number): void;
  /** Busca dentro del invitado; Chromium resalta las coincidencias. */
  findInPage?(text: string, options?: { forward?: boolean; findNext?: boolean }): number;
  /** Corta la búsqueda actual; `clearSelection` quita el resaltado. */
  stopFindInPage?(action?: 'clearSelection' | 'keepSelection' | 'activateSelection'): void;
}

/**
 * `allowpopups` no abre nada por sí solo: sin él Electron descarta el
 * `target=_blank`/`window.open` del invitado sin consultar al proceso principal, así
 * que la app no puede decidir entre pestaña nueva y `deny`. Con el atributo, el
 * aviso llega a `setWindowOpenHandler`, que siempre responde `deny` (la pestaña la
 * abre el renderer por `terminus:browser:open-tab`).
 */
export const createNativeWebview = (): NativeWebviewElement => {
  const view = document.createElement('webview') as NativeWebviewElement;
  view.setAttribute('allowpopups', '');
  return view;
};
