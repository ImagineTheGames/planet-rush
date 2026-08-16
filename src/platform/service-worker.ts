/**
 * src/platform/service-worker.ts — registering the app-shell worker, at boot.
 * OWNER: Platform Engineer (GDD §4.1, §4.3, §4.9; incident a0-66, 2026-08-16).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A MODULE AND NOT FIVE LINES AT THE BOTTOM OF `boot()`
 * ---------------------------------------------------------------------------
 * It was five lines at the bottom of `boot()`, and that is exactly what went
 * wrong. `boot()` is one long async function, and since the menu/lobby flow grew
 * it PARKS in the middle of itself:
 *
 *     boot()
 *       …renderer up, canvas mounted, main menu drawn…
 *       await mainMenu.untilPlay()      ← src/main.ts, parks here indefinitely
 *       …doors, lobby, world build, loop.start()…
 *       navigator.serviceWorker.register(…)   ← only ever reached IN A MATCH
 *
 * So the worker registered only for a player who had already walked the doors
 * and started a match — and never at all for someone who just opened the URL.
 * Measured against the live deploy on 2026-08-16: `getRegistrations()` returned
 * `[]` after 10 s on a fresh visit, and `navigator.serviceWorker.controller` was
 * `null` on the reload. Two consequences, both quiet:
 *
 *  1. **The PWA was not one.** Offline play and install (§4.1, §4.3) depended on
 *     a worker that a first-time visitor never installed.
 *  2. **The post-deploy gate's second visit was vacuous.** `tests/live/boot.spec.ts`
 *     says "the second is served THROUGH it — the exact path that bricked", and
 *     it was not: there was no worker to be served through. The one check written
 *     against the 2026-07-23 incident had stopped exercising the incident's path,
 *     silently, and nothing could tell because the check still passed.
 *
 * Registration is now a named, top-of-boot side effect that does not sit behind
 * any await the player controls. `tests/live/boot.spec.ts` asserts the worker
 * actually takes control on visit 2, so (2) cannot go quiet again.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS SAFE TO ACTUALLY TURN ON
 * ---------------------------------------------------------------------------
 * The worker this registers (`public/sw.js`) is already written against the
 * stale-shell incident: navigations are NETWORK-FIRST with the cache as the
 * offline fallback, `version.json` is never cached, subresources are hashed and
 * content-addressed, and the cache is versioned so `activate` evicts the last
 * one. Registering it earlier makes it do its job; it does not reopen §5.
 */

/** The `navigator` seam this module reads. Narrowed so a fake drives the tests. */
export interface ServiceWorkerNavigator {
  readonly serviceWorker?: {
    register(url: string): Promise<unknown>;
  };
}

/** The `window`/`document` seam: just enough to know whether load has fired. */
export interface ServiceWorkerWindow {
  addEventListener(type: 'load', listener: () => void, options?: { once: boolean }): void;
  readonly document: { readonly readyState: DocumentReadyState };
}

/**
 * Register the app-shell service worker, best-effort.
 *
 * Deferred to the `load` event (or run straight away if the document has already
 * finished loading) so the worker's own fetch never competes with the entry
 * bundle and the two blocking woff2 faces for the first paint. That is the only
 * thing it waits for: nothing here is behind a player action.
 *
 * Never throws and never rejects — install is a nice-to-have (§4.9) and a boot
 * must not fail because a worker did.
 *
 * @param win Injectable `window`.
 * @param nav Injectable `navigator`.
 * @param base The deploy base; defaults to Vite's. `sw.js` is served out of
 *   `public/`, so it moves with the base exactly like the fonts do — see
 *   `./asset-url` for the a0-66 failure that spelling prevents.
 */
export function registerServiceWorker(
  win: ServiceWorkerWindow,
  nav: ServiceWorkerNavigator,
  base: string = import.meta.env.BASE_URL,
): void {
  const container = nav.serviceWorker;
  // Feature-detected at the edge, never assumed: no worker support (older iOS
  // Safari in a private window, a non-secure origin) is a supported way to play.
  if (!container) return;

  const url = `${base.endsWith('/') ? base : `${base}/`}sw.js`;
  const go = (): void => {
    void Promise.resolve()
      .then(() => container.register(url))
      .catch(() => {
        /* offline install is a nice-to-have; never block boot on it */
      });
  };

  // `complete` means the load event has already fired — a listener added now
  // would never run, and the worker would never register. This is the branch
  // that matters in practice: `src/main.ts` is a dynamic import awaited behind
  // the font gate, so boot() often starts after load.
  if (win.document.readyState === 'complete') go();
  else win.addEventListener('load', go, { once: true });
}
