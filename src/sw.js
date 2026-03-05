// Service Worker — kept minimal
// Audio sounds are handled via blob URLs in script.js
// SW is registered for PWA install support and future use

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Clean only caches from previous versions of this app
      const keys = await caches.keys();
      await Promise.all(
        keys.filter(k => k.startsWith('radio-')).map(k => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});
