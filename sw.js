const CACHE_NAME = "lead-center-v4";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./manifest.json",
  "./lead-center-full-backup-2026-06-28.json"
];

// Install: pre-cache assets
self.addEventListener("install", (event) => {
  self.skipWaiting(); // activate immediately without waiting
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// Activate: delete ALL old caches so users always get latest version
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim()) // take control of all open tabs immediately
  );
});

// Fetch: Network-first strategy — try network, fall back to cache only if offline
self.addEventListener("fetch", (event) => {
  // Only intercept same-origin GET requests
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // Update the cache with the fresh response
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return networkResponse;
      })
      .catch(() => {
        // Offline fallback: serve from cache
        return caches.match(event.request);
      })
  );
});
