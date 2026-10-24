/**
 * Service Worker for GIS Smart Evacuation Assistant.
 * Provides offline caching for the app shell, static assets,
 * bundled evacuation data, and CDN dependencies.
 */

const CACHE_NAME = 'evac-gis-v2.2';

const PRECACHE_ASSETS = [
    './',
    './index.html',
    './style.css',
    './manifest.webmanifest',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon.svg',
    './data/government_hospitals.geojson',
    './data/government_schools.geojson',
    './js/geo.js',
    './js/storage.js',
    './js/overpass.js',
    './js/routing.js',
    './js/ranking.js',
    './js/hazards.js',
    './js/weather.js',
    './js/pwa.js',
    './js/ui.js',
    './js/app.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.css',
    'https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // Use cache.addAll with individual catch to avoid total install failure if one CDN fails
            return Promise.all(
                PRECACHE_ASSETS.map((url) => {
                    return cache.add(url).catch((err) => {
                        console.warn(`[SW] Precache failed for ${url}:`, err);
                    });
                })
            );
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') return;

    // Handle OpenStreetMap Tile caching: Stale-While-Revalidate with caching
    if (url.hostname.includes('tile.openstreetmap.org')) {
        event.respondWith(
            caches.open('osm-tiles-cache').then((cache) => {
                return cache.match(request).then((cachedResponse) => {
                    const fetchPromise = fetch(request).then((networkResponse) => {
                        if (networkResponse.ok) {
                            cache.put(request, networkResponse.clone());
                        }
                        return networkResponse;
                    }).catch(() => cachedResponse);

                    return cachedResponse || fetchPromise;
                });
            })
        );
        return;
    }

    // App shell & static assets: Cache-First, fallback to Network
    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }

            return fetch(request).then((networkResponse) => {
                // Cache successfully fetched static resources
                if (networkResponse && networkResponse.status === 200 && (
                    url.origin === self.location.origin ||
                    url.hostname.includes('unpkg.com') ||
                    url.hostname.includes('cdnjs.cloudflare.com')
                )) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseToCache);
                    });
                }
                return networkResponse;
            }).catch(() => {
                // If offline and requesting navigation, return index.html
                if (request.mode === 'navigate') {
                    return caches.match('./index.html');
                }
            });
        })
    );
});
