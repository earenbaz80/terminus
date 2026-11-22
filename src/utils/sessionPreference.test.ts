// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SHARED_SESSION_EVENT,
  isSharedSessionEnabled,
  setSharedSessionEnabled,
} from './sessionPreference';

beforeEach(() => {
  localStorage.clear();
});

describe('modo de sesión', () => {
  it('arranca aislado por sitio', () => {
    expect(isSharedSessionEnabled()).toBe(false);
  });

  it('persiste el modo compartido', () => {
    setSharedSessionEnabled(true);

    expect(isSharedSessionEnabled()).toBe(true);
  });

  it('avisa a las superficies abiertas al cambiar', () => {
    const listener = vi.fn();
    window.addEventListener(SHARED_SESSION_EVENT, listener);

    setSharedSessionEnabled(true);

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(SHARED_SESSION_EVENT, listener);
  });
});
