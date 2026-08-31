// SPDX-License-Identifier: AGPL-3.0-or-later
const CACHE = 'mb-label-editor-v4';
const ROOT = new URL('./', self.location.href);
const API_PATH = new URL('v1/', ROOT).pathname;
const SHELL = [ROOT.href, new URL('manifest.webmanifest', ROOT).href, new URL('icons/icon.svg', ROOT).href];

function applicationRequest(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  return url.origin === self.location.origin
    && !url.pathname.startsWith(API_PATH)
    && !url.pathname.startsWith('/cdn-cgi/');
}

function cacheable(request, response) {
  return response.ok
    && !response.redirected
    && response.type === 'basic'
    && response.url === request.url;
}

async function fetchAndCache(request) {
  const response = await fetch(request);
  if (cacheable(request, response)) {
    const copy = response.clone();
    void caches.open(CACHE).then(cache => cache.put(request, copy));
  }
  return response;
}

self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  for (const url of SHELL) {
    const request = new Request(url, { credentials: 'same-origin' });
    const response = await fetch(request);
    if (!cacheable(request, response)) throw new Error(`Refusing to cache redirected PWA shell response for ${url}`);
    await cache.put(request, response);
  }
  await self.skipWaiting();
})()));

self.addEventListener('activate', event => event.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim())
));

self.addEventListener('fetch', event => {
  // Let the active document perform loopback Local Network Access requests.
  // Also keep authenticated /v1/ and Cloudflare Access traffic out of Cache API.
  if (!applicationRequest(event.request)) return;
  event.respondWith(event.request.mode === 'navigate'
    ? fetchAndCache(event.request).catch(() => caches.match(ROOT.href))
    : caches.match(event.request).then(hit => hit ?? fetchAndCache(event.request)));
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
