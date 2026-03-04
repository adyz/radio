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

// Sounds: cache first — no need to hit network, they never change
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.endsWith('.mp3')) return;

  event.respondWith(
    caches.match(event.request, { ignoreVary: true, ignoreSearch: true })
      .then((cached) => cached || fetch(event.request))
  );
});
