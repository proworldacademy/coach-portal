/* PROWORLD — the app's service worker (Nov 3, 2026). Enough for "Add to Home Screen" on Android and the standalone window on
   iPhone: the app shell is served network-first (every push to the site is live at once), with the last copy as the offline fallback.
   Nothing from the database or the API is ever cached here. */
const SHELL = 'pw-shell-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/__/')) return;
  if (!(e.request.mode === 'navigate' || /\.(css|js|png|webmanifest)$/.test(u.pathname))) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(SHELL).then((x) => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request)));
});
