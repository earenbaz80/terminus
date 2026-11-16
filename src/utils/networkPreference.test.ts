import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NETWORK_PREFERENCE_KEY,
  applyAllowPrivateNetworks,
  readAllowPrivatePreference,
  readNetworkState,
} from './networkPreference';

afterEach(() => {
  localStorage.removeItem(NETWORK_PREFERENCE_KEY);
  delete window.terminusDesktop;
});

describe('networkPreference', () => {
  it('bloquea los destinos privados cuando no hay nada guardado', () => {
    expect(readAllowPrivatePreference()).toBe(false);
  });

  it('guarda la elección aunque no haya puente de escritorio', async () => {
    const state = await applyAllowPrivateNetworks(true);

    expect(state).toEqual({ allowPrivate: true, available: false, appliesLive: false });
    expect(localStorage.getItem(NETWORK_PREFERENCE_KEY)).toBe('1');
    expect(readAllowPrivatePreference()).toBe(true);

    const read = await readNetworkState();
    expect(read.allowPrivate).toBe(true);
    expect(read.available).toBe(false);
    expect(read.appliesLive).toBe(false);
  });

  it('manda la decisión al proceso principal cuando existe el puente', async () => {
    const setAllowPrivateNetworks = vi
      .fn()
      .mockResolvedValue({ allowPrivate: true, available: true, appliesLive: true });
    const getNetworkState = vi
      .fn()
      .mockResolvedValue({ allowPrivate: false, available: true, appliesLive: true });
    window.terminusDesktop = {
      ...(window.terminusDesktop ?? {}),
      getNetworkState,
      setAllowPrivateNetworks,
    } as NonNullable<typeof window.terminusDesktop>;

    await expect(readNetworkState()).resolves.toEqual({
      allowPrivate: false,
      available: true,
      appliesLive: true,
    });
    await expect(applyAllowPrivateNetworks(true)).resolves.toEqual({
      allowPrivate: true,
      available: true,
      appliesLive: true,
    });

    expect(getNetworkState).toHaveBeenCalledTimes(1);
    expect(setAllowPrivateNetworks).toHaveBeenCalledWith(true);
    expect(localStorage.getItem(NETWORK_PREFERENCE_KEY)).toBe('1');
  });

  it('si el puente falla deja la preferencia en el estado seguro', async () => {
    window.terminusDesktop = {
      ...(window.terminusDesktop ?? {}),
      getNetworkState: vi.fn().mockRejectedValue(new Error('sin IPC')),
      setAllowPrivateNetworks: vi.fn().mockRejectedValue(new Error('sin IPC')),
    } as NonNullable<typeof window.terminusDesktop>;

    await expect(readNetworkState()).resolves.toEqual({
      allowPrivate: false,
      available: false,
      appliesLive: false,
    });
    await expect(applyAllowPrivateNetworks(false)).resolves.toEqual({
      allowPrivate: false,
      available: false,
      appliesLive: false,
    });
  });

  it('conserva appliesLive=false cuando el servidor corre en otro proceso', async () => {
    // `npm run desktop:dev`: el proceso principal guarda la decisión, pero el
    // servidor hijo solo la hereda al arrancar, así que el menú debe poder decirlo.
    window.terminusDesktop = {
      ...(window.terminusDesktop ?? {}),
      getNetworkState: vi
        .fn()
        .mockResolvedValue({ allowPrivate: true, available: true, appliesLive: false }),
      setAllowPrivateNetworks: vi
        .fn()
        .mockResolvedValue({ allowPrivate: true, available: true, appliesLive: false }),
    } as NonNullable<typeof window.terminusDesktop>;

    await expect(readNetworkState()).resolves.toEqual({
      allowPrivate: true,
      available: true,
      appliesLive: false,
    });
    await expect(applyAllowPrivateNetworks(true)).resolves.toEqual({
      allowPrivate: true,
      available: true,
      appliesLive: false,
    });
  });
});
