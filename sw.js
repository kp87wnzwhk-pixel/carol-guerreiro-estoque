/* Service worker — cache leve v4 (sem vendor OCR enorme) */
const CACHE = 'cgi-estoque-v7';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/storage.js',
  './js/db.js',
  './js/ocr.js',
  './js/ocr-fill.js',
  './js/sync.js',
  './js/firebase-config.js',
  './js/cdn.json',
  './manifest.json',
  './icons/logo.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      for (const url of ASSETS) {
        try { await cache.add(url); } catch (e) { console.warn('SW skip', url, e); }
      }
      await self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.includes('/vendor/') || url.hostname.includes('gstatic.com') || url.hostname.includes('googleapis.com')) {
    event.respondWith(fetch(req));
    return;
  }
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetched = fetch(req)
        .then((res) => {
          if (res && res.ok && url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
