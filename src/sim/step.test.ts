/**
 * src/sim/step.test.ts — day-1 sim core coverage (GDD §2.3, §2.8, §4.8).
 *
 * The four contract checks from the brief:
 *   1. determinism — two runs, same inputs, deep-equal states;
 *   2. the beam mines at 0.5 ore/s (Vanguard baseline);
 *   3. the hold caps at capacity;
 *   4. a ship reflects off an asteroid.
 * Plus a few guards around world construction and the beam raycast.
 */

import { describe, it, expect } from 'vitest';
import type { Action } from '@shared/types';
import { ShipClass } from '@shared/types';
import { createWorld, step, type Inputs, type Ship, type Asteroid, type World } from './index';
import { MINING_RATE, SHIP_RADIUS, SHIP_STATS, CARGO_BASE } from './constants';

// --- builders --------------------------------------------------------------

function makeShip(over: Partial<Ship> & Pick<Ship, 'id'>): Ship {
  const cls = over.shipClass ?? ShipClass.Vanguard;
  const stats = SHIP_STATS[cls];
  return {
    id: over.id,
    shipClass: cls,
    pos: over.pos ?? { x: 0, y: 0 },
    vel: over.vel ?? { x: 0, y: 0 },
    home: over.home ?? { x: 0, y: 0 },
    angle: over.angle ?? 0,
    hull: over.hull ?? stats.hull,
    maxHull: over.maxHull ?? stats.hull,
    cargo: over.cargo ?? 0,
    cargoCap: over.cargoCap ?? Math.max(CARGO_BASE, stats.cargo),
    banked: over.banked ?? 0,
    alive: over.alive ?? true,
    respawnTimer: over.respawnTimer ?? 0,
    spawnProtect: over.spawnProtect ?? 0,
    radius: over.radius ?? SHIP_RADIUS,
  };
}

function makeAsteroid(over: Partial<Asteroid> & Pick<Asteroid, 'id'>): Asteroid {
  const ore = over.ore ?? 10;
  return {
    id: over.id,
    pos: over.pos ?? { x: 0, y: 0 },
    radius: over.radius ?? 30,
    ore,
    maxOre: over.maxOre ?? ore,
    crackStage: over.crackStage ?? 0,
    mineBuffer: over.mineBuffer ?? 0,
  };
}

function emptyWorld(over: Partial<World> = {}): World {
  return {
    time: 0,
    tick: 0,
    rngState: 1,
    nextEntityId: 1000,
    ships: over.ships ?? [],
    asteroids: over.asteroids ?? [],
    chunks: over.chunks ?? [],
    bounds: over.bounds ?? { width: 4000, height: 4000 },
  };
}

const fire = (auto = false): Action => ({ type: 'fire', active: true, auto });

// --- 1. determinism --------------------------------------------------------

describe('determinism (GDD §4.8)', () => {
  it('two runs from the same world + same inputs deep-equal', () => {
    const cfg = {
      seed: 1337,
      players: [
        { id: 0, shipClass: ShipClass.Interceptor },
        { id: 1, shipClass: ShipClass.Vanguard },
        { id: 2, shipClass: ShipClass.Excavator },
        { id: 3, shipClass: ShipClass.Hauler },
      ],
      asteroidCount: 40,
    } as const;

    // Deterministic, tick-dependent script so movement, beam, and tractor all run.
    const inputsAt = (tick: number): Inputs =>
      cfg.players.map((p) => ({
        id: p.id,
        actions: [
          { type: 'thrust', dir: { x: Math.sin(tick * 0.1 + p.id), y: Math.cos(tick * 0.13 + p.id) } },
          fire(true),
        ] as Action[],
      }));

    const a = createWorld(cfg);
    const b = createWorld(cfg);
    for (let t = 0; t < 400; t++) {
      step(a, inputsAt(t));
      step(b, inputsAt(t));
    }
    expect(a).toEqual(b);
    // Sanity: the run actually did something (ships moved, ore mined).
    expect(a.tick).toBe(400);
  });

  it('createWorld is a pure function of the seed', () => {
    const players = [{ id: 0, shipClass: ShipClass.Vanguard }];
    expect(createWorld({ seed: 7, players })).toEqual(createWorld({ seed: 7, players }));
    expect(createWorld({ seed: 7, players })).not.toEqual(createWorld({ seed: 8, players }));
  });
});

// --- 2. beam mines at 0.5 ore/s -------------------------------------------

describe('beam mining (GDD §2.3, §2.8)', () => {
  it('a Vanguard mines an asteroid at 0.5 ore/s', () => {
    const ship = makeShip({ id: 0, pos: { x: 100, y: 100 }, angle: 0 }); // faces +x
    const rock = makeAsteroid({ id: 0, pos: { x: 300, y: 100 }, radius: 30, ore: 20 });
    const world = emptyWorld({ ships: [ship], asteroids: [rock] });

    const inputs: Inputs = [{ id: 0, actions: [fire()] }]; // manual, straight ahead
    for (let t = 0; t < 60; t++) step(world, inputs); // 60 ticks ≈ 1 s

    const oreMined = rock.maxOre - world.asteroids[0]!.ore;
    expect(oreMined).toBeCloseTo(MINING_RATE, 6); // 0.5 ore in one second
  });

  it('the same beam damages an enemy ship (one beam, one stat)', () => {
    const shooter = makeShip({ id: 0, pos: { x: 0, y: 0 }, angle: 0 });
    const target = makeShip({ id: 1, pos: { x: 120, y: 0 }, spawnProtect: 0 });
    const world = emptyWorld({ ships: [shooter, target] });

    const before = target.hull;
    const inputs: Inputs = [{ id: 0, actions: [fire()] }];
    for (let t = 0; t < 60; t++) step(world, inputs);

    // Vanguard beam DPS = 10 → ~10 HP gone in a second.
    expect(before - world.ships[1]!.hull).toBeCloseTo(10, 4);
  });

  it('spawn protection blocks beam damage', () => {
    const shooter = makeShip({ id: 0, pos: { x: 0, y: 0 }, angle: 0 });
    const target = makeShip({ id: 1, pos: { x: 120, y: 0 }, spawnProtect: 10 });
    const world = emptyWorld({ ships: [shooter, target] });

    const inputs: Inputs = [{ id: 0, actions: [fire()] }];
    for (let t = 0; t < 30; t++) step(world, inputs);
    expect(world.ships[1]!.hull).toBe(target.maxHull);
  });
});

// --- 3. hold caps at capacity ---------------------------------------------

describe('cargo hold cap (GDD §2.3, §2.8)', () => {
  it('never exceeds capacity and fills to exactly the cap', () => {
    const ship = makeShip({ id: 0, pos: { x: 500, y: 500 } }); // Vanguard cap = 2
    const chunks = Array.from({ length: 8 }, (_, i) => ({
      id: 2000 + i,
      pos: { x: 500 + (i - 4) * 10, y: 540 }, // clustered within tractor range
      vel: { x: 0, y: 0 },
      amount: 1,
      radius: 6,
    }));
    const world = emptyWorld({ ships: [ship], chunks });

    for (let t = 0; t < 240; t++) {
      step(world, []); // no input; tractor pulls chunks in on its own
      expect(world.ships[0]!.cargo).toBeLessThanOrEqual(world.ships[0]!.cargoCap);
    }
    expect(world.ships[0]!.cargo).toBe(ship.cargoCap); // === 2
  });
});

// --- 4. ship-asteroid reflection ------------------------------------------

describe('ship-vs-asteroid reflection (GDD §4.1)', () => {
  it('reverses the ship velocity component along the contact normal', () => {
    const ship = makeShip({ id: 0, pos: { x: 100, y: 100 }, vel: { x: 300, y: 0 } });
    const rock = makeAsteroid({ id: 0, pos: { x: 160, y: 100 }, radius: 30 });
    const world = emptyWorld({ ships: [ship], asteroids: [rock] });

    // Drive the ship into the rock; no thrust so momentum carries it in.
    for (let t = 0; t < 40; t++) step(world, []);

    const s = world.ships[0]!;
    expect(s.vel.x).toBeLessThan(0); // bounced back along -x
    // And it is no longer deeply overlapping the asteroid.
    const dx = s.pos.x - rock.pos.x;
    const dy = s.pos.y - rock.pos.y;
    const sep = Math.sqrt(dx * dx + dy * dy);
    expect(sep).toBeGreaterThanOrEqual(s.radius + rock.radius - 1e-6);
  });
});

// --- physics + construction guards ----------------------------------------

describe('ship physics (GDD §2.11, §4.1)', () => {
  it('drag brings an unthrusted ship to rest and never past top speed', () => {
    const ship = makeShip({ id: 0, pos: { x: 1000, y: 1000 }, vel: { x: 500, y: 0 } });
    const world = emptyWorld({ ships: [ship] });
    const top = SHIP_STATS[ShipClass.Vanguard].speedMul * 260; // BASE_SPEED

    step(world, []);
    const speedAfterClamp = Math.hypot(world.ships[0]!.vel.x, world.ships[0]!.vel.y);
    expect(speedAfterClamp).toBeLessThanOrEqual(top + 1e-6);

    for (let t = 0; t < 600; t++) step(world, []);
    expect(Math.hypot(world.ships[0]!.vel.x, world.ships[0]!.vel.y)).toBeLessThan(1);
  });

  it('createWorld spawns one ship per slot and a central field', () => {
    const world = createWorld({
      seed: 99,
      players: [
        { id: 0, shipClass: ShipClass.Vanguard },
        { id: 1, shipClass: ShipClass.Hauler },
      ],
      asteroidCount: 12,
    });
    expect(world.ships).toHaveLength(2);
    expect(world.asteroids).toHaveLength(12);
    // Hauler carries 3 cargo slots by class (GDD §2.11).
    expect(world.ships[1]!.cargoCap).toBe(3);
  });
});
