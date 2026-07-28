/**
 * src/sim/satellite.test.ts — the RADAR SATELLITE, a buildable, orbiting,
 * attackable sensor body (RATIFIED developer feature f1: "build a radar
 * satellite … it orbits around the mining station and can be attacked").
 *
 * The contract checks from the brief:
 *   1. build / cost / cap — one per station, ordered through the SAME buildOrder
 *      path a turret is, paid up front, built over `SATELLITE.buildTime`;
 *   2. orbit — it rides its station's rim band at a constant radius and its
 *      `orbitAngle` advances every tick (reusing the turret orbit geometry);
 *   3. attackable + the target ladder includes it — a besieger's auto-aim shot
 *      picks it off and damages it, exactly like a turret;
 *   4. death — a killed satellite is swept, and it dies with its station;
 *   5. determinism — same seed + same inputs ⇒ identical satellite state.
 * (The sensor-coverage half lives in `./sensing.test.ts`.)
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import { createWorld, step, type Inputs, type WorldConfig } from './index';
import {
  damageSatellite,
  isDocked,
  placeOrder,
  satelliteCount,
  satelliteOrbitRadius,
  stationOf,
} from './buildings';
import { destroyCore } from './match';
import { SATELLITE, TICK_DT } from './constants';
import type { RadarSatellite, World } from './state';

// --- helpers ---------------------------------------------------------------

/** A fresh two-player match. Both ships spawn docked at their own station with a
 *  fat bank so the cost of a satellite is never the thing under test. */
function twoPlayerWorld(seed = 7): World {
  const config: WorldConfig = {
    seed,
    players: [
      { id: 0, shipClass: ShipClass.Vanguard },
      { id: 1, shipClass: ShipClass.Vanguard },
    ],
  };
  const world = createWorld(config);
  for (const s of world.ships) s.banked = 100;
  return world;
}

const buildOrder = (id: number): Inputs => [{ id, actions: [{ type: 'buildOrder', item: 'satellite' }] }];

/** Distance between two points. */
function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Step `n` ticks with `inputs` on tick 1 only (a one-shot buildOrder), idle after. */
function stepN(world: World, n: number, firstTick: Inputs = []): void {
  for (let t = 0; t < n; t++) step(world, t === 0 ? firstTick : []);
}

// --- 1. build / cost / cap -------------------------------------------------

describe('radar satellite — build, cost, cap (feature f1)', () => {
  it('a docked ship builds one through the buildOrder path, paying SATELLITE.cost up front', () => {
    const world = twoPlayerWorld();
    const ship = world.ships[0]!;
    const station = stationOf(world, 0)!;
    expect(isDocked(ship, station)).toBe(true); // spawns orbiting its own home

    const bankBefore = ship.banked;
    expect(placeOrder(world, ship, 'satellite')).toBe('ok');
    // Ore spent the moment the order lands; a build job is queued, not instant.
    expect(ship.banked).toBeCloseTo(bankBefore - SATELLITE.cost, 6);
    expect(satelliteCount(station)).toBe(1);
    expect(station.satellites!.length).toBe(0);
    expect(station.builds.some((b) => b.kind === 'satellite')).toBe(true);
  });

  it('the satellite materialises after SATELLITE.buildTime, at full HP, in its orbit band', () => {
    const world = twoPlayerWorld();
    const station = stationOf(world, 0)!;
    // Order on tick 1, then let construction run out (one extra tick to be sure).
    const ticks = Math.ceil(SATELLITE.buildTime / TICK_DT) + 2;
    stepN(world, ticks, buildOrder(0));

    expect(station.satellites!.length).toBe(1);
    const sat = station.satellites![0]!;
    expect(sat.hp).toBe(SATELLITE.hp);
    expect(sat.maxHp).toBe(SATELLITE.hp);
    expect(sat.owner).toBe(0);
    // It rides the station rim band at a constant radius (turret-orbit geometry).
    expect(dist(sat.pos, station.pos)).toBeCloseTo(satelliteOrbitRadius(station), 3);
  });

  it('refuses an unaffordable order, spending nothing', () => {
    const world = twoPlayerWorld();
    const ship = world.ships[0]!;
    ship.banked = SATELLITE.cost - 1;
    ship.cargo = 0;
    expect(placeOrder(world, ship, 'satellite')).toBe('cannot-afford');
    expect(ship.banked).toBe(SATELLITE.cost - 1); // untouched
    expect(satelliteCount(stationOf(world, 0)!)).toBe(0);
  });

  it('caps at one per station — the queued job counts, so a second order is refused', () => {
    const world = twoPlayerWorld();
    const ship = world.ships[0]!;
    const station = stationOf(world, 0)!;
    expect(placeOrder(world, ship, 'satellite')).toBe('ok');
    expect(placeOrder(world, ship, 'satellite')).toBe('cap-reached');
    expect(satelliteCount(station)).toBe(SATELLITE.capPerStation);
  });
});

// --- 2. orbit --------------------------------------------------------------

describe('radar satellite — orbit (feature f1)', () => {
  it('orbits its station: the angle advances each tick and the radius holds', () => {
    const world = twoPlayerWorld();
    const station = stationOf(world, 0)!;
    stepN(world, Math.ceil(SATELLITE.buildTime / TICK_DT) + 2, buildOrder(0));
    const sat = station.satellites![0]!;

    const a0 = sat.orbitAngle;
    const r0 = dist(sat.pos, station.pos);
    stepN(world, 30);
    const a1 = sat.orbitAngle;
    const r1 = dist(sat.pos, station.pos);

    expect(a1).not.toBeCloseTo(a0, 5); // it moved around the rim
    expect(r1).toBeCloseTo(r0, 3); // …but stayed on the ring
    expect(r1).toBeCloseTo(satelliteOrbitRadius(station), 3);
    // 30 ticks at SATELLITE.orbitSpeed — the arc swept is speed × elapsed.
    const swept = Math.abs(((a1 - a0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    expect(swept).toBeCloseTo(SATELLITE.orbitSpeed * 30 * TICK_DT, 4);
  });
});

// --- 3. attackable + the target ladder -------------------------------------

describe('radar satellite — attackable, and the auto-aim ladder targets it (feature f1)', () => {
  it("a besieger's auto-aim shot picks off an enemy satellite", () => {
    // Player 1's home gets a satellite; player 0 flies up next to it and holds
    // auto-fire with nothing else in reach, so the ladder can only pick the sat.
    const world = twoPlayerWorld();
    const enemyStation = stationOf(world, 1)!;
    enemyStation.spawnProtect = 0;
    const sat: RadarSatellite = {
      id: 9001,
      owner: 1,
      pos: { x: enemyStation.pos.x + 120, y: enemyStation.pos.y },
      radius: SATELLITE.radius,
      hp: SATELLITE.hp,
      maxHp: SATELLITE.hp,
      orbitAngle: 0,
    };
    enemyStation.satellites = [sat];

    const attacker = world.ships[0]!;
    attacker.spawnProtect = 0;
    attacker.pos = { x: sat.pos.x + 60, y: sat.pos.y }; // 60 units out — well in range
    attacker.vel = { x: 0, y: 0 };
    // Keep the far enemy ship out of the picture so the satellite is the pick.
    world.ships[1]!.pos = { x: enemyStation.pos.x, y: enemyStation.pos.y - 5000 };

    const fire: Inputs = [{ id: 0, actions: [{ type: 'fire', active: true, auto: true }] }];
    for (let t = 0; t < 60 && sat.hp === SATELLITE.hp; t++) step(world, fire);

    expect(sat.hp).toBeLessThan(SATELLITE.hp); // the ladder found it and shots bit it
  });

  it('damageSatellite clamps at zero and refuses a dead body', () => {
    const sat: RadarSatellite = { id: 1, owner: 0, pos: { x: 0, y: 0 }, radius: SATELLITE.radius, hp: 20, maxHp: SATELLITE.hp, orbitAngle: 0 };
    expect(damageSatellite(sat, 5)).toBe(true);
    expect(sat.hp).toBe(15);
    expect(damageSatellite(sat, 999)).toBe(true);
    expect(sat.hp).toBe(0);
    expect(damageSatellite(sat, 5)).toBe(false); // already dead
    expect(sat.hp).toBe(0);
  });
});

// --- 4. death --------------------------------------------------------------

describe('radar satellite — death (feature f1)', () => {
  it('a satellite killed by damage is swept off the station at end of step', () => {
    const world = twoPlayerWorld();
    const station = stationOf(world, 0)!;
    stepN(world, Math.ceil(SATELLITE.buildTime / TICK_DT) + 2, buildOrder(0));
    const sat = station.satellites![0]!;

    sat.hp = 0; // mark it dead as a shot would
    step(world, []);
    expect(station.satellites!.length).toBe(0); // swept
  });

  it('dies with its station: destroying the core zeros its satellites', () => {
    const world = twoPlayerWorld();
    const station = stationOf(world, 0)!;
    stepN(world, Math.ceil(SATELLITE.buildTime / TICK_DT) + 2, buildOrder(0));
    expect(station.satellites!.length).toBe(1);

    destroyCore(world, station);
    expect(station.satellites![0]!.hp).toBe(0);
    step(world, []); // the end-of-tick sweep clears it
    expect(station.satellites!.length).toBe(0);
  });
});

// --- 5. determinism --------------------------------------------------------

describe('radar satellite — determinism (feature f1, GDD §4.8)', () => {
  it('two runs from the same seed + inputs reach identical satellite state', () => {
    const run = (): string => {
      const world = twoPlayerWorld(42);
      stepN(world, Math.ceil(SATELLITE.buildTime / TICK_DT) + 40, buildOrder(0));
      const sats = stationOf(world, 0)!.satellites!;
      // Fold the satellite's full state (id/hp/orbit/pos) to a stable string.
      return JSON.stringify(sats.map((s) => [s.id, s.hp, s.maxHp, s.orbitAngle, s.pos.x, s.pos.y]));
    };
    expect(run()).toBe(run());
  });
});
