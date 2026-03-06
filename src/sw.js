// Service Worker — kept minimal
// Status images (idle, loading, error) are handled via blob URLs in script.js
// Audio sounds are also handled via blob URLs in script.js
// SW caches station poster images for offline use

const CACHE_NAME = 'radio-images';
const MAX_CACHED_IMAGES = 30;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Clean old caches from previous versions
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
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
        const cache = await caches.open(CACHE_NAME);
        const hit = await cache.match(event.request, { ignoreVary: true });
        return hit || Response.error();
      }
    })()
  );
});
