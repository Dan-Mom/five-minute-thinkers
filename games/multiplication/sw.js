/**
 * Times Tables Challenge — service worker
 * Enables "Add to Home Screen" installability and basic offline play.
 * Bump CACHE_NAME whenever you change the app (use a date stamp) so old caches get cleared.
 *
 * SHARED ORIGIN: this worker sits at the root of dan-mom.github.io/Math/ and other apps (the games under
 * /Math/games/...) keep their own caches on the same origin. So this worker must ONLY ever touch caches whose
 * name starts with CACHE_PREFIX, and only ever look in its own cache. (Deleting "every cache that is not mine"
 * wipes the games' offline files.)
 */
const CACHE_PREFIX = "ttc-cache-";
const CACHE_NAME = CACHE_PREFIX + "20260926";

const PRECACHE_URLS = [
  "./Multiplication.html",
  "./MultiDashboard.html",
  "./manifest.json",
  "./dashboard-manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // cache each file individually so one missing file doesn't block the rest
      return Promise.all(
        PRECACHE_URLS.map((url) => cache.add(url).catch(() => {}))
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      // delete only OLD copies of THIS app's cache (same prefix); never another app's cache
      Promise.all(keys.filter((k) => k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

const OWN_PATHS = PRECACHE_URLS.map((u) => new URL(u, self.location.href).pathname);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  // Only this app's own files: another app under /Math/ (a game with no worker of its own) must never be answered from here.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || OWN_PATHS.indexOf(url.pathname) < 0) return;

  // HTML pages: try the network first (so kids get the latest quiz logic
  // when online), fall back to cache if offline.
  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) { const copy = res.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)); }   // never cache a 404 page
          return res;
        })
        .catch(() => caches.open(CACHE_NAME).then((c) => c.match(req).then((r) => r || c.match("./Multiplication.html"))))
    );
    return;
  }

  // Everything else (icons, manifest, etc): cache-first, then network.
  event.respondWith(
    caches.open(CACHE_NAME).then((c) => c.match(req)).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
