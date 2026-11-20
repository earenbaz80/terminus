import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DownloadsPanel, formatDownloadSize } from './DownloadsPanel';
import { DownloadEntry } from '../types';
import { THEMES } from '../utils/themes';

const theme = THEMES['cyberpunk-obsidian'];

const item = (overrides: Partial<DownloadEntry> = {}): DownloadEntry => ({
  id: 'dl-1',
  name: 'informe.pdf',
  url: 'https://example.test/informe.pdf',
  host: 'example.test',
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

const renderPanel = (downloads: DownloadEntry[], handlers: Partial<{
  onCancel: (id: string) => void;
  onShow: (id: string) => void;
  onClose: () => void;
}> = {}) => {
  const onCancel = vi.fn();
  const onShow = vi.fn();
  const onClose = vi.fn();
  render(
    <DownloadsPanel
      theme={theme}
      downloads={downloads}
      onCancel={handlers.onCancel ?? onCancel}
      onShow={handlers.onShow ?? onShow}
      onClose={handlers.onClose ?? onClose}
    />,
  );
  return { onCancel, onShow, onClose };
};

describe('DownloadsPanel', () => {
  it('muestra el estado vacío con su ancla', () => {
    renderPanel([]);
    const panel = document.querySelector('[data-e2e="downloads"]');
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute('role')).toBe('dialog');
    expect(document.querySelectorAll('[data-e2e="download-row"]')).toHaveLength(0);
    expect(panel?.textContent).toContain('0');
  });

  it('lista las descargas con nombre, host, estado y porcentaje', () => {
    renderPanel([item(), item({ id: 'dl-2', name: 'foto.zip', host: 'cdn.test', state: 'completed', percent: 100 })]);

    const rows = [...document.querySelectorAll('[data-e2e="download-row"]')];
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute('data-download-state')).toBe('progressing');
    expect(rows[0].getAttribute('data-download-name')).toBe('informe.pdf');
    expect(rows[0].textContent).toContain('example.test');
    expect(rows[0].textContent).toContain('50%');
    expect(rows[1].getAttribute('data-download-state')).toBe('completed');
    expect(rows[1].textContent).toContain('foto.zip');
  });

  it('solo deja cancelar lo que sigue en curso', () => {
    const { onCancel } = renderPanel([item(), item({ id: 'dl-2', state: 'completed', percent: 100 })]);
    const cancelButtons = [...document.querySelectorAll('[data-e2e="download-cancel"]')];
    expect(cancelButtons).toHaveLength(1);
    (cancelButtons[0] as HTMLElement).click();
    expect(onCancel).toHaveBeenCalledWith('dl-1');
  });

  it('ofrece ver en carpeta cuando ya hay archivo', () => {
    const { onShow } = renderPanel([
      item({ state: 'completed', percent: 100, savePath: 'C:\\Descargas\\informe.pdf' }),
    ]);
    const show = document.querySelector('[data-e2e="download-show"]') as HTMLElement | null;
    expect(show).toBeTruthy();
    show?.click();
    expect(onShow).toHaveBeenCalledWith('dl-1');
  });

  it('no ofrece ver en carpeta si el archivo no llegó a guardarse', () => {
    renderPanel([item({ state: 'interrupted', savePath: '' })]);
    const show = document.querySelector('[data-e2e="download-show"]') as HTMLButtonElement | null;
    expect(show?.disabled).toBe(true);
  });

  it('describe los estados finales con el catálogo de la interfaz', () => {
    renderPanel([item({ state: 'cancelled' }), item({ id: 'dl-2', state: 'interrupted' })]);
    const text = document.querySelector('[data-e2e="downloads"]')?.textContent ?? '';
    expect(text).toMatch(/cancelada|interrumpida/i);
  });

  it('formatea tamaños legibles', () => {
    expect(formatDownloadSize(0)).toBe('—');
    expect(formatDownloadSize(512)).toBe('512 B');
    expect(formatDownloadSize(2048)).toBe('2 KB');
    expect(formatDownloadSize(5 * 1024 * 1024)).toBe('5 MB');
  });

  it('cierra el panel al pulsar fuera', () => {
    const { onClose } = renderPanel([item()]);
    screen.getByLabelText(/cerrar descargas/i).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
