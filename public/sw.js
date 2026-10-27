// @ts-check
/// <reference lib="webworker" />
/**
 * Offline support for the static export.
 * - Navigations: network first, cached copy when offline.
 * - /_next/static/*: cache first (file names are content-hashed, so entries never go stale).
 * - Other same-origin GETs: stale-while-revalidate.
 * The cache is versioned per build (`?v=` on the worker URL), so each deploy installs a new
 * worker and the previous build's files are deleted on activation.
 */
const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));
const CACHE = `neje-web-engraver-${new URL(sw.location.href).searchParams.get('v') ?? 'dev'}`;
const SCOPE = new URL(sw.registration.scope);

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([SCOPE.href, new URL('manifest.webmanifest', SCOPE).href, new URL('icon.svg', SCOPE).href]))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener('message', (event) => {
  if (event.data?.type !== 'warm' || !Array.isArray(event.data.urls)) return;
  const urls = event.data.urls.filter((/** @type {unknown} */ u) => typeof u === 'string' && u.startsWith(SCOPE.origin));
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(urls.map((u) => cache.add(u).catch(() => undefined)))));
});

/** @param {Request} request @param {Response} response */
async function put(request, response) {
  if (response.ok && response.type === 'basic') await (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== SCOPE.origin) return;

  if (request.mode === 'navigate') {
    // a half-finished or broken deploy answers 404/5xx: keep serving the last good copy then
    const cached = async () => (await caches.match(request, { ignoreSearch: true })) ?? (await caches.match(SCOPE.href));
    event.respondWith(
      fetch(request)
        .then(async (r) => (r.ok ? put(request, r) : ((await cached()) ?? r)))
        .catch(async () => (await cached()) ?? Response.error()),
    );
    return;
  }

  if (url.pathname.includes('/_next/static/')) {
    event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request).then((r) => put(request, r))));
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((r) => put(request, r))
        .catch(() => hit ?? Response.error());
      if (hit) event.waitUntil(network);
      return hit ?? network;
    }),
  );
});
