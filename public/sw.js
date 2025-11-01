const CACHE_NAME = 'wf-group-dashboard-v2'; // Version erhöht, um alten Cache zu löschen
const urlsToCache = [
    '/', // Die Haupt-HTML-Seite
    '/manifest.json',
    '/images/icon-192.png',
    '/images/icon-512.png'
    // Absichtlich /favicon.ico weggelassen, da es oft Probleme macht
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache');
                // fetch-Anfragen mit "cache: 'no-store'" erstellen, um sicherzustellen, 
                // dass wir frische Dateien vom Server bekommen und keine 502s aus dem Browser-Cache.
                const requests = urlsToCache.map(url => new Request(url, { cache: 'no-store' }));
                return cache.addAll(requests);
            })
            .catch(err => {
                console.error('Service Worker: Cache.addAll fehlgeschlagen:', err);
                // Dieser Fehler ist oft auf eine 502-Datei (manifest.json) zurückzuführen
            })
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Cache hit - return response
                if (response) {
                    return response;
                }
                // Ansonsten: Vom Netzwerk holen
                return fetch(event.request);
            }
        )
    );
});

self.addEventListener('activate', event => {
    // Alte Caches löschen
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.filter(name => name !== CACHE_NAME) // Alle löschen, die nicht V2 sind
                          .map(name => caches.delete(name))
            );
        })
    );
});
