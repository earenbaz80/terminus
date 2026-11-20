import { describe, expect, it, vi } from 'vitest';
import { crawlSite, normalizeCrawlUrl, type CrawlPage } from './searchCrawler';

const page = (url: string, links: string[] = []): CrawlPage => ({
  url,
  title: `Título de ${url}`,
  text: 'contenido indexable '.repeat(30),
  links,
});

describe('normalizeCrawlUrl', () => {
  it('resolves relative links and drops fragments', () => {
    expect(normalizeCrawlUrl('/docs#intro', 'https://example.com/base')).toBe(
      'https://example.com/docs'
    );
  });

  it('rejects non-web schemes and binary assets', () => {
    expect(normalizeCrawlUrl('mailto:hola@example.com')).toBeNull();
    expect(normalizeCrawlUrl('https://example.com/foto.png')).toBeNull();
    expect(normalizeCrawlUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('crawlSite', () => {
  it('indexes the seed and same-host links up to the page limit', async () => {
    const indexPage = vi.fn(async () => true);
    const fetchPage = vi.fn(async (url: string) =>
      url.endsWith('/')
        ? page('https://example.com/', ['/a', '/b', 'https://otro.example/x'])
        : page(url)
    );

    const result = await crawlSite(
      'https://example.com/',
      { fetchPage, indexPage },
      { depth: 1, maxPages: 3, delayMs: 0 }
    );

    expect(result.pagesVisited).toBe(3);
    expect(result.pagesIndexed).toBe(3);
    expect(indexPage).toHaveBeenCalledTimes(3);
    const visited = fetchPage.mock.calls.map(([url]) => url as string);
    expect(visited.some((url) => url.includes('otro.example'))).toBe(false);
  });

  it('respects the robots policy before fetching', async () => {
    const indexPage = vi.fn(async () => true);
    const fetchPage = vi.fn(async () => page('https://example.com/'));

    const result = await crawlSite(
      'https://example.com/',
      { fetchPage, indexPage, isAllowed: async () => false },
      { depth: 0, maxPages: 5, delayMs: 0 }
    );

    expect(fetchPage).not.toHaveBeenCalled();
    expect(result.pagesSkipped).toBe(1);
    expect(result.pagesIndexed).toBe(0);
  });

  it('never visits more pages than the cap', async () => {
    const fetchPage = vi.fn(async (url: string) =>
      page(url, ['https://example.com/a', 'https://example.com/b', 'https://example.com/c'])
    );
    const result = await crawlSite(
      'https://example.com/',
      { fetchPage, indexPage: async () => true },
      { depth: 2, maxPages: 2, delayMs: 0 }
    );

    expect(result.pagesVisited).toBe(2);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});
