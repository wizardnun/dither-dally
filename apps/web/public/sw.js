// Offline support. Network first, so you always get the latest version when
// online; anything fetched successfully is kept for when you're offline.
// Bump CACHE to drop everything stored by older versions.
const CACHE = "dither-dally-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

// The page sends the files it loaded before this worker took control.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "cache-urls") return;
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        event.data.urls
          .filter((url) => new URL(url).origin === self.location.origin)
          .map((url) => cache.add(url).catch(() => undefined)),
      ),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        if (res.ok) {
          const copy = res.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(req, copy)));
        }
        return res;
      } catch {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        if (req.mode === "navigate") {
          const shell = (await caches.match("./")) ?? (await caches.match("./index.html"));
          if (shell) return shell;
        }
        return Response.error();
      }
    })(),
  );
});
