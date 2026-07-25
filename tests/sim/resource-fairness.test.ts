/**
 * tests/sim/resource-fairness.test.ts — equal resources for every planet
 * (developer field rule v0.1.2). OWNER: Gameplay Engineer.
 *
 * "We also need equally located resources (asteroids) for planets, before the
 * fight begins — with neighbor resources and central ones as well."
 *
 * Resource placement is a FAIRNESS INVARIANT, not scatter. The whole asteroid
 * field is invariant under rotation by `2π / N` about the arena centre (`N` =
 * player count), so:
 *
 *   1. every home planet's LOCAL ore (within radius R of it) is equal — and,
 *      because each home field is a rigid rotation of one seeded pattern, equal
 *      EXACTLY, no tolerance;
 *   2. every player's distance profile to their nearest ore is identical;
 *   3. the contested commons holds at least a named share of all world ore;
 *   4. the margin and determinism guarantees still hold.
 *
 * See the invariant note atop `src/sim/waves.ts`. A future map registry must
 * pass this same suite — the rotation stamping is layout-agnostic, so parity is
 * a property any ring order inherits for free.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass, type Vec2 } from '@shared/types';
import {
  createWorld,
  spawnWave,
  FIELD_YIELD,
  RESOURCE_FIELD,
  SPAWN_CLEAR_POCKET,
  TURRET,
  WAVE_COUNT,
  WORLD_EDGE_MARGIN,
  type PlayerSpec,
  type World,
} from '../../src/sim';

// --- fixtures --------------------------------------------------------------

const CLASSES = [
  ShipClass.Interceptor,
  ShipClass.Vanguard,
  ShipClass.Excavator,
  ShipClass.Hauler,
] as const;

/** `n` lobby slots, hulls cycled so class variety is exercised — the layout is
 *  class-independent, but nothing should quietly depend on that. */
function players(n: number): PlayerSpec[] {
  return Array.from({ length: n }, (_, i) => ({ id: i, shipClass: CLASSES[i % CLASSES.length]! }));
}

/** A grid of seeds — small primes and a couple of large ones, so the RNG-driven
 *  pattern is sampled across very different states. Matches the margin suite. */
const SEEDS = [1, 2, 3, 7, 42, 1337, 99991, 20260725, 0x7fffffff];
/** Every real lobby size (GDD §2.1: up to 8 planets). */
const COUNTS = [2, 3, 4, 5, 6, 7, 8];

function center(w: World): Vec2 {
  return { x: w.bounds.width / 2, y: w.bounds.height / 2 };
}
function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
/** The planet ring radius (all planets equidistant from the centre). */
function ringRadius(w: World): number {
  const c = center(w);
  return dist(w.planets[0]!.pos, c);
}
/** The measure radius R around a home — a fraction of the ring, sized to
 *  enclose one home field and nothing else (`RESOURCE_FIELD`). */
function measureRadius(w: World): number {
  return ringRadius(w) * RESOURCE_FIELD.homeMeasureFraction;
}
/** The spawn-clear pocket radius around a home — a fraction of the ring, kept
 *  empty so a ship can launch and manoeuvre freely (`SPAWN_CLEAR_POCKET`). */
function pocketRadius(w: World): number {
  return ringRadius(w) * SPAWN_CLEAR_POCKET;
}
/** Deliver the whole commons schedule so the full field is on the map. */
function fullField(seed: number, n: number): World {
  const w = createWorld({ seed, players: players(n) });
  while (w.match.wavesSpawned < WAVE_COUNT) spawnWave(w);
  return w;
}
/** Asteroids whose centre is within R of a point. */
function within(w: World, p: Vec2, r: number) {
  return w.asteroids.filter((a) => dist(a.pos, p) <= r);
}

// --- 1. equal local ore, EXACTLY (invariant §1) ----------------------------

describe('every home planet has the same local ore — exactly (field rule §1)', () => {
  it('per-player ore within R of each home is EXACTLY equal, on the full field', () => {
    for (const seed of SEEDS) {
      for (const n of COUNTS) {
        const w = fullField(seed, n);
        const r = measureRadius(w);
        const totals = w.planets.map((p) =>
          within(w, p.pos, r).reduce((s, a) => s + a.ore, 0),
        );
        // Perfect symmetry needs no tolerance: byte-for-byte equal (GDD-style).
        for (let i = 1; i < totals.length; i++) {
          expect(totals[i], `seed ${seed} × ${n}: planet ${i} local ore`).toBe(totals[0]);
        }
        // …and it is a real, positive neighbourhood, not an empty one.
        expect(totals[0], `seed ${seed} × ${n}: local ore is positive`).toBeGreaterThan(0);
      }
    }
  });

  it('the measured neighbourhood is exactly one home field — commons and neighbours excluded', () => {
    // If R ever leaked into the commons or an adjacent field, the count would
    // exceed `homeCount` and the "exactly equal" claim above would be luck.
    for (const seed of SEEDS) {
      for (const n of COUNTS) {
        const w = fullField(seed, n);
        const r = measureRadius(w);
        for (const p of w.planets) {
          const local = within(w, p.pos, r);
          expect(local, `seed ${seed} × ${n}: planet ${p.id} local rocks`).toHaveLength(
            RESOURCE_FIELD.homeCount,
          );
          expect(
            local.every((a) => a.home === p.owner),
            `seed ${seed} × ${n}: planet ${p.id} local rocks are all its own home field`,
          ).toBe(true);
        }
      }
    }
  });

  it('every home field is congruent — same shape and same ore, by construction', () => {
    for (const seed of SEEDS) {
      for (const n of COUNTS) {
        const w = createWorld({ seed, players: players(n) });
        const homeOf = (owner: number) => w.asteroids.filter((a) => a.home === owner);
        const p0 = w.planets[0]!;
        const refDist = homeOf(p0.owner)
          .map((a) => dist(a.pos, p0.pos))
          .sort((x, y) => x - y);
        const refOre = homeOf(p0.owner)
          .map((a) => a.ore)
          .sort((x, y) => x - y);
        for (const p of w.planets) {
          const h = homeOf(p.owner);
          expect(h).toHaveLength(RESOURCE_FIELD.homeCount);
          // Ore values are literal copies of the one canonical pattern → equal
          // as a multiset, exactly.
          expect(h.map((a) => a.ore).sort((x, y) => x - y)).toEqual(refOre);
          // Positions are a rigid rotation → distances-to-own-planet match to
          // float precision (rotation is a float isometry).
          const d = h.map((a) => dist(a.pos, p.pos)).sort((x, y) => x - y);
          for (let i = 0; i < d.length; i++) {
            expect(d[i]).toBeCloseTo(refDist[i]!, 6);
          }
        }
      }
    }
  });
});

// --- 2. identical distance profile (invariant §1) --------------------------

describe('every player faces the same field (field rule §4)', () => {
  it('per-player distance profile to their k nearest ore rocks is identical', () => {
    for (const seed of SEEDS) {
      for (const n of COUNTS) {
        const w = fullField(seed, n);
        const k = RESOURCE_FIELD.homeCount + 4; // home field + into the commons
        const profiles = w.planets.map((p) =>
          w.asteroids
            .map((a) => dist(a.pos, p.pos))
            .sort((x, y) => x - y)
            .slice(0, k),
        );
        for (let pi = 1; pi < profiles.length; pi++) {
          for (let i = 0; i < k; i++) {
            expect(
              profiles[pi]![i],
              `seed ${seed} × ${n}: planet ${pi} nearest-${i} distance`,
            ).toBeCloseTo(profiles[0]![i]!, 6);
          }
        }
      }
    }
  });
});

// --- 3. the commons is worth fighting for (invariant §2) -------------------

describe('the contested commons (field rule §2)', () => {
  it('holds at least the named share of all world ore', () => {
    for (const seed of SEEDS) {
      for (const n of COUNTS) {
        const w = fullField(seed, n);
        let commons = 0;
        let world = 0;
        for (const a of w.asteroids) {
          world += a.ore;
          if (a.home == null) commons += a.ore;
        }
        expect(commons / world, `seed ${seed} × ${n}: commons share`).toBeGreaterThanOrEqual(
          RESOURCE_FIELD.commonsMinShare - 1e-9,
        );
        // The finite field still totals exactly the design yield, split into the
        // commons and the equal home neighbourhoods (GDD §2.3, `RESOURCE_FIELD`).
        expect(world, `seed ${seed} × ${n}: total yield`).toBeCloseTo(FIELD_YIELD, 4);
        expect(commons, `seed ${seed} × ${n}: commons total`).toBeCloseTo(
          FIELD_YIELD * RESOURCE_FIELD.commonsShare,
          4,
        );
      }
    }
  });

  it('is symmetric — each rotation sector carries an equal commons total', () => {
    // The commons favours nobody's approach: split it into the N angular sectors
    // the symmetry group defines and every sector holds the same ore.
    for (const seed of [3, 42, 20260725]) {
      for (const n of COUNTS) {
        const w = fullField(seed, n);
        const c = center(w);
        const sectorWidth = (2 * Math.PI) / n;
        const perSector = new Array<number>(n).fill(0);
        for (const a of w.asteroids) {
          if (a.home != null) continue;
          let ang = Math.atan2(a.pos.y - c.y, a.pos.x - c.x);
          if (ang < 0) ang += 2 * Math.PI;
          const s = Math.min(n - 1, Math.floor(ang / sectorWidth));
          perSector[s]! += a.ore;
        }
        for (let s = 1; s < n; s++) {
          expect(perSector[s], `seed ${seed} × ${n}: commons sector ${s}`).toBeCloseTo(
            perSector[0]!,
            4,
          );
        }
      }
    }
  });
});

// --- 4. margin, turret clearance, and determinism (field rule §4) ----------

describe('the fair field respects the world rules (field rule §4)', () => {
  it('keeps every home field outside its planet turret range', () => {
    // GDD balance: a home field must not sit under the guns of its own planet,
    // or "your neighbourhood" would be a free, defended pantry (field rule §1).
    for (const seed of SEEDS) {
      for (const n of COUNTS) {
        const w = createWorld({ seed, players: players(n) });
        for (const p of w.planets) {
          for (const a of w.asteroids) {
            if (a.home !== p.owner) continue;
            expect(
              dist(a.pos, p.pos),
              `seed ${seed} × ${n}: planet ${p.id} home rock inside turret range`,
            ).toBeGreaterThan(TURRET.range);
          }
        }
      }
    }
  });

  it('keeps a clear launch pocket around every home — no rock inside SPAWN_CLEAR_POCKET', () => {
    // Field report P1: the stamped home field sat close enough to crowd the spawn,
    // so a ship leaving its planet bumped rock (the mobile drag test caught it). The
    // pocket is the fix — NO asteroid body may intrude within `SPAWN_CLEAR_POCKET`
    // of ANY planet. Checked on the full field (home fields AND the whole commons)
    // and for every seed and lobby size: because the pocket is part of the rotated
    // per-planet stamp it is identical for everyone, so it holds universally.
    for (const seed of SEEDS) {
      for (const n of COUNTS) {
        const w = fullField(seed, n);
        const pocket = pocketRadius(w);
        for (const p of w.planets) {
          for (const a of w.asteroids) {
            // Nearest rock surface (`dist − radius`) must clear the pocket, so no
            // part of any rock lies inside a home's launch space.
            expect(
              dist(a.pos, p.pos) - a.radius,
              `seed ${seed} × ${n}: rock ${a.id} intrudes into planet ${p.id}'s spawn pocket`,
            ).toBeGreaterThanOrEqual(pocket - 1e-6);
          }
        }
      }
    }
  });

  it('the pocket is generous — the launch lane from spawn to the first rock is wide', () => {
    // "Generous, not minimal" (brief): a ship spawns orbiting its planet, so the
    // pocket must clear well past the spawn point. Assert the pocket comfortably
    // exceeds the spawn's offset from the planet, i.e. the ship itself sits inside
    // the clear pocket with room to move before the field begins.
    for (const seed of [1, 42, 20260725]) {
      for (const n of COUNTS) {
        const w = fullField(seed, n);
        const pocket = pocketRadius(w);
        // Ship spawn radius from its planet — the ship rings its planet inboard by
        // `PLANET.orbitOffset`, so this is that gap, read straight off the world.
        for (const s of w.ships) {
          const home = w.planets.find((p) => p.owner === s.id)!;
          const spawnToPlanet = dist(s.home, home.pos);
          expect(
            pocket,
            `seed ${seed} × ${n}: pocket must clear past ship ${s.id}'s spawn`,
          ).toBeGreaterThan(spawnToPlanet);
        }
      }
    }
  });

  it('spawns nothing within WORLD_EDGE_MARGIN of the wall, home fields and commons alike', () => {
    for (const seed of SEEDS) {
      for (const n of COUNTS) {
        const w = fullField(seed, n);
        const { width, height } = w.bounds;
        for (const a of w.asteroids) {
          expect(a.pos.x - a.radius).toBeGreaterThanOrEqual(WORLD_EDGE_MARGIN - 1e-6);
          expect(a.pos.x + a.radius).toBeLessThanOrEqual(width - WORLD_EDGE_MARGIN + 1e-6);
          expect(a.pos.y - a.radius).toBeGreaterThanOrEqual(WORLD_EDGE_MARGIN - 1e-6);
          expect(a.pos.y + a.radius).toBeLessThanOrEqual(height - WORLD_EDGE_MARGIN + 1e-6);
        }
      }
    }
  });

  it('is deterministic — same seed and field, identical asteroids', () => {
    for (const seed of [1, 42, 20260725]) {
      for (const n of [2, 5, 8]) {
        // At construction…
        expect(createWorld({ seed, players: players(n) })).toEqual(
          createWorld({ seed, players: players(n) }),
        );
        // …and after the whole commons schedule has landed.
        expect(fullField(seed, n).asteroids).toEqual(fullField(seed, n).asteroids);
      }
    }
  });
});
