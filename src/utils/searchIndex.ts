/**
 * Motor de búsqueda propio de Terminus.
 *
 * Mantiene un índice local de las páginas que el navegador ha visitado o crawleado y
 * responde consultas con BM25. No consulta ningún motor externo: el índice se guarda en
 * disco y sobrevive a reinicios y actualizaciones.
 */
import { promises as fs } from 'fs';
import path from 'path';

export interface SearchDocumentInput {
  url: string;
  title: string;
  text: string;
}

export interface IndexedDocument {
  url: string;
  title: string;
  host: string;
  /** Texto plano recortado; se usa para construir el fragmento de cada resultado. */
  text: string;
  fetchedAt: string;
  /** Número de términos indexados (longitud del documento para BM25). */
  length: number;
  terms: Record<string, number>;
}

export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
  host: string;
  score: number;
}

export interface IndexStatus {
  documents: number;
  hosts: string[];
  terms: number;
  updatedAt: string;
  directory: string;
}

const INDEX_VERSION = 1;
const MAX_DOCUMENTS = 5000;
const MAX_TEXT_CHARS = 60000;
const MAX_TERMS_PER_DOCUMENT = 800;
const MIN_TEXT_CHARS = 80;
const MAX_TOTAL_TEXT_CHARS = 500000;
const BM25_K1 = 1.2;
const BM25_B = 0.75;

/** Stopwords ES + EN: no aportan señal y engordan el índice. */
const STOPWORDS = new Set([
  'de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'u', 'e', 'a', 'en',
  'con', 'por', 'para', 'sin', 'sobre', 'entre', 'desde', 'hasta', 'que', 'del', 'al', 'se',
  'su', 'sus', 'es', 'son', 'fue', 'ser', 'como', 'mas', 'más', 'pero', 'si', 'no', 'lo',
  'le', 'les', 'ya', 'muy', 'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas',
  'the', 'and', 'for', 'are', 'was', 'were', 'with', 'from', 'that', 'this', 'these', 'those',
  'you', 'your', 'his', 'her', 'its', 'our', 'their', 'not', 'but', 'have', 'has', 'had',
  'will', 'would', 'can', 'could', 'into', 'than', 'then', 'they', 'them', 'there', 'here',
  'about', 'after', 'before', 'over', 'under', 'all', 'any', 'out', 'one', 'two', 'how',
  'what', 'when', 'where', 'who', 'why', 'http', 'https', 'www', 'com', 'org', 'net',
]);

/**
 * Pliega acentos 1:1 (misma longitud que la entrada) para que los offsets del texto
 * plegado sigan sirviendo sobre el texto original al recortar fragmentos.
 */
export const foldText = (input: string): string =>
  Array.from(input)
    .map((char) => {
      const decomposed = char.normalize('NFD');
      return decomposed[0] || char;
    })
    .join('')
    .toLowerCase();

/** Convierte texto libre en términos indexables. */
export const tokenize = (input: string): string[] => {
  const folded = foldText(input);
  const tokens: string[] = [];
  const pattern = /[a-z0-9]+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(folded)) !== null) {
    const token = match[0];
    if (token.length < 2 || token.length > 40) continue;
    if (STOPWORDS.has(token)) continue;
    tokens.push(token);
  }
  return tokens;
};

/** Recorta una ventana de texto alrededor del primer término encontrado. */
export function buildSnippet(text: string, queryTerms: string[], maxChars = 180): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '';

  const folded = foldText(flat);
  let hit = -1;
  for (const term of queryTerms) {
    const at = folded.indexOf(term);
    if (at !== -1 && (hit === -1 || at < hit)) hit = at;
  }

  const center = hit === -1 ? 0 : hit;
  let start = Math.max(0, center - Math.floor(maxChars / 3));
  let end = Math.min(flat.length, start + maxChars);

  if (start > 0) {
    const space = flat.indexOf(' ', start);
    if (space !== -1 && space < center) start = space + 1;
  }
  if (end < flat.length) {
    const space = flat.lastIndexOf(' ', end);
    if (space > center) end = space;
  }

  const snippet = flat.slice(start, end).trim();
  if (!snippet) return '';
  return `${start > 0 ? '…' : ''}${snippet}${end < flat.length ? '…' : ''}`;
}

/** Conserva solo los términos más frecuentes para acotar el tamaño persistido. */
const topTerms = (terms: Record<string, number>): Record<string, number> => {
  const entries = Object.entries(terms);
  if (entries.length <= MAX_TERMS_PER_DOCUMENT) return terms;
  return Object.fromEntries(
    entries
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_TERMS_PER_DOCUMENT)
  );
};

export class TerminusSearchIndex {
  private readonly documents = new Map<string, IndexedDocument>();
  private readonly documentFrequency = new Map<string, number>();
  private loaded = false;
  private loading: Promise<void> | null = null;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private updatedAt = '';
  private totalTextChars = 0;

  constructor(private readonly directory: string) {}

  private get filePath(): string {
    return path.join(this.directory, 'index.json');
  }

  /** Carga el índice persistido una sola vez (llamadas concurrentes comparten la promesa). */
  async load(): Promise<void> {
    if (this.loaded) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      try {
        const raw = await fs.readFile(this.filePath, 'utf8');
        const parsed = JSON.parse(raw) as {
          version?: number;
          updatedAt?: string;
          documents?: IndexedDocument[];
        };
        if (parsed?.version === INDEX_VERSION && Array.isArray(parsed.documents)) {
          for (const doc of parsed.documents) {
            if (!doc?.url || !doc?.terms) continue;
            this.documents.set(doc.url, doc);
            for (const term of Object.keys(doc.terms)) {
              this.documentFrequency.set(term, (this.documentFrequency.get(term) || 0) + 1);
            }
          }
          this.updatedAt = typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '';
        }
      } catch {
        // Sin índice previo (o corrupto): se arranca vacío y se reescribe en la próxima indexación.
      } finally {
        this.loaded = true;
        this.loading = null;
      }
    })();

    return this.loading;
  }

  /** Añade o refresca una página. Devuelve false si no aporta contenido indexable. */
  async addDocument(input: SearchDocumentInput): Promise<boolean> {
    await this.load();

    const url = (input.url || '').trim();
    if (!/^https?:\/\//i.test(url)) return false;

    const title = (input.title || '').trim().slice(0, 200) || url;

    let text = (input.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
    if (text.length < MIN_TEXT_CHARS) return false;

    // Recortar el texto ANTES de tokenizar: los términos guardados deben existir
    // en el texto que realmente se persiste. Al reindexar la misma URL su texto
    // anterior se descuenta del presupuesto, porque se reemplaza, no se suma.
    const previous = this.documents.get(url);
    const previousChars = previous?.text.length ?? 0;
    const budget = MAX_TOTAL_TEXT_CHARS - (this.totalTextChars - previousChars);
    if (text.length > budget) {
      text = text.slice(0, Math.max(0, budget));
    }
    if (text.length < MIN_TEXT_CHARS) return false;

    const tokens = tokenize(`${title} ${title} ${text}`);
    if (tokens.length < 3) return false;

    const host = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return '';
      }
    })();
    if (!host) return false;

    const counts: Record<string, number> = {};
    for (const token of tokens) counts[token] = (counts[token] || 0) + 1;

    if (previous) {
      this.totalTextChars = Math.max(0, this.totalTextChars - previous.text.length);
      for (const term of Object.keys(previous.terms)) {
        const df = (this.documentFrequency.get(term) || 1) - 1;
        if (df > 0) this.documentFrequency.set(term, df);
        else this.documentFrequency.delete(term);
      }
    } else if (this.documents.size >= MAX_DOCUMENTS) {
      // Índice lleno: se descarta el documento más antiguo.
      let oldestUrl = '';
      let oldestAt = '';
      for (const [docUrl, doc] of this.documents) {
        if (!oldestAt || doc.fetchedAt < oldestAt) {
          oldestAt = doc.fetchedAt;
          oldestUrl = docUrl;
        }
      }
      if (oldestUrl) {
        const oldDoc = this.documents.get(oldestUrl);
        if (oldDoc) {
          for (const term of Object.keys(oldDoc.terms)) {
            const df = (this.documentFrequency.get(term) || 1) - 1;
            if (df > 0) this.documentFrequency.set(term, df);
            else this.documentFrequency.delete(term);
          }
        }
        if (oldDoc) this.totalTextChars = Math.max(0, this.totalTextChars - oldDoc.text.length);
        this.documents.delete(oldestUrl);
      }
    }

    const document: IndexedDocument = {
      url,
      title,
      host,
      text,
      fetchedAt: new Date().toISOString(),
      length: tokens.length,
      terms: topTerms(counts),
    };

    this.documents.set(url, document);
    this.totalTextChars += text.length;
    for (const term of Object.keys(document.terms)) {
      this.documentFrequency.set(term, (this.documentFrequency.get(term) || 0) + 1);
    }

    this.updatedAt = document.fetchedAt;
    this.scheduleSave();
    return true;
  }

  /** Consulta BM25 sobre el índice local. */
  search(query: string, limit = 20): SearchHit[] {
    const queryTerms = Array.from(new Set(tokenize(query)));
    if (!queryTerms.length || !this.documents.size) return [];

    const total = this.documents.size;
    let totalLength = 0;
    for (const doc of this.documents.values()) totalLength += doc.length || 1;
    const averageLength = totalLength / total || 1;

    const scored: { doc: IndexedDocument; score: number }[] = [];
    for (const doc of this.documents.values()) {
      let score = 0;
      let matched = 0;
      for (const term of queryTerms) {
        const frequency = doc.terms[term];
        if (!frequency) continue;
        matched += 1;
        const documentFrequency = this.documentFrequency.get(term) || 0;
        const idf = Math.log(1 + (total - documentFrequency + 0.5) / (documentFrequency + 0.5));
        score +=
          idf *
          ((frequency * (BM25_K1 + 1)) /
            (frequency + BM25_K1 * (1 - BM25_B + (BM25_B * doc.length) / averageLength)));
      }
      if (!score) continue;
      // Coincidencia parcial: cubrir más términos de la consulta siempre gana.
      score += matched * 0.25;
      scored.push({ doc, score });
    }

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, Math.max(1, limit)).map(({ doc, score }) => ({
      url: doc.url,
      title: doc.title,
      host: doc.host,
      snippet: buildSnippet(doc.text, queryTerms),
      score: Number(score.toFixed(4)),
    }));
  }

  has(url: string): boolean {
    return this.documents.has(url);
  }

  status(): IndexStatus {
    const hosts = new Set<string>();
    for (const doc of this.documents.values()) hosts.add(doc.host);
    return {
      documents: this.documents.size,
      hosts: Array.from(hosts).sort(),
      terms: this.documentFrequency.size,
      updatedAt: this.updatedAt,
      directory: this.directory,
    };
  }

  /** Fuerza el guardado pendiente (usado al cerrar o en pruebas). */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.save();
  }

  /** Borra todo el índice, dejando un índice vacío persistente. */
  async clear(): Promise<void> {
    this.documents.clear();
    this.documentFrequency.clear();
    this.totalTextChars = 0;
    this.updatedAt = '';
    await this.save();
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save().catch(() => undefined);
    }, 800);
    (this.saveTimer as unknown as { unref?: () => void }).unref?.();
  }

  private async save(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    await fs.mkdir(this.directory, { recursive: true });
    const payload = {
      version: INDEX_VERSION,
      updatedAt: this.updatedAt,
      documents: Array.from(this.documents.values()),
    };
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(payload));
    await fs.rename(temporary, this.filePath);
  }
}
