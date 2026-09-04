// SPDX-License-Identifier: AGPL-3.0-or-later
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'apps/pwa/dist');
const prefix = '/mb-label-editor/';
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
};

const localRequests = [];
const localServer = createServer((request, response) => {
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => {
    body += chunk;
  });
  request.on('end', () => {
    localRequests.push({
      method: request.method ?? '',
      url: request.url ?? '',
      authorization: request.headers.authorization ?? '',
      accept: request.headers.accept ?? '',
      body,
    });
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    response.setHeader('access-control-allow-headers', 'authorization,content-type');
    response.setHeader('cache-control', 'no-store');
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
    } else if (request.url === '/v1/pair') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ token: 'release-pair-grant' }));
    } else if (request.url === '/v1/jobs/release/events') {
      response.setHeader('content-type', 'text/event-stream');
      response.end('event: progress\ndata: {"terminal":true}\n\n');
    } else {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ status: 'ready' }));
    }
  });
});
await new Promise((resolve) => localServer.listen(0, '127.0.0.1', resolve));
const localAddress = localServer.address();
if (!localAddress || typeof localAddress === 'string') throw new Error('local test server did not bind');

let catalogRequests = 0;
let catalogAuthorization = '';
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
    if (url.pathname === `${prefix}v1/catalog`) {
      catalogRequests++;
      catalogAuthorization = request.headers.authorization ?? '';
      response.setHeader('content-type', 'application/json');
      response.setHeader('cache-control', 'no-store');
      response.end(JSON.stringify({ private: true }));
      return;
    }
    if (url.pathname === `${prefix}access-expired`) {
      response.writeHead(302, { location: '/cdn-cgi/access/login' }).end();
      return;
    }
    if (url.pathname === '/cdn-cgi/access/login') {
      response.setHeader('content-type', 'text/html');
      response.end('<!doctype html><title>Cloudflare Access login</title>');
      return;
    }
    if (!url.pathname.startsWith(prefix)) {
      response.writeHead(404).end();
      return;
    }
    const relative = url.pathname.slice(prefix.length) || 'index.html';
    let path = join(dist, normalize(relative));
    if (!(await stat(path)).isFile()) path = join(dist, 'index.html');
    response.setHeader('content-type', types[extname(path)] ?? 'application/octet-stream');
    response.end(await readFile(path));
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('release PWA server did not bind');

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox'],
});

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const url = `http://127.0.0.1:${address.port}${prefix}`;
  await page.goto(url);
  if ((await page.title()) !== 'MakersBrain Label Editor') throw new Error('non-root PWA failed to load');

  const manifest = await page.locator('link[rel=manifest]').getAttribute('href');
  const manifestResponse = await context.request.get(new URL(manifest ?? '', url).href);
  if (!manifestResponse.ok()) throw new Error('non-root manifest failed');
  const wasmResponse = await context.request
    .get(new URL((await page.locator('script[type=module]').getAttribute('src')) ?? '', url).href)
    .catch(() => undefined);
  if (wasmResponse && !wasmResponse.ok()) throw new Error('non-root module failed');

  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
    throw new Error('service worker did not control the release page');
  }
  if (localRequests.length !== 0) {
    throw new Error('PWA startup probed the local service before a user action');
  }

  const localOrigin = `http://127.0.0.1:${localAddress.port}`;
  await page.evaluate(
    async ({ localOrigin }) => {
      const catalogUrl = new URL('v1/catalog', location.href);
      const api = await fetch(catalogUrl, {
        headers: { authorization: 'Bearer release-test' },
      });
      if (!api.ok) throw new Error('same-origin API fixture failed');
      const repeatedApi = await fetch(catalogUrl, {
        headers: { authorization: 'Bearer release-test' },
      });
      if (!repeatedApi.ok) throw new Error('same-origin API repeat failed');
      const local = await fetch(`${localOrigin}/v1/status`);
      if (!local.ok) throw new Error('cross-origin local fixture failed');
      const pair = await fetch(`${localOrigin}/v1/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret: 'release-pair-secret' }),
      });
      if (!pair.ok) throw new Error('cross-origin pairing fixture failed');
      const events = await fetch(`${localOrigin}/v1/jobs/release/events`, {
        headers: { authorization: 'Bearer release-pair-grant', accept: 'text/event-stream' },
      });
      if (!events.ok || !(await events.text()).includes('"terminal":true')) {
        throw new Error('cross-origin event stream fixture failed');
      }
      const access = await fetch(new URL('access-expired', location.href));
      if (!access.redirected || !access.url.includes('/cdn-cgi/access/login')) {
        throw new Error('Access redirect fixture failed');
      }
    },
    { localOrigin },
  );

  const cacheEvidence = await page.evaluate(async () => {
    const urls = [];
    const bodies = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        urls.push(request.url);
        const response = await cache.match(request);
        bodies.push(await response?.clone().text());
      }
    }
    const rootResponse = await caches.match(new URL('./', location.href).href);
    return { urls, bodies, root: await rootResponse?.text() };
  });
  if (
    cacheEvidence.urls.some(
      (item) => item.includes('/v1/') || item.includes('/cdn-cgi/') || item.includes('access-expired'),
    )
  ) {
    throw new Error(`private or Access response entered Cache API: ${cacheEvidence.urls.join(', ')}`);
  }
  if (!cacheEvidence.root?.includes('<title>MakersBrain Label Editor</title>')) {
    throw new Error('Access redirect replaced the cached application shell');
  }
  if (
    cacheEvidence.bodies.some((item) => item?.includes('release-pair-secret') || item?.includes('release-pair-grant'))
  ) {
    throw new Error('pairing material entered a Cache API response');
  }
  if (catalogRequests !== 2 || catalogAuthorization !== 'Bearer release-test') {
    throw new Error(`asset API was cached or lost Authorization: requests=${catalogRequests}`);
  }
  const applicationRequests = localRequests.filter((item) => item.method !== 'OPTIONS');
  if (applicationRequests.length !== 3) {
    throw new Error(`expected status, pair, and event-stream requests, received ${applicationRequests.length}`);
  }
  if (!applicationRequests.some((item) => item.url === '/v1/pair' && item.body.includes('release-pair-secret'))) {
    throw new Error('pairing request did not reach the active document boundary');
  }
  if (
    !applicationRequests.some(
      (item) => item.url.endsWith('/events') && item.authorization === 'Bearer release-pair-grant',
    )
  ) {
    throw new Error('event stream did not reach the active document boundary');
  }

  await context.setOffline(true);
  await page.reload();
  if ((await page.title()) !== 'MakersBrain Label Editor')
    throw new Error('installed non-root PWA failed offline reload');
  await context.close();
  console.log('non-root PWA, API/pairing/SSE cache boundaries, Access redirect, and offline acceptance passed');
} finally {
  await browser.close();
  server.close();
  localServer.close();
}
