// Service Worker — app shell + offline support
// Bump APP_CACHE version when static files change to force re-cache.
// Bump SOUND_CACHE version when sound files change.

const APP_CACHE_NAME = 'radio-app-v1';
const CACHE_NAME = 'radio-images-v2';
const SOUND_CACHE_NAME = 'radio-sounds-v1';
const MAX_CACHED_IMAGES = 30;

// App shell — everything needed to render the page offline
const APP_SHELL = [
  './',
  './index.html',
  './css/output.css',
  './js/script.js',
  './js/radioCore.js',
  './js/stateMachine.js',
  './js/keepAlive.js',
  './manifest.json',
  './images/favicon.png',
  './images/logo.png',
];

const PRECACHE_SOUNDS = [
  './sounds/loading-low.mp3',
  './sounds/error-low.mp3',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      (async () => {
        const cache = await caches.open(APP_CACHE_NAME);
        for (const url of APP_SHELL) {
          try { await cache.add(url); } catch (_) { /* individual failure won't block install */ }
        }
      })(),
      (async () => {
        const cache = await caches.open(SOUND_CACHE_NAME);
        for (const url of PRECACHE_SOUNDS) {
          try { await cache.add(url); } catch (_) { /* individual failure won't block install */ }
        }
      })(),
    ])
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Clean old caches from previous versions
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(k => k.startsWith('radio-') && k !== APP_CACHE_NAME && k !== CACHE_NAME && k !== SOUND_CACHE_NAME)
          .map(k => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// Trim cache to prevent unbounded growth (FIFO: oldest entries evicted first)
async function trimCache() {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  if (keys.length > MAX_CACHED_IMAGES) {
    await Promise.all(keys.slice(0, keys.length - MAX_CACHED_IMAGES).map(k => cache.delete(k)));
  }
}

// Serve cached Cloudinary images, sound files, and app shell when offline
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Sound files — cache-first (pre-cached at install, same-origin /sounds/ only)
  const reqUrl = new URL(url, self.location.origin);
  if (
    event.request.method === 'GET' &&
    reqUrl.origin === self.location.origin &&
    reqUrl.pathname.startsWith('/sounds/') &&
    reqUrl.pathname.endsWith('.mp3')
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SOUND_CACHE_NAME);
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const response = await fetch(event.request);
          if (response.ok) await cache.put(event.request, response.clone());
          return response;
        } catch (_) {
          return new Response('', { status: 503, statusText: 'Offline' });
        }
      })()
    );
    return;
  }

  // App shell — network-first, fallback to cache for offline
  if (
    event.request.method === 'GET' &&
    reqUrl.origin === self.location.origin &&
    !reqUrl.pathname.startsWith('/sounds/')
  ) {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(event.request);
          if (response.ok) {
            const cache = await caches.open(APP_CACHE_NAME);
            await cache.put(event.request, response.clone());
          }
          return response;
        } catch (_) {
          const cached = await caches.match(event.request);
          return cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        }
      })()
    );
    return;
  }

  if (!url.includes('res.cloudinary.com') || event.request.method !== 'GET') return;

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(event.request);

        if (response.ok || response.type === 'opaque') {
          const clone = response.clone();
          event.waitUntil(
            (async () => {
              try {
                const cache = await caches.open(CACHE_NAME);
                await cache.put(event.request, clone);
                await trimCache();
              } catch (_) { /* swallow cache errors */ }
            })()
          );
        }

        return response;
      } catch (_) {
        const cached = await caches.match(event.request);
        return cached || Response.error();
      }
    })()
  );
});
