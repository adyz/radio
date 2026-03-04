const CACHE_NAME = 'radio-player-v3';

const PRECACHE_ASSETS = [
  '/sounds/loading-low.mp3',
  '/sounds/error-low.mp3',
];

// Cache critical assets on install
self.addEventListener('install', (event) => {
  console.log('SW: installing, caching:', PRECACHE_ASSETS);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => console.log('SW: precache OK'))
      .catch((err) => console.error('SW: precache FAILED', err))
  );
  self.skipWaiting();
});

// Clean old caches on activate
self.addEventListener('activate', (event) => {
  console.log('SW: activated');
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Only serve precached sounds from cache when offline, everything else goes to network
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isCachedSound = url.pathname.endsWith('.mp3');

  if (!isCachedSound) return;

  console.log('SW fetch intercepted:', url.pathname);

  event.respondWith(
    fetch(event.request).catch(async () => {
      console.log('SW: network failed, trying cache for:', url.pathname);
      // ignoreVary + ignoreSearch: audio elements send Range/Vary headers that break exact match
      const cached = await caches.match(event.request, { ignoreVary: true, ignoreSearch: true });
      if (cached) {
        console.log('SW: cache HIT for:', url.pathname);
        return cached;
      }
      console.error('SW: cache MISS for:', url.pathname);
      return new Response('Not found in cache', { status: 503 });
    })
  );
});
