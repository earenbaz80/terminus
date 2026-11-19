/**
 * Terminus - Lectura inteligente.
 *
 * Utilidades sin dependencias para el modo lector: extracción del contenido
 * principal, detección del idioma y resumen extractivo. Todo se ejecuta en el
 * cliente, así que ninguna página visitada sale del equipo para resumirse.
 */

export interface LanguageGuess {
  /** ISO 639-1 cuando se reconoce; 'und' si no hay señal suficiente. */
  code: string;
  name: string;
  /** 0..1; proporción de palabras que coinciden con el idioma elegido. */
  confidence: number;
}

interface LanguageProfile {
  name: string;
  words: Set<string>;
}

const LANGUAGES: Record<string, LanguageProfile> = {
  es: {
    name: 'Español',
    words: new Set([
      'de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'que', 'en',
      'con', 'por', 'para', 'sin', 'sobre', 'entre', 'desde', 'hasta', 'del', 'al', 'se',
      'su', 'sus', 'es', 'son', 'fue', 'ser', 'como', 'mas', 'más', 'pero', 'si', 'no',
      'lo', 'le', 'les', 'ya', 'muy', 'este', 'esta', 'estos', 'estas', 'ese', 'esa',
      'también', 'porque', 'cuando', 'donde', 'todo', 'todos', 'puede', 'tiene', 'hace',
    ]),
  },
  en: {
    name: 'English',
    words: new Set([
      'the', 'and', 'for', 'are', 'was', 'were', 'with', 'from', 'that', 'this', 'these',
      'those', 'you', 'your', 'his', 'her', 'its', 'our', 'their', 'not', 'but', 'have',
      'has', 'had', 'will', 'would', 'can', 'could', 'into', 'than', 'then', 'there',
      'what', 'when', 'where', 'which', 'who', 'how', 'all', 'any', 'more', 'most', 'some',
      'they', 'them', 'been', 'being', 'about', 'after', 'before', 'also', 'should',
    ]),
  },
  fr: {
    name: 'Français',
    words: new Set([
      'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'que', 'qui', 'dans',
      'pour', 'par', 'avec', 'sans', 'sur', 'sous', 'entre', 'depuis', 'jusqu', 'au',
      'aux', 'se', 'sa', 'ses', 'son', 'est', 'sont', 'été', 'être', 'comme', 'mais',
      'plus', 'pas', 'ne', 'ce', 'cette', 'ces', 'cet', 'tout', 'tous', 'aussi', 'lorsque',
      'donc', 'alors', 'leur', 'leurs', 'nous', 'vous', 'ils', 'elles', 'avoir',
    ]),
  },
  de: {
    name: 'Deutsch',
    words: new Set([
      'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer',
      'und', 'oder', 'aber', 'mit', 'ohne', 'für', 'von', 'zu', 'zum', 'zur', 'im', 'in',
      'am', 'an', 'auf', 'über', 'unter', 'zwischen', 'seit', 'bis', 'ist', 'sind',
      'war', 'waren', 'sein', 'als', 'auch', 'nicht', 'noch', 'nur', 'sich', 'sie', 'wir',
      'ihr', 'ihre', 'dieser', 'diese', 'dieses', 'werden', 'wird', 'wurde', 'haben', 'hat',
    ]),
  },
  it: {
    name: 'Italiano',
    words: new Set([
      'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'di', 'del', 'della', 'dei',
      'delle', 'e', 'o', 'che', 'chi', 'in', 'con', 'per', 'senza', 'su', 'sopra', 'sotto',
      'tra', 'fra', 'da', 'dal', 'dalla', 'al', 'alla', 'si', 'suo', 'sua', 'suoi', 'sue',
      'è', 'sono', 'era', 'erano', 'essere', 'come', 'ma', 'più', 'non', 'questo', 'questa',
      'questi', 'queste', 'anche', 'quando', 'dove', 'tutto', 'tutti', 'può', 'ha', 'hanno',
    ]),
  },
  pt: {
    name: 'Português',
    words: new Set([
      'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das',
      'e', 'ou', 'que', 'quem', 'em', 'no', 'na', 'nos', 'nas', 'com', 'sem', 'por',
      'para', 'sobre', 'entre', 'desde', 'até', 'ao', 'aos', 'se', 'seu', 'sua', 'seus',
      'suas', 'é', 'são', 'era', 'eram', 'ser', 'como', 'mas', 'mais', 'não', 'este',
      'esta', 'estes', 'estas', 'esse', 'essa', 'também', 'quando', 'onde', 'todo', 'todos',
    ]),
  },
};

const STOPWORDS = new Set<string>([
  ...Object.values(LANGUAGES).flatMap((profile) => [...profile.words]),
  'http', 'https', 'www', 'com', 'org', 'net', 'html',
]);

const normalizeWords = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .split(/[^a-zà-ÿ\u00c0-\u017f']+/i)
    .map((word) => word.replace(/^'+|'+$/g, ''))
    .filter(Boolean);

/** Detecta el idioma dominante con un perfil de palabras funcionales. */
export const detectLanguage = (text: string): LanguageGuess => {
  const words = normalizeWords(text).slice(0, 4000);
  if (words.length < 12) return { code: 'und', name: 'Desconocido', confidence: 0 };

  let bestCode = 'und';
  let bestMatches = 0;
  for (const [code, profile] of Object.entries(LANGUAGES)) {
    let matches = 0;
    for (const word of words) {
      if (profile.words.has(word)) matches += 1;
    }
    if (matches > bestMatches) {
      bestMatches = matches;
      bestCode = code;
    }
  }

  if (bestCode === 'und' || bestMatches < 3) {
    return { code: 'und', name: 'Desconocido', confidence: 0 };
  }

  return {
    code: bestCode,
    name: LANGUAGES[bestCode].name,
    confidence: Math.min(1, bestMatches / Math.max(12, words.length * 0.18)),
  };
};

const splitSentences = (text: string): string[] => {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?…]+[.!?…]+[)"'»]*/g) ?? [clean];
  return sentences.map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 24);
};

/**
 * Resumen extractivo: puntúa cada oración por frecuencia de sus términos y por
 * su posición, y devuelve las mejores en el orden original del texto.
 */
export const summarizeText = (text: string, maxSentences = 5): string => {
  const sentences = splitSentences(text);
  if (sentences.length <= maxSentences) return sentences.join(' ');

  const frequencies = new Map<string, number>();
  for (const word of normalizeWords(text)) {
    if (word.length < 4 || STOPWORDS.has(word)) continue;
    frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
  }

  const scored = sentences.map((sentence, index) => {
    const words = normalizeWords(sentence).filter((word) => word.length >= 4 && !STOPWORDS.has(word));
    const score = words.reduce((total, word) => total + (frequencies.get(word) ?? 0), 0) /
      Math.sqrt(Math.max(1, words.length));
    const positionBonus = index < 2 ? 1.25 : index < 4 ? 1.1 : 1;
    return { index, sentence, score: score * positionBonus };
  });

  return scored
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.sentence)
    .join(' ');
};

const decodeEntities = (value: string): string =>
  value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)));

/**
 * Extrae el contenido principal de una página: descarta navegación, cabeceras,
 * pies, formularios y scripts, y prefiere <article>/<main> cuando existen.
 */
export const extractMainContent = (html: string): string => {
  if (!html) return '';

  let source = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<template\b[\s\S]*?<\/template>/gi, ' ')
    .replace(/<(nav|footer|aside|form|svg|iframe|header)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const article = source.match(/<article\b[\s\S]*?<\/article>/i) || source.match(/<main\b[\s\S]*?<\/main>/i);
  if (article) source = article[0];

  const text = source
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|li|h[1-6]|blockquote|pre|tr|td|th|figcaption)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');

  return decodeEntities(text).replace(/\n{3,}/g, '\n\n').trim();
};
