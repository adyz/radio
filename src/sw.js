// Service Worker — kept minimal
// Audio sounds are handled via blob URLs in script.js
// SW is registered for PWA install support and future use

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
          .filter(k => k.startsWith('radio-') && k !== CACHE_NAME)
          .map(k => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// Trim cache to prevent unbounded growth (LRU-style: oldest entries first)
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
  if (!url.includes('res.cloudinary.com')) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Update cache with fresh copy
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, clone);
          trimCache();
        });
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
