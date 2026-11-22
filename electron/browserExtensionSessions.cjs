'use strict';

/**
 * Las extensiones de navegador solo se cargan en las sesiones de sitio.
 *
 * `session.defaultSession` sirve la UI de Terminus. Un content script con
 * `<all_urls>` inyectado ahí podría leer o modificar la app, así que se excluye
 * siempre, incluso si una lista futura lo incluyera por error.
 *
 * @param {{ defaultSession?: unknown, siteSessions?: unknown[] }} [options]
 * @returns {unknown[]}
 */
const siteSessionsForExtensions = ({ defaultSession = null, siteSessions = [] } = {}) => {
  const candidates = Array.isArray(siteSessions) ? siteSessions : [];
  return [...new Set(candidates)].filter(
    (candidate) => Boolean(candidate) && candidate !== defaultSession
  );
};

module.exports = { siteSessionsForExtensions };
