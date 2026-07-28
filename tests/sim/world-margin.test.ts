/**
 * tests/sim/world-margin.test.ts — the arena is space, not a box the stations
 * touch (field report P1). OWNER: Gameplay Engineer.
 *
 * The v0.1 release put a home station hard against the arena wall: the 8-station
 * ring, at `ringFraction` 0.42 on a 1920 arena, sat at 0.84×halfMin and, once
 * the station radius was added, reached the wall exactly. The fix is two-part and
 * this file pins both halves so they cannot silently regress:
 *
 *   1. **The clearance guarantee.** NOTHING the sim spawns — station, ship,
 *      asteroid, ore chunk, wreck debris — is placed within `WORLD_EDGE_MARGIN`
 *      of the bounds. Every entity's centre ± its own radius stays inside
 *      `[margin, dimension - margin]`.
 *   2. **The ring clears the wall by the margin.** The outermost point of the
 *      station ring is at least `WORLD_EDGE_MARGIN` from the wall — the ring reads
 *      "well inside the steel frame," not touching it.
 *
 * Plus the invariant that guards every sim change: same seed ⇒ byte-identical
 * world (GDD §4.8), before and after stepping. Growing the arena must not make
 * the world non-deterministic.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass, type Vec2 } from '@shared/types';
import {
  createWorld,
  destroyCore,
  killShip,
  spawnWave,
  step,
  MAPS,
  WAVE_COUNT,
  WORLD_EDGE_MARGIN,
  WORLD_SIZE,
  clampToMargin,
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

/** `n` lobby slots, hulls cycled so class radius/placement variety is exercised. */
function players(n: number): PlayerSpec[] {
  return Array.from({ length: n }, (_, i) => ({ id: i, shipClass: CLASSES[i % CLASSES.length]! }));
}

/** A grid of seeds — small primes and a couple of large ones, so the RNG-driven
 *  asteroid scatter is sampled across very different states. */
const SEEDS = [1, 2, 3, 7, 42, 1337, 99991, 20260725, 0x7fffffff];
/** Every real lobby size (GDD §2.1: up to 8 stations). */
const COUNTS = [2, 3, 4, 5, 6, 7, 8];

const EPS = 1e-6;

/**
 * Assert every spawned entity keeps its whole body (centre ± radius) at least
 * `WORLD_EDGE_MARGIN` inside the bounds, on all four sides. The message names the
 * offending entity so a regression points at what escaped, not just "a number".
 */
function assertAllInsideMargin(world: World, label: string): void {
  const { width, height } = world.bounds;
  const check = (pos: Vec2, radius: number, what: string): void => {
    expect(pos.x - radius, `${what} — left edge`).toBeGreaterThanOrEqual(WORLD_EDGE_MARGIN - EPS);
    expect(pos.x + radius, `${what} — right edge`).toBeLessThanOrEqual(width - WORLD_EDGE_MARGIN + EPS);
    expect(pos.y - radius, `${what} — top edge`).toBeGreaterThanOrEqual(WORLD_EDGE_MARGIN - EPS);
    expect(pos.y + radius, `${what} — bottom edge`).toBeLessThanOrEqual(height - WORLD_EDGE_MARGIN + EPS);
  };
  for (const p of world.stations) check(p.pos, p.radius, `${label}: station ${p.id}`);
  for (const s of world.ships) check(s.pos, s.radius, `${label}: ship ${s.id}`);
  for (const a of world.asteroids) check(a.pos, a.radius, `${label}: asteroid ${a.id}`);
  for (const c of world.chunks) check(c.pos, c.radius, `${label}: chunk ${c.id}`);
}

// --- the clearance guarantee (spawn placement) -----------------------------

describe('nothing spawns within WORLD_EDGE_MARGIN of the bounds (field report P1)', () => {
  it('holds for every seed × lobby size on the default arena', () => {
    for (const seed of SEEDS) {
      for (const n of COUNTS) {
        const world = createWorld({ seed, players: players(n) });
        assertAllInsideMargin(world, `seed ${seed} × ${n} players`);
      }
    }
  });

  it('holds across all five asteroid waves, including the tightest inner disc', () => {
    // Waves shrink toward centre, so the later ones sit deeper inside — but wave 1
    // is the widest and closest to the wall. Spawn the whole schedule and re-check
    // after each wave lands.
    for (const seed of SEEDS) {
      const world = createWorld({ seed, players: players(8) });
      // Wave 1 was placed by createWorld; deliver the remaining waves directly.
      for (let w = world.match.wavesSpawned; w < WAVE_COUNT; w++) spawnWave(world);
      expect(world.match.wavesSpawned).toBe(WAVE_COUNT);
      assertAllInsideMargin(world, `seed ${seed} after all ${WAVE_COUNT} waves`);
    }
  });

  it('clamps a wide field on a cramped arena rather than scattering into the wall', () => {
    // The QA harness runs deliberately small worlds; a wide scatter disc there
    // would otherwise throw rocks past the margin. The spawner clamps instead.
    const world = createWorld({
      seed: 12345,
      players: players(4),
      bounds: { width: 1400, height: 1400 },
      asteroidCount: 40,
    });
    for (let w = world.match.wavesSpawned; w < WAVE_COUNT; w++) spawnWave(world);
    assertAllInsideMargin(world, 'cramped arena');
  });

  it('keeps a wreck near the edge from ringing debris into the wall', () => {
    // Shove a home to the arena corner and destroy its core: the debris ring
    // (station radius + offset, outboard) would poke past the margin if unclamped.
    const world = createWorld({ seed: 77, players: players(4) });
    const station = world.stations[0]!;
    station.pos = { x: WORLD_EDGE_MARGIN + station.radius, y: WORLD_EDGE_MARGIN + station.radius };
    const owner = world.ships.find((s) => s.id === station.owner)!;
    owner.banked = 30; // a real fortune to burst into debris
    destroyCore(world, station);
    expect(world.chunks.length).toBeGreaterThan(0);
    assertAllInsideMargin(world, 'wreck at the corner');
  });

  it("keeps a dying ship's dropped ore off the wall", () => {
    const world = createWorld({ seed: 88, players: players(4) });
    const ship = world.ships[0]!;
    ship.pos = { x: ship.radius + WORLD_EDGE_MARGIN, y: ship.radius + WORLD_EDGE_MARGIN };
    ship.cargo = ship.cargoCap; // full hold, so half of it drops as debris
    killShip(world, ship);
    expect(world.chunks.length).toBeGreaterThan(0);
    assertAllInsideMargin(world, 'ship death at the corner');
  });
});

// --- the clearance holds on every map, at every N (Milestone B) ------------

describe.each(MAPS)('map "$id" spawns nothing on the wall, at any N', (map: MapDef) => {
  it('holds for every seed × lobby size — stations, ships, home fields, derelict debris, commons', () => {
    // Variable N: octagon/oval regenerate N homes; compass/diamond keep all eight
    // positions with the extras as derelict wrecks whose lootable debris also rings
    // outboard — every one of those bodies must clear `WORLD_EDGE_MARGIN` too.
    for (const seed of SEEDS) {
      for (const n of COUNTS) {
        const world = createWorld({ seed, players: players(n), mapId: map.id });
        assertAllInsideMargin(world, `${map.id} seed ${seed} × ${n} @ construction`);
        for (let w = world.match.wavesSpawned; w < WAVE_COUNT; w++) spawnWave(world);
        assertAllInsideMargin(world, `${map.id} seed ${seed} × ${n} @ full field`);
      }
    }
  });
});

// --- the ring clears the wall by the margin --------------------------------

describe('the station ring reads well inside the steel frame', () => {
  it("outermost station point clears the wall by at least WORLD_EDGE_MARGIN", () => {
    for (const seed of SEEDS) {
      for (const n of COUNTS) {
        const world = createWorld({ seed, players: players(n) });
        const halfMin = Math.min(world.bounds.width, world.bounds.height) / 2;
        const cx = world.bounds.width / 2;
        const cy = world.bounds.height / 2;
        for (const p of world.stations) {
          const outermost = Math.hypot(p.pos.x - cx, p.pos.y - cy) + p.radius;
          const clearance = halfMin - outermost;
          expect(clearance, `seed ${seed} × ${n}: station ${p.id} wall clearance`).toBeGreaterThanOrEqual(
            WORLD_EDGE_MARGIN - EPS,
          );
        }
      }
    }
  });

  it('is a real ring, not collapsed onto the centre by over-clamping', () => {
    // Guard against "fixing" the margin by shrinking the ring to nothing: the
    // stations must still sit in a generous ring, outboard of their ships.
    const world = createWorld({ seed: 5, players: players(8) });
    const cx = world.bounds.width / 2;
    const cy = world.bounds.height / 2;
    const ringR = Math.hypot(world.stations[0]!.pos.x - cx, world.stations[0]!.pos.y - cy);
    // All stations one ring.
    for (const p of world.stations) {
      expect(Math.hypot(p.pos.x - cx, p.pos.y - cy)).toBeCloseTo(ringR, 6);
    }
    // The ring is a healthy fraction of the arena, not a huddle at the centre.
    expect(ringR).toBeGreaterThan(0.25 * (world.bounds.width / 2));
    // Ships spawn inboard of their own station (GDD §2.1) — still true after the fix.
    for (const p of world.stations) {
      const ship = world.ships.find((s) => s.id === p.owner)!;
      const shipR = Math.hypot(ship.pos.x - cx, ship.pos.y - cy);
      expect(shipR, `ship ${ship.id} inboard of station ${p.id}`).toBeLessThan(ringR);
    }
  });
});

// --- determinism (GDD §4.8) ------------------------------------------------

describe('growing the arena keeps the world deterministic (GDD §4.8)', () => {
  it('same seed yields an identical world at construction', () => {
    for (const seed of [1, 42, 20260725]) {
      const a = createWorld({ seed, players: players(8) });
      const b = createWorld({ seed, players: players(8) });
      expect(a).toEqual(b);
    }
  });

  it('same seed replays identically through 300 stepped ticks', () => {
    const mk = () => createWorld({ seed: 20260725, players: players(6) });
    const a = mk();
    const b = mk();
    for (let i = 0; i < 300; i++) {
      step(a, []);
      step(b, []);
    }
    expect(a).toEqual(b);
  });
});

// --- the clamp helper itself -----------------------------------------------

describe('clampToMargin keeps a body inside the margin without re-rolling', () => {
  it('leaves an already-safe coordinate untouched', () => {
    expect(clampToMargin(1200, 20, 2400, 220)).toBe(1200);
  });

  it('pulls a body past the far wall back to margin + radius clearance', () => {
    expect(clampToMargin(2500, 30, 2400, 220)).toBe(2400 - 220 - 30);
  });

  it('pulls a body past the near wall back to margin + radius clearance', () => {
    expect(clampToMargin(-100, 30, 2400, 220)).toBe(220 + 30);
  });

  it('centres a body on an arena too small to hold the margin on both sides', () => {
    expect(clampToMargin(0, 100, 300, 220)).toBe(150);
  });

  it('defaults its margin to WORLD_EDGE_MARGIN', () => {
    expect(clampToMargin(0, 0, WORLD_SIZE)).toBe(WORLD_EDGE_MARGIN);
  });
});
