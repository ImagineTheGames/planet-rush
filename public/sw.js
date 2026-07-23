/*
 * Planet Rush service worker — app-shell cache (GDD §4.1).
 * OWNER: Platform Engineer.
 *
 * Day-0 scaffold: a no-op pass-through worker so registration succeeds and the
 * PWA install prompt is available. Real app-shell precaching (making the game
 * offline-capable against bots) lands with the PWA milestone. Kept as plain JS,
 * outside the bundle, so it is served at a stable scope root.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {
  /* pass through to the network for now */
});
