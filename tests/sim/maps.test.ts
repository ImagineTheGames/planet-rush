/**
 * tests/sim/maps.test.ts — the ratified map registry (m8). OWNER: Gameplay
 * Engineer.
 *
 * Four maps, `octagon` the default. A map is a layout — arena bounds + where the
 * home stations sit — and everything downstream is the same code for every map,
 * so the suite proves two things of ALL four and a shape claim of each:
 *
 *   1. **Every map honours the world rules.** Eight stations; nothing spawns
 *      within `WORLD_EDGE_MARGIN` of the wall (field report P1); the board is
 *      deterministic per seed (GDD §4.8).
 *   2. **Every map honours the resource-fairness invariant** (p1-09 field rule
 *      v0.1.2) — the same assertions `resource-fairness.test.ts` pins on the
 *      default, re-run on each layout: identical stamped home fields (equal local
 *      ore, EXACTLY, by construction), a contested commons holding at least its
 *      named share and `N`-fold symmetric, and every home field outside its own
 *      turret range. This holds even for `diamond`, whose stations are NOT
 *      congruent but whose resources are — the map is unfair in ground, never in
 *      ore.
 *   3. **Each map's own shape.** octagon/compass/oval: equal neighbour gaps
 *      (compass exact). diamond: exact 4-fold symmetry of each diamond, outer
 *      homes strictly farther from centre than inner.
 *
 * See `src/sim/maps.ts` and the invariant note atop `src/sim/waves.ts`.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass, type Vec2 } from '@shared/types';
import {
  createWorld,
  damageStation,
  getMap,
  homeFieldOre,
  spawnWave,
  DEFAULT_MAP_ID,
  MAPS,
  FIELD_YIELD,
  RESOURCE_FIELD,
  TURRET,
  WAVE_COUNT,
  WORLD_EDGE_MARGIN,
  type MapDef,
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

/** Eight lobby slots, hulls cycled — the layout is class-independent, but
 *  nothing should quietly depend on that. Every map is designed for eight. */
function players(n = 8): PlayerSpec[] {
  return Array.from({ length: n }, (_, i) => ({ id: i, shipClass: CLASSES[i % CLASSES.length]! }));
}

/** A grid of seeds — matches the p1-09 / margin suites so the RNG-driven
 *  asteroid scatter is sampled across very different states. */
const SEEDS = [1, 2, 3, 7, 42, 1337, 99991, 20260725, 0x7fffffff];
/** Every real lobby size (GDD §2.1: 2..8). Variable N (Milestone B): octagon/oval
 *  regenerate exactly N live homes; compass/diamond keep all eight positions with
 *  the `8-N` unused ones derelict, so every map must honour the invariants at any
 *  N, not just at eight. */
const COUNTS = [2, 3, 4, 5, 6, 7, 8];
const EPS = 1e-6;

function center(w: World): Vec2 {
  return { x: w.bounds.width / 2, y: w.bounds.height / 2 };
}
function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The whole board for a map + seed at N players: construction plus the full
 *  commons schedule, so the complete field is present (the commons only reaches
 *  its share once all `WAVE_COUNT` waves have landed). */
function fullField(mapId: string, seed: number, n = 8): World {
  const w = createWorld({ seed, players: players(n), mapId });
  while (w.match.wavesSpawned < WAVE_COUNT) spawnWave(w);
  return w;
}

/** The LIVE homes of a world — the non-derelict stations. On a regenerate map
 *  (octagon/oval) this is every station; on a derelict-fill map (compass/diamond)
 *  it is the `N` owned homes, the `8-N` derelict wrecks excluded. The fairness
 *  invariants are claims about live homes; derelicts are unowned loot. */
function liveHomes(w: World) {
  return w.stations.filter((p) => !p.derelict);
}

/** Assert every spawned body keeps its whole extent (centre ± radius) at least
 *  `WORLD_EDGE_MARGIN` inside the bounds — reused from the margin suite. */
function assertAllInsideMargin(w: World, label: string): void {
  const { width, height } = w.bounds;
  const check = (pos: Vec2, radius: number, what: string): void => {
    expect(pos.x - radius, `${what} — left`).toBeGreaterThanOrEqual(WORLD_EDGE_MARGIN - EPS);
    expect(pos.x + radius, `${what} — right`).toBeLessThanOrEqual(width - WORLD_EDGE_MARGIN + EPS);
    expect(pos.y - radius, `${what} — top`).toBeGreaterThanOrEqual(WORLD_EDGE_MARGIN - EPS);
    expect(pos.y + radius, `${what} — bottom`).toBeLessThanOrEqual(height - WORLD_EDGE_MARGIN + EPS);
  };
  for (const p of w.stations) check(p.pos, p.radius, `${label}: station ${p.id}`);
  for (const s of w.ships) check(s.pos, s.radius, `${label}: ship ${s.id}`);
  for (const a of w.asteroids) check(a.pos, a.radius, `${label}: asteroid ${a.id}`);
  for (const c of w.chunks) check(c.pos, c.radius, `${label}: chunk ${c.id}`);
}

/** Station centres in slot order. */
function stationPositions(w: World): Vec2[] {
  return w.stations.map((p) => p.pos);
}

// --- the registry itself ---------------------------------------------------

describe('the map registry', () => {
  it('has the four ratified maps with octagon the default', () => {
    expect(MAPS.map((m) => m.id)).toEqual(['octagon', 'compass', 'oval', 'diamond']);
    expect(DEFAULT_MAP_ID).toBe('octagon');
    expect(getMap().id).toBe('octagon');
    // Unknown ids fall back to the default — boot never crashes on a stale key.
    expect(getMap('no-such-map').id).toBe('octagon');
  });

  it('every map is fully described — id, name, blurb, bounds', () => {
    for (const m of MAPS) {
      expect(m.id, 'id').toBeTruthy();
      expect(m.name, `${m.id} name`).toBeTruthy();
      expect(m.blurb, `${m.id} blurb`).toBeTruthy();
      expect(m.bounds.width, `${m.id} width`).toBeGreaterThan(0);
      expect(m.bounds.height, `${m.id} height`).toBeGreaterThan(0);
    }
  });

  it('the default map matches the historical default board, byte for byte', () => {
    // Adopting the registry must change no pixel of the shipped octagon board:
    // the default `createWorld` and an explicit `octagon` build the same world.
    for (const seed of [1, 42, 20260725]) {
      expect(createWorld({ seed, players: players() })).toEqual(
        createWorld({ seed, players: players(), mapId: 'octagon' }),
      );
    }
  });
});

// --- rules every map honours -----------------------------------------------

describe.each(MAPS)('map "$id" honours the world rules', (map: MapDef) => {
  it('places exactly eight home stations at a full lobby', () => {
    const w = createWorld({ seed: 1, players: players(), mapId: map.id });
    expect(w.stations).toHaveLength(8);
    expect(w.ships).toHaveLength(8);
    // A full lobby has no derelicts — every board position is a live home.
    expect(liveHomes(w)).toHaveLength(8);
  });

  it('seats exactly N live homes at every lobby size (derelict-fill keeps the shape)', () => {
    for (const n of COUNTS) {
      const w = createWorld({ seed: 1, players: players(n), mapId: map.id });
      // One ship and one LIVE home per player, always.
      expect(w.ships, `${map.id} × ${n}: ships`).toHaveLength(n);
      expect(liveHomes(w), `${map.id} × ${n}: live homes`).toHaveLength(n);
      // Regenerate maps drop to N stations; derelict-fill maps keep all eight
      // board positions with the extras as unowned wrecks — either way the shape
      // is intact and every station is accounted for.
      const derelicts = w.stations.filter((p) => p.derelict);
      expect(w.stations.length, `${map.id} × ${n}: total stations`).toBe(n + derelicts.length);
      for (const d of derelicts) {
        // A derelict is born a wreck: dead core, no defenders, its own board id as
        // owner (>= N, so no ship shares it), lootable but never a win-condition.
        expect(d.alive, `${map.id} × ${n}: derelict ${d.id} is a wreck`).toBe(false);
        expect(d.coreHp, `${map.id} × ${n}: derelict ${d.id} core`).toBe(0);
        expect(d.owner, `${map.id} × ${n}: derelict ${d.id} owner beyond roster`).toBeGreaterThanOrEqual(n);
        expect(d.turrets, `${map.id} × ${n}: derelict ${d.id} turrets`).toHaveLength(0);
      }
    }
  });

  it('spawns nothing within WORLD_EDGE_MARGIN of the wall — construction and full field, every N', () => {
    for (const seed of SEEDS) {
      for (const n of COUNTS) {
        // At construction (stations incl. derelict wrecks, ships, home fields,
        // derelict debris, wave 1)…
        assertAllInsideMargin(
          createWorld({ seed, players: players(n), mapId: map.id }),
          `${map.id} seed ${seed} × ${n} @ construction`,
        );
        // …and once the whole shrinking commons schedule has landed.
        assertAllInsideMargin(fullField(map.id, seed, n), `${map.id} seed ${seed} × ${n} @ full field`);
      }
    }
  });

  it('is deterministic — same seed yields an identical board at every N', () => {
    for (const seed of [1, 42, 20260725]) {
      for (const n of COUNTS) {
        expect(createWorld({ seed, players: players(n), mapId: map.id })).toEqual(
          createWorld({ seed, players: players(n), mapId: map.id }),
        );
        expect(fullField(map.id, seed, n).asteroids).toEqual(fullField(map.id, seed, n).asteroids);
      }
    }
  });
});

// --- resource fairness on every map (reuse p1-09's assertions) --------------

describe.each(MAPS)('map "$id" honours the resource-fairness invariant', (map: MapDef) => {
  it('every home field is exactly one seeded pattern, stamped identically per live home, at every N', () => {
    for (const seed of SEEDS) {
      for (const n of COUNTS) {
        const w = createWorld({ seed, players: players(n), mapId: map.id });
        const homeOf = (owner: number) => w.asteroids.filter((a) => a.home === owner);
        const homes = liveHomes(w);
        const p0 = homes[0]!;
        const refOre = homeOf(p0.owner)
          .map((a) => a.ore)
          .sort((x, y) => x - y);
        const refDist = homeOf(p0.owner)
          .map((a) => dist(a.pos, p0.pos))
          .sort((x, y) => x - y);
        for (const p of homes) {
          const h = homeOf(p.owner);
          expect(h, `${map.id} seed ${seed} × ${n}: station ${p.id} home count`).toHaveLength(
            RESOURCE_FIELD.homeCount,
          );
          // Ore is a literal copy of the canonical pattern → equal multiset, exactly.
          expect(h.map((a) => a.ore).sort((x, y) => x - y)).toEqual(refOre);
          // Positions are a rigid rotation-plus-translation → distances-to-own-station
          // match to float precision, even where the stations themselves do not.
          const d = h.map((a) => dist(a.pos, p.pos)).sort((x, y) => x - y);
          for (let i = 0; i < d.length; i++) expect(d[i]).toBeCloseTo(refDist[i]!, 6);
        }
      }
    }
  });

  it('per-player local ore is EXACTLY equal, at every N', () => {
    for (const seed of SEEDS) {
      for (const n of COUNTS) {
        const w = fullField(map.id, seed, n);
        const totals = liveHomes(w).map((p) =>
          w.asteroids.filter((a) => a.home === p.owner).reduce((s, a) => s + a.ore, 0),
        );
        for (let i = 1; i < totals.length; i++) {
          expect(totals[i], `${map.id} seed ${seed} × ${n}: station ${i} local ore`).toBe(totals[0]);
        }
        expect(totals[0], `${map.id} seed ${seed} × ${n}: local ore positive`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every home field outside its own turret range, at every N', () => {
    // A home field must not sit under the guns of its own station, or "your
    // neighbourhood" would be a free defended pantry (p1-09 §1).
    for (const seed of SEEDS) {
      for (const n of COUNTS) {
        const w = createWorld({ seed, players: players(n), mapId: map.id });
        for (const p of liveHomes(w)) {
          for (const a of w.asteroids) {
            if (a.home !== p.owner) continue;
            expect(
              dist(a.pos, p.pos),
              `${map.id} seed ${seed} × ${n}: station ${p.id} home rock inside turret range`,
            ).toBeGreaterThan(TURRET.range);
          }
        }
      }
    }
  });

  it('the contested commons holds at least its named share, and the field totals FIELD_YIELD, at every N', () => {
    for (const seed of SEEDS) {
      for (const n of COUNTS) {
        const w = fullField(map.id, seed, n);
        let commons = 0;
        let world = 0;
        for (const a of w.asteroids) {
          world += a.ore;
          if (a.home == null) commons += a.ore;
        }
        expect(
          commons / world,
          `${map.id} seed ${seed} × ${n}: commons share`,
        ).toBeGreaterThanOrEqual(RESOURCE_FIELD.commonsMinShare - EPS);
        // The finite field still totals exactly the design yield (GDD §2.3): the
        // live home neighbourhoods (funded by active N) plus the commons. Derelict
        // debris is loose CHUNKS, not asteroids, so it never enters this budget.
        expect(world, `${map.id} seed ${seed} × ${n}: total yield`).toBeCloseTo(FIELD_YIELD, 4);
        expect(commons, `${map.id} seed ${seed} × ${n}: commons total`).toBeCloseTo(
          FIELD_YIELD * RESOURCE_FIELD.commonsShare,
          4,
        );
      }
    }
  });

  it('the commons is symmetric — every rotation sector holds equal ore, at every N', () => {
    // The commons favours nobody's approach on any map: split it into the angular
    // sectors the symmetry group defines (N for a regenerate map, eight for a
    // derelict-fill map, since it stays symmetric about every board position); every
    // sector holds the same ore.
    for (const seed of [3, 42, 20260725]) {
      for (const n of COUNTS) {
        const w = fullField(map.id, seed, n);
        const c = center(w);
        const sectors = w.stations.length;
        const sectorWidth = (2 * Math.PI) / sectors;
        const perSector = new Array<number>(sectors).fill(0);
        for (const a of w.asteroids) {
          if (a.home != null) continue;
          let ang = Math.atan2(a.pos.y - c.y, a.pos.x - c.x);
          if (ang < 0) ang += 2 * Math.PI;
          const s = Math.min(sectors - 1, Math.floor(ang / sectorWidth));
          perSector[s]! += a.ore;
        }
        for (let s = 1; s < sectors; s++) {
          expect(perSector[s], `${map.id} seed ${seed} × ${n}: commons sector ${s}`).toBeCloseTo(
            perSector[0]!,
            4,
          );
        }
      }
    }
  });
});

// --- variable N: regenerate vs derelict-fill (Milestone B) -----------------

describe('maps at any N — regenerate vs derelict-fill (ratified 2026-07-26)', () => {
  it('octagon and oval REGENERATE — exactly N stations, no derelicts, at every N', () => {
    for (const id of ['octagon', 'oval']) {
      for (const n of COUNTS) {
        const w = createWorld({ seed: 1, players: players(n), mapId: id });
        expect(w.stations, `${id} × ${n}: regenerated station count`).toHaveLength(n);
        expect(w.stations.some((p) => p.derelict), `${id} × ${n}: no derelicts`).toBe(false);
      }
    }
  });

  it('compass and diamond DERELICT-FILL — always eight positions, 8-N of them wrecks', () => {
    for (const id of ['compass', 'diamond']) {
      for (const n of COUNTS) {
        const w = createWorld({ seed: 1, players: players(n), mapId: id });
        expect(w.stations, `${id} × ${n}: keeps all eight positions`).toHaveLength(8);
        expect(w.stations.filter((p) => p.derelict), `${id} × ${n}: derelict count`).toHaveLength(
          8 - n,
        );
        // The live homes are the first N board positions, so slot 0 keeps its
        // identity (compass slot 0 = an edge home; diamond slot 0 = an outer home)
        // at every N — actives come first, derelicts fill the tail.
        for (let i = 0; i < 8; i++) {
          expect(!!w.stations[i]!.derelict, `${id} × ${n}: position ${i} derelict?`).toBe(i >= n);
        }
      }
    }
  });

  it('a derelict takes NO core damage — it is nobody\'s enemy (a born wreck)', () => {
    // The whole point of a derelict is inert scenery + loot: a shot, a turret, the
    // collapse decay must never chip it, because its core is already dead. Prove the
    // damage seam refuses it outright (siege collision and auto-aim skip dead cores
    // for the same reason).
    const w = createWorld({ seed: 1, players: players(3), mapId: 'diamond' });
    const derelicts = w.stations.filter((p) => p.derelict);
    expect(derelicts.length).toBeGreaterThan(0);
    for (const d of derelicts) {
      expect(damageStation(w, d, 100), `derelict ${d.id} rejects damage`).toBe(false);
      expect(d.coreHp, `derelict ${d.id} stays at zero`).toBe(0);
      expect(d.alive, `derelict ${d.id} stays a wreck`).toBe(false);
    }
  });

  it('a derelict is LOOTABLE — it scatters scavengeable debris chunks (GDD §2.7)', () => {
    // No derelicts on a regenerate map → no derelict debris; a derelict-fill map at
    // N<8 rings each wreck with loose ore anyone can scavenge.
    expect(createWorld({ seed: 1, players: players(4), mapId: 'octagon' }).chunks).toHaveLength(0);
    const w = createWorld({ seed: 1, players: players(4), mapId: 'compass' });
    expect(w.stations.filter((p) => p.derelict).length).toBe(4);
    // Debris is loose chunks (not asteroids), one ring per wreck — a positive,
    // scavengeable pile the finite-field asteroid budget never counts.
    expect(w.chunks.length, 'compass ×4 derelict debris chunks').toBeGreaterThan(0);
    const debris = w.chunks.reduce((s, c) => s + c.amount, 0);
    expect(debris, 'total derelict debris ore').toBeGreaterThan(0);
  });

  it('live homes stay rich at small N — home ore divides by ACTIVE N, not the board size', () => {
    // A compass duel (N=2) must give each of its two players the SAME neighbourhood
    // richness a 2-station octagon would — the six derelict positions do not dilute
    // the home share. Every live home carries exactly homeFieldOre(N) worth of ore.
    for (const id of ['compass', 'diamond', 'octagon', 'oval']) {
      for (const n of COUNTS) {
        const w = createWorld({ seed: 42, players: players(n), mapId: id });
        for (const p of liveHomes(w)) {
          const ore = w.asteroids
            .filter((a) => a.home === p.owner)
            .reduce((s, a) => s + a.ore, 0);
          expect(ore, `${id} × ${n}: home ${p.id} ore vs homeFieldOre(${n})`).toBeCloseTo(
            homeFieldOre(n),
            4,
          );
        }
      }
    }
  });
});

// --- each map's own shape --------------------------------------------------

/** Adjacent-slot station gaps (slots are ordered around the layout, so slot i
 *  and i+1 are neighbours; the last wraps to the first). */
function neighbourGaps(w: World): number[] {
  const pts = stationPositions(w);
  return pts.map((p, i) => dist(p, pts[(i + 1) % pts.length]!));
}

describe('each map has its own shape', () => {
  it('octagon / compass / oval have equal neighbour gaps (compass exact)', () => {
    for (const id of ['octagon', 'compass', 'oval']) {
      const w = createWorld({ seed: 1, players: players(), mapId: id });
      const gaps = neighbourGaps(w);
      const min = Math.min(...gaps);
      const max = Math.max(...gaps);
      // Equal to well under half a percent — octagon by construction, oval by
      // the iterative equal-chord solve.
      expect((max - min) / max, `${id} neighbour-gap spread`).toBeLessThan(0.005);
    }
    // Compass is equal *exactly* — every adjacent step is half the inner square's
    // side by construction, no tolerance.
    const compass = neighbourGaps(createWorld({ seed: 1, players: players(), mapId: 'compass' }));
    for (let i = 1; i < compass.length; i++) {
      expect(compass[i], `compass gap ${i}`).toBeCloseTo(compass[0]!, 6);
    }
  });

  it('diamond: each diamond is exactly 4-fold symmetric, outer strictly farther than inner', () => {
    const w = createWorld({ seed: 1, players: players(), mapId: 'diamond' });
    const c = center(w);
    // Slots alternate outer/inner (slot 0 outer, 1 inner, …), so the local player
    // (slot 0) always spawns on an outer home.
    const outer = w.stations.filter((_, i) => i % 2 === 0);
    const inner = w.stations.filter((_, i) => i % 2 === 1);
    expect(outer).toHaveLength(4);
    expect(inner).toHaveLength(4);

    const radiusOf = (p: (typeof w.stations)[number]) => dist(p.pos, c);
    const rOut = radiusOf(outer[0]!);
    const rIn = radiusOf(inner[0]!);

    // Each diamond: four stations at ONE radius, at exact 90° steps → 4-fold
    // symmetric about the centre.
    for (const [ring, r] of [
      [outer, rOut],
      [inner, rIn],
    ] as const) {
      const angles = ring
        .map((p) => Math.atan2(p.pos.y - c.y, p.pos.x - c.x))
        .map((a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI))
        .sort((x, y) => x - y);
      for (const p of ring) expect(radiusOf(p)).toBeCloseTo(r, 6);
      for (let i = 1; i < angles.length; i++) {
        expect(angles[i]! - angles[i - 1]!, 'diamond 90° step').toBeCloseTo(Math.PI / 2, 6);
      }
    }
    // Outer strictly farther from the commons than inner — the veteran's asymmetry.
    expect(rOut).toBeGreaterThan(rIn);
  });
});
