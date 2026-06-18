// ─── Vantage PWA Service Worker ──────────────────────────────
// Cache-first strategy: serves cached assets instantly, updates
// cache in background. App shell loads even without network.

const CACHE_NAME = 'vantage-v1';
const OFFLINE_URL = '/';

const PRECACHE_ASSETS = [
  '/',
  '/login',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.svg',
];

// ─── Install: precache app shell ─────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch(() => {
        // Individual asset failures shouldn't block install
      });
    })
  );
  // Activate immediately — don't wait for old tabs
  self.skipWaiting();
});

// ─── Activate: clean old caches ─────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  // Take control of all clients immediately
  self.clients.claim();
});

// ─── Fetch: cache-first for nav, network-first for API ──

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Don't cache API calls — always try network
  if (url.pathname.startsWith('/api/')) {
    return; // let browser handle normally
  }

  // Don't cache Supabase auth calls
  if (url.hostname.includes('supabase')) {
    return;
  }

  // Navigation requests: network-first — never serve stale HTML
  // Cache-first caused React #310: cached HTML references old/removed JS chunks
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then((res) => {
        // Cache fresh response for offline fallback
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return res;
      }).catch(() => {
        // Offline fallback
        return caches.match(request).then((cached) =>
          cached || caches.match('/') || new Response('Offline', { status: 503 })
        );
      })
    );
    return;
  }

  // Static assets (JS, CSS, images, fonts): cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // Background update
        fetch(request).then((res) => {
          if (res.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, res));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(request).then((res) => {
        if (!res.ok) return res;
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return res;
      });
    })
  );
});
