/* Roman Numeral Kingdom Builder - service worker (offline cache for the "Add to Home Screen" install).
   Scope = the folder this file lives in. The game works fully without it: delete sw.js and nothing breaks.

   >>> bump VERSION on every content change (index.html, manifest, icons), or players keep seeing the old game. <<<

   Another app on the same origin has a root worker that deletes every cache not named "ttc-cache-v1".
   So: we use our own uniquely-named cache, look ONLY in our own cache, and re-fill it on request ("ensure").
*/
const VERSION = '202609262245'; // date+time stamp, not a version name: set it to the current date and time whenever the content changes
const PREFIX = 'rnk-roman-numeral-kingdom-';
const CACHE = PREFIX + VERSION;
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];
const SCOPE_PATH = new URL('./', self.location.href).pathname;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      /* cache:'reload' = fetch a fresh copy, never the browser's old HTTP-cached one */
      .then(cache => Promise.all(FILES.map(f => cache.add(new Request(f, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k === 'rnk-v1' || (k.indexOf(PREFIX) === 0 && k !== CACHE))
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* "ensure": the page asks us to re-add any of our files that another worker wiped out of the cache. Best effort. */
self.addEventListener('message', event => {
  if (event.data !== 'ensure') return;
  event.waitUntil(
    caches.open(CACHE).then(cache => Promise.all(FILES.map(f =>
      cache.match(f).then(hit => hit || cache.add(new Request(f, { cache: 'reload' })))
        .catch(() => {})
    ))).catch(() => {})
  );
});

/* cache-first, from OUR cache only (never the global caches.match); misses go to the network and are copied in */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const inScope = url.pathname.indexOf(SCOPE_PATH) === 0;
  event.respondWith(
    caches.open(CACHE).then(c => c.match(req, { ignoreSearch: true })).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        if (inScope && res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => (req.mode === 'navigate'
        ? caches.open(CACHE).then(c => c.match('./index.html')).then(r => r || Response.error())
        : Response.error()));
    }).catch(() => fetch(req))
  );
});
