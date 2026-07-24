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
 *     viewport:   { w: number, h: number },  // visual-viewport size (CSS px)
 *     fps:        number,                     // smoothed frames/sec
 *     build:      { sha, time, dirty },       // WHICH BUILD this is (build-info.ts)
 *   }
 *
 * `build` is a frozen snapshot of the build stamp, so a failing QA run can name
 * the build it failed on instead of "the one that was deployed at the time".
 *
 * `viewport` reports its size under BOTH `{w,h}` and `{width,height}`. That is
 * not indecision: `__planetRush` is a SHARED handle — the layout registry
 * (layout-registry.ts) merges its own surface onto whatever this module installed
 * first, and its merge deliberately never clobbers a key the co-tenant already
 * owns. So `viewport` stays this module's object, and the layout suite, which
 * speaks the registry's `{width,height}` vocabulary, read `undefined` off it.
 * Carrying both spellings on one object satisfies both contracts additively,
 * with no reader anywhere needing to know which module answered.
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
 * Without `?debug=1` this module is inert: it installs nothing, attaches nothing
 * to `window`, and its `update` is a no-op. It is an instrument only — no game
 * code reads `__planetRush`, and this file exposes nothing else on the global.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { BUILD_INFO } from './build-info';
import type { BuildInfo } from './build-info';

/** The frozen shape of `window.__planetRush` (see the contract above). */
export interface DebugState {
  readonly shipScreen: { x: number; y: number };
  readonly shipWorld: { x: number; y: number };
  /** Visual-viewport size, CSS px. Carries BOTH spellings on purpose — see the
   *  shared-handle note in {@link installDebugHook}. */
  readonly viewport: { w: number; h: number; width: number; height: number };
  readonly fps: number;
  /** The build stamp this page is running (src/platform/build-info.ts). Fixed
   *  for the life of the page — frozen, never rewritten per frame. */
  readonly build: BuildInfo;
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
  build: BuildInfo = BUILD_INFO,
): DebugHook {
  if (!isDebugEnabled(search)) return NOOP_HOOK;

  // Mutable backing store; the readonly `DebugState` fields are overwritten in
  // place, never reassigned, so the exposed handle stays a stable read-only ref.
  // `build` is the exception: a compile-time constant, frozen on the way in.
  const state = {
    shipScreen: { x: 0, y: 0 },
    shipWorld: { x: 0, y: 0 },
    viewport: { w: 0, h: 0, width: 0, height: 0 },
    fps: 0,
    build: Object.freeze({ ...build }),
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
    update(shipScreenX, shipScreenY, viewportW, viewportH, shipWorldX, shipWorldY, nowMs): void {
      state.shipScreen.x = shipScreenX;
      state.shipScreen.y = shipScreenY;
      state.shipWorld.x = shipWorldX;
      state.shipWorld.y = shipWorldY;
      state.viewport.w = viewportW;
      state.viewport.h = viewportH;
      state.viewport.width = viewportW;
      state.viewport.height = viewportH;

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
