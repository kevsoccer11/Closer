const CACHE_NAME = 'closer-pwa-v359';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './manifest.json',
    './cards.json',
    './explicit-cards.json',
    './css/styles.css',
    './js/app-state.js',
    './js/app-logic.js',
    './js/app.js',
    './img/pack-first-impressions.webp',
    './img/pack-passport-to-us.webp',
    './img/pack-find-our-way-back.webp',
    './img/pack-beneath-the-surface.webp',
    './js/firebase-config.js'
];
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[ServiceWorker] Caching App Shell');
            return cache.addAll(ASSETS_TO_CACHE);
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(
                keyList.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log('[ServiceWorker] Clearing old cache:', key);
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
})
;

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
        return;
    }
    const url = new URL(event.request.url);
    const isAsset = url.pathname.endsWith('.css') || url.pathname.endsWith('.js') || url.pathname.endsWith('.html') || url.pathname === '/';
    if (isAsset) {
        event.respondWith(
            fetch(event.request, { cache: 'no-store' }).then((response) => {
                const copy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                return response;
            }).catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
        );
        return;
    }
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;
            return fetch(event.request).catch(() => {
                if (event.request.mode === 'navigate') return caches.match('./index.html');
            });
        })
    );
});