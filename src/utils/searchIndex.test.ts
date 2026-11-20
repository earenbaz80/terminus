import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSnippet, foldText, TerminusSearchIndex, tokenize } from './searchIndex';

const directories: string[] = [];

const makeIndex = async (): Promise<TerminusSearchIndex> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'terminus-index-'));
  directories.push(directory);
  const index = new TerminusSearchIndex(directory);
  await index.load();
  return index;
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('TerminusSearchIndex', () => {
  it('folds accents and drops stopwords when tokenizing', () => {
    expect(foldText('Computación Cuántica')).toBe('computacion cuantica');
    expect(tokenize('la computación cuántica de los ordenadores')).toEqual([
      'computacion',
      'cuantica',
      'ordenadores',
    ]);
  });

  it('rejects documents without usable content', async () => {
    const index = await makeIndex();
    const added = await index.addDocument({
      url: 'https://example.com',
      title: 'Ejemplo',
      text: 'corto',
    });
    expect(added).toBe(false);
    expect(index.status().documents).toBe(0);
  });

  it('ranks the page that covers the query best and shows it in the snippet', async () => {
    const index = await makeIndex();
    await index.addDocument({
      url: 'https://example.com/redes',
      title: 'Redes neuronales',
      text: 'Las redes neuronales profundas aprenden representaciones densas. '.repeat(6),
    });
    await index.addDocument({
      url: 'https://example.com/cocina',
      title: 'Cocina',
      text: 'Recetas de cocina tradicional con redes para colar la salsa. '.repeat(6),
    });

    const hits = index.search('redes neuronales');
    expect(hits[0]?.url).toBe('https://example.com/redes');
    expect(hits[0]?.snippet.toLowerCase()).toContain('redes');
  });

  it('persists documents so a new instance can search them', async () => {
    const first = await makeIndex();
    await first.addDocument({
      url: 'https://example.com/doc',
      title: 'Protocolo QUIC',
      text: 'QUIC es un protocolo de transporte sobre UDP pensado para reducir latencia. '.repeat(8),
    });
    await first.flush();

    const second = new TerminusSearchIndex(first.status().directory);
    await second.load();

    expect(second.status().documents).toBe(1);
    expect(second.search('quic')[0]?.url).toBe('https://example.com/doc');
  });

  it('clear() vacía el índice en memoria y en disco', async () => {
    const first = await makeIndex();
    await first.addDocument({
      url: 'https://example.com/doc',
      title: 'Protocolo QUIC',
      text: 'QUIC es un protocolo de transporte sobre UDP pensado para reducir latencia. '.repeat(8),
    });
    await first.flush();

    await first.clear();

    expect(first.status().documents).toBe(0);
    expect(first.status().terms).toBe(0);
    expect(first.search('quic')).toEqual([]);

    const second = new TerminusSearchIndex(first.status().directory);
    await second.load();
    expect(second.status().documents).toBe(0);
  });

  it('no indexa términos que quedaron fuera del texto truncado', async () => {
    const index = await makeIndex();
    // 8 documentos de 60 000 caracteres llenan el presupuesto de 500 000.
    for (let i = 0; i < 8; i += 1) {
      await index.addDocument({
        url: `https://example.com/relleno-${i}`,
        title: 'Relleno',
        text: 'relleno '.repeat(7500),
      });
    }

    // Solo quedan ~20 000 caracteres: el término final cae fuera del recorte.
    const added = await index.addDocument({
      url: 'https://example.com/truncado',
      title: 'Truncado',
      text: `${'relleno '.repeat(2500)}unicotermino`,
    });

    expect(added).toBe(true);
    expect(index.search('unicotermino')).toHaveLength(0);
  });

  it('builds snippets with ellipses around the match', () => {
    const text = `${'relleno '.repeat(40)}objetivo ${'relleno '.repeat(40)}`;
    const snippet = buildSnippet(text, ['objetivo'], 120);

    expect(snippet).toContain('objetivo');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });
});
