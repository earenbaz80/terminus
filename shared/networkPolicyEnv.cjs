'use strict';

/**
 * Precedencia de las variables de entorno que deciden si Terminus puede alcanzar
 * destinos privados: loopback, RFC1918, link-local y CGNAT.
 *
 * Vive en un módulo CJS compartido porque la consumen dos builds que no comparten
 * código: `src/utils/serverSecurity.ts` (servidor) y `electron/main.cjs` (proceso
 * principal). Una sola lista, para que no puedan divergir.
 *
 * Devuelve `null` cuando el entorno no decide nada, para que quien llama aplique
 * su propio defecto (bloquear) o su preferencia guardada.
 */

function envDecidesPrivateNetworks(env = process.env) {
  if (env.TERMINUS_BLOCK_PRIVATE === '1') return 'block';
  if (env.TERMINUS_NETWORK_POLICY === 'public') return 'block';
  if (env.TERMINUS_BLOCK_PRIVATE === '0') return 'allow';
  if (env.TERMINUS_ALLOW_PRIVATE === '1') return 'allow';
  if (env.TERMINUS_NETWORK_POLICY === 'local' || env.TERMINUS_NETWORK_POLICY === 'private') {
    return 'allow';
  }
  return null;
}

/** Bloquea salvo que el entorno conceda la excepción explícitamente. */
function envBlocksPrivateNetworks(env = process.env) {
  return envDecidesPrivateNetworks(env) !== 'allow';
}

module.exports = { envDecidesPrivateNetworks, envBlocksPrivateNetworks };
