// FATH 3D Manager - Service Worker
// Cache version bumped only to force delivery of the current production HTML.
const CACHE_VERSION = 'fath3d-v3';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './FATH3D_192.png',
  './FATH3D_512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames
        .filter((name) => name !== CACHE_VERSION)
        .map((name) => caches.delete(name))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('google.com') ||
    url.hostname.includes('firebase.com') ||
    url.hostname.includes('firebaseapp.com')
  ) return;

  // The manager HTML must always come from the network when available.
  if (url.pathname.endsWith('/manager/index.html')) {
    event.respondWith(
      fetch(event.request, {cache: 'no-store'})
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, responseToCache));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return caches.match('./index.html');
      }))
  );
});
