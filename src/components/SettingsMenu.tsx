import React, { useEffect, useRef, useState } from 'react';
import { Blocks, Download, Languages, Menu, Network, Puzzle, RefreshCw, ShieldCheck, Volume2, VolumeX, X } from 'lucide-react';
import { BrowserExtensionInfo, ThemeConfig, ThemeId } from '../types';
import { THEMES } from '../utils/themes';
import { themeName } from '../i18n/themes';
import { soundEffects, SoundTheme } from '../utils/soundEffects';
import { LOCALES } from '../i18n/locales';
import { useI18n } from '../i18n';
import { LockSettings } from './LockSettings';
import { applyAdblockEnabled, readAdblockState, AdblockState } from '../utils/adblockPreference';
import { isPrivateMode, setPrivateMode } from '../utils/privacyMode';
import {
  applyAllowPrivateNetworks,
  readNetworkState,
  NetworkState,
} from '../utils/networkPreference';
import {
  isSharedSessionEnabled,
  setSharedSessionEnabled,
} from '../utils/sessionPreference';
import {
  addBrowserExtension,
  readBrowserExtensions,
  removeBrowserExtension,
} from '../utils/browserExtensions';
import {
  applyUpdateMode,
  checkForUpdates,
  installUpdate,
  onUpdateProgress,
  readUpdateState,
  UpdateMode,
  UpdateState,
} from '../utils/updatePreference';

interface SettingsMenuProps {
  theme: ThemeConfig;
  currentThemeId: ThemeId;
  onSelectTheme: (id: ThemeId) => void;
  isMuted: boolean;
  onToggleMute: () => void;
  crtEnabled: boolean;
  onToggleCrt: () => void;
  onLockNow: () => void;
  onOpenSecurity: () => void;
  onOpenExtensions: () => void;
}

/**
 * Single entry point for configuration. Language, audio, visual settings,
 * ad blocking and local security live here so the header stays short.
 */
export const SettingsMenu: React.FC<SettingsMenuProps> = ({
  theme,
  currentThemeId,
  onSelectTheme,
  isMuted,
  onToggleMute,
  crtEnabled,
  onToggleCrt,
  onLockNow,
  onOpenSecurity,
  onOpenExtensions,
}) => {
  const { t, locale, setLocale } = useI18n();
  const [open, setOpen] = useState(false);
  const [soundTheme, setSoundTheme] = useState<SoundTheme>(() => soundEffects.getSoundTheme());
  const [customWavName, setCustomWavName] = useState<string | null>(() => soundEffects.getCustomSoundName());
  const [privateMode, setPrivateModeState] = useState<boolean>(() => isPrivateMode());
  const [adblock, setAdblock] = useState<AdblockState>({ enabled: true, available: false });
  const [adblockBusy, setAdblockBusy] = useState(false);
  const [network, setNetwork] = useState<NetworkState>({
    allowPrivate: false,
    available: false,
    appliesLive: false,
  });
  const [networkBusy, setNetworkBusy] = useState(false);
  const [sharedSession, setSharedSession] = useState<boolean>(() => isSharedSessionEnabled());
  const [browserExtensions, setBrowserExtensions] = useState<BrowserExtensionInfo[]>([]);
  const [extensionsBusy, setExtensionsBusy] = useState(false);
  const [extensionsError, setExtensionsError] = useState('');
  const [updates, setUpdates] = useState<UpdateState>({
    mode: 'auto',
    available: false,
    currentVersion: '',
    lastCheck: null,
  });
  const [updatesBusy, setUpdatesBusy] = useState(false);
  const [updatePhase, setUpdatePhase] = useState<string | null>(null);
  const [updatePercent, setUpdatePercent] = useState<number | null>(null);
  const [installError, setInstallError] = useState('');
  const wavInputRef = useRef<HTMLInputElement>(null);
  const browserExtensionsAvailable = Boolean(
    typeof window !== 'undefined' && window.terminusDesktop?.addBrowserExtension
  );

  // The download and install run in the main process, so the menu follows the
  // phases it reports instead of guessing from the click.
  useEffect(() => {
    return onUpdateProgress((progress) => {
      setUpdatePhase(progress.phase);
      setUpdatePercent(
        progress.phase === 'downloading' && typeof progress.percent === 'number' ? progress.percent : null
      );
      setInstallError(progress.phase === 'error' ? progress.message || '' : '');
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void readAdblockState().then((state) => {
      if (active) setAdblock(state);
    });
    void readNetworkState().then((state) => {
      if (active) setNetwork(state);
    });
    void readBrowserExtensions().then((extensions) => {
      if (active) setBrowserExtensions(extensions);
    });
    void readUpdateState().then((state) => {
      if (active) setUpdates(state);
    });
    return () => {
      active = false;
    };
  }, [open]);

  const toggleAdblock = async () => {
    if (adblockBusy || !adblock.available) return;
    soundEffects.playKeyClick();
    setAdblockBusy(true);
    setAdblock((previous) => ({ ...previous, enabled: !previous.enabled }));
    const state = await applyAdblockEnabled(!adblock.enabled);
    setAdblock(state);
    setAdblockBusy(false);
  };

  const togglePrivateNetworks = async () => {
    if (networkBusy || !network.available) return;
    soundEffects.playKeyClick();
    setNetworkBusy(true);
    setNetwork((previous) => ({ ...previous, allowPrivate: !previous.allowPrivate }));
    const state = await applyAllowPrivateNetworks(!network.allowPrivate);
    setNetwork(state);
    setNetworkBusy(false);
  };

  const toggleSharedSession = () => {
    soundEffects.playKeyClick();
    const next = !sharedSession;
    setSharedSessionEnabled(next);
    setSharedSession(next);
  };

  const loadExtension = async () => {
    if (extensionsBusy) return;
    soundEffects.playKeyClick();
    setExtensionsBusy(true);
    setExtensionsError('');
    const result = await addBrowserExtension();
    if (result.ok) {
      setBrowserExtensions(result.extensions ?? (await readBrowserExtensions()));
    } else if (!result.cancelled) {
      setExtensionsError(t('settings.browserExtensionError'));
    }
    setExtensionsBusy(false);
  };

  const removeExtension = async (extension: BrowserExtensionInfo) => {
    if (extensionsBusy) return;
    soundEffects.playKeyClick();
    setExtensionsBusy(true);
    setExtensionsError('');
    const result = await removeBrowserExtension(extension.id ?? extension.path);
    if (result.ok) setBrowserExtensions(result.extensions ?? []);
    else setExtensionsError(t('settings.browserExtensionError'));
    setExtensionsBusy(false);
  };

  const changeUpdateMode = async (mode: UpdateMode) => {
    if (updatesBusy || !updates.available) return;
    soundEffects.playKeyClick();
    setUpdatesBusy(true);
    setUpdates(await applyUpdateMode(mode));
    setUpdatesBusy(false);
  };

  const checkUpdatesNow = async () => {
    if (updatesBusy || !updates.available) return;
    soundEffects.playKeyClick();
    setUpdatesBusy(true);
    setUpdates(await checkForUpdates());
    setUpdatesBusy(false);
  };

  const installNow = async () => {
    if (updatesBusy || !updates.available) return;
    soundEffects.playKeyClick();
    setUpdatesBusy(true);
    setInstallError('');
    setUpdatePhase('downloading');
    setUpdatePercent(null);
    const result = await installUpdate();
    if (result.status === 'error') {
      setUpdatePhase('error');
      setInstallError(result.message || '');
    }
    setUpdatesBusy(false);
  };

  const updatePhaseLabel =
    updatePhase === 'downloading'
      ? `${t('settings.updateDownloading')}${updatePercent === null ? '' : ` ${updatePercent} %`}`
      : updatePhase === 'verifying'
        ? t('settings.updateVerifying')
        : updatePhase === 'installing'
          ? t('settings.updateInstalling')
          : '';

  const updateStatus = (() => {
    const check = updates.lastCheck;
    if (!check) return '';
    if (check.status === 'available') {
      return t('settings.updateAvailable', { version: check.latestVersion });
    }
    if (check.status === 'current') {
      return t('settings.updateCurrent', { version: check.currentVersion || updates.currentVersion });
    }
    return t('settings.updateError');
  })();

  const sectionTitle = (label: string) => (
    <div className="mb-1 text-[9px] uppercase tracking-[0.16em] opacity-50">{label}</div>
  );

  return (
    <div className="relative flex shrink-0 items-stretch">
      <button
        type="button"
        className="tb-window-button"
        style={{ borderColor: theme.border }}
        onClick={() => {
          soundEffects.playKeyClick();
          setOpen((value) => !value);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('settings.open')}
        title={t('settings.open')}
      >
        <Menu className="h-3.5 w-3.5" />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label={t('settings.close')}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            className="absolute right-0 top-full z-50 mt-1 max-h-[calc(100vh-3.5rem)] w-72 overflow-y-auto border p-2 font-mono text-[10px] shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
            style={{ backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
            role="dialog"
            aria-label={t('settings.title')}
          >
            <div
              className="mb-2 flex items-center justify-between border-b pb-1.5 text-[9px] uppercase tracking-[0.14em] opacity-60"
              style={{ borderColor: theme.border }}
            >
              <span>{t('settings.title')}</span>
              <span>{isMuted ? t('settings.audioOff') : t('settings.audioOn')}</span>
            </div>

            <section aria-label={t('settings.language')} className="mb-3">
              {sectionTitle(t('settings.language'))}
              <label className="mb-1 flex items-center gap-1.5 text-[9px] uppercase tracking-wide opacity-50" htmlFor="terminus-locale-select">
                <Languages className="h-3 w-3" />
                {t('settings.languageLabel')}
              </label>
              <select
                id="terminus-locale-select"
                value={locale}
                onChange={(event) => {
                  soundEffects.playKeyClick();
                  setLocale(event.target.value as (typeof LOCALES)[number]['id']);
                }}
                className="w-full border px-2 py-1 text-[11px] cursor-pointer focus:outline-hidden"
                style={{ backgroundColor: theme.bg, borderColor: theme.border, color: theme.accent }}
              >
                {LOCALES.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </section>

            <section aria-label={t('settings.privateMode')} className="mb-3 border-t pt-2" style={{ borderColor: theme.border }}>
              {sectionTitle(t('settings.privateMode'))}
              <button
                type="button"
                onClick={() => {
                  soundEffects.playKeyClick();
                  setPrivateModeState(setPrivateMode(!privateMode));
                }}
                aria-pressed={privateMode}
                className="flex w-full items-center justify-between border px-2 py-1.5 cursor-pointer hover:bg-white/5"
                style={{ borderColor: privateMode ? theme.accent : theme.border }}
              >
                <span>{t('settings.privateMode')}</span>
                <span className="font-bold" style={{ color: privateMode ? theme.accent : theme.text }}>
                  {privateMode ? t('settings.privateModeOn') : t('settings.privateModeOff')}
                </span>
              </button>
              <p className="mt-1 text-[9px] leading-4 opacity-55">{t('settings.privateModeHint')}</p>
            </section>

            <section aria-label={t('settings.audio')} className="mb-3 border-t pt-2" style={{ borderColor: theme.border }}>
              {sectionTitle(t('settings.audio'))}
              <button
                type="button"
                onClick={onToggleMute}
                className="mb-2 flex w-full items-center justify-between border px-2 py-1.5 cursor-pointer hover:bg-white/5"
                style={{ borderColor: theme.border }}
              >
                <span>{isMuted ? t('settings.unmute') : t('settings.mute')}</span>
                {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
              </button>

              <label className="mb-1 block text-[9px] uppercase tracking-wide opacity-50" htmlFor="terminus-sound-theme">
                {t('settings.synth')}
              </label>
              <select
                id="terminus-sound-theme"
                value={soundTheme}
                onChange={(event) => {
                  const value = event.target.value as SoundTheme;
                  soundEffects.setSoundTheme(value);
                  setSoundTheme(value);
                }}
                className="mb-2 w-full border px-2 py-1 text-[11px] cursor-pointer focus:outline-hidden"
                style={{ backgroundColor: theme.bg, borderColor: theme.border, color: theme.accent }}
              >
                <option value="ibm-pc">IBM PC Speaker</option>
                <option value="c64-synth">Commodore 64 Synth</option>
                <option value="modern-ui">Modern UI</option>
              </select>

              <div className="mb-1 text-[9px] uppercase tracking-wide opacity-50">{t('settings.wav')}</div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    soundEffects.playKeyClick();
                    wavInputRef.current?.click();
                  }}
                  className="min-w-0 flex-1 cursor-pointer truncate border px-2 py-1 text-left hover:bg-white/5"
                  style={{ borderColor: customWavName ? theme.accent : theme.border, color: theme.text }}
                  title={customWavName ? `WAV: ${customWavName}` : t('settings.wavLoad')}
                >
                  {customWavName ? `WAV: ${customWavName}` : t('settings.wavLoad')}
                </button>
                {customWavName && (
                  <button
                    type="button"
                    onClick={() => {
                      soundEffects.playKeyClick();
                      soundEffects.clearCustomSound();
                      setCustomWavName(null);
                    }}
                    className="shrink-0 cursor-pointer border px-1.5 py-1 text-red-400 hover:text-red-300"
                    style={{ borderColor: theme.border }}
                    title={t('settings.wavRemove')}
                    aria-label={t('settings.wavRemove')}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              <input
                ref={wavInputRef}
                type="file"
                accept=".wav,audio/*"
                className="hidden"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const result = await soundEffects.loadCustomWavFile(file);
                  if (result.success) setCustomWavName(file.name);
                  else alert(result.message);
                }}
              />
            </section>

            <section
              aria-label={t('settings.appearance')}
              className="mb-3 border-t pt-2"
              style={{ borderColor: theme.border }}
            >
              {sectionTitle(t('settings.themes'))}
              <label className="mb-1 block text-[9px] uppercase tracking-wide opacity-50" htmlFor="terminus-theme-select">
                {t('settings.theme')}
              </label>
              <select
                id="terminus-theme-select"
                value={currentThemeId}
                onChange={(event) => {
                  soundEffects.playKeyClick();
                  onSelectTheme(event.target.value as ThemeId);
                }}
                className="mb-2 w-full border px-2 py-1 text-[11px] cursor-pointer focus:outline-hidden"
                style={{ backgroundColor: theme.bg, borderColor: theme.border, color: theme.accent }}
                title={t('settings.theme')}
              >
                {Object.values(THEMES).map((option) => (
                  <option key={option.id} value={option.id}>
                    {themeName(locale, option.id)}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    soundEffects.playKeyClick();
                    onSelectTheme(currentThemeId === 'black-and-white' ? 'cyberpunk-obsidian' : 'black-and-white');
                  }}
                  className="flex-1 cursor-pointer border px-2 py-1 text-[10px] font-bold"
                  style={{
                    borderColor: currentThemeId === 'black-and-white' ? '#ffffff' : theme.border,
                    backgroundColor: currentThemeId === 'black-and-white' ? '#ffffff' : 'transparent',
                    color: currentThemeId === 'black-and-white' ? '#000000' : theme.text,
                  }}
                  title={t('settings.bw')}
                >
                  {t('settings.bw')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    soundEffects.playKeyClick();
                    onToggleCrt();
                  }}
                  className="flex-1 cursor-pointer border px-2 py-1 text-[10px] font-bold"
                  style={{
                    borderColor: crtEnabled ? theme.accent : theme.border,
                    backgroundColor: crtEnabled ? 'rgba(255,255,255,0.12)' : 'transparent',
                    color: theme.text,
                  }}
                  title={t('settings.crt')}
                >
                  {t('settings.crt')}
                </button>
              </div>
            </section>

            <section
              aria-label={t('settings.adblock')}
              className="mb-3 border-t pt-2"
              style={{ borderColor: theme.border }}
            >
              {sectionTitle(t('settings.adblock'))}
              <button
                type="button"
                onClick={() => void toggleAdblock()}
                disabled={!adblock.available || adblockBusy}
                aria-pressed={adblock.enabled}
                className="mb-1 flex w-full items-center justify-between border px-2 py-1.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                style={{ borderColor: adblock.enabled ? theme.accent : theme.border }}
              >
                <span>{t('settings.adblock')}</span>
                <span style={{ color: adblock.enabled ? theme.accent : theme.text }}>
                  {adblock.enabled ? t('settings.on') : t('settings.off')}
                </span>
              </button>
              <p className="text-[9px] leading-4 opacity-45">
                {adblock.available ? t('settings.adblockHint') : t('settings.adblockDesktopOnly')}
              </p>
            </section>

            <section
              aria-label={t('settings.network')}
              className="mb-3 border-t pt-2"
              style={{ borderColor: theme.border }}
            >
              {sectionTitle(t('settings.network'))}
              <button
                type="button"
                onClick={() => void togglePrivateNetworks()}
                disabled={!network.available || networkBusy}
                aria-pressed={network.allowPrivate}
                className="mb-1 flex w-full items-center justify-between border px-2 py-1.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                style={{ borderColor: network.allowPrivate ? theme.accent : theme.border }}
              >
                <span className="flex items-center gap-1.5">
                  <Network className="h-3 w-3 shrink-0" style={{ color: theme.accent }} />
                  {t('settings.allowPrivate')}
                </span>
                <span style={{ color: network.allowPrivate ? theme.accent : theme.text }}>
                  {network.allowPrivate ? t('settings.on') : t('settings.off')}
                </span>
              </button>
              <p className="text-[9px] leading-4 opacity-45">
                {network.allowPrivate ? t('settings.allowPrivateHint') : t('settings.networkHint')}
              </p>
              {!network.available && (
                <p className="mt-1 text-[9px] leading-4 opacity-45">{t('settings.networkDesktopOnly')}</p>
              )}
              {network.available && !network.appliesLive && (
                <p className="mt-1 text-[9px] leading-4 opacity-45">{t('settings.networkRestart')}</p>
              )}
            </section>

            <section
              aria-label={t('settings.cookieSession')}
              className="mb-3 border-t pt-2"
              style={{ borderColor: theme.border }}
            >
              {sectionTitle(t('settings.cookieSession'))}
              <button
                type="button"
                onClick={toggleSharedSession}
                aria-pressed={sharedSession}
                className="mb-1 flex w-full items-center justify-between border px-2 py-1.5 cursor-pointer"
                style={{ borderColor: sharedSession ? theme.accent : theme.border }}
              >
                <span>{t('settings.sharedCookies')}</span>
                <span style={{ color: sharedSession ? theme.accent : theme.text }}>
                  {sharedSession ? t('settings.on') : t('settings.off')}
                </span>
              </button>
              <p className="text-[9px] leading-4 opacity-45">
                {sharedSession ? t('settings.sharedCookiesOnHint') : t('settings.sharedCookiesOffHint')}
              </p>
            </section>

            <section
              aria-label={t('settings.browserExtensions')}
              className="mb-3 border-t pt-2"
              style={{ borderColor: theme.border }}
            >
              {sectionTitle(t('settings.browserExtensions'))}
              {browserExtensions.length === 0 ? (
                <p className="mb-1 text-[9px] leading-4 opacity-45">
                  {t('settings.browserExtensionEmpty')}
                </p>
              ) : (
                <ul className="mb-1 space-y-1">
                  {browserExtensions.map((extension) => (
                    <li
                      key={extension.path}
                      className="flex items-center justify-between gap-2 border px-2 py-1"
                      style={{ borderColor: theme.border }}
                    >
                      <span className="min-w-0 truncate text-[10px]">
                        {extension.name}{' '}
                        <span className="opacity-50">{extension.version}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => void removeExtension(extension)}
                        disabled={extensionsBusy}
                        aria-label={`${t('settings.browserExtensionRemove')}: ${extension.name}`}
                        className="shrink-0 border px-1.5 py-0.5 text-[9px] cursor-pointer hover:bg-red-900/40 disabled:cursor-not-allowed disabled:opacity-50"
                        style={{ borderColor: theme.border }}
                      >
                        {t('settings.browserExtensionRemove')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() => void loadExtension()}
                disabled={extensionsBusy || !browserExtensionsAvailable}
                className="mb-1 flex w-full items-center justify-center gap-1.5 border px-2 py-1.5 cursor-pointer hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ borderColor: theme.border, color: theme.text }}
              >
                <Puzzle className="h-3 w-3 shrink-0" style={{ color: theme.accent }} />
                {t('settings.browserExtensionAdd')}
              </button>
              <p className="text-[9px] leading-4 opacity-45">
                {browserExtensionsAvailable
                  ? t('settings.browserExtensionsHint')
                  : t('settings.browserExtensionsDesktopOnly')}
              </p>
              {extensionsError && (
                <p className="mt-1 text-[9px] leading-4 text-red-400">{extensionsError}</p>
              )}
            </section>

            <section
              aria-label={t('settings.updates')}
              className="mb-3 border-t pt-2"
              style={{ borderColor: theme.border }}
            >
              {sectionTitle(t('settings.updates'))}
              <label
                className="mb-1 block text-[9px] uppercase tracking-wide opacity-50"
                htmlFor="terminus-update-mode"
              >
                {t('settings.updateMode')}
              </label>
              <select
                id="terminus-update-mode"
                value={updates.mode}
                onChange={(event) => void changeUpdateMode(event.target.value as UpdateMode)}
                disabled={!updates.available || updatesBusy}
                className="mb-2 w-full border px-2 py-1 text-[11px] cursor-pointer focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
                style={{ backgroundColor: theme.bg, borderColor: theme.border, color: theme.accent }}
              >
                <option value="auto">{t('settings.updatesAuto')}</option>
                <option value="manual">{t('settings.updatesManual')}</option>
              </select>

              <button
                type="button"
                onClick={() => void checkUpdatesNow()}
                disabled={!updates.available || updatesBusy}
                className="mb-1 flex w-full items-center justify-center gap-1.5 border px-2 py-1.5 cursor-pointer hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ borderColor: theme.border, color: theme.text }}
              >
                <RefreshCw
                  className={`h-3 w-3 shrink-0 ${updatesBusy ? 'animate-spin' : ''}`}
                  style={{ color: theme.accent }}
                />
                {updatesBusy ? t('settings.checking') : t('settings.checkNow')}
              </button>

              <p className="text-[9px] leading-4 opacity-45">
                {updates.mode === 'auto' ? t('settings.updatesAutoHint') : t('settings.updatesManualHint')}
              </p>
              {updateStatus && (
                <p
                  className="mt-1 text-[9px] leading-4"
                  style={{ color: updates.lastCheck?.status === 'available' ? theme.accent : theme.text }}
                  title={updates.lastCheck?.message}
                >
                  {updateStatus}
                </p>
              )}
              {updates.available && updates.lastCheck?.status === 'available' && (
                <button
                  type="button"
                  onClick={() => void installNow()}
                  disabled={updatesBusy || updatePhase === 'installing'}
                  className="mt-1 flex w-full items-center justify-center gap-1.5 border px-2 py-1.5 cursor-pointer hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ borderColor: theme.accent, color: theme.accent }}
                >
                  <Download className="h-3 w-3 shrink-0" />
                  {t('settings.installUpdate', { version: updates.lastCheck.latestVersion })}
                </button>
              )}
              {updatePhaseLabel && (
                <p className="mt-1 text-[9px] leading-4 opacity-60">{updatePhaseLabel}</p>
              )}
              {installError && (
                <p className="mt-1 text-[9px] leading-4" style={{ color: '#f87171' }} title={installError}>
                  {t('settings.updateInstallError')}
                </p>
              )}
              {!updates.available && (
                <p className="mt-1 text-[9px] leading-4 opacity-45">{t('settings.updatesDesktopOnly')}</p>
              )}
            </section>

            <section
              aria-label={t('settings.browser')}
              className="mb-3 border-t pt-2"
              style={{ borderColor: theme.border }}
            >
              {sectionTitle(t('settings.browser'))}
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => {
                    soundEffects.playKeyClick();
                    setOpen(false);
                    onOpenSecurity();
                  }}
                  className="flex flex-1 items-center justify-center gap-1.5 border px-2 py-1.5 cursor-pointer hover:bg-white/5"
                  style={{ borderColor: theme.border, color: theme.text }}
                >
                  <ShieldCheck className="h-3 w-3 shrink-0" style={{ color: theme.accent }} />
                  {t('header.security')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    soundEffects.playKeyClick();
                    setOpen(false);
                    onOpenExtensions();
                  }}
                  className="flex flex-1 items-center justify-center gap-1.5 border px-2 py-1.5 cursor-pointer hover:bg-white/5"
                  style={{ borderColor: theme.border, color: theme.text }}
                >
                  <Blocks className="h-3 w-3 shrink-0" style={{ color: theme.accent }} />
                  {t('header.extensions')}
                </button>
              </div>
            </section>

            <section
              aria-label={t('settings.security')}
              className="mb-1 border-t pt-2"
              style={{ borderColor: theme.border }}
            >
              {sectionTitle(t('settings.security'))}
              <LockSettings theme={theme} onLockNow={onLockNow} />

              {/* Security opens from the Navegador section, so this block only describes the vault. */}
              <div className="mt-3 border-t pt-2" style={{ borderColor: theme.border }}>
                <div className="mb-1 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.14em] opacity-60">
                  <ShieldCheck className="h-3 w-3" />
                  {t('settings.vault')}
                </div>
                <p className="text-[9px] leading-4 opacity-45">{t('settings.vaultHint')}</p>
              </div>
            </section>

            <p className="mt-2 border-t pt-1.5 text-[9px] leading-4 opacity-40" style={{ borderColor: theme.border }}>
              {t('settings.footer')}
            </p>
          </div>
        </>
      )}
    </div>
  );
};
