const CACHE_NAME = 'closer-pwa-v4';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './cards.json',
    './css/styles.css',
    './js/firebase-config.js',
    './js/app.js'
];

// Install Event: Cache Assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('[Closer PWA] Caching App Assets');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

// Activate Event: Clear Stale Cache
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.map(key => {
                    if (key !== CACHE_NAME) {
                        console.log('[Closer PWA] Removing Old Cache:', key);
                        return caches.delete(key);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch Event: Bypass external CDNs & serve local cache/network safely
self.addEventListener('fetch', event => {
    // 1. Ignore non-GET requests and cross-origin external requests (unpkg, Firebase, fonts)
    if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
        return; // Let the browser handle external requests natively
    }

    // 2. Local asset caching strategy
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(event.request).catch(() => {
                if (event.request.mode === 'navigate') {
                    return caches.match('./index.html');
                }
            });
        })
    );
});