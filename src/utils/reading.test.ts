import { describe, expect, it } from 'vitest';
import { detectLanguage, extractMainContent, summarizeText } from './reading';

describe('reading', () => {
  it('detecta español e inglés por sus palabras funcionales', () => {
    const spanish =
      'La computación cuántica es una disciplina que usa los principios de la mecánica cuántica. ' +
      'Los ordenadores cuánticos pueden resolver problemas que las máquinas clásicas no pueden.';
    const english =
      'Quantum computing is a discipline that uses the principles of quantum mechanics. ' +
      'Quantum computers can solve problems that classical machines cannot solve easily.';

    expect(detectLanguage(spanish).code).toBe('es');
    expect(detectLanguage(english).code).toBe('en');
  });

  it('no inventa un idioma con muy poco texto', () => {
    expect(detectLanguage('hola').code).toBe('und');
  });

  it('resume conservando las oraciones más relevantes en orden', () => {
    const text =
      'El cifrado AES-256 protege los datos. ' +
      'AES-256 usa una clave de 256 bits y es el estándar del gobierno de Estados Unidos. ' +
      'Muchos productos guardan los archivos en disco. ' +
      'AES-256 también se usa en las conexiones TLS de los navegadores modernos. ' +
      'El cifrado AES-256 es rápido y seguro para los datos en reposo.';

    const summary = summarizeText(text, 2);
    expect(summary.length).toBeGreaterThan(0);
    expect(summary.toLowerCase()).toContain('aes-256');
    expect(summary.split('. ').length).toBeLessThanOrEqual(2);
  });

  it('extrae el artículo y descarta navegación, cabecera y scripts', () => {
    const html = `
      <html><head><style>body{color:red}</style></head>
      <body>
        <header><nav>Inicio · Productos · Contacto</nav></header>
        <article>
          <h1>Noticia principal</h1>
          <p>El contenido importante de la página.</p>
          <p>Un segundo párrafo con más detalles.</p>
        </article>
        <footer>Pie de página legal</footer>
        <script>console.log('secreto')</script>
      </body></html>`;

    const text = extractMainContent(html);
    expect(text).toContain('Noticia principal');
    expect(text).toContain('El contenido importante');
    expect(text).not.toContain('Inicio · Productos');
    expect(text).not.toContain('Pie de página legal');
    expect(text).not.toContain('secreto');
  });
});
