const CACHE_NAME = 'the-stacks-cache-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon_small.png',
  './logo.png',
  './focus.gif',
  './loading.mp4',
  './light-bells.wav',
  './quick-ring.wav',
  './uplifting-bells.wav'
];

// Install stage: cache all static shell files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching app shell assets');
      return cache.addAll(ASSETS).catch(err => {
        console.error('[Service Worker] Error during pre-caching:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate stage: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch stage: serve from cache if available, else fetch and cache cover images
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // Skip caching for Supabase DB requests (API requests) or hot-reloading
  if (event.request.method !== 'GET' || requestUrl.host.includes('supabase.co')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        // Cache dynamic books covers from Open Library or Google Books APIs
        if (
          networkResponse.status === 200 &&
          (requestUrl.host.includes('covers.openlibrary.org') ||
           requestUrl.host.includes('books.google.com') ||
           requestUrl.host.includes('googleusercontent.com'))
        ) {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        }

        return networkResponse;
      }).catch((err) => {
        console.warn('[Service Worker] Fetch failed, resource not available offline:', err);
        // Fallback for document request (if offline)
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
