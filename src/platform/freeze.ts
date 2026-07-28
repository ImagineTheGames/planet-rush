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
import { createWorld, step, turretHomeAngle, turretOrbitPos, TURRET, SHIELD } from '../sim';
import type { World, PlayerSpec, MiningStation } from '../sim';

/** The seed the frozen world is built from. Matches the day-1 boot world so the
 *  frozen frame is the same scene the game normally opens on. */
export const FREEZE_SEED = 1;

/** Player roster for the frozen world: a full 8-station ring of Vanguards (the
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
 * Stamp a **defence showcase** onto the local player's home for the frozen
 * golden — a review surface for the structure art (a2-05). Structures never
 * appear in a natural two-second opening (a build takes ~10 s, GDD §2.5), so a
 * golden that only froze the day-1 scene could never show a turret or a shield;
 * this stages one deterministically so the ratified turret pool (Breech Mk I,
 * Twin Mk II, Rail Mk III), a construction scaffold, and a stacked shield bubble
 * are all on screen and reviewable, the same way the ship and asteroid art landed
 * in the golden because they are simply *there*.
 *
 * Pure and deterministic (no RNG, no clock), so the frozen frame stays
 * byte-stable across boots. It writes only `Turret`/`Shield`/`BuildJob` literals
 * onto the local station — the exact plain-data shapes the sim itself builds — and
 * touches nothing the world hash covers (turrets/shields/builds are not hashed),
 * so freeze determinism is unchanged. Applied *after* the freeze advance, and
 * only under `?freeze=1`, so it can never reach a live match.
 */
export function stampDefenseShowcase(world: World, localOwner = 0): void {
  const station = world.stations.find((p) => p.owner === localOwner && p.alive);
  if (!station) return;
  if (station.turrets.length > 0 || station.shields.length > 0 || station.builds.length > 0) return;

  // Three standing turrets, one per Mk, so the pool's escalation reads at a glance;
  // the Mk II is tracking (plasma charge at the muzzle), the others idle.
  const stand = [
    { slot: 0, tier: 0, targetId: null as number | null },
    { slot: 1, tier: 1, targetId: firstRival(world, localOwner) },
    { slot: 2, tier: 2, targetId: null as number | null },
  ];
  for (const s of stand) {
    const home = turretHomeAngle(station, s.slot);
    const pos = turretOrbitPos(station, home);
    station.turrets.push({
      id: world.nextEntityId++,
      owner: station.owner,
      slot: s.slot,
      pos: { x: pos.x, y: pos.y },
      radius: TURRET.radius,
      hp: TURRET.hp,
      maxHp: TURRET.hp,
      tier: s.tier,
      angle: home,
      orbitAngle: home,
      cooldown: 0,
      targetId: s.targetId,
      aim: null,
      muzzle: null,
    });
  }

  // A fourth mount mid-build — the scaffold, ~60% done, so "defences are bought
  // before the attack" has a picture (GDD §2.5).
  station.builds.push({
    id: world.nextEntityId++,
    kind: 'turret',
    slot: 3,
    total: TURRET.buildTime,
    remaining: TURRET.buildTime * 0.4,
  });

  // A stacked shield: a full inner bubble and a half-drained outer one, so the
  // "pressure beats regeneration" banding (GDD §2.6) is on the sheet too.
  station.shields.push(
    { id: world.nextEntityId++, hp: SHIELD.hp, maxHp: SHIELD.hp, radius: SHIELD.radius },
    { id: world.nextEntityId++, hp: SHIELD.hp * 0.5, maxHp: SHIELD.hp, radius: SHIELD.radius },
  );
}

/** The first enemy home's owner, so a tracking turret has a real slot to face —
 *  or `1` if the roster somehow has no rival (never in the 8-home freeze). */
function firstRival(world: World, localOwner: number): number {
  const rival = world.stations.find((p: MiningStation) => p.owner !== localOwner);
  return rival ? rival.owner : 1;
}

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
