/**
 * Terminus - Parseo de resultados web reales.
 *
 * El buscador no usa APIs de "respuesta instantánea": descarga la página de
 * resultados de DuckDuckGo (HTML o Lite) y extrae título, URL y fragmento de
 * cada resultado. Sin claves ni intermediarios.
 */

import { decodeHtmlEntities } from './htmlEntities';

export interface ScrapedSearchResult {
  title: string;
  url: string;
  snippet: string;
}

const stripTags = (html: string): string =>
  decodeHtmlEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

const attributeValue = (attributes: string, name: string): string => {
  const doubleQuoted = attributes.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i'));
  if (doubleQuoted) return doubleQuoted[1];
  const singleQuoted = attributes.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i'));
  return singleQuoted ? singleQuoted[1] : '';
};

/** Convierte los enlaces redirigidos de DuckDuckGo (`/l/?uddg=...`) en la URL real. */
export const unwrapDuckDuckGoUrl = (href: string): string => {
  let raw = href.trim();
  if (!raw) return '';
  if (raw.startsWith('//')) raw = `https:${raw}`;
  if (raw.startsWith('/')) raw = `https://duckduckgo.com${raw}`;

  try {
    const parsed = new URL(raw);
    const target = parsed.searchParams.get('uddg');
    if (target) return decodeURIComponent(target);
    // Los enlaces internos (anuncios, configuración) no son resultados.
    if (/(^|\.)duckduckgo\.com$/i.test(parsed.hostname)) return '';
    return /^https?:\/\//i.test(parsed.toString()) ? parsed.toString() : '';
  } catch {
    return '';
  }
};

const anchors = (html: string): { attributes: string; inner: string }[] =>
  [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((match) => ({
    attributes: match[1] ?? '',
    inner: match[2] ?? '',
  }));

const dedupe = (results: ScrapedSearchResult[]): ScrapedSearchResult[] => {
  const seen = new Set<string>();
  const kept: ScrapedSearchResult[] = [];
  for (const result of results) {
    if (!result.url || seen.has(result.url)) continue;
    seen.add(result.url);
    kept.push(result);
  }
  return kept;
};

/**
 * Extrae resultados del HTML de `html.duckduckgo.com` o de `lite.duckduckgo.com`.
 * Los fragmentos son el texto real que muestra el buscador, no una frase fija.
 */
export const parseDuckDuckGoHtml = (html: string): ScrapedSearchResult[] => {
  if (!html) return [];

  // Formato Lite: <a class="result-link"> + <td class="result-snippet">.
  if (/result-link/i.test(html)) {
    const titles = anchors(html)
      .filter((anchor) => /result-link/i.test(attributeValue(anchor.attributes, 'class')))
      .map((anchor) => ({
        url: unwrapDuckDuckGoUrl(attributeValue(anchor.attributes, 'href')),
        title: stripTags(anchor.inner),
      }))
      .filter((entry) => entry.url && entry.title);

    const snippets = [...html.matchAll(/<td\b[^>]*class=['"][^'"]*result-snippet[^'"]*['"][^>]*>([\s\S]*?)<\/td>/gi)].map(
      (match) => stripTags(match[1] ?? '')
    );

    return dedupe(
      titles.map((entry, index) => ({
        title: entry.title,
        url: entry.url,
        snippet: snippets[index] ?? '',
      }))
    );
  }

  // Formato HTML: <a class="result__a"> + <a class="result__snippet">.
  const titleAnchors = anchors(html)
    .filter((anchor) => /result__a/i.test(attributeValue(anchor.attributes, 'class')))
    .map((anchor) => ({
      url: unwrapDuckDuckGoUrl(attributeValue(anchor.attributes, 'href')),
      title: stripTags(anchor.inner),
    }))
    .filter((entry) => entry.url && entry.title);

  const snippetAnchors = anchors(html)
    .filter((anchor) => /result__snippet/i.test(attributeValue(anchor.attributes, 'class')))
    .map((anchor) => stripTags(anchor.inner));

  return dedupe(
    titleAnchors.map((entry, index) => ({
      title: entry.title,
      url: entry.url,
      snippet: snippetAnchors[index] ?? '',
    }))
  );
};
