import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import App from './App';

/**
 * `target=_blank` dentro de la página nativa: el proceso principal avisa por
 * `onOpenTab` y la app abre una pestaña nueva con esa URL, activa y sin perder la
 * que estaba abierta. La webview del invitado no navega a la nueva URL.
 */

const SESSION_KEY = 'termbrowser.tabs';

const webTab = (id: string, url: string) => ({
  id,
  kind: 'web' as const,
  title: url,
  url,
  displayUrl: url,
  isLoading: false,
  history: [url],
  historyIndex: 0,
});

let openTabListener: ((url: string) => void) | null = null;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      tabs: [webTab('tab_a', 'https://a.test/')],
      activeTabId: 'tab_a',
      logs: {},
    })
  );
  window.terminusNative = { available: true };
  openTabListener = null;
  window.terminusDesktop = {
    platform: 'win32',
    isMaximized: async () => false,
    onMaximizedChange: () => () => {},
    onFrameContextMenu: () => () => {},
    onFindShortcut: () => () => {},
    onOpenTab: (listener: (url: string) => void) => {
      openTabListener = listener;
      return () => {
        openTabListener = null;
      };
    },
  } as unknown as typeof window.terminusDesktop;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200 }))
  );
});

afterEach(() => {
  cleanup();
  delete window.terminusNative;
  delete window.terminusDesktop;
  vi.unstubAllGlobals();
});

const tabButtons = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'));
/** La barra de direcciones de la superficie visible (aún hay una sola montada). */
const addressOfSurface = (): HTMLInputElement | null =>
  document.querySelector<HTMLInputElement>('input[aria-controls="terminus-address-suggestions"]');

describe('target=_blank en la página nativa', () => {
  it('abre la URL en una pestaña nueva y la deja activa', async () => {
    render(<App />);
    await waitFor(() => expect(tabButtons()).toHaveLength(1));
    expect(openTabListener).toBeTruthy();

    act(() => openTabListener?.('https://example.com/blank'));

    await waitFor(() => expect(tabButtons()).toHaveLength(2));
    // La nueva queda activa, con su URL en la barra, y la anterior sigue abierta.
    expect(document.querySelectorAll('[role="tab"][aria-selected="true"]')).toHaveLength(1);
    expect(addressOfSurface()?.value).toBe('https://example.com/blank');
  });

  it('ignora esquemas que no son web', async () => {
    render(<App />);
    await waitFor(() => expect(tabButtons()).toHaveLength(1));

    act(() => openTabListener?.('file:///C:/Windows/System32'));
    act(() => openTabListener?.('javascript:alert(1)'));

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(tabButtons()).toHaveLength(1);
  });
});
