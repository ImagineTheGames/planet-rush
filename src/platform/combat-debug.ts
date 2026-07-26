/**
 * src/platform/combat-debug.ts — the combat-visuals test instrument. OWNER: Platform Engineer.
 *
 * ── RATIFIED TEST CONTRACT (additive to ?debug=1's __planetRush) ────────────
 * A companion to src/platform/debug-hook.ts and src/platform/layout-registry.ts:
 * under `?debug=1` only, it merges two keys onto the shared `window.__planetRush`
 * surface so a live-boot Playwright suite can assert what the REAL client puts on
 * stage — not the render MODEL a unit test can fake, but the muzzle flashes the
 * booted client actually drew this frame:
 *
 *   window.__planetRush.muzzles: ReadonlyArray<{
 *     shooter: number,               // player slot that fired (turret owner)
 *     origin:  { x, y },             // muzzle / barrel tip, WORLD units
 *     end:     { x, y },             // clamped endpoint (origin + dir·length)
 *     hit:     { x, y } | null,      // aimed-at point, or null on a clean miss
 *   }>
 *   window.__planetRush.stageCombat(): unknown   // deterministically stage a
 *                                                // non-local turret muzzle flash
 *                                                // into the live world, for the test.
 *
 * WHY THIS EXISTS. The field bug (builds 5254cfe…b522a78) was that main.ts built
 * its combat visuals from the LOCAL player's fire, so only your own shot ever drew;
 * every non-local turret muzzle was invisible. m2-11's unit suite stayed green
 * because it tests the render model (combat-view.ts `muzzleFlashes`), not what the
 * booted client wires onto the Pixi stage. `muzzles` closes that gap: it reflects
 * exactly the flash set the renderer was handed this frame — one record per FIRING
 * turret, sourced from sim combat state for EVERY owner — so a test that boots the
 * real client and finds a non-local turret's flash here proves the wiring the unit
 * suite cannot reach. If main.ts regresses to feeding only the local shooter,
 * `muzzles` carries only `shooter === 0` and the guard fails.
 *
 * (Ships no longer contribute here at all: since the v0.3 laser funeral a ship's
 * shots are pooled projectiles drawn from the shot pool, not a standing line — so
 * the only muzzle flashes are turrets'.)
 *
 * `stageCombat` is the deterministic stager. main.ts (which owns `world`) registers
 * the closure via {@link CombatDebugHook.setStager}; this module only forwards the
 * call, so the sim-touching logic stays with the module that legitimately holds the
 * world. It is expected to be driven under `?freeze=1`, where the sim does not step
 * and therefore cannot clear the staged `Turret.muzzle` out from under the shutter.
 *
 * Without `?debug=1` this module is inert: it installs nothing and `update` is a
 * no-op. It is an instrument only — no game code reads these fields.
 * ───────────────────────────────────────────────────────────────────────────
 */

import type { Vec2 } from '@shared/types';
import { DEBUG_GLOBAL_KEY, isDebugEnabled } from './debug-hook';

/** The structural slice of a `MuzzleFlash` (src/sim/combat-view.ts) this instrument
 *  reads. Declared locally so the platform layer needn't import the sim; main.ts
 *  passes the concrete `muzzleFlashes(world)` records, which satisfy this shape. */
export interface MuzzleFlashLike {
  readonly shooter: number;
  readonly origin: Readonly<Vec2>;
  readonly dir: Readonly<Vec2>;
  readonly hitPoint: Readonly<Vec2> | null;
  readonly length: number;
}

/** One muzzle flash as the test reads it: emitter identity plus world-space
 *  geometry, with the clamped endpoint pre-computed so the assertion needn't
 *  re-derive it. */
export interface MuzzleFlashReadout {
  readonly shooter: number;
  readonly origin: { readonly x: number; readonly y: number };
  readonly end: { readonly x: number; readonly y: number };
  readonly hit: { readonly x: number; readonly y: number } | null;
}

/** The world-staging closure main.ts registers — it holds `world`, so it, not this
 *  instrument, does the mutation. Returns whatever it wants the test to assert on. */
export type CombatStager = () => unknown;

/** What `main.ts` drives: a live `enabled` flag (skip the work when debug is off),
 *  a per-frame `update` that records the drawn flash set, and `setStager` to register
 *  the deterministic firefight stager. */
export interface CombatDebugHook {
  readonly enabled: boolean;
  /** Record the muzzle-flash set the renderer was handed this frame. Stores the
   *  reference only — zero per-frame allocation on the hot path (GDD §4.3). */
  update(muzzles: readonly MuzzleFlashLike[]): void;
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

/** Project one sim-state muzzle flash into the readout shape the test asserts against. */
function readout(m: MuzzleFlashLike): MuzzleFlashReadout {
  return Object.freeze({
    shooter: m.shooter,
    origin: Object.freeze({ x: m.origin.x, y: m.origin.y }),
    // `length` is the sim's clamp to what the shot is aimed at (or full range on a
    // miss), so the endpoint IS the hit point when there is one — never drawn through it.
    end: Object.freeze({ x: m.origin.x + m.dir.x * m.length, y: m.origin.y + m.dir.y * m.length }),
    hit: m.hitPoint ? Object.freeze({ x: m.hitPoint.x, y: m.hitPoint.y }) : null,
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

  let latest: readonly MuzzleFlashLike[] = [];
  let stager: CombatStager | null = null;

  const hook: CombatDebugHook = {
    enabled: true,
    update(muzzles): void {
      latest = muzzles; // reference only — no copy on the per-frame path
    },
    setStager(fn): void {
      stager = fn;
    },
  };

  // The read/act surface merged onto __planetRush. Getters snapshot on read (only
  // the test reads them), so the per-frame `update` stays allocation-free.
  const surface = {
    get muzzles(): readonly MuzzleFlashReadout[] {
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
