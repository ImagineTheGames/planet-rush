/**
 * src/platform/freeze.ts — deterministic sim freeze for screenshots. OWNER:
 * Platform Engineer.
 *
 * `?freeze=1` (only with `?debug=1`) advances the sim to a fixed, seeded tick
 * and then stops stepping it — the world holds still so a screenshot is
 * byte-for-byte reproducible across boots and machines. This is a testing and
 * documentation instrument: the mobile-emulation Playwright suite and the
 * milestone phone-verification shots want the same frame every time, not a
 * frame that depends on when the capture happened to fire.
 *
 * Determinism is already guaranteed by the sim (GDD §4.1, §4.8): `createWorld`
 * is seeded and `step` is a pure function of (world, inputs). Freeze just pins
 * the entry point — same seed, same player roster, same tick count, no input —
 * so {@link buildFrozenWorld} returns an identical world every call, and
 * {@link hashWorld} collapses that to a compact fingerprint the debug hook can
 * surface (`window.__planetRush.worldHash`) and a test can compare across two
 * boots.
 *
 * Pure and DOM-free. It consumes the sim's public surface only — it never edits
 * `src/sim/` (that is the Gameplay Engineer's; here we are a read-only client).
 */

import { ShipClass } from '@shared/types';
import { createWorld, step } from '../sim';
import type { World, PlayerSpec } from '../sim';

/** The seed the frozen world is built from. Matches the day-1 boot world so the
 *  frozen frame is the same scene the game normally opens on. */
export const FREEZE_SEED = 1;

/** Player roster for the frozen world: a full 8-planet ring of Vanguards (the
 *  onboarding default, GDD §2.11), mirroring `main.ts`'s boot world. */
export const FREEZE_PLAYER_COUNT = 8;

/**
 * The tick the sim is frozen at. Two seconds of sim time at 60 Hz — far enough
 * in that the opening settles, with nothing random in play (no input, static
 * field), so the frame is deterministic regardless of the exact value. A round
 * constant keeps the frozen shot recognisable and stable across milestones.
 */
export const FREEZE_TICK = 120;

/** The frozen world's player roster (deterministic; no RNG). */
export function freezePlayers(count: number = FREEZE_PLAYER_COUNT): PlayerSpec[] {
  return Array.from({ length: count }, (_, id) => ({ id, shipClass: ShipClass.Vanguard }));
}

/**
 * Build the frozen world: construct the seeded day-1 world and advance it
 * exactly `tick` fixed steps with **no input** (ships hold position; the field
 * is static). Pure and deterministic — identical output on every call, which is
 * the whole point (deterministic screenshots; the freeze-determinism test).
 */
export function buildFrozenWorld(
  tick: number = FREEZE_TICK,
  seed: number = FREEZE_SEED,
  playerCount: number = FREEZE_PLAYER_COUNT,
): World {
  const world = createWorld({ seed, players: freezePlayers(playerCount) });
  advanceToFreezeTick(world, tick);
  return world;
}

/**
 * Advance an existing world to the freeze tick in place, stepping with empty
 * inputs. `main.ts` uses this to freeze the very world it already created and
 * renders, rather than swapping in a second one. Steps only forward; a world
 * already at/past `tick` is left untouched.
 */
export function advanceToFreezeTick(world: World, tick: number = FREEZE_TICK): void {
  while (world.tick < tick) {
    step(world, EMPTY_INPUTS);
  }
}

/** No player acts while freezing — the frozen frame is input-independent. */
const EMPTY_INPUTS = [] as const;

/**
 * A stable, compact fingerprint of a world's placement-relevant state. Two
 * worlds that `deepEqual` produce the same hash; two that differ almost
 * certainly differ (FNV-1a 32-bit over a canonical field serialization). Used
 * to assert freeze determinism across boots and to surface a one-line world
 * identity on the debug hook.
 *
 * Canonicalizes only the fields that a deterministic replay must match — the
 * plain-data world is already serialization-clean (sim/state.ts), so the order
 * is fixed and stable.
 */
export function hashWorld(world: World): string {
  let h = 0x811c9dc5; // FNV-1a offset basis

  const mix = (n: number): void => {
    // Fold a number to a stable 32-bit token, then FNV-1a each byte. `Math.round`
    // to a fixed micro-unit tames last-bit float noise without hiding real drift.
    let x = Math.round(n * 1e6) | 0;
    for (let i = 0; i < 4; i++) {
      h ^= x & 0xff;
      h = Math.imul(h, 0x01000193);
      x >>>= 8;
    }
  };

  mix(world.tick);
  mix(world.time);
  mix(world.rngState);
  mix(world.nextEntityId);

  for (const s of world.ships) {
    mix(s.id);
    mix(s.pos.x);
    mix(s.pos.y);
    mix(s.vel.x);
    mix(s.vel.y);
    mix(s.angle);
    mix(s.hull);
    mix(s.cargo);
    mix(s.banked);
    mix(s.spawnProtect);
    mix(s.alive ? 1 : 0);
  }
  for (const a of world.asteroids) {
    mix(a.id);
    mix(a.pos.x);
    mix(a.pos.y);
    mix(a.radius);
    mix(a.ore);
    mix(a.crackStage);
  }
  for (const c of world.chunks) {
    mix(c.id);
    mix(c.pos.x);
    mix(c.pos.y);
    mix(c.amount);
  }

  return (h >>> 0).toString(16).padStart(8, '0');
}
