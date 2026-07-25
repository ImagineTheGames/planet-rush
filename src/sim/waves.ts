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
 * FUTURE MAPS: this is layout-agnostic by design — the rotation stamping works
 * for any ring order and any `N`. A new map in a future map registry keeps
 * parity for free **as long as it places home fields by the same per-planet
 * stamping and keeps every ore source `N`-fold symmetric**, and it must prove it
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
import { rngRange } from './rng';
import type { World } from './state';

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
// Stamping: one rock, rotated onto every planet's spoke
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
  const planets = world.planets;
  const n = planets.length;
  if (n === 0) return;

  const cx = world.bounds.width / 2;
  const cy = world.bounds.height / 2;
  // The ring radius, read off a planet — the field is a fraction of it, so the
  // layout scales with the arena and stays layout-agnostic (any ring order).
  const ringR = Math.hypot(planets[0]!.pos.x - cx, planets[0]!.pos.y - cy);

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

  // Draw the shared pattern ONCE and advance the world RNG by it; the stamping
  // that follows is pure trig, so every field is identical and the RNG advance
  // does not depend on `n`.
  const { rocks, rng } = drawCanon(
    world.rngState,
    RESOURCE_FIELD.homeCount,
    innerR,
    outerR,
    -RESOURCE_FIELD.homeAngularSpread,
    RESOURCE_FIELD.homeAngularSpread,
    homeFieldOre(n),
  );
  world.rngState = rng;

  for (const planet of planets) {
    for (const rock of rocks) {
      stampRock(world, cx, cy, planet.angle, rock, planet.owner);
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

  // Each of the `sectors` stamps carries a copy of the sector's ore, so the
  // wave total is `WAVE_ORE`; the per-sector budget is `WAVE_ORE / sectors`.
  const { rocks, rng } = drawCanon(
    world.rngState,
    sectorRocks,
    0,
    discRadius,
    0,
    sectorWidth,
    WAVE_ORE / sectors,
  );
  world.rngState = rng;

  for (let j = 0; j < sectors; j++) {
    const rot = j * sectorWidth;
    for (const rock of rocks) stampRock(world, cx, cy, rot, rock, null);
  }

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
