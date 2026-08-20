/* B.E.L.A Gym — service worker */
const VERSION = '7.0';
const CACHE = 'bela-gym-' + VERSION;
const ASSETS = [
  '.',
  'index.html',
  'css/style.css?v=' + VERSION,
  'js/app.js?v=' + VERSION,
  'js/exercises.js?v=' + VERSION,
  'js/foods.js?v=' + VERSION,
  'manifest.webmanifest',
  'icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' bypasses the HTTP cache — without it the browser can
      // hand back the previous deploy's files and the "update" changes nothing
      .then((c) => Promise.all(ASSETS.map((url) =>
        fetch(new Request(url, { cache: 'reload' }))
          .then((res) => (res.ok ? c.put(url, res) : null))
          .catch(() => null)
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const sameOrigin = new URL(e.request.url).origin === location.origin;
  const put = (res) => {
    if (res.ok && sameOrigin) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
    }
    return res;
  };
  // the page itself is always fetched fresh, so a new deploy is picked up
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(put)
        .catch(() => caches.match(e.request).then((c) => c || caches.match('index.html')))
    );
    return;
  }
  // versioned assets are safe to serve from cache, and refresh in the background
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const network = fetch(e.request).then(put).catch(() => cached);
      return cached || network;
    })
  );
});
