import React from 'react';
import { FolderOpen, X } from 'lucide-react';
import { DownloadEntry, ThemeConfig } from '../types';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/messages';

interface DownloadsPanelProps {
  theme: ThemeConfig;
  downloads: DownloadEntry[];
  /** Cancela una descarga en curso; el proceso principal mata la transferencia. */
  onCancel: (id: string) => void;
  /** Abre la carpeta con el archivo terminado ya seleccionado. */
  onShow: (id: string) => void;
  onClose: () => void;
}

const STATE_KEYS: Record<DownloadEntry['state'], MessageKey> = {
  progressing: 'downloads.stateProgressing',
  completed: 'downloads.stateCompleted',
  cancelled: 'downloads.stateCancelled',
  interrupted: 'downloads.stateInterrupted',
};

const units = ['B', 'KB', 'MB', 'GB'];

/** Tamaño legible para la lista; `—` cuando el sitio no anuncia el total. */
export const formatDownloadSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // Enteros cuando el valor es exacto (2 KB) y un decimal cuando no (1,5 KB).
  const shown = value >= 10 || Number.isInteger(value) ? String(Math.round(value)) : String(Number(value.toFixed(1)));
  return `${shown} ${units[unit]}`;
};

/**
 * Lista de descargas de la sesión, como los demás paneles compactos de la barra:
 * un diálogo anclado al botón y cerrado al pulsar fuera.
 */
export const DownloadsPanel: React.FC<DownloadsPanelProps> = ({
  theme,
  downloads,
  onCancel,
  onShow,
  onClose,
}) => {
  const { t } = useI18n();

  return (
    <>
      <button
        type="button"
        aria-label={t('downloads.close')}
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default"
      />
      <div
        className="absolute top-full right-0 z-50 mt-1 w-80 max-w-[85vw] border rounded-xs font-mono text-[10px] shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
        style={{ backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
        role="dialog"
        aria-label={t('downloads.title')}
        data-e2e="downloads"
      >
        <div
          className="flex items-center justify-between border-b px-2 py-1 text-[9px] uppercase tracking-wide opacity-55"
          style={{ borderColor: theme.border }}
        >
          <span>{t('downloads.heading')}</span>
          <span>{t('downloads.count', { n: downloads.length })}</span>
        </div>

        {downloads.length === 0 ? (
          <div className="px-2 py-2 opacity-50">{t('downloads.empty')}</div>
        ) : (
          <div className="max-h-56 overflow-y-auto">
            {downloads.map((item) => (
              <div
                key={item.id}
                className="border-b px-2 py-1.5 last:border-b-0"
                style={{ borderColor: theme.border }}
                data-e2e="download-row"
                data-download-state={item.state}
                data-download-name={item.name}
              >
                <div className="flex items-center gap-1">
                  <span className="block truncate font-bold" title={item.savePath || item.url}>
                    {item.name}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-[9px] opacity-55">
                  <span className="truncate">{item.host || item.url}</span>
                  <span data-e2e="download-meta">
                    {t(STATE_KEYS[item.state])}
                    {item.state === 'progressing' && typeof item.percent === 'number'
                      ? ` ${item.percent}%`
                      : ''}
                    {item.total > 0 ? ` · ${formatDownloadSize(item.total)}` : ''}
                  </span>
                </div>

                {item.state === 'progressing' && (
                  <div
                    className="mt-1 h-1 w-full"
                    style={{ backgroundColor: theme.border }}
                    role="progressbar"
                    aria-valuenow={typeof item.percent === 'number' ? item.percent : undefined}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="h-full transition-[width]"
                      style={{
                        width: `${typeof item.percent === 'number' ? item.percent : 8}%`,
                        backgroundColor: theme.accent,
                      }}
                    />
                  </div>
                )}

                <div className="mt-1 flex gap-2">
                  {item.state === 'progressing' && (
                    <button
                      type="button"
                      onClick={() => onCancel(item.id)}
                      className="flex items-center gap-1 border px-1.5 py-0.5 hover:opacity-75"
                      style={{ borderColor: theme.border, color: theme.text }}
                      data-e2e="download-cancel"
                    >
                      <X className="w-2.5 h-2.5" />
                      {t('downloads.cancel')}
                    </button>
                  )}
                  {(item.state === 'completed' || item.state === 'interrupted') && (
                    <button
                      type="button"
                      onClick={() => onShow(item.id)}
                      disabled={!item.savePath}
                      className="flex items-center gap-1 border px-1.5 py-0.5 hover:opacity-75 disabled:cursor-not-allowed disabled:opacity-30"
                      style={{ borderColor: theme.border, color: theme.accent }}
                      data-e2e="download-show"
                    >
                      <FolderOpen className="w-2.5 h-2.5" />
                      {t('downloads.show')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
};
