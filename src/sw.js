// Service Worker — kept minimal
// Audio sounds are handled via blob URLs in script.js
// SW is registered for PWA install support and future use

const CACHE_NAME = 'radio-images';
const STATUS_CACHE = 'radio-status';
const MAX_CACHED_IMAGES = 30;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Clean old caches from previous versions
      const keep = new Set([CACHE_NAME, STATUS_CACHE]);
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(k => !keep.has(k))
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

// Serve cached Cloudinary images when offline (network-first)
self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  if (!url.includes('res.cloudinary.com') || event.request.method !== 'GET') return;

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(event.request);

        if (response.ok) {
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
        // Explicitly search both caches with ignoreVary to avoid
        // Safari/WebKit issues with global caches.match() and Vary headers
        const opts = { ignoreVary: true };
        const statusCache = await caches.open(STATUS_CACHE);
        const hit = await statusCache.match(event.request, opts);
        if (hit) return hit;

        const imgCache = await caches.open(CACHE_NAME);
        const hit2 = await imgCache.match(event.request, opts);
        return hit2 || Response.error();
      }
    })()
  );
});
