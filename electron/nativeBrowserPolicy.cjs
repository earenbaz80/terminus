'use strict';

/**
 * Reglas puras del navegador nativo (sin dependencias de Electron) para poder
 * probarlas con Vitest como el resto de la política de red.
 */

/** Prefijo de las sesiones por sitio que crea la superficie de la app. */
const NATIVE_PARTITION_PREFIX = 'persist:terminus-site-';

const isWebUrl = (value) => {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Un enlace con `target=_blank` (o `window.open`) va a pestaña nueva de la app
 * cuando es web y no lo bloquea el adblock; los esquemas locales, `javascript:`
 * y las ventanas emergentes de anuncios se rechazan.
 */
const shouldOpenInTab = (value, isBlockedUrl = () => false) =>
  isWebUrl(value) && !isBlockedUrl(value);

/** La ventana solo incrusta páginas en nuestras sesiones por sitio, nada más. */
const isNativePartition = (value) =>
  typeof value === 'string' && value.startsWith(NATIVE_PARTITION_PREFIX);

/**
 * Los sitios deben ver a un Chrome normal, no la identidad de la app: algunas
 * páginas sirven otro contenido (o lo bloquean) para navegadores desconocidos.
 */
const chromeUserAgent = () => {
  const chrome = process.versions.chrome || '130.0.0.0';
  const platform =
    process.platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : process.platform === 'darwin'
        ? 'Macintosh; Intel Mac OS X 10_15_7'
        : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
};

module.exports = {
  isWebUrl,
  shouldOpenInTab,
  isNativePartition,
  chromeUserAgent,
  NATIVE_PARTITION_PREFIX,
};
