import { describe, expect, it } from 'vitest';
import { parseDuckDuckGoHtml, unwrapDuckDuckGoUrl } from './searchScrape';

describe('searchScrape', () => {
  it('unwrap DuckDuckGo redirects and rejects internal links', () => {
    expect(unwrapDuckDuckGoUrl('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1')).toBe(
      'https://example.com/a?b=1'
    );
    expect(unwrapDuckDuckGoUrl('https://duckduckgo.com/y.js?ad=1')).toBe('');
    expect(unwrapDuckDuckGoUrl('https://example.org/page')).toBe('https://example.org/page');
  });

  it('parses the HTML endpoint with real titles, URLs and snippets', () => {
    const html = `
      <div class="result results_links">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fclima.example%2Fmadrid">Clima en Madrid hoy</a>
        <a class="result__snippet" href="#">Temperatura actual, máxima y mínima para Madrid.</a>
      </div>
      <div class="result results_links">
        <a rel="nofollow" class="result__a" href="https://www.aemet.es/es/eltiempo/prediccion/municipios/madrid">AEMET · Madrid</a>
        <a class="result__snippet" href="#">Predicción oficial del tiempo para el municipio de Madrid.</a>
      </div>
    `;

    expect(parseDuckDuckGoHtml(html)).toEqual([
      {
        title: 'Clima en Madrid hoy',
        url: 'https://clima.example/madrid',
        snippet: 'Temperatura actual, máxima y mínima para Madrid.',
      },
      {
        title: 'AEMET · Madrid',
        url: 'https://www.aemet.es/es/eltiempo/prediccion/municipios/madrid',
        snippet: 'Predicción oficial del tiempo para el municipio de Madrid.',
      },
    ]);
  });

  it('parses the Lite endpoint used when the HTML page is blocked', () => {
    const html = `
      <table>
        <tr>
          <td><a rel="nofollow" href="https://lite.example/one" class='result-link'>Primer resultado</a></td>
        </tr>
        <tr><td class='result-snippet'>Fragmento real del primer resultado.</td></tr>
      </table>
    `;

    expect(parseDuckDuckGoHtml(html)).toEqual([
      {
        title: 'Primer resultado',
        url: 'https://lite.example/one',
        snippet: 'Fragmento real del primer resultado.',
      },
    ]);
  });

  it('returns nothing for a page without results', () => {
    expect(parseDuckDuckGoHtml('<html><body><p>Sin resultados</p></body></html>')).toEqual([]);
  });
});
