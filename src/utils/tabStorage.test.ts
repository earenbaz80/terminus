// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { BrowserTab } from '../types';
import { loadSession, saveSession } from './tabStorage';

const tab = (viewMode: BrowserTab['viewMode']): BrowserTab => ({
  id: 'tab_1',
  kind: 'web',
  title: 'Example',
  url: 'https://example.com/',
  displayUrl: 'https://example.com/',
  isLoading: false,
  content: '',
  history: ['https://example.com/'],
  historyIndex: 0,
  viewMode,
});

beforeEach(() => {
  localStorage.clear();
});

describe('sesión guardada', () => {
  it('conserva el modo NATIVO al recargar', () => {
    saveSession([tab('native')], 'tab_1', {});

    expect(loadSession()?.tabs[0].viewMode).toBe('native');
  });

  it('conserva los modos de página existentes', () => {
    for (const mode of ['real', 'dark', 'text'] as const) {
      localStorage.clear();
      saveSession([tab(mode)], 'tab_1', {});

      expect(loadSession()?.tabs[0].viewMode).toBe(mode);
    }
  });

  it('descarta un modo desconocido', () => {
    localStorage.setItem(
      'termbrowser.tabs',
      JSON.stringify({
        tabs: [{ ...tab(undefined), viewMode: 'reader' }],
        activeTabId: 'tab_1',
        logs: {},
      })
    );

    expect(loadSession()?.tabs[0].viewMode).toBeUndefined();
  });
});
