import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import App from './App';

/**
 * Pestañas vivas: cada pestaña web mantiene su superficie montada. La inactiva
 * queda oculta, pero su `<webview>` no se recrea, que es lo que conserva audio,
 * descargas y lo escrito en un formulario.
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

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      tabs: [webTab('tab_a', 'https://a.test/'), webTab('tab_b', 'https://b.test/')],
      activeTabId: 'tab_a',
      logs: {},
    })
  );
  window.terminusNative = { available: true };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200 }))
  );
});

afterEach(() => {
  cleanup();
  delete window.terminusNative;
  vi.unstubAllGlobals();
});

const panes = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-e2e="browser-pane"]'));
const activePane = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-e2e="browser-pane"][data-active="true"]');
const tabButtons = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'));

describe('pestañas con superficie propia', () => {
  it('monta una superficie por pestaña web y deja activa solo la suya', async () => {
    render(<App />);

    await waitFor(() => expect(panes()).toHaveLength(2));

    const [first, second] = panes();
    expect(first.dataset.tabId).toBe('tab_a');
    expect(second.dataset.tabId).toBe('tab_b');
    expect(first.getAttribute('data-active')).toBe('true');
    expect(second.getAttribute('data-active')).toBe('false');
    // La pestaña de fondo no se ve, pero sigue en el árbol con su invitado.
    expect(second.getAttribute('aria-hidden')).toBe('true');
    expect(first.querySelector('webview')).toBeTruthy();
    expect(second.querySelector('webview')).toBeTruthy();
  });

  it('conserva el mismo nodo de webview al cambiar de pestaña y volver', async () => {
    render(<App />);
    await waitFor(() => expect(panes()).toHaveLength(2));

    const firstView = panes()[0].querySelector('webview');
    const secondView = panes()[1].querySelector('webview');
    expect(firstView).toBeTruthy();
    expect(secondView).toBeTruthy();

    fireEvent.click(tabButtons()[1]);
    await waitFor(() => expect(activePane()?.dataset.tabId).toBe('tab_b'));

    fireEvent.click(tabButtons()[0]);
    await waitFor(() => expect(activePane()?.dataset.tabId).toBe('tab_a'));

    // La misma instancia: el invitado no se recreó al volver.
    expect(panes()[0].querySelector('webview')).toBe(firstView);
    expect(panes()[1].querySelector('webview')).toBe(secondView);
  });

  it('cierra pestañas sin arrastrar la superficie de las que quedan', async () => {
    render(<App />);
    await waitFor(() => expect(panes()).toHaveLength(2));

    const firstView = panes()[0].querySelector('webview');
    fireEvent.click(tabButtons()[0]);
    await waitFor(() => expect(activePane()?.dataset.tabId).toBe('tab_a'));

    const close = document.querySelector<HTMLElement>('[title^="Cerrar pestaña"]');
    expect(close).toBeTruthy();
    close?.click();

    await waitFor(() => expect(panes()).toHaveLength(1));
    expect(panes()[0].dataset.tabId).toBe('tab_b');
    expect(panes()[0].querySelector('webview')).toBeTruthy();
    expect(panes()[0].querySelector('webview')).not.toBe(firstView);
  });
});
