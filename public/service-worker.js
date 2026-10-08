'use strict';
// Bump this version whenever you change cached files.
const VERSION = 'v1';
const STATIC_CACHE = 'mda-static-' + VERSION;
const API_CACHE = 'mda-api-v1';   // last list of alerts, so residents can still read them offline
const PRECACHE = [
  '/', '/offline.html', '/css/style.css', '/js/common.js', '/js/auth.js', '/js/offline.js',
  '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mda-static-') && k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Alerts API: network first, fall back to the last saved copy.
  if (url.pathname === '/api/alerts') {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(API_CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { cacheName: API_CACHE }).then((hit) => hit || Response.error()))
    );
    return;
  }
  if (url.pathname.startsWith('/api/')) return;   // other API calls are never cached

  // Pages and files: network first, then cache, then the offline page.
  event.respondWith(
    fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(STATIC_CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() =>
      caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('/offline.html') : Response.error()))
    )
  );
});

// ---------- Web Push ----------
self.addEventListener('push', (event) => {
  let data = { title: 'Municipal Disaster Alert', body: 'A new alert was published.', url: '/resident' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch { /* keep defaults */ }

  event.waitUntil((async () => {
    await self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'alert-' + (data.alertId || 'new'),
      requireInteraction: data.level === 'emergency',
      vibrate: [300, 150, 300, 150, 300],
      data: { url: data.url }
    });
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    wins.forEach((w) => w.postMessage({ type: 'alert-received' }));   // open pages refresh immediately
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/resident', location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = wins.find((w) => new URL(w.url).origin === location.origin);
    if (existing) {
      try {
        const focused = await existing.focus();
        return await focused.navigate(target);
      } catch { /* uncontrolled window: fall through and open a new one */ }
    }
    return self.clients.openWindow(target);
  })());
});
