// App shell only. API calls, media streams and anything not listed are never cached.
const CACHE = "listening-room-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Only page navigations are handled: network first, cached shell when offline.
// Everything else (including /api and audio with Range requests) goes straight to the network.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.mode !== "navigate") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(request).then(
      (response) => {
        if (response.ok && url.pathname === "/") {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put("/", copy)));
        }
        return response;
      },
      () => caches.match("/").then((cached) => cached ?? Response.error()),
    ),
  );
});
