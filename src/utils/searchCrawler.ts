/**
 * Crawler de Terminus. Recorre un sitio desde una URL semilla y entrega cada página
 * al índice propio. Es agnóstico de la red: `fetchPage` se inyecta, así que el servidor
 * reutiliza su ruta segura (`fetchRemote` con pinning de IP) y las pruebas usan un doble.
 */

export interface CrawlPage {
  url: string;
  title: string;
  text: string;
  links: string[];
}

export interface CrawlDeps {
  fetchPage(url: string): Promise<CrawlPage | null>;
  /** Política opcional por URL (robots.txt). Un false salta la página. */
  isAllowed?(url: string): Promise<boolean>;
  indexPage(page: { url: string; title: string; text: string }): Promise<boolean>;
  onPage?(event: { url: string; indexed: boolean; error?: string }): void;
}

export interface CrawlOptions {
  maxPages?: number;
  /** 0 indexa solo la semilla; 1 añade sus enlaces; 2 y 3 amplían. */
  depth?: number;
  /** Por defecto se queda en el mismo host para no dispersar el índice. */
  sameHost?: boolean;
  delayMs?: number;
}

export interface CrawlResult {
  seedUrl: string;
  pagesVisited: number;
  pagesIndexed: number;
  pagesSkipped: number;
  errors: string[];
  hosts: string[];
  durationMs: number;
}

const CRAWLABLE_EXTENSIONS = /\.(?:html?|xhtml|php|asp|aspx|jsp|txt|md)$/i;
const SKIPPED_EXTENSIONS =
  /\.(?:png|jpe?g|gif|webp|svg|ico|bmp|avif|mp4|webm|mp3|wav|ogg|pdf|zip|rar|7z|gz|tar|exe|msi|dmg|iso|woff2?|ttf|otf|eot|css|js|json)$/i;

/** Normaliza un enlace: resuelve relativos, quita el hash y descarta esquemas no web. */
export function normalizeCrawlUrl(raw: string, base?: string): string | null {
  const value = (raw || '').trim();
  if (!value || /^(?:mailto|tel|javascript|data|about):/i.test(value)) return null;

  let parsed: URL;
  try {
    parsed = base ? new URL(value, base) : new URL(value);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  if (SKIPPED_EXTENSIONS.test(parsed.pathname)) return null;

  parsed.hash = '';
  return parsed.href;
}

/** Solo se pone en cola lo que parece una página navegable. */
const looksCrawlable = (url: string): boolean => {
  try {
    const { pathname } = new URL(url);
    if (!pathname || pathname === '/') return true;
    return CRAWLABLE_EXTENSIONS.test(pathname) || !pathname.includes('.');
  } catch {
    return false;
  }
};

export async function crawlSite(
  seed: string,
  deps: CrawlDeps,
  options: CrawlOptions = {}
): Promise<CrawlResult> {
  const startedAt = Date.now();
  const maxPages = Math.min(Math.max(options.maxPages ?? 20, 1), 100);
  const depth = Math.min(Math.max(options.depth ?? 1, 0), 3);
  const sameHost = options.sameHost ?? true;
  const delayMs = Math.max(options.delayMs ?? 200, 0);

  const seedUrl = normalizeCrawlUrl(seed);
  if (!seedUrl) throw new Error('URL inválida: se esperaba una dirección http(s).');

  const seedHost = new URL(seedUrl).hostname;
  const queue: { url: string; level: number }[] = [{ url: seedUrl, level: 0 }];
  const scheduled = new Set<string>([seedUrl]);
  const hosts = new Set<string>();
  const errors: string[] = [];

  let pagesVisited = 0;
  let pagesIndexed = 0;
  let pagesSkipped = 0;

  while (queue.length > 0 && pagesVisited < maxPages) {
    const next = queue.shift();
    if (!next) break;

    pagesVisited += 1;

    try {
      if (deps.isAllowed && !(await deps.isAllowed(next.url))) {
        pagesSkipped += 1;
        deps.onPage?.({ url: next.url, indexed: false, error: 'robots' });
        continue;
      }

      const page = await deps.fetchPage(next.url);
      if (!page) {
        pagesSkipped += 1;
        deps.onPage?.({ url: next.url, indexed: false, error: 'sin contenido' });
        continue;
      }

      try {
        hosts.add(new URL(page.url).hostname);
      } catch {
        // La URL final siempre es válida; si no, el índice la rechaza igualmente.
      }

      const indexed = await deps.indexPage({
        url: page.url,
        title: page.title,
        text: page.text,
      });
      if (indexed) pagesIndexed += 1;
      else pagesSkipped += 1;
      deps.onPage?.({ url: page.url, indexed });

      if (next.level < depth) {
        for (const raw of page.links) {
          if (queue.length + scheduled.size >= maxPages * 8) break;
          const link = normalizeCrawlUrl(raw, page.url);
          if (!link || scheduled.has(link) || !looksCrawlable(link)) continue;
          if (sameHost && new URL(link).hostname !== seedHost) continue;
          scheduled.add(link);
          queue.push({ url: link, level: next.level + 1 });
        }
      }
    } catch (err: any) {
      pagesSkipped += 1;
      errors.push(`${next.url}: ${err?.message || String(err)}`);
      deps.onPage?.({ url: next.url, indexed: false, error: err?.message || 'error' });
    }

    if (delayMs > 0 && queue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return {
    seedUrl,
    pagesVisited,
    pagesIndexed,
    pagesSkipped,
    errors: errors.slice(0, 10),
    hosts: Array.from(hosts).sort(),
    durationMs: Date.now() - startedAt,
  };
}
