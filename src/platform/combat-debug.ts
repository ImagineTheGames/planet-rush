/**
 * src/platform/combat-debug.ts — the combat-visuals test instrument. OWNER: Platform Engineer.
 *
 * ── RATIFIED TEST CONTRACT (additive to ?debug=1's __planetRush) ────────────
 * A companion to src/platform/debug-hook.ts and src/platform/layout-registry.ts:
 * under `?debug=1` only, it merges two keys onto the shared `window.__planetRush`
 * surface so a live-boot Playwright suite can assert what the REAL client puts on
 * stage — not the render MODEL a unit test can fake, but the beams the booted
 * client actually drew this frame:
 *
 *   window.__planetRush.beams: ReadonlyArray<{
 *     shooter: number,               // player slot that fired (turret: owner)
 *     source:  'ship' | 'turret',    // emitter kind
 *     origin:  { x, y },             // muzzle / emitter, WORLD units
 *     end:     { x, y },             // clamped endpoint (origin + dir·length)
 *     hit:     { x, y } | null,      // first-strike point, or null on a clean miss
 *   }>
 *   window.__planetRush.stageCombat(): unknown   // deterministically stage a
 *                                                // non-local firefight (a bot
 *                                                // beam + a turret muzzle) into
 *                                                // the live world, for the test.
 *
 * WHY THIS EXISTS. The field bug (builds 5254cfe…b522a78) was that main.ts built
 * its beam visuals from the LOCAL player's fire, so only your own beam ever drew;
 * every bot beam and every turret muzzle was invisible. m2-11's unit suite stayed
 * green because it tests the render model (combat-view.ts `combatBeams`), not what
 * the booted client wires onto the Pixi stage. `beams` closes that gap: it reflects
 * exactly the beam set the renderer was handed this frame — one record per FIRING
 * EMITTER, sourced from sim combat state for EVERY shooter — so a test that boots
 * the real client and finds a non-local shooter's beam here proves the wiring the
 * unit suite cannot reach. If main.ts regresses to feeding only the local beam,
 * `beams` carries only `shooter === 0` and the guard fails.
 *
 * `stageCombat` is the deterministic stager. main.ts (which owns `world`) registers
 * the closure via {@link CombatDebugHook.setStager}; this module only forwards the
 * call, so the sim-touching logic stays with the module that legitimately holds the
 * world. It is expected to be driven under `?freeze=1`, where the sim does not step
 * and therefore cannot clear the staged `Ship.beam` / `Turret.muzzle` out from under
 * the shutter.
 *
 * Without `?debug=1` this module is inert: it installs nothing and `update` is a
 * no-op. It is an instrument only — no game code reads these fields.
 * ───────────────────────────────────────────────────────────────────────────
 */

import type { Vec2 } from '@shared/types';
import { DEBUG_GLOBAL_KEY, isDebugEnabled } from './debug-hook';

/** The structural slice of a `CombatBeam` (src/sim/combat-view.ts) this instrument
 *  reads. Declared locally so the platform layer needn't import the sim; main.ts
 *  passes the concrete `combatBeams(world)` records, which satisfy this shape. */
export interface CombatBeamLike {
  readonly shooter: number;
  readonly source: 'ship' | 'turret';
  readonly origin: Readonly<Vec2>;
  readonly dir: Readonly<Vec2>;
  readonly hitPoint: Readonly<Vec2> | null;
  readonly length: number;
}

/** One beam as the test reads it: emitter identity plus world-space geometry,
 *  with the clamped endpoint pre-computed so the assertion needn't re-derive it. */
export interface CombatBeamReadout {
  readonly shooter: number;
  readonly source: 'ship' | 'turret';
  readonly origin: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number };
  readonly hit: { readonly x: number; readonly y: number } | null;
}

/** The world-staging closure main.ts registers — it holds `world`, so it, not this
 *  instrument, does the mutation. Returns whatever it wants the test to assert on. */
export type CombatStager = () => unknown;

/** What `main.ts` drives: a live `enabled` flag (skip the work when debug is off),
 *  a per-frame `update` that records the drawn beam set, and `setStager` to register
 *  the deterministic firefight stager. */
export interface CombatDebugHook {
  readonly enabled: boolean;
  /** Record the beam set the renderer was handed this frame. Stores the reference
   *  only — zero per-frame allocation on the hot path (GDD §4.3). */
  update(beams: readonly CombatBeamLike[]): void;
  /** Register the world-staging closure (main.ts owns `world`). */
  setStager(fn: CombatStager): void;
}

/** A shared do-nothing hook for the (common) debug-off path. */
const NOOP_HOOK: CombatDebugHook = {
  enabled: false,
  update: () => {},
  setStager: () => {},
};

/** Anything with a settable/extensible `__planetRush` — a `Window` or a test double. */
type HookTarget = Record<string, unknown>;

/** Project one sim-state beam into the readout shape the test asserts against. */
function readout(b: CombatBeamLike): CombatBeamReadout {
  return Object.freeze({
    shooter: b.shooter,
    source: b.source,
    origin: Object.freeze({ x: b.origin.x, y: b.origin.y }),
    // `length` is the sim's clamp to the first hit (or full range on a miss), so
    // the endpoint IS the hit point when there is one — never drawn through it.
    end: Object.freeze({ x: b.origin.x + b.dir.x * b.length, y: b.origin.y + b.dir.y * b.length }),
    hit: b.hitPoint ? Object.freeze({ x: b.hitPoint.x, y: b.hitPoint.y }) : null,
  });
}

/**
 * Install the additive combat-visuals surface iff `search` carries `?debug=1`;
 * otherwise return an inert no-op hook that touches nothing.
 *
 * Follows the shared-handle discipline of layout-registry.ts: `window.__planetRush`
 * is co-owned (the camera instrument installs it first, read-only), so this merges
 * its two keys onto the existing handle rather than reassigning it — a plain
 * assignment would throw on the non-configurable property and abort boot.
 */
export function installCombatDebug(
  search: string,
  target: HookTarget = globalThis as unknown as HookTarget,
): CombatDebugHook {
  if (!isDebugEnabled(search)) return NOOP_HOOK;

  let latest: readonly CombatBeamLike[] = [];
  let stager: CombatStager | null = null;

  const hook: CombatDebugHook = {
    enabled: true,
    update(beams): void {
      latest = beams; // reference only — no copy on the per-frame path
    },
    setStager(fn): void {
      stager = fn;
    },
  };

  // The read/act surface merged onto __planetRush. Getters snapshot on read (only
  // the test reads them), so the per-frame `update` stays allocation-free.
  const surface = {
    get beams(): readonly CombatBeamReadout[] {
      return Object.freeze(latest.map(readout));
    },
    stageCombat(): unknown {
      if (!stager) throw new Error('combat-debug: no stager registered (is the game loop up?)');
      return stager();
    },
  };

  // Additive install (see layout-registry.ts `installLayoutHook` for the full
  // rationale): merge our keys onto whatever co-tenant already owns the handle,
  // never clobbering a key it holds. Best-effort per key so one collision can't
  // abort the rest.
  const existing = target[DEBUG_GLOBAL_KEY] as Record<string, unknown> | undefined;
  const host = existing ?? {};
  const descriptors = Object.getOwnPropertyDescriptors(surface);
  for (const key of Object.keys(descriptors)) {
    if (Object.prototype.hasOwnProperty.call(host, key)) continue;
    try {
      Object.defineProperty(host, key, descriptors[key]!);
    } catch {
      /* co-tenant is non-extensible for this key — skip it, keep the rest */
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
