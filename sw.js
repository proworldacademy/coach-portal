/* PROWORLD — the app's service worker (Nov 3, 2026). Enough for "Add to Home Screen" on Android and the standalone window on
   iPhone: the app shell is served network-first (every push to the site is live at once), with the last copy as the offline fallback.
   Nothing from the database or the API is ever cached here. */
const SHELL = 'pw-shell-v1';   // (the name stays: the copies kept are still good)
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/__/')) return;
  if (!(e.request.mode === 'navigate' || /\.(css|js|png|webmanifest)$/.test(u.pathname))) return;
  // Nov 16, 2026: the network still comes first, but it gets four seconds. On a weak signal a request can hang for a minute with the page
  // blank behind it; after four seconds the last copy kept on the device is shown, and the fresh one is still stored when it arrives.
  e.respondWith((async () => {
    const net = fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(SHELL).then((x) => x.put(e.request, c)); } return r; });
    const kept = await caches.match(e.request);
    if (!kept) return net;
    net.catch(() => {});
    return Promise.race([net, new Promise((ok) => setTimeout(() => ok(kept), 4000))]).catch(() => kept);
  })());
});

/* Notifications (Nov 13, 2026): the engine sends {title, body, url, tag} when a family writes back; a tap opens that chat. */
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  e.waitUntil(self.registration.showNotification(d.title || 'PROWORLD', { body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag, data: { url: d.url || '/portal' }, icon: '/app/icon-192.png', badge: '/app/icon-192.png' }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close(); const url = (e.notification.data && e.notification.data.url) || '/portal';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ws) => {
    for (const w of ws) { if ('focus' in w) { if (w.navigate) { try { w.navigate(url); } catch (err) { /* stay */ } } return w.focus(); } }
    return self.clients.openWindow(url);
  }));
});
