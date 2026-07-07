/**
 * Service worker — offline support so the app keeps working in kitchen
 * Wi-Fi dead zones and as an installed PWA.
 *
 * Strategy:
 *   - Navigations: network-first (deploys propagate immediately), falling
 *     back to the cached app shell when offline.
 *   - Everything else same-origin (Vite emits content-hashed, immutable
 *     asset names) plus Google Fonts: cache-first, filled from the network.
 *
 * Bump CACHE to invalidate everything after a breaking change.
 */

const CACHE = 'tempguide-v1';
const APP_SHELL = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Navigations: network-first with offline fallback to the cached shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Assets: cache-first for our own origin and the font CDN
  const cacheable =
    url.origin === location.origin ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com';
  if (!cacheable) return;

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          // Opaque responses (no-cors font requests) can't be inspected but are cacheable
          if (res.ok || res.type === 'opaque') {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        }),
    ),
  );
});
