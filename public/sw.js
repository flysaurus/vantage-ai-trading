// ─── Vantage PWA Service Worker — KILL SWITCH ────────────────
// This file used to be a cache-first SW ('vantage-v1') that precached the app
// shell. That cache-first strategy meant devices kept running OLD JS chunks long
// after a deploy, so shipped changes looked "not applied" on a real device.
//
// It is now a self-destructing worker: any client still holding the old
// registration fetches this file on the next navigation (byte-compare), the new
// worker activates immediately, deletes every cache and unregisters itself.
// Nothing is ever precached or served from the cache again.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {
      /* no Cache Storage — nothing to clean */
    }
    try {
      await self.registration.unregister();
    } catch {
      /* already gone */
    }
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((c) => {
      try { c.navigate(c.url); } catch { /* best effort reload */ }
    });
  })());
});

// Never intercept a request. Network only, always.
self.addEventListener('fetch', () => {});
