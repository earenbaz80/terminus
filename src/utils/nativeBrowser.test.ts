import { describe, expect, it } from 'vitest';
import { NATIVE_PARTITION_PREFIX, createNativeWebview, partitionForUrl } from './nativeBrowser';

describe('native browser embedding', () => {
  it('gives every site its own persistent session partition', () => {
    expect(partitionForUrl('https://example.com/a')).toBe('persist:terminus-site-example.com');
    expect(partitionForUrl('http://example.com:8080/')).toBe('persist:terminus-site-example.com');
    expect(partitionForUrl('https://sub.example.com/')).toBe(
      'persist:terminus-site-sub.example.com'
    );
    expect(partitionForUrl('https://evil.test/')).not.toBe(partitionForUrl('https://example.com/'));
    expect(partitionForUrl('not a url')).toBe('persist:terminus-site-unknown');
    expect(partitionForUrl('https://example.com/').startsWith(NATIVE_PARTITION_PREFIX)).toBe(true);
  });

  // Sin `allowpopups`, Electron no llama a `setWindowOpenHandler` del invitado y un
  // `target=_blank` no llega nunca a la app: el paso 14 del E2E instalado lo cubre
  // de punta a punta, y esto evita que el atributo se caiga sin que nadie lo note.
  it('permite que el invitado pida una ventana nueva para que la app decida', () => {
    const view = createNativeWebview();

    expect(view.getAttribute('allowpopups')).toBe('');
  });
});
