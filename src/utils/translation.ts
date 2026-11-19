/**
 * Terminus - Traducción de página con proveedor configurable.
 *
 * El proveedor y su clave viven SOLO en el servidor, en variables de entorno:
 *   - TERMINUS_TRANSLATE_URL  (obligatoria, servicio compatible con LibreTranslate)
 *   - TERMINUS_TRANSLATE_API_KEY (opcional)
 *
 * El cliente nunca ve la URL ni la clave: envía el texto a /api/translate y el
 * servidor habla con el proveedor. Sin URL configurada, la traducción responde
 * `not_configured` para que la interfaz muestre un aviso claro.
 */

export const TRANSLATE_URL_ENV = 'TERMINUS_TRANSLATE_URL';
export const TRANSLATE_KEY_ENV = 'TERMINUS_TRANSLATE_API_KEY';

/** Límite por petición, alineado con el endpoint del servidor. */
export const MAX_TRANSLATE_CHARS = 5000;
/** Fragmentos que el cliente envía como máximo por página. */
export const MAX_TRANSLATE_CHUNKS = 4;

export interface TranslationConfig {
  url?: string;
  apiKey?: string;
}

export interface TranslateTextInput {
  text: string;
  /** Idioma origen; se omite si no se reconoce. */
  source?: string;
  target: string;
}

export type TranslationFailure = 'not_configured' | 'request_failed' | 'invalid_response';

export type TranslateTextResult =
  | { ok: true; text: string }
  | { ok: false; reason: TranslationFailure; message: string };

export const isTranslationConfigured = (config: TranslationConfig): boolean =>
  Boolean(config.url && config.url.trim());

/** Parte el texto en fragmentos que respetan el límite del proveedor. */
export const chunkText = (text: string, maxChars = 4000): string[] => {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks: string[] = [];
  let current = '';

  for (const word of clean.split(' ')) {
    if (!word) continue;
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length > maxChars) {
      chunks.push(current);
      current = word;
    } else {
      current = `${current} ${word}`;
    }

    // Una sola palabra más larga que el límite se corta en seco.
    while (current.length > maxChars) {
      chunks.push(current.slice(0, maxChars));
      current = current.slice(maxChars);
    }
  }

  if (current) chunks.push(current);
  return chunks;
};

export const translateText = async (
  fetchImpl: typeof fetch,
  config: TranslationConfig,
  input: TranslateTextInput
): Promise<TranslateTextResult> => {
  const baseUrl = config.url?.trim().replace(/\/+$/, '');
  if (!baseUrl) {
    return {
      ok: false,
      reason: 'not_configured',
      message: `${TRANSLATE_URL_ENV} no está definida en el servidor.`,
    };
  }

  const text = input.text.trim();
  if (!text) {
    return { ok: false, reason: 'request_failed', message: 'El texto a traducir está vacío.' };
  }

  const body: Record<string, string> = {
    q: text.slice(0, MAX_TRANSLATE_CHARS),
    target: input.target,
    format: 'text',
  };
  if (input.source && /^[a-z]{2}$/i.test(input.source) && input.source.toLowerCase() !== 'und') {
    body.source = input.source.toLowerCase();
  }
  if (config.apiKey) body.api_key = config.apiKey;

  try {
    const response = await fetchImpl(`${baseUrl}/translate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        DNT: '1',
        'Sec-GPC': '1',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      return {
        ok: false,
        reason: 'request_failed',
        message: `El proveedor respondió HTTP ${response.status}.`,
      };
    }

    const data = (await response.json()) as { translatedText?: unknown; error?: unknown };
    if (typeof data?.translatedText !== 'string') {
      return {
        ok: false,
        reason: 'invalid_response',
        message:
          typeof data?.error === 'string'
            ? data.error
            : 'El proveedor no devolvió translatedText.',
      };
    }

    return { ok: true, text: data.translatedText };
  } catch (error) {
    return {
      ok: false,
      reason: 'request_failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }
};
