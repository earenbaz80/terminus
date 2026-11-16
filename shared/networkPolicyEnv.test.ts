import { afterEach, describe, expect, it } from 'vitest';
import { envBlocksPrivateNetworks, envDecidesPrivateNetworks } from './networkPolicyEnv.cjs';
import { blockPrivateNetworks } from '../src/utils/serverSecurity';

/**
 * El servidor y el proceso principal leen la misma lista. Este test fija la
 * precedencia en un sitio y comprueba que la función del servidor sigue dándola
 * por buena, que es lo que evita que las dos copias se separen.
 */
const CASES: Array<{
  env: Record<string, string>;
  decision: 'allow' | 'block' | null;
  blocks: boolean;
}> = [
  { env: {}, decision: null, blocks: true },
  { env: { TERMINUS_BLOCK_PRIVATE: '1' }, decision: 'block', blocks: true },
  { env: { TERMINUS_NETWORK_POLICY: 'public' }, decision: 'block', blocks: true },
  // El bloqueo explícito gana a una concesión, en cualquier orden.
  {
    env: { TERMINUS_BLOCK_PRIVATE: '1', TERMINUS_ALLOW_PRIVATE: '1' },
    decision: 'block',
    blocks: true,
  },
  {
    env: { TERMINUS_NETWORK_POLICY: 'public', TERMINUS_BLOCK_PRIVATE: '0' },
    decision: 'block',
    blocks: true,
  },
  { env: { TERMINUS_BLOCK_PRIVATE: '0' }, decision: 'allow', blocks: false },
  { env: { TERMINUS_ALLOW_PRIVATE: '1' }, decision: 'allow', blocks: false },
  { env: { TERMINUS_NETWORK_POLICY: 'local' }, decision: 'allow', blocks: false },
  { env: { TERMINUS_NETWORK_POLICY: 'private' }, decision: 'allow', blocks: false },
  {
    env: { TERMINUS_ALLOW_PRIVATE: '1', TERMINUS_NETWORK_POLICY: 'local' },
    decision: 'allow',
    blocks: false,
  },
  // Valores que no son el marcador esperado no conceden nada.
  { env: { TERMINUS_ALLOW_PRIVATE: 'true' }, decision: null, blocks: true },
  { env: { TERMINUS_NETWORK_POLICY: 'LAN' }, decision: null, blocks: true },
];

const NETWORK_VARS = ['TERMINUS_BLOCK_PRIVATE', 'TERMINUS_ALLOW_PRIVATE', 'TERMINUS_NETWORK_POLICY'];

const applyEnv = (env: Record<string, string>) => {
  for (const name of NETWORK_VARS) delete process.env[name];
  Object.assign(process.env, env);
};

afterEach(() => {
  for (const name of NETWORK_VARS) delete process.env[name];
});

describe('precedencia de las variables de red', () => {
  it.each(CASES)('decide $decision y bloquea=$blocks con $env', ({ env, decision, blocks }) => {
    expect(envDecidesPrivateNetworks(env)).toBe(decision);
    expect(envBlocksPrivateNetworks(env)).toBe(blocks);
    // Lo mismo que hace `blockPrivateNetworks()` en cada petición.
    applyEnv(env);
    expect(blockPrivateNetworks()).toBe(blocks);
  });
});
