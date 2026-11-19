import { describe, expect, it, vi } from 'vitest';
import {
  chunkText,
  isTranslationConfigured,
  MAX_TRANSLATE_CHARS,
  translateText,
  TRANSLATE_URL_ENV,
} from './translation';

describe('translation', () => {
  it('avisa de que no está configurada sin llamar al proveedor', async () => {
    const fetchImpl = vi.fn();
    const result = await translateText(fetchImpl as unknown as typeof fetch, {}, { text: 'hola', target: 'en' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('not_configured');
      expect(result.message).toContain(TRANSLATE_URL_ENV);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(isTranslationConfigured({ url: '   ' })).toBe(false);
    expect(isTranslationConfigured({ url: 'https://translate.example' })).toBe(true);
  });

  it('envía texto, idiomas y clave solo desde el servidor', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ translatedText: 'hello world' }),
    }));

    const result = await translateText(
      fetchImpl as unknown as typeof fetch,
      { url: 'https://translate.example/', apiKey: 'server-only-key' },
      { text: 'hola mundo', source: 'es', target: 'en' }
    );

    expect(result).toEqual({ ok: true, text: 'hello world' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://translate.example/translate');
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      q: 'hola mundo',
      source: 'es',
      target: 'en',
      format: 'text',
      api_key: 'server-only-key',
    });
  });

  it('recorta el texto y rechaza respuestas sin translatedText', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ error: 'idioma no soportado' }),
    }));

    const result = await translateText(
      fetchImpl as unknown as typeof fetch,
      { url: 'https://translate.example' },
      { text: 'x'.repeat(MAX_TRANSLATE_CHARS + 100), target: 'en' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid_response');
      expect(result.message).toContain('idioma no soportado');
    }
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).q).toHaveLength(MAX_TRANSLATE_CHARS);
  });

  it('propaga los fallos HTTP del proveedor', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }));
    const result = await translateText(
      fetchImpl as unknown as typeof fetch,
      { url: 'https://translate.example' },
      { text: 'hola', target: 'en' }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('request_failed');
      expect(result.message).toContain('429');
    }
  });

  it('parte el texto en fragmentos que respetan el límite', () => {
    const text = 'palabra '.repeat(200).trim();
    const chunks = chunkText(text, 100);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 100)).toBe(true);
    expect(chunks.join(' ')).toBe(text);
  });
});
