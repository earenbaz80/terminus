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

const panes = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-e2e="browser-pane"]'));
const activePane = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-e2e="browser-pane"][data-active="true"]');

describe('target=_blank en la página nativa', () => {
  it('abre la URL en una pestaña nueva y la deja activa', async () => {
    render(<App />);
    await waitFor(() => expect(panes()).toHaveLength(1));
    expect(openTabListener).toBeTruthy();

    act(() => openTabListener?.('https://example.com/blank'));

    await waitFor(() => expect(panes()).toHaveLength(2));
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(2);
    // La nueva queda activa y la anterior sigue montada con su propia página.
    expect(activePane()?.dataset.tabId).not.toBe('tab_a');
    const address = activePane()?.querySelector<HTMLInputElement>(
      'input[aria-controls="terminus-address-suggestions"]'
    );
    expect(address?.value).toBe('https://example.com/blank');
    expect(panes()[0].dataset.tabId).toBe('tab_a');
  });

  it('ignora esquemas que no son web', async () => {
    render(<App />);
    await waitFor(() => expect(panes()).toHaveLength(1));

    act(() => openTabListener?.('file:///C:/Windows/System32'));
    act(() => openTabListener?.('javascript:alert(1)'));

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(panes()).toHaveLength(1);
  });
});
