import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { WebBrowserSurface } from './WebBrowserSurface';
import { THEMES } from '../utils/themes';
import type { BrowserTab, DownloadEntry, TerminusDesktopApi } from '../types';

const theme = THEMES['cyberpunk-obsidian'];

const pageTab: BrowserTab = {
  id: 'tab_downloads',
  kind: 'web',
  title: 'Example',
  url: 'https://example.com',
  displayUrl: 'https://example.com',
  isLoading: false,
  content: '',
  history: ['about:blank', 'https://example.com'],
  historyIndex: 1,
};

const download = (overrides: Partial<DownloadEntry> = {}): DownloadEntry => ({
  id: 'dl-1',
  name: 'informe.pdf',
  url: 'https://example.com/informe.pdf',
  host: 'example.com',
  state: 'progressing',
  received: 512,
  total: 1024,
  percent: 50,
  savePath: '',
  startedAt: 1,
  endedAt: null,
  error: '',
  ...overrides,
});

const renderSurface = () =>
  render(
    <WebBrowserSurface
      theme={theme}
      tab={pageTab}
      onCommand={vi.fn()}
      bookmarks={[]}
      onAddBookmark={vi.fn()}
      onRemoveBookmark={vi.fn()}
      onSetViewMode={vi.fn()}
      latencyMs={18}
    />,
  );

/** Puente de escritorio mínimo: solo lo que usa la lista de descargas. */
const makeBridge = (items: DownloadEntry[]) => {
  const listeners: ((update: { downloads: DownloadEntry[] }) => void)[] = [];
  const unsubscribe = vi.fn();
  const bridge = {
    platform: 'win32',
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn(),
    onMaximizedChange: () => () => {},
    onFrameContextMenu: () => () => {},
    onFindShortcut: () => () => {},
    listDownloads: vi.fn(async () => items),
    cancelDownload: vi.fn(async () => true),
    showDownload: vi.fn(async () => true),
    onDownloadsUpdate: (callback: (update: { downloads: DownloadEntry[] }) => void) => {
      listeners.push(callback);
      return unsubscribe;
    },
  } as unknown as TerminusDesktopApi;

  return { bridge, listeners, unsubscribe };
};

describe('descargas en la superficie del navegador', () => {
  it('sin puente de escritorio no hay botón de descargas', () => {
    const { unmount } = renderSurface();
    expect(document.querySelector('[data-e2e="downloads-toggle"]')).toBeNull();
    unmount();
  });

  it('pide la lista al montar y la lista al abrir el panel', async () => {
    const { bridge } = makeBridge([download()]);
    window.terminusDesktop = bridge;

    try {
      renderSurface();
      const toggle = await waitFor(() => {
        const found = document.querySelector<HTMLElement>('[data-e2e="downloads-toggle"]');
        expect(found).toBeTruthy();
        return found as HTMLElement;
      });

      await waitFor(() => expect(bridge.listDownloads).toHaveBeenCalled());
      expect(document.querySelector('[data-e2e="downloads-count"]')?.textContent).toBe('1');

      fireEvent.click(toggle);
      await waitFor(() => {
        const rows = [...document.querySelectorAll('[data-e2e="download-row"]')];
        expect(rows).toHaveLength(1);
        expect(rows[0].getAttribute('data-download-name')).toBe('informe.pdf');
        expect(rows[0].getAttribute('data-download-state')).toBe('progressing');
      });
    } finally {
      delete window.terminusDesktop;
    }
  });

  it('sigue el progreso que publica el proceso principal y permite cancelar', async () => {
    const { bridge, listeners } = makeBridge([download()]);
    window.terminusDesktop = bridge;

    try {
      renderSurface();
      const toggle = await waitFor(() => {
        const found = document.querySelector<HTMLElement>('[data-e2e="downloads-toggle"]');
        expect(found).toBeTruthy();
        return found as HTMLElement;
      });
      fireEvent.click(toggle);

      await waitFor(() => expect(document.querySelector('[data-e2e="download-row"]')).toBeTruthy());

      act(() => {
        listeners.forEach((listener) =>
          listener({ downloads: [download({ received: 1024, percent: 100, state: 'completed', savePath: 'C:\\Descargas\\informe.pdf' })] }),
        );
      });

      await waitFor(() => {
        const row = document.querySelector('[data-e2e="download-row"]');
        expect(row?.getAttribute('data-download-state')).toBe('completed');
      });

      const show = document.querySelector<HTMLElement>('[data-e2e="download-show"]');
      expect(show).toBeTruthy();
      show?.click();
      expect(bridge.showDownload).toHaveBeenCalledWith('dl-1');
      expect(document.querySelector('[data-e2e="download-cancel"]')).toBeNull();
    } finally {
      delete window.terminusDesktop;
    }
  });

  it('cancela desde el panel a través del puente', async () => {
    const { bridge } = makeBridge([download()]);
    window.terminusDesktop = bridge;

    try {
      renderSurface();
      const toggle = await waitFor(() => {
        const found = document.querySelector<HTMLElement>('[data-e2e="downloads-toggle"]');
        expect(found).toBeTruthy();
        return found as HTMLElement;
      });
      fireEvent.click(toggle);
      const cancel = await waitFor(() => {
        const found = document.querySelector<HTMLElement>('[data-e2e="download-cancel"]');
        expect(found).toBeTruthy();
        return found as HTMLElement;
      });
      cancel.click();
      expect(bridge.cancelDownload).toHaveBeenCalledWith('dl-1');
    } finally {
      delete window.terminusDesktop;
    }
  });
});
