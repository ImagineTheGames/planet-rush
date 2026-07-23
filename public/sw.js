/*
 * Planet Rush service worker — app-shell cache (GDD §4.1). OWNER: Platform Engineer.
 *
 * Makes the client installable and offline-capable against bots by the same
 * mechanism (GDD §4.1, §4.3 primary constraint): cache the app shell, then serve
 * it from cache when the network is gone. Strategy is stale-while-revalidate for
 * same-origin GETs — instant from cache, refreshed in the background — with the
 * cached shell as the offline fallback for navigations. Kept as plain JS outside
 * the bundle so it is served at a stable scope root.
 *
 * PWA installability is cuttable (GDD §4.9) and this worker degrades safely: any
 * cache miss falls through to the network, so a fetch never fails *because* of
 * the worker. The cache is versioned; bump CACHE_VERSION to evict on deploy.
 */

const CACHE_VERSION = 'planet-rush-v1';
// The shell entry points; hashed asset chunks are cached lazily on first fetch.
const SHELL = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {
        /* A shell URL may 404 in dev; never block install on precache. */
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle same-origin GETs; everything else (WebSocket upgrades, the match
  // server, cross-origin) passes straight through to the network.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          // Cache only successful, complete responses.
          if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);

      // Stale-while-revalidate: serve cache immediately if present, refresh behind it.
      if (cached) {
        event.waitUntil(network);
        return cached;
      }

      const fresh = await network;
      if (fresh) return fresh;

      // Offline with no cached copy: fall back to the shell for navigations.
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return Response.error();
    }),
  );
});
