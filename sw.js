// FATH 3D Manager - Service Worker
// Version : 1.0.1 (incrémente la version pour forcer la MAJ du cache)

const CACHE_VERSION = 'fath3d-v2';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './FATH3D_192.png',
  './FATH3D_512.png'
];

// === INSTALL : mise en cache des fichiers de l'appli ===
self.addEventListener('install', (event) => {
  console.log('[SW] Installation...');
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => {
        console.log('[SW] Mise en cache des fichiers');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// === ACTIVATE : nettoyage des anciens caches ===
self.addEventListener('activate', (event) => {
  console.log('[SW] Activation...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_VERSION)
          .map((name) => {
            console.log('[SW] Suppression ancien cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// === FETCH : stratégie "Network First, fallback Cache" ===
// Pour Firebase et l'API, on essaie le réseau d'abord
// Pour les assets statiques (HTML, PNG, JSON), on utilise le cache si dispo
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ignorer les requêtes Firebase/Google (laisser passer normalement)
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('google.com') ||
    url.hostname.includes('firebase.com') ||
    url.hostname.includes('firebaseapp.com')
  ) {
    return;
  }

  // Stratégie pour les autres requêtes
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Si on a une réponse du réseau, on met à jour le cache
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_VERSION).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Pas de réseau → on tente le cache
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Si rien dans le cache, retourner index.html (pour navigation SPA)
          return caches.match('./index.html');
        });
      })
  );
});

console.log('[SW] FATH 3D Service Worker chargé');
