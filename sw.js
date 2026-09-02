/* B.E.L.A Gym — service worker */
const VERSION = '14.9';
const CACHE = 'bela-gym-' + VERSION;
const ASSETS = [
  '.',
  'index.html',
  'css/style.css?v=' + VERSION,
  'js/app.js?v=' + VERSION,
  'js/sync.js?v=' + VERSION,
  'js/exercises.js?v=' + VERSION,
  'js/foods.js?v=' + VERSION,
  'manifest.webmanifest',
  /* Icons are versioned like everything else. Without the ?v= the cache-first
     rule below would keep serving whatever art was cached the first time, and
     the notification would show last month's icon for good. */
  'icons/icon.svg?v=' + VERSION,
  'icons/icon-192.png?v=' + VERSION,
  'icons/notify-192.png?v=' + VERSION,
  'icons/badge-96.png?v=' + VERSION,
  'icons/blank-192.png?v=' + VERSION,
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

/* A file shared into the app (Samsung Health export -> Share -> B.E.L.A Gym)
   arrives as a POST. Stash it, then send the app to ?shared=1 to pick it up. */
const SHARE_KEY = 'shared-import';

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target/')) {
    e.respondWith((async () => {
      const home = url.pathname.replace(/share-target\/$/, '');
      try {
        const form = await e.request.formData();
        const file = form.get('file');
        const text = file && file.text ? await file.text() : String(form.get('text') || '');
        const c = await caches.open(CACHE);
        await c.put(SHARE_KEY, new Response(text, { headers: { 'Content-Type': 'text/plain' } }));
        return Response.redirect(home + '?shared=1', 303);
      } catch (err) {
        return Response.redirect(home + '?shared=error', 303);
      }
    })());
    return;
  }
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

/* Tapping the rest-over notification should bring the workout back up, not
   open a second copy of the app. */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.includes(self.registration.scope));
      if (open) return open.focus();
      return self.clients.openWindow(self.registration.scope);
    })
  );
});
