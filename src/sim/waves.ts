/**
 * src/sim/waves.ts — the asteroid field: fair home neighbourhoods + the
 * contested commons. OWNER: Gameplay Engineer.
 *
 * ---------------------------------------------------------------------------
 * THE FAIRNESS INVARIANT (developer field rule v0.1.2)
 * ---------------------------------------------------------------------------
 * "We also need equally located resources (asteroids) for planets, before the
 * fight begins — with neighbor resources and central ones as well."
 *
 * Resource placement is a fairness invariant, not scatter. The whole asteroid
 * field is **invariant under rotation by `2π / N` about the arena centre**,
 * where `N` is the player count:
 *
 *  1. **Home fields — identical by construction.** One seeded canonical pattern
 *     (`homeCanon`), stamped around each planet rotated by that planet's ring
 *     angle. A rotation about the centre is an isometry, so every home field has
 *     the same count, the same total ore, the same size mix, and the same
 *     positions *relative to its planet* — the per-player totals are equal
 *     EXACTLY, no tolerance. Each field sits inboard of its planet (between it
 *     and the ring midline), OUTSIDE turret range, clear of the wall margin, and
 *     beyond the `SPAWN_CLEAR_POCKET` launch pocket kept empty around every home
 *     (field report P1) — because the pocket is part of the per-planet stamp it
 *     is automatically identical for everyone and costs the invariant nothing.
 *  2. **The commons — contested centre.** Each wave's rocks are generated in one
 *     `2π / N` sector and stamped at all `N` rotations, so the central field is
 *     `N`-fold symmetric too — mid-map expansion is worth fighting for but
 *     favours nobody's approach.
 *  3. **No stray scatter.** Nothing else spawns ore off-pattern. Wreck debris
 *     (`./match`) and a ship's death drop (`./damage`) are the only other ore
 *     sources, and both are consequences of play, not the pre-fight layout.
 *
 * FUTURE MAPS: this is layout-agnostic by design — the rotation stamp works
 * for any ring order and any `N`. A new map in a future map registry keeps
 * parity for free **as long as it places home fields by the same per-planet
 * stamp and keeps every ore source `N`-fold symmetric**, and it must prove it
 * against the same seeded suite, `tests/sim/resource-fairness.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * The finite field and its metronome (GDD §2.3)
 * ---------------------------------------------------------------------------
 * The commons arrives on a metronome: `WAVE_COUNT` waves, `WAVE_INTERVAL_S`
 * apart, each spawning closer to the map centre than the last. That shrinking
 * disc is the match's shape, and when the last wave is exhausted the match
 * enters collapse (see `./match`). Two rules make the ending structural:
 *
 *  1. **Finite yield.** The commons waves carry `WAVE_ORE` each and the home
 *     fields carry the rest, summing to exactly `FIELD_YIELD` — no seed produces
 *     a match that can be farmed forever.
 *  2. **Fixed schedule.** Wave `n` lands at `waveTime(n)` — the same function
 *     the HUD's wave clock counts down to, so the clock can never promise a wave
 *     the sim does not deliver.
 *
 * Determinism (GDD §4.8): every draw comes from `world.rngState` in a fixed
 * order — the canonical pattern is drawn once, then stamped with pure trig — so
 * the field that lands at t=600 is decided by the seed, not the frame rate.
 */

import type { PlayerId } from '@shared/types';
import {
  ASTEROID,
  RESOURCE_FIELD,
  SPAWN_CLEAR_POCKET,
  WAVE_COUNT,
  WAVE_ORE,
  clampToMargin,
  homeFieldOre,
  waveRadiusFraction,
  waveTime,
} from './constants';
import { ledgerAdd } from './ore-ledger';
import { rngRange } from './rng';
import type { World } from './state';

/** Total ore locked in unmined rock (plus the fractional mine buffer that has
 *  left `ore` but not yet formed a chunk) — the source a wave adds to. */
function totalRockOre(world: World): number {
  let ore = 0;
  for (const a of world.asteroids) ore += a.ore + a.mineBuffer;
  return ore;
}

/** True once every wave in the schedule has been delivered — no more ore is
 *  ever coming (GDD §2.3, the precondition for collapse). */
export function allWavesSpawned(world: World): boolean {
  return world.match.wavesSpawned >= WAVE_COUNT;
}

/** Ore still available to a miner anywhere on the map: rock plus loose chunks.
 *  Debris around a wreck counts — it is ore, and it is scavengeable (GDD §2.7). */
export function fieldOre(world: World): number {
  let ore = 0;
  for (const a of world.asteroids) ore += a.ore;
  for (const c of world.chunks) ore += c.amount;
  return ore;
}

/** True when there is nothing left to mine or scoop anywhere. */
export function fieldExhausted(world: World): boolean {
  return fieldOre(world) <= 1e-9;
}

// ---------------------------------------------------------------------------
// Stamp: one rock, rotated onto every planet's spoke
// ---------------------------------------------------------------------------

/** A canonical rock in the arena's polar frame: `r` from the centre, angular
 *  offset `delta` from a reference spoke at angle 0. Stamped onto a real spoke
 *  by adding that spoke's angle — a pure rotation about the centre, so every
 *  stamp is congruent to the canonical. */
interface CanonRock {
  r: number;
  delta: number;
  radius: number;
  ore: number;
}

/** Push one canonical rock, rotated onto spoke `theta`, into the world. The
 *  clamp keeps a rock on a cramped QA world off the wall (field report P1); on
 *  the real arena the field sits well inside the margin, so the clamp is a
 *  no-op and the rotational symmetry is exact. `home` tags which neighbourhood
 *  it belongs to (a planet owner), or `null` for the commons. */
function stampRock(
  world: World,
  cx: number,
  cy: number,
  theta: number,
  rock: CanonRock,
  home: PlayerId | null,
): void {
  const ang = theta + rock.delta;
  world.asteroids.push({
    id: world.nextEntityId++,
    pos: {
      x: clampToMargin(cx + Math.cos(ang) * rock.r, rock.radius, world.bounds.width),
      y: clampToMargin(cy + Math.sin(ang) * rock.r, rock.radius, world.bounds.height),
    },
    radius: rock.radius,
    ore: rock.ore,
    maxOre: rock.ore,
    crackStage: 0,
    mineBuffer: 0,
    home,
  });
}

/**
 * Stamp a canonical home rock **in a planet's own frame** rather than the
 * arena's — for maps whose planets do not share one ring (`compass`, `oval`,
 * `diamond`). The canonical rock lives in the polar frame of a reference planet
 * sitting on the +x spoke at radius `refR`; its offset from that planet is
 * rotated by the real planet's spoke angle and dropped at the real planet's
 * centre. Because the offset is the SAME for every planet, all `N` home fields
 * are a rigid rotation-plus-translation of one pattern — congruent, so the
 * per-player local ore is identical by construction even when the planets are
 * not (the fairness invariant, `resource-fairness.test.ts`), exactly as the
 * single-ring `stampRock` gives for `octagon`. Positions still clamp to the wall
 * margin (a no-op on the shipped maps, where the field sits well inboard).
 */
function stampRockLocal(
  world: World,
  refR: number,
  planet: { pos: { x: number; y: number }; angle: number },
  rock: CanonRock,
  home: PlayerId | null,
): void {
  // Canonical rock at (r, delta) in the reference planet's polar frame; its
  // offset from that planet (which sits at (refR, 0) in that frame).
  const ox = rock.r * Math.cos(rock.delta) - refR;
  const oy = rock.r * Math.sin(rock.delta);
  const ca = Math.cos(planet.angle);
  const sa = Math.sin(planet.angle);
  world.asteroids.push({
    id: world.nextEntityId++,
    pos: {
      x: clampToMargin(planet.pos.x + (ox * ca - oy * sa), rock.radius, world.bounds.width),
      y: clampToMargin(planet.pos.y + (ox * sa + oy * ca), rock.radius, world.bounds.height),
    },
    radius: rock.radius,
    ore: rock.ore,
    maxOre: rock.ore,
    crackStage: 0,
    mineBuffer: 0,
    home,
  });
}

/** Draw `count` canonical rocks and scale their ore so the whole pattern totals
 *  `oreBudget`. Advances and returns the RNG state. Radii/angles vary with the
 *  seed (GDD §5.5 — a payout a player can judge); the total does not. */
function drawCanon(
  rng: number,
  count: number,
  minR: number,
  maxR: number,
  minDelta: number,
  maxDelta: number,
  oreBudget: number,
): { rocks: CanonRock[]; rng: number } {
  const rocks: CanonRock[] = [];
  let drawnOre = 0;
  for (let i = 0; i < count; i++) {
    let d = rngRange(rng, minR, maxR);
    const r = d.value;
    rng = d.state;
    d = rngRange(rng, minDelta, maxDelta);
    const delta = d.value;
    rng = d.state;
    d = rngRange(rng, ASTEROID.minRadius, ASTEROID.maxRadius);
    const radius = d.value;
    rng = d.state;
    d = rngRange(rng, ASTEROID.minOre, ASTEROID.maxOre);
    const ore = d.value;
    rng = d.state;
    drawnOre += ore;
    rocks.push({ r, delta, radius, ore });
  }
  if (drawnOre > 1e-9) {
    const scale = oreBudget / drawnOre;
    for (const rock of rocks) rock.ore *= scale;
  }
  return { rocks, rng };
}

// ---------------------------------------------------------------------------
// Home fields — the identical per-planet neighbourhoods (invariant §1)
// ---------------------------------------------------------------------------

/**
 * Place every planet's home field: one seeded canonical pattern stamped around
 * each planet rotated by its ring angle. Runs once, at match construction,
 * before wave 1 — the neighbour resources "before the fight begins."
 *
 * Because the pattern is drawn ONCE and only rotated, all `N` fields are
 * congruent: equal count, equal total ore (`homeFieldOre`), equal size mix, and
 * equal positions relative to their own planet. That is the fairness invariant,
 * and it holds with no tolerance — the totals are equal EXACTLY.
 */
export function spawnHomeFields(world: World): void {
  // Only LIVE homes get a stamped neighbourhood: a derelict is an unowned wreck
  // (the derelict-fill maps, Milestone B), so it carries no home field — its
  // lootable ore is wreck debris instead (`scatterDerelictLoot` in `./match`).
  // `n` is the count of live homes, so `homeFieldOre` divides the home share by
  // the ACTIVE player count, not the board size: every live player's
  // neighbourhood is as rich at a small N as it would be on a regenerate map,
  // and the finite field still totals exactly `FIELD_YIELD` (the derelict debris
  // is separate loose ore, not part of the home/commons budget).
  const planets = world.planets.filter((p) => !p.derelict);
  const n = planets.length;
  if (n === 0) return;

  const cx = world.bounds.width / 2;
  const cy = world.bounds.height / 2;
  // Each live home's own distance from the centre. On a single-ring map (`octagon`
  // and the historical default) these are all equal; on `compass`/`oval`/
  // `diamond` they are not, and the field is stamped per-planet so it stays
  // inboard of each home wherever the home sits.
  const radii = planets.map((p) => Math.hypot(p.pos.x - cx, p.pos.y - cy));
  const ref = radii[0]!;
  const singleRing = radii.every((r) => Math.abs(r - ref) <= 1e-9);
  // The field-band reference: the ring radius on a single-ring map (identical to
  // the historical `ringR`, so that path stays byte-for-byte unchanged), else
  // the SMALLEST planet radius, so the shared pattern fits inboard of even the
  // closest-in home (the `diamond` inner ring). The field is a fraction of it,
  // so the layout scales with the arena and stays layout-agnostic.
  const ringR = singleRing ? ref : Math.min(...radii);

  // The launch pocket (field report P1): no rock's BODY may sit within
  // `SPAWN_CLEAR_POCKET` of a planet, so a ship can leave spawn and manoeuvre in
  // open space. The band fractions below already place the whole field well
  // inside this, but clamp the outer edge to the pocket so the guarantee is
  // structural — it survives a retune of `homeOuterFraction`. `maxRadius` keeps
  // the whole rock out of the pocket, not just its centre; the outer rock is the
  // one nearest its planet, so this is the only edge the pocket can bind.
  const pocketOuterR = ringR - ringR * SPAWN_CLEAR_POCKET - ASTEROID.maxRadius;
  const outerR = Math.min(ringR * RESOURCE_FIELD.homeOuterFraction, pocketOuterR);
  // Keep the band ordered if a large pocket ever clamps `outerR` below the inner
  // fraction (degenerate tuning only — never on the shipped numbers).
  const innerR = Math.min(ringR * RESOURCE_FIELD.homeInnerFraction, outerR);

  // Draw the shared pattern ONCE and advance the world RNG by it; the stamp
  // that follows is pure trig, so every field is identical and the RNG advance
  // does not depend on `n`. The raw angular draw spans the full cone
  // `±homeConeOuter`; it is then folded OUT of the launch corridor (below).
  const { rocks, rng } = drawCanon(
    world.rngState,
    RESOURCE_FIELD.homeCount,
    innerR,
    outerR,
    -RESOURCE_FIELD.homeConeOuter,
    RESOURCE_FIELD.homeConeOuter,
    homeFieldOre(n),
  );
  world.rngState = rng;

  // Fold each rock's angular offset out of the clear wedge along the spoke: keep
  // its side, but map the magnitude from `[0, homeConeOuter]` onto
  // `[homeConeInner, homeConeOuter]`. This is a deterministic transform of an
  // already-drawn value (no extra RNG draw, determinism preserved, GDD §4.8), so
  // the field becomes two lobes straddling a clear launch corridor while every
  // home field stays a rigid rotation of this one pattern — the fairness
  // invariant is untouched (field report P1; see `homeConeInner` in constants).
  const { homeConeInner: cIn, homeConeOuter: cOut } = RESOURCE_FIELD;
  const span = cOut - cIn;
  for (const rock of rocks) {
    const side = rock.delta < 0 ? -1 : 1;
    rock.delta = side * (cIn + (span * Math.abs(rock.delta)) / cOut);
  }

  for (const planet of planets) {
    for (const rock of rocks) {
      // Single-ring maps take the original arena-frame stamp unchanged (the
      // `octagon`/default board is byte-for-byte what it always was); varying-
      // radius maps stamp the same pattern in each planet's own frame, holding
      // every home field congruent.
      if (singleRing) {
        stampRock(world, cx, cy, planet.angle, rock, planet.owner);
      } else {
        stampRockLocal(world, ringR, planet, rock, planet.owner);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The commons — the contested centre, delivered on the metronome (invariant §2)
// ---------------------------------------------------------------------------

/**
 * Spawn the next commons wave: rocks scattered in a disc whose radius shrinks
 * wave over wave, carrying exactly `WAVE_ORE` ore between them and — like the
 * home fields — `N`-fold symmetric about the arena centre.
 *
 * One `2π / N` sector's worth of rocks is drawn and stamped at all `N`
 * rotations, so each player faces the same central field. `count` is a target;
 * it is rounded to a whole number of sector rocks so the symmetry is exact.
 * Advances `world.match.wavesSpawned`.
 */
export function spawnWave(world: World, count: number = world.asteroidsPerWave): void {
  const n = world.match.wavesSpawned + 1;
  const cx = world.bounds.width / 2;
  const cy = world.bounds.height / 2;
  const discRadius = world.fieldRadius * waveRadiusFraction(n);

  // Symmetry group order: one stamp per planet spoke (the same rotation the home
  // fields use). A world with no planets (render/test fixtures) still spawns a
  // plain ring of `count` rocks — one "sector."
  const sectors = Math.max(1, world.planets.length);
  const sectorRocks = count <= 0 ? 0 : Math.max(1, Math.round(count / sectors));
  const sectorWidth = (2 * Math.PI) / sectors;

  // The commons is a coned RING, not a filled disc (field report P1). Two shapes,
  // one reason — keep every player's launch corridor clear:
  //   • a clear eye: rocks avoid the inner `commonsHoleFraction` of the wave's
  //     disc, so the very centre — and the straight spoke a ship launches down —
  //     is open. Each wave still lands closer in than the last (the "Outer Drift"
  //     that closes to the core, GDD §2.3): they are concentric shrinking rings.
  //   • a spoke gap: rocks sit only in `[gap, sectorWidth − gap]` of their sector,
  //     so no rock lands ON a spoke where a launching ship would ram it. Under a
  //     slow renderer the drag test's gesture ramp flies the ship most of the way
  //     to the centre before its window even opens, so the whole spoke must be
  //     clear, not just a pocket. Sized so the innermost ring rock clears a ship's
  //     straight path by more than a ship+rock radius (`inner·sin(gap)` ≈ 74 u).
  // Both are pure `N`-fold-symmetric reshapes of one drawn sector, so the commons
  // stays symmetric and carries the same `WAVE_ORE` — the fairness invariant is
  // untouched (`resource-fairness.test.ts`).
  const gap = Math.min(RESOURCE_FIELD.commonsSpokeGap, sectorWidth * 0.45);
  const innerRadius = discRadius * RESOURCE_FIELD.commonsHoleFraction;

  // Each of the `sectors` stamps carries a copy of the sector's ore, so the
  // wave total is `WAVE_ORE`; the per-sector budget is `WAVE_ORE / sectors`.
  const { rocks, rng } = drawCanon(
    world.rngState,
    sectorRocks,
    innerRadius,
    discRadius,
    gap,
    sectorWidth - gap,
    WAVE_ORE / sectors,
  );
  world.rngState = rng;

  const rockBefore = totalRockOre(world);
  for (let j = 0; j < sectors; j++) {
    const rot = j * sectorWidth;
    for (const rock of rocks) stampRock(world, cx, cy, rot, rock, null);
  }
  // A wave adds rock to the live economy — record the exact ore delivered so the
  // conservation ledger balances this source (`./ore-ledger`). The opening wave
  // fired during world-build is folded into `seeded` and this counter is zeroed
  // there, so `injected` is post-build waves only.
  ledgerAdd(world, 'injected', totalRockOre(world) - rockBefore);

  world.match.wavesSpawned = n;
}

/**
 * Deliver every wave whose scheduled time has arrived (GDD §2.3). Normally one
 * per call at most; a coarse `dt` (the QA harness fast-forwards) can make two
 * come due in the same step, and both land rather than one being silently
 * dropped.
 *
 * Collapse closes the field for good — "no new ore" (GDD §2.3) — so nothing
 * spawns once it has begun, even if the schedule somehow still owes a wave.
 */
export function spawnDueWaves(world: World): void {
  if (world.match.collapseTime >= 0) return;
  while (!allWavesSpawned(world) && world.time >= waveTime(world.match.wavesSpawned + 1)) {
    spawnWave(world);
  }
}
