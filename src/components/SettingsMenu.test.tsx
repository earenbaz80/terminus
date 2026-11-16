import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '../i18n';
import { LOCALE_STORAGE_KEY } from '../i18n/locales';
import { THEMES } from '../utils/themes';
import type { ThemeId } from '../types';
import { NETWORK_PREFERENCE_KEY } from '../utils/networkPreference';
import { SettingsMenu } from './SettingsMenu';

afterEach(() => {
  cleanup();
  delete window.terminusDesktop;
  localStorage.removeItem(NETWORK_PREFERENCE_KEY);
  localStorage.removeItem(LOCALE_STORAGE_KEY);
});

const themeNames = (locale: string): string[] => {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  render(
    <I18nProvider>
      <SettingsMenu
        theme={THEMES['cyberpunk-obsidian']}
        currentThemeId="cyberpunk-obsidian"
        onSelectTheme={() => {}}
        isMuted={false}
        onToggleMute={() => {}}
        crtEnabled
        onToggleCrt={() => {}}
        onLockNow={() => {}}
        onOpenSecurity={() => {}}
        onOpenExtensions={() => {}}
      />
    </I18nProvider>
  );

  fireEvent.click(document.querySelector('button[aria-haspopup="dialog"]') as HTMLButtonElement);
  const select = document.getElementById('terminus-theme-select') as HTMLSelectElement | null;
  return Array.from(select?.options ?? []).map((option) => option.textContent ?? '');
};

describe('SettingsMenu theme selector', () => {
  it('muestra los nombres de tema del catálogo themeName.* en inglés', () => {
    const options = themeNames('en');

    expect(options).toEqual([
      'P1 Phosphor Green (VT100)',
      'DEC VT220 Amber',
      'Cyberpunk Obsidian',
      'Retro Futurist (Orbit 2086)',
      'MS-DOS 6.22 Classic Blue',
      'Matrix Minimalist Black',
      'Black & White (1-Bit Monochrome)',
    ]);
    expect(options.join(' ')).not.toMatch(/Órbita|Blanco y Negro|Monocromo/);
  });

  it('usa los nombres en español cuando la interfaz está en español', () => {
    const options = themeNames('es');

    expect(options).toContain('Retro Futurista (Órbita 2086)');
    expect(options).toContain('Blanco y Negro (1-Bit Monocromo)');
  });
});

const renderSettings = (overrides: { currentThemeId?: ThemeId; isMuted?: boolean } = {}) => {
  const currentThemeId = overrides.currentThemeId ?? 'cyberpunk-obsidian';
  const handlers = {
    onSelectTheme: vi.fn(),
    onToggleMute: vi.fn(),
    onToggleCrt: vi.fn(),
    onLockNow: vi.fn(),
    onOpenSecurity: vi.fn(),
    onOpenExtensions: vi.fn(),
  };
  render(
    <I18nProvider>
      <SettingsMenu
        theme={THEMES[currentThemeId]}
        currentThemeId={currentThemeId}
        isMuted={overrides.isMuted ?? false}
        crtEnabled
        {...handlers}
      />
    </I18nProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Menú de configuración' }));
  return handlers;
};

describe('SettingsMenu comportamiento', () => {
  it('abre el menú con sus secciones y lo cierra', () => {
    renderSettings();

    const dialog = screen.getByRole('dialog', { name: 'Configuración' });
    expect(within(dialog).getByRole('region', { name: 'Idioma' })).toBeTruthy();
    expect(within(dialog).getByRole('region', { name: 'Audio' })).toBeTruthy();
    expect(within(dialog).getByRole('region', { name: 'Apariencia' })).toBeTruthy();
    expect(within(dialog).getByRole('region', { name: 'Bloqueo de publicidad' })).toBeTruthy();
    expect(dialog.textContent).toContain('Seguridad');

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar menú de configuración' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cambia el tema avisando al padre y respeta el tema que recibe', () => {
    const handlers = renderSettings();
    const select = document.getElementById('terminus-theme-select') as HTMLSelectElement;

    expect(select.value).toBe('cyberpunk-obsidian');
    fireEvent.change(select, { target: { value: 'ms-dos' } });

    expect(handlers.onSelectTheme).toHaveBeenCalledTimes(1);
    expect(handlers.onSelectTheme).toHaveBeenCalledWith('ms-dos');
    // El select es controlado: hasta que el padre no cambie la prop, sigue mostrando el tema activo.
    expect(select.value).toBe('cyberpunk-obsidian');
  });

  it('alterna silencio y CRT desde el menú', () => {
    const handlers = renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Silenciar sonido' }));
    expect(handlers.onToggleMute).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('CRT'));
    expect(handlers.onToggleCrt).toHaveBeenCalledTimes(1);

    expect(handlers.onSelectTheme).not.toHaveBeenCalled();
  });

  it('alterna el blanco y negro sin tocar el resto de ajustes', () => {
    const mono = renderSettings();
    fireEvent.click(screen.getByTitle('B&W'));
    expect(mono.onSelectTheme).toHaveBeenCalledWith('black-and-white');
    expect(mono.onToggleMute).not.toHaveBeenCalled();
    expect(mono.onToggleCrt).not.toHaveBeenCalled();

    cleanup();
    const back = renderSettings({ currentThemeId: 'black-and-white' });
    const monoSelect = document.getElementById('terminus-theme-select') as HTMLSelectElement;
    expect(monoSelect.value).toBe('black-and-white');
    fireEvent.click(screen.getByTitle('B&W'));
    expect(back.onSelectTheme).toHaveBeenCalledWith('cyberpunk-obsidian');
  });
});

type StubNetworkState = { allowPrivate: boolean; available: boolean; appliesLive: boolean };

const stubDesktopBridge = (network: {
  getNetworkState: () => Promise<StubNetworkState>;
  setAllowPrivateNetworks: (allowPrivate: boolean) => Promise<StubNetworkState>;
}) => {
  window.terminusDesktop = {
    ...(window.terminusDesktop ?? {}),
    ...network,
  } as NonNullable<typeof window.terminusDesktop>;
};

const networkRegion = () =>
  within(screen.getByRole('dialog', { name: 'Configuración' })).getByRole('region', {
    name: 'Red y privacidad',
  });

describe('SettingsMenu red y privacidad', () => {
  it('bloquea los destinos privados por defecto y lo explica en la sección', async () => {
    renderSettings();
    const region = networkRegion();
    const toggle = await within(region).findByRole('button', { name: /Permitir destinos privados/ });

    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(region.textContent).toContain('El proxy y el DNS rechazan loopback');
    // Sin puente de escritorio el control queda inerte y se dice por qué.
    expect(toggle).toHaveProperty('disabled', true);
    expect(region.textContent).toContain('Se cambia desde la aplicación de escritorio');
  });

  it('alterna la excepción desde el escritorio y refleja lo que devuelve el proceso principal', async () => {
    const getNetworkState = vi
      .fn()
      .mockResolvedValue({ allowPrivate: false, available: true, appliesLive: true });
    const setAllowPrivateNetworks = vi
      .fn()
      .mockResolvedValue({ allowPrivate: true, available: true, appliesLive: true });
    stubDesktopBridge({ getNetworkState, setAllowPrivateNetworks });

    renderSettings();
    const region = networkRegion();
    const toggle = await within(region).findByRole('button', { name: /Permitir destinos privados/ });
    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('false'));
    expect(toggle).toHaveProperty('disabled', false);

    fireEvent.click(toggle);

    await waitFor(() => expect(setAllowPrivateNetworks).toHaveBeenCalledWith(true));
    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('true'));
    expect(region.textContent).toContain('la vista REAL sigue bloqueándolos');
    // El servidor corre en este proceso: no hay nada que avisar del reinicio.
    expect(region.textContent).not.toContain('al reiniciar Terminus');
    expect(localStorage.getItem(NETWORK_PREFERENCE_KEY)).toBe('1');
  });

  it('mantiene el control en el estado que manda el proceso principal si el entorno lo bloquea', async () => {
    // El proceso principal devuelve el valor efectivo: si el entorno fuerza el
    // bloqueo, el clic no puede dejar el menú en «permitido».
    const getNetworkState = vi
      .fn()
      .mockResolvedValue({ allowPrivate: false, available: true, appliesLive: true });
    const setAllowPrivateNetworks = vi
      .fn()
      .mockResolvedValue({ allowPrivate: false, available: true, appliesLive: true });
    stubDesktopBridge({ getNetworkState, setAllowPrivateNetworks });

    renderSettings();
    const toggle = await within(networkRegion()).findByRole('button', {
      name: /Permitir destinos privados/,
    });
    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('false'));

    fireEvent.click(toggle);

    await waitFor(() => expect(setAllowPrivateNetworks).toHaveBeenCalledWith(true));
    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('false'));
    expect(localStorage.getItem(NETWORK_PREFERENCE_KEY)).toBe('0');
  });

  it('avisa de que el cambio necesita reinicio cuando el servidor vive en otro proceso', async () => {
    const getNetworkState = vi
      .fn()
      .mockResolvedValue({ allowPrivate: true, available: true, appliesLive: false });
    const setAllowPrivateNetworks = vi
      .fn()
      .mockResolvedValue({ allowPrivate: false, available: true, appliesLive: false });
    stubDesktopBridge({ getNetworkState, setAllowPrivateNetworks });

    renderSettings();
    const region = networkRegion();
    const toggle = await within(region).findByRole('button', { name: /Permitir destinos privados/ });
    await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('true'));

    // `desktop:dev` arranca el servidor como hijo: el estado se guarda, pero no se
    // aplica hasta reiniciar, y el menú lo dice en vez de callarlo.
    expect(region.textContent).toContain('el cambio se aplica al reiniciar Terminus');
    expect(toggle).toHaveProperty('disabled', false);
  });
});
