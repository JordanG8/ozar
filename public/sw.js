const staticCache = "ozar-offline-v2";
const offline = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(staticCache).then((cache) => cache.add(offline)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith("ozar-offline-") && key !== staticCache).map((key) => caches.delete(key)),
  )).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate" || event.request.method !== "GET") return;
  // Offline fallback contains only static text. Auth and study responses are never cached here.
  event.respondWith(fetch(event.request).catch(async () => (await caches.match(offline)) ?? Response.error()));
});
