/* Schnell-Deal Service Worker
 * - Offline-Shell: statische Next.js-Assets cache-first, Seiten network-first mit Fallback auf den letzten Stand.
 * - API-Aufrufe werden NIE gecacht (Daten kommen immer vom Server; Offline-Schreibzugriffe übernimmt die IndexedDB-Warteschlange).
 * - Web-Push-Benachrichtigungen.
 */
const VERSION = 'sd-v1';
const STATIC = `${VERSION}-static`;
const PAGES = `${VERSION}-pages`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(PAGES).then((c) => c.addAll(['/aussendienst', '/manifest.webmanifest', '/icon-192.png']).catch(() => undefined)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // nie cachen

  if (url.pathname.startsWith('/_next/static/') || /\.(png|svg|ico|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(PAGES).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match('/aussendienst')) || new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } })),
    );
  }
});

self.addEventListener('push', (event) => {
  let data = { title: 'Schnell-Deal', body: '', link: '/' };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    /* Textnachricht */
  }
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: '/icon-192.png', badge: '/icon-192.png', data: { link: data.link || '/' } }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.navigate(link);
          return c.focus();
        }
      }
      return self.clients.openWindow(link);
    }),
  );
});
