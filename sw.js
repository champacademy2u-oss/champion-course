const CACHE_NAME = "lead-center-v27-champ-library-upload-check";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=20261012-contact-export",
  "./whatsapp-bulk-core.js?v=20260828-emoji-direct",
  "./contact-export-core.js?v=20261012-contact-export",
  "./ebook-reply-core.js?v=20261007-five-step",
  "./ebook-reply.js?v=20261007-five-step",
  "./ebook-reply.css?v=20261007-five-step",
  "./app.js?v=20261113-champ-library",
  "./champ-library.js?v=20261113-upload-check",
  "./champ-library-core.js",
  "./champ-library-store.js?v=20261113-upload-check",
  "./champ-library-upload.js?v=20261113-upload-check",
  "./champ-library.css?v=20261113-library",
  "./preview-followup-core.js?v=20261018-preview-followup",
  "./preview-followup.js?v=20261018-preview-followup",
  "./preview-followup.css?v=20261018-preview-followup",
  "./config.js",
  "./manifest.json",
  "./zoom.html",
  "./zoom.css",
  "./zoom.js",
  "./zoom-og.png",
  "./logo.png"
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
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const allowedPaths = new Set(ASSETS.map(asset => new URL(asset, self.location).pathname));
  if (!allowedPaths.has(url.pathname)) return;

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
