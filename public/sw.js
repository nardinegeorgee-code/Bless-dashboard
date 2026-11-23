// Bless Team Hub service worker: makes the app installable and keeps the shell available offline.
// It never caches /api (live data, sign-in cookies) or anything that is not a GET from this site.
const VER = 'bless-v1';
const SHELL = ['/', '/manifest.webmanifest', '/favicon.png', '/bless-logo.png', '/bless-butterfly.png', '/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VER).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VER).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;

  // Pages: network first so a new deploy shows at once; fall back to the saved shell when offline.
  if (r.mode === 'navigate') {
    e.respondWith(
      fetch(r).then((res) => {
        const copy = res.clone();
        caches.open(VER).then((c) => c.put('/', copy));
        return res;
      }).catch(() => caches.match('/').then((m) => m || new Response('You are offline. Reconnect and reopen the Hub.', { status: 503, headers: { 'Content-Type': 'text/plain' } })))
    );
    return;
  }

  // Built files (hashed names) and images: cache first, filled on first use.
  e.respondWith(
    caches.match(r).then((hit) => hit || fetch(r).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VER).then((c) => c.put(r, copy)); }
      return res;
    }))
  );
});
