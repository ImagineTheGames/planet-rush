/**
 * src/platform/debug-hook.ts — the QA centring instrument. OWNER: Platform Engineer.
 *
 * ── RATIFIED TEST CONTRACT ─────────────────────────────────────────────────
 * When (and only when) the page URL carries `?debug=1`, this module exposes one
 * read-only global for the QA mobile suite to assert against:
 *
 *   window.__planetRush = {
 *     shipScreen: { x: number, y: number },  // local ship position, in VISUAL-
 *                                             // VIEWPORT space (CSS px): the
 *                                             // visible centre is {w/2, h/2}
 *     shipWorld:  { x: number, y: number },  // local ship position in WORLD space
 *                                             // (sim units) — moves as the ship
 *                                             // flies even though the follow-camera
 *                                             // keeps shipScreen centred; a
 *                                             // render-speed-independent movement
 *                                             // truth for "did the drag move it?"
 *     viewport:   { w, h, width, height },   // visual-viewport size (CSS px) —
 *                                             // the same two numbers under both
 *                                             // spellings, see the note below
 *     fps:        number,                     // smoothed frames/sec
 *     ticks:      number,                     // fixed sim steps executed since
 *                                             // boot — the sim's OWN clock
 *   }
 *
 * Updated in place every rendered frame. The handle is installed read-only
 * (non-writable, non-configurable) — QA reads it, nothing (game or test) reassigns
 * it. The centring gate the suite enforces (developer phone report, M1):
 *
 *   |shipScreen.x - viewport.w / 2| < 0.05 * viewport.w   (and likewise y)
 *
 * in BOTH orientations. Reporting `shipScreen` in visual-viewport space (via
 * camera.ts `toViewportSpace`) is what makes that assertion device-independent:
 * a centred ship reads {w/2, h/2} whether or not the URL bar or a notch has
 * cropped the canvas.
 *
 * `ticks` is the same idea applied to TIME. Wall-clock seconds are not a fixed
 * amount of simulation: the loop clamps a slow frame's catch-up (loop.ts
 * `MAX_FRAME_SECONDS`), so on a software-WebGL CI runner at ~1 fps a 1.4 s
 * gesture advances the sim only a fraction of what the same gesture advances it
 * at 60 fps. Any assertion phrased in *absolute* movement is therefore really an
 * assertion about the host's frame rate. Reporting the sim's own step count lets
 * QA divide the two — movement per elapsed tick — which is invariant across
 * render throughput (platform note m1-12).
 *
 * `viewport` answers to BOTH spellings on purpose. `__planetRush` is a SHARED
 * debug surface: the layout registry (layout-registry.ts) installs onto the same
 * global and, finding `viewport` already owned here, leaves it alone — as it must,
 * since this one is the *visual* viewport, the whole point of the centring
 * instrument. But the two co-tenants name the field differently: the centring
 * contract is `{w, h}`, the layout contract is `{width, height}`. Whichever reader
 * lost the key got `undefined` and a baffling failure (the QA layout suite did).
 * Four fields, one source, written together: neither contract is weakened and both
 * are readable at once.
 *
 * Without `?debug=1` this module is inert: it installs nothing, attaches nothing
 * to `window`, and its `update` is a no-op. It is an instrument only — no game
 * code reads `__planetRush`, and this file exposes nothing else on the global.
 * ───────────────────────────────────────────────────────────────────────────
 */

/** The frozen shape of `window.__planetRush` (see the contract above). */
export interface DebugState {
  readonly shipScreen: { x: number; y: number };
  readonly shipWorld: { x: number; y: number };
  readonly viewport: { w: number; h: number; width: number; height: number };
  readonly fps: number;
  /** Fixed sim steps executed since boot — monotonic, render-rate independent. */
  readonly ticks: number;
}

/** The property name placed on `window` — the only global this module touches. */
export const DEBUG_GLOBAL_KEY = '__planetRush';

/** What `main.ts` drives each frame: a live `enabled` flag (so the caller can skip
 *  the per-frame projection work entirely when debug is off) and an allocation-free
 *  `update` that writes the current frame into the global. */
export interface DebugHook {
  readonly enabled: boolean;
  update(
    shipScreenX: number,
    shipScreenY: number,
    viewportW: number,
    viewportH: number,
    shipWorldX: number,
    shipWorldY: number,
    nowMs: number,
    simTicks: number,
  ): void;
}

/** Weight of a new frame's instantaneous fps in the smoothing EMA. Low so a
 *  single hitch doesn't swing the readout QA samples. */
const FPS_SMOOTHING = 0.1;

/** A shared do-nothing hook for the (common) debug-off path. */
const NOOP_HOOK: DebugHook = { enabled: false, update: () => {} };

/** True when the URL query string opts into the instrument (`?debug=1`). */
export function isDebugEnabled(search: string): boolean {
  return new URLSearchParams(search).get('debug') === '1';
}

/**
 * Install the read-only `window.__planetRush` instrument iff `search` carries
 * `?debug=1`; otherwise return an inert no-op hook that touches nothing.
 *
 * `target` is the object the global is attached to — `window` in the app, a plain
 * object in tests. Mutable internal state is written in place each frame so the
 * per-frame path allocates nothing (GDD §4.3), matching the render discipline.
 */
export function installDebugHook(
  search: string,
  target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): DebugHook {
  if (!isDebugEnabled(search)) return NOOP_HOOK;

  // Mutable backing store; the readonly `DebugState` fields are overwritten in
  // place, never reassigned, so the exposed handle stays a stable read-only ref.
  const state = {
    shipScreen: { x: 0, y: 0 },
    shipWorld: { x: 0, y: 0 },
    // Two numbers, four fields: the layout-registry co-tenant reads this same
    // object as {width, height} (see the `viewport` note in the contract above).
    viewport: { w: 0, h: 0, width: 0, height: 0 },
    fps: 0,
    ticks: 0,
  };

  // Read-only handle: the instrument cannot be swapped out from under QA.
  try {
    Object.defineProperty(target, DEBUG_GLOBAL_KEY, {
      value: state,
      writable: false,
      configurable: false,
      enumerable: true,
    });
  } catch {
    // Already defined (double install) — reuse whatever is there rather than throw.
  }

  let lastMs = 0;
  let hasLast = false;

  return {
    enabled: true,
    update(
      shipScreenX,
      shipScreenY,
      viewportW,
      viewportH,
      shipWorldX,
      shipWorldY,
      nowMs,
      simTicks,
    ): void {
      state.shipScreen.x = shipScreenX;
      state.shipScreen.y = shipScreenY;
      state.shipWorld.x = shipWorldX;
      state.shipWorld.y = shipWorldY;
      state.viewport.w = viewportW;
      state.viewport.h = viewportH;
      state.viewport.width = viewportW; // alias — the layout registry's spelling
      state.viewport.height = viewportH;
      state.ticks = simTicks;

      // Smooth fps off successive frame timestamps; ignore non-advancing clocks.
      if (hasLast) {
        const dt = nowMs - lastMs;
        if (dt > 0) {
          const inst = 1000 / dt;
          state.fps = state.fps === 0 ? inst : state.fps * (1 - FPS_SMOOTHING) + inst * FPS_SMOOTHING;
        }
      }
      lastMs = nowMs;
      hasLast = true;
    },
  };
}
