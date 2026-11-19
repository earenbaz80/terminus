'use strict';

/**
 * Página nativa: cada pestaña es una `<webview>` de Chromium incrustada en el
 * DOM de la ventana. La página corre en su propio proceso y con su propia sesión
 * por sitio, pero la dibuja el documento: la interfaz queda por encima sin
 * recortar la página ni pelearse con capas nativas.
 *
 * Este módulo aplica en el proceso principal la política del navegador: permisos
 * denegados, bloqueador de anuncios por sesión y menú contextual reenviado a la
 * interfaz, porque el clic derecho dentro de la página no llega al DOM.
 */

const { app, screen } = require('electron');
const { isWebUrl, chromeUserAgent } = require('./nativeBrowserPolicy.cjs');

const FRAME_CONTEXT_MENU_CHANNEL = 'terminus:context-menu:frame';
// El UA de la plataforma no cambia durante la sesión de la app.
const CHROME_USER_AGENT = chromeUserAgent();
const guestSessions = new Set();
const configuredSessions = new WeakSet();
let onSiteSessionCreated = () => {};
let getHostWindow = () => null;

const configureGuestSession = (siteSession) => {
  guestSessions.add(siteSession);
  if (configuredSessions.has(siteSession)) return;
  configuredSessions.add(siteSession);
  // El sitio ve un Chrome normal: la sesión del invitado firma sus peticiones
  // así, no con la identidad de la app.
  siteSession.setUserAgent(CHROME_USER_AGENT);
  // Un navegador no concede cámara, micrófono, ubicación ni notificaciones sin
  // preguntar; este primer tramo niega todo por defecto.
  siteSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  siteSession.setPermissionCheckHandler(() => false);
  // La primera carga espera al bloqueador para no dejar pasar un anuncio.
  try {
    void onSiteSessionCreated(siteSession)?.catch?.(() => {});
  } catch {
    // Una sesión sin bloqueador sigue siendo navegable.
  }
};

const forwardContextMenu = (contents, params) => {
  const window = getHostWindow();
  if (!window || window.isDestroyed() || contents.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  const bounds = window.getContentBounds();
  window.webContents.send(FRAME_CONTEXT_MENU_CHANNEL, {
    x: cursor.x - bounds.x,
    y: cursor.y - bounds.y,
    pageURL: contents.getURL(),
    linkURL: params?.linkURL || '',
    selectionText: params?.selectionText || '',
  });
};

const registerNativeGuests = ({
  getWindow = () => null,
  onSessionCreated = () => {},
} = {}) => {
  getHostWindow = getWindow;
  onSiteSessionCreated = onSessionCreated;

  // El invitado hereda el UA de la app al conectarse: hay que reescribirlo en
  // cuanto se adjunta, antes de su primera navegación.
  app.on('browser-window-created', (_event, window) => {
    window.webContents.on('did-attach-webview', (_attachEvent, contents) => {
      contents.setUserAgent(CHROME_USER_AGENT);
    });
  });

  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return;

    configureGuestSession(contents.session);

    // Los enlaces con target=_blank se abren en la misma pestaña; las ventanas
    // emergentes no se permiten.
    contents.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) void contents.loadURL(url);
      return { action: 'deny' };
    });

    contents.on('will-navigate', (event, url) => {
      if (!isWebUrl(url)) event.preventDefault();
    });

    contents.on('context-menu', (_menuEvent, params) => forwardContextMenu(contents, params));
  });
};

module.exports = {
  registerNativeGuests,
  listNativeSessions: () => [...guestSessions],
};
