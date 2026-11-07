const CACHE_NAME = 'cx-live-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = event.request.url;

  // Never cache streams, m3u8, video ts/mp4 chunks, live APIs, or dynamic HTML
  if (
    url.includes('.m3u8') || 
    url.includes('.ts') || 
    url.includes('.mp4') || 
    url.includes('.mpd') ||
    url.includes('/api') || 
    url.includes('suggestions.json') ||
    url.endsWith('.html') ||
    url.endsWith('/')
  ) {
    return;
  }

  // Network-first for static icons/assets
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => networkResponse)
      .catch(() => caches.match(event.request))
  );
});
