export const TERMINUS_SEARCH_URL = 'terminus://search';
export const TERMINUS_SEARCH_PROVIDER = 'DuckDuckGo';

export const isTerminusSearchUrl = (url?: string): boolean =>
  Boolean(url && url.startsWith(TERMINUS_SEARCH_URL));

export const buildTerminusSearchUrl = (query?: string): string => {
  const cleanQuery = (query ?? '').trim();
  return cleanQuery ? `${TERMINUS_SEARCH_URL}?q=${encodeURIComponent(cleanQuery)}` : TERMINUS_SEARCH_URL;
};

export const getTerminusSearchQuery = (url?: string): string => {
  if (!isTerminusSearchUrl(url)) return '';
  try {
    return (new URL(url as string).searchParams.get('q') ?? '').trim();
  } catch {
    return '';
  }
};

export interface ParsedSearchQuery {
  /** Consulta sin operadores; es la que se envía al proveedor. */
  text: string;
  /** site:dominio — restringe a un host. */
  site: string;
  /** intitle:palabra — exige el término en el título. */
  intitle: string;
  /** inurl:palabra — exige el término en la URL. */
  inurl: string;
  /** Términos precedidos por "-" que no deben aparecer. */
  exclude: string[];
}

const readOperator = (raw: string, name: string): string => {
  const match = raw.match(new RegExp(`\\b${name}:("[^"]+"|\\S+)`, 'i'));
  return match ? match[1].replace(/^"/, '').replace(/"$/, '') : '';
};

/** Separa los operadores de búsqueda de la consulta libre. */
export const parseSearchQuery = (raw: string): ParsedSearchQuery => {
  const exclude: string[] = [];
  const text = raw
    .replace(/\b(?:site|intitle|inurl):("[^"]+"|\S+)/gi, ' ')
    .replace(/(^|\s)-(\S+)/g, (_match, space: string, term: string) => {
      exclude.push(term.toLowerCase());
      return space;
    })
    .replace(/\s+/g, ' ')
    .trim();

  return {
    text: text || raw.trim(),
    site: readOperator(raw, 'site'),
    intitle: readOperator(raw, 'intitle'),
    inurl: readOperator(raw, 'inurl'),
    exclude,
  };
};

export interface SearchProvider {
  id: 'duckduckgo' | 'wikipedia';
  label: string;
  /** Página del proveedor para abrir la búsqueda fuera de Terminus. */
  urlTemplate: (query: string) => string;
}

export const SEARCH_PROVIDERS: SearchProvider[] = [
  {
    id: 'duckduckgo',
    label: 'DuckDuckGo',
    urlTemplate: (query) => `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
  },
  {
    id: 'wikipedia',
    label: 'Wikipedia',
    urlTemplate: (query) =>
      `https://es.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(query)}`,
  },
];

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Parte un texto en tramos marcados y no marcados para resaltar los términos
 * de la consulta en los resultados, sin usar HTML.
 */
export const splitHighlight = (
  text: string,
  query: string
): { text: string; match: boolean }[] => {
  const { text: bare } = parseSearchQuery(query);
  const terms = bare
    .split(/\s+/)
    .map((term) => term.replace(/^"|"$/g, '').trim())
    .filter((term) => term.length >= 2);

  if (!text || terms.length === 0) return [{ text, match: false }];

  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  const parts: { text: string; match: boolean }[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), match: false });
    }
    parts.push({ text: match[0], match: true });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex), match: false });
  return parts.length > 0 ? parts : [{ text, match: false }];
};
