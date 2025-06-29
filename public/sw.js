const CACHE_NAME = 'wf-dashboard-cache-v2'; // v2, um alten Cache zu invalidieren
const urlsToCache = [
  '/',
  '/views/index.html',
  '/images/icon-192.png',
  '/images/icon-512.png',
  '/favicon.ico'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache and caching files');
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting();
});

self.addEventListener('fetch', event => {
  // Wir konzentrieren uns nur auf das Caching, nicht auf die Netzwerkstrategie für den Moment
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        return response || fetch(event.request);
      })
  );
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
