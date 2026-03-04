const CACHE_NAME = 'radio-player-v2';

const PRECACHE_ASSETS = [
  './sounds/loading-low.mp3',
  './sounds/error-low.mp3',
];

// Cache critical assets on install
self.addEventListener('install', (event) => {
  console.log('Service Worker: installing & caching assets');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

// Clean old caches on activate
self.addEventListener('activate', (event) => {
  console.log('Service Worker: activated');
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

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
