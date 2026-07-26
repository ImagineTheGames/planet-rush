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
 *     build:      { sha, time, dirty },       // WHICH BUILD this is (build-info.ts)
 *     ticks:      number,                     // fixed sim steps executed since
 *                                             // boot — the sim's OWN clock
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
 * ── WRITE SEAMS (round-9 QA unblock: damageShip / damageCore / coreHp) ──────
 * The readouts above are the original instrument: read-only, updated per frame.
 * The QA Manager proved two round-9 gates unverifiable — nothing could stage
 * damage against an arbitrary owner, and nothing could damage or read a core.
 * {@link installDebugStage} closes that, merging three more keys onto the same
 * `?debug=1` `window.__planetRush` handle (additively, exactly as the combat and
 * layout co-tenants do — the handle is installed read-only/non-configurable, but
 * co-tenants EXTEND it with their own keys; none is ever clobbered):
 *
 *   window.__planetRush.damageShip(owner, amount): DebugWriteAction   // WRITE
 *   window.__planetRush.damageCore(player, amount): DebugWriteAction  // WRITE
 *   window.__planetRush.coreHp(player): number | null                // READ-ONLY
 *
 * `coreHp` is a pure read — the core-HP counterpart to the already-readable bank —
 * and answers immediately off the live world. The two `damage*` calls are the new
 * part: they WRITE to the sim. To keep determinism and the net protocol intact
 * they do NOT poke world state; they QUEUE a {@link DebugWriteAction} (a
 * platform-local "debug Action kind", deliberately NOT a `@shared/types` `Action`
 * so it never rides the net wire nor needs a sim-side reducer case) and return the
 * queued verb. `main.ts` drains the queue once per fixed step
 * ({@link DebugStageHook.drain}) and applies each write through the sim's OWN
 * ratified damage functions, so the effect lands only on a tick boundary, in FIFO
 * order, attributed to the local player — the same ordered pulse real input rides,
 * replay-deterministic and off the wire.
 *
 * Without `?debug=1` this module is inert: it installs nothing, attaches nothing
 * to `window`, `update` is a no-op, and {@link installDebugStage} returns a no-op
 * hook that touches neither `window` nor the sim. It is an instrument only — no
 * game code reads `__planetRush` or these seams; they exist for the QA suite.
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
  build: BuildInfo = BUILD_INFO,
): DebugHook {
  if (!isDebugEnabled(search)) return NOOP_HOOK;

  // Mutable backing store; the readonly `DebugState` fields are overwritten in
  // place, never reassigned, so the exposed handle stays a stable read-only ref.
  // `build` is the exception: a compile-time constant, frozen on the way in.
  const state = {
    shipScreen: { x: 0, y: 0 },
    shipWorld: { x: 0, y: 0 },
    // Two numbers, four fields: the layout-registry co-tenant reads this same
    // object as {width, height} (see the `viewport` note in the contract above).
    viewport: { w: 0, h: 0, width: 0, height: 0 },
    fps: 0,
    build: Object.freeze({ ...build }),
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
      state.viewport.width = viewportW;
      state.viewport.height = viewportH;
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

// ---------------------------------------------------------------------------
// Write seams — the round-9 QA unblock (damageShip / damageCore / coreHp)
// ---------------------------------------------------------------------------

/**
 * The debug "Action kind": a staging verb the QA suite files to make the sim DO
 * something, as opposed to the read-only readouts of {@link DebugState}. Two
 * writes today — damage an arbitrary owner's ship, damage an arbitrary player's
 * core.
 *
 * Deliberately a PLATFORM-LOCAL type and NOT a `@shared/types` `Action`:
 *  - it must never ride the net wire (`InputMessage.actions`), where a real
 *    server would neither expect nor trust it — that would corrupt the protocol;
 *  - it needs no `case` in the sim's action reducer, so nothing in `src/sim`
 *    changes and no exhaustive switch there is broken.
 * Instead it rides the SAME ordered pulse real input does: queued on the call,
 * drained by `main.ts` once per fixed step ({@link DebugStageHook.drain}), and
 * applied through the sim's own ratified damage functions via a bridge `main.ts`
 * registers (it owns `world`). So a write lands only on a tick boundary, in FIFO
 * order, attributed to the local player — replay-deterministic, never poked into
 * world state between ticks.
 */
export type DebugWriteAction =
  | { readonly op: 'damageShip'; readonly owner: number; readonly amount: number }
  | { readonly op: 'damageCore'; readonly player: number; readonly amount: number };

/**
 * The world-facing bridge `main.ts` registers via {@link DebugStageHook.setBridge}.
 * It holds `world`, so the sim-touching apply/read stays there (the same division
 * of labour as combat-debug's `setStager`); this module only queues and forwards.
 */
export interface DebugSimBridge {
  /** Apply `amount` sim damage to `owner`'s ship. The sim tracks no killer, so
   *  "attributed to the local player" is nominal today — this is the same code
   *  path a real hit uses, spawn protection included. */
  damageShip(owner: number, amount: number): void;
  /** Apply `amount` sim damage to `player`'s planet (shields first, then core —
   *  the sim's real rule; a fresh home has no shields, so it hits the core). */
  damageCore(player: number, amount: number): void;
  /** Read `player`'s current core HP, or null if they have no planet. */
  coreHp(player: number): number | null;
}

/** What `main.ts` drives for the write seams: register the world bridge, and
 *  drain the queued writes once per fixed step so they land on a tick boundary. */
export interface DebugStageHook {
  readonly enabled: boolean;
  /** Register the world-facing bridge (main.ts owns `world`). */
  setBridge(bridge: DebugSimBridge): void;
  /** Apply every queued {@link DebugWriteAction} in FIFO order, then clear. A
   *  no-op until a bridge is registered — the queue is preserved until then, so
   *  a write filed before the loop wired the bridge is not lost. */
  drain(): void;
}

/** A shared do-nothing write hook for the (common) debug-off path. */
const NOOP_STAGE_HOOK: DebugStageHook = {
  enabled: false,
  setBridge: () => {},
  drain: () => {},
};

/** Anything with a settable/extensible `__planetRush` — a `Window` or a test double. */
type StageTarget = Record<string, unknown>;

/**
 * Install the `?debug=1` WRITE seams — `damageShip`, `damageCore`, `coreHp` —
 * onto the shared `window.__planetRush` handle, or return an inert no-op hook
 * when the URL does not opt in. Additive-merge discipline (see
 * {@link installCombatDebug} in combat-debug.ts for the full rationale): the
 * camera instrument installs the handle read-only first, so we merge our keys
 * onto whatever co-tenant already owns it rather than reassigning, never
 * clobbering a key it holds.
 *
 * The two damage methods QUEUE a {@link DebugWriteAction} and return the queued
 * verb (frozen) — the effect lands when `main.ts` next {@link DebugStageHook.drain}s
 * the queue, on a fixed-tick boundary, so the write is ordered like real input
 * and never a mid-frame poke. `coreHp` is a pure read and answers now, off the
 * bridge's live world (null before the bridge is registered).
 */
export function installDebugStage(
  search: string,
  target: StageTarget = globalThis as unknown as StageTarget,
): DebugStageHook {
  if (!isDebugEnabled(search)) return NOOP_STAGE_HOOK;

  const queue: DebugWriteAction[] = [];
  let bridge: DebugSimBridge | null = null;

  const hook: DebugStageHook = {
    enabled: true,
    setBridge(b): void {
      bridge = b;
    },
    drain(): void {
      if (!bridge || queue.length === 0) return;
      // Take this tick's batch off the queue first, then apply — so nothing an
      // apply might enqueue (there is none today) is dropped or double-run.
      const batch = queue.splice(0, queue.length);
      for (const a of batch) {
        if (a.op === 'damageShip') bridge.damageShip(a.owner, a.amount);
        else bridge.damageCore(a.player, a.amount);
      }
    },
  };

  // The write/read surface merged onto __planetRush. The two writers only QUEUE —
  // they do not touch the sim here — so the effect is deferred to the ordered
  // drain; `coreHp` reads through the bridge immediately (read-only, like `bars`).
  const surface = {
    damageShip(owner: number, amount: number): DebugWriteAction {
      const action = Object.freeze({ op: 'damageShip', owner, amount } as const);
      queue.push(action);
      return action;
    },
    damageCore(player: number, amount: number): DebugWriteAction {
      const action = Object.freeze({ op: 'damageCore', player, amount } as const);
      queue.push(action);
      return action;
    },
    coreHp(player: number): number | null {
      return bridge ? bridge.coreHp(player) : null;
    },
  };

  // Additive install onto the shared handle (identical discipline to
  // installCombatDebug): merge our keys onto whatever co-tenant already owns the
  // handle, never clobbering a key it holds; best-effort per key.
  const existing = target[DEBUG_GLOBAL_KEY] as Record<string, unknown> | undefined;
  const host = existing ?? {};
  const descriptors = Object.getOwnPropertyDescriptors(surface);
  for (const key of Object.keys(descriptors)) {
    if (Object.prototype.hasOwnProperty.call(host, key)) continue;
    try {
      Object.defineProperty(host, key, descriptors[key]!);
    } catch {
      /* co-tenant owns this key or is non-extensible — skip it, keep the rest */
    }
  }
  if (!existing) {
    try {
      Object.defineProperty(target, DEBUG_GLOBAL_KEY, {
        value: host,
        writable: false,
        configurable: false,
        enumerable: true,
      });
    } catch {
      target[DEBUG_GLOBAL_KEY] = host;
    }
  }

  return hook;
}
