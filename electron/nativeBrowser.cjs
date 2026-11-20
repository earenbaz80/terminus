'use strict';

/**
 * Página nativa: cada pestaña es una `<webview>` de Chromium incrustada en el
 * DOM de la ventana. La página corre en su propio proceso y con su propia sesión
 * por sitio, pero la dibuja el documento: la interfaz queda por encima sin
 * recortar la página ni pelearse con capas nativas.
 *
 * Este módulo aplica en el proceso principal la política del navegador: permisos
 * preguntados y recordados por origen, `target=_blank` a pestaña nueva, bloqueador
 * de anuncios por sesión y menú contextual reenviado a la interfaz, porque el clic
 * derecho dentro de la página no llega al DOM.
 */

const { app, dialog, screen } = require('electron');
const path = require('node:path');
const { isWebUrl, shouldOpenInTab, chromeUserAgent } = require('./nativeBrowserPolicy.cjs');
const {
  ASKABLE_PERMISSIONS,
  decidePermission,
  loadPermissionStore,
  normalizeOrigin,
  permissionPrompt,
  recordPermission,
  savePermissionStore,
} = require('./sitePermissions.cjs');

const FRAME_CONTEXT_MENU_CHANNEL = 'terminus:context-menu:frame';
const OPEN_TAB_CHANNEL = 'terminus:browser:open-tab';
// El UA de la plataforma no cambia durante la sesión de la app.
const CHROME_USER_AGENT = chromeUserAgent();
const guestSessions = new Set();
const configuredSessions = new WeakSet();
let onSiteSessionCreated = () => {};
let getHostWindow = () => null;
let isBlockedUrl = () => false;
let permissionStore = null;

const permissionsFile = () => path.join(app.getPath('userData'), 'permissions.json');

/** El almacén se lee una vez y se mantiene en memoria hasta la próxima escritura. */
const permissionState = () => {
  if (!permissionStore) permissionStore = loadPermissionStore(permissionsFile());
  return permissionStore;
};

/**
 * Un navegador pregunta cámara, micrófono, ubicación, notificaciones y
 * portapapeles; el resto se niega sin molestar. La respuesta se recuerda por
 * origen. `TERMINUS_E2E_PERMISSION_ANSWER` contesta sin diálogo porque el cuadro
 * nativo no se puede pulsar desde CDP.
 */
const askPermission = async (contents, permission, details) => {
  const origin = normalizeOrigin(details?.requestingUrl || contents?.getURL?.() || '');
  if (!ASKABLE_PERMISSIONS.has(permission) || !origin) return false;

  const forced = process.env.TERMINUS_E2E_PERMISSION_ANSWER;
  if (forced === 'allow' || forced === 'deny') return forced === 'allow';

  let current;
  try {
    current = permissionState();
  } catch {
    return false;
  }
  const decision = decidePermission(current, origin, permission);
  if (decision !== 'ask') return decision === 'allow';

  const host = getHostWindow();
  if (!host || host.isDestroyed()) return false;

  const prompt = permissionPrompt(app.getLocale?.() || 'en', origin, permission);
  const { response } = await dialog.showMessageBox(host, {
    type: 'question',
    buttons: prompt.buttons,
    defaultId: 0,
    cancelId: prompt.buttons.length - 1,
    noLink: true,
    message: prompt.message,
    detail: prompt.detail,
  });
  const allowed = response === 0;
  permissionStore = recordPermission(current, origin, permission, allowed ? 'allow' : 'deny');
  savePermissionStore(permissionsFile(), permissionStore);
  return allowed;
};

const configureGuestSession = (siteSession) => {
  guestSessions.add(siteSession);
  if (configuredSessions.has(siteSession)) return;
  configuredSessions.add(siteSession);
  // El sitio ve un Chrome normal: la sesión del invitado firma sus peticiones
  // así, no con la identidad de la app.
  siteSession.setUserAgent(CHROME_USER_AGENT);
  siteSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    void askPermission(contents, permission, details).then(callback, () => callback(false));
  });
  // Chromium consulta el estado antes de pedir: se responde con lo ya decidido.
  siteSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    try {
      return decidePermission(permissionState(), normalizeOrigin(requestingOrigin), permission) === 'allow';
    } catch {
      return false;
    }
  });
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
  isBlocked = () => false,
} = {}) => {
  getHostWindow = getWindow;
  onSiteSessionCreated = onSessionCreated;
  isBlockedUrl = isBlocked;

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

    // `target=_blank` y `window.open` abren pestaña nueva en la app, como en un
    // navegador; los esquemas que no son web y las URL bloqueadas se rechazan.
    contents.setWindowOpenHandler(({ url }) => {
      const host = getHostWindow();
      if (!shouldOpenInTab(url, isBlockedUrl) || !host || host.isDestroyed()) {
        return { action: 'deny' };
      }
      host.webContents.send(OPEN_TAB_CHANNEL, url);
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
