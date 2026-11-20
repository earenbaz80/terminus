import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();
const CHILD_TIMEOUT_MS = 20000;

type HttpResponse = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
};

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('El servidor de fixtures no expuso un puerto TCP.'));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: http.Server | undefined): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('No se pudo reservar un puerto libre.'));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function request(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      { method: init.method ?? 'GET', headers: init.headers ?? {} },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
          });
        });
      }
    );
    req.setTimeout(15000, () => req.destroy(new Error(`Timeout al consultar ${url}`)));
    req.once('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

async function waitForServer(baseUrl: string): Promise<HttpResponse> {
  const deadline = Date.now() + CHILD_TIMEOUT_MS;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await request(`${baseUrl}/api/session`);
      if (response.status === 200) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`El servidor de Terminus no arrancó: ${String(lastError)}`);
}

const fixturePage = (title: string, body: string, link?: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body><p>${body}</p>` +
  (link ? `<a href="${link}">Siguiente</a>` : '') +
  '</body></html>';

describe('/api/index integration', () => {
  let fixtureServer: http.Server | undefined;
  let terminus: ChildProcess | undefined;
  let terminusLogs = '';
  let terminusOrigin = '';
  let fixtureOrigin = '';
  let indexDirectory = '';
  let sessionCookie = '';

  beforeAll(async () => {
    fixtureServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (req.url === '/') {
        res.end(
          fixturePage(
            'Semilla',
            'Contenido extenso sobre redes neuronales y aprendizaje profundo para indexar en local sin salir del equipo.',
            '/detalle'
          )
        );
        return;
      }
      res.end(
        fixturePage(
          'Detalle',
          'Detalle sobre redes convolucionales y vision artificial para indexar correctamente la pagina del sitio.'
        )
      );
    });
    const fixturePort = await listen(fixtureServer);
    fixtureOrigin = `http://127.0.0.1:${fixturePort}`;

    indexDirectory = await mkdtemp(path.join(os.tmpdir(), 'terminus-index-integration-'));

    const terminusPort = await getFreePort();
    terminusOrigin = `http://127.0.0.1:${terminusPort}`;
    terminus = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: String(terminusPort),
        TERMINUS_ALLOW_PRIVATE: '1',
        TERMINUS_BLOCK_PRIVATE: '0',
        TERMINUS_NETWORK_POLICY: 'local',
        TERMINUS_SEARCH_INDEX_DIR: indexDirectory,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    terminus.stdout?.on('data', (chunk: Buffer) => {
      terminusLogs += chunk.toString();
    });
    terminus.stderr?.on('data', (chunk: Buffer) => {
      terminusLogs += chunk.toString();
    });

    const session = await waitForServer(terminusOrigin);
    const setCookie = session.headers['set-cookie'];
    const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (!cookieHeader) throw new Error(`/api/session no devolvió cookie. Logs: ${terminusLogs}`);
    sessionCookie = cookieHeader.split(';')[0];
  }, 30000);

  afterAll(async () => {
    if (terminus && terminus.exitCode === null) {
      terminus.kill();
      await Promise.race([
        once(terminus, 'exit').then(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    }
    await close(fixtureServer);
    if (indexDirectory) {
      await rm(indexDirectory, { recursive: true, force: true });
    }
  });

  const postIndex = (payload: unknown) =>
    request(`${terminusOrigin}/api/index`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
      body: JSON.stringify(payload),
    });

  it('indexa dos páginas con POST y las devuelve con GET', async () => {
    const response = await postIndex({ url: `${fixtureOrigin}/` });

    expect(response.status).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.pagesVisited).toBe(2);
    expect(body.pagesIndexed).toBe(2);
    expect(body.pagesSkipped).toBe(0);
    expect(body.index.documents).toBe(2);
    expect(body.index.directory).toBe(indexDirectory);

    const search = await request(`${terminusOrigin}/api/index?q=redes`, {
      headers: { Cookie: sessionCookie },
    });

    expect(search.status).toBe(200);
    const found = JSON.parse(search.body);
    expect(found.query).toBe('redes');
    expect(found.results.length).toBeGreaterThan(0);
    expect(found.results.some((result: { url: string }) => result.url === `${fixtureOrigin}/detalle`)).toBe(
      true
    );
    expect(found.index.documents).toBe(2);
  }, 20000);

  it('devuelve el estado cuando se pide el índice sin consulta', async () => {
    const response = await request(`${terminusOrigin}/api/index`, {
      headers: { Cookie: sessionCookie },
    });

    expect(response.status).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(true);
    expect(body.index.documents).toBe(2);
    expect(body.index.hosts).toEqual(['127.0.0.1']);
  });

  it('rechaza con 400 una URL que no es http(s)', async () => {
    const response = await postIndex({ url: 'ftp://example.com/archivo' });

    expect(response.status).toBe(400);
    expect(JSON.parse(response.body).error).toBe('invalid_url');
  });

  it('rechaza con 403 un host de metadatos sin tocar la red', async () => {
    const response = await postIndex({ url: 'http://169.254.169.254/latest/meta-data/' });

    expect(response.status).toBe(403);
    expect(JSON.parse(response.body).error).toBe('blocked_host');
  });
});
