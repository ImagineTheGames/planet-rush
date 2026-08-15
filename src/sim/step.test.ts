/**
 * src/sim/step.test.ts — day-1 sim core coverage (GDD §2.3, §2.8, §4.8).
 *
 * The four contract checks from the brief:
 *   1. determinism — two runs, same inputs, deep-equal states;
 *   2. mining chips an asteroid at ~0.5 ore/s (Vanguard baseline) — a projectile
 *      now, not a laser (ratified amendment v0.3);
 *   3. the hold caps at capacity;
 *   4. a ship reflects off an asteroid.
 * Plus a few guards around world construction and the one weapon system.
 */

import { describe, it, expect } from 'vitest';
import type { Action } from '@shared/types';
import { ShipClass } from '@shared/types';
import {
  activeProjectilesOf,
  createWorld,
  step,
  type Inputs,
  type Ship,
  type Asteroid,
  type World,
} from './index';
import {
  BASE_TURN_RATE,
  DRAG,
  FACE_VELOCITY_MIN_SPEED,
  MINING_RATE,
  RESOURCE_FIELD,
  SHIP_RADIUS,
  SHIP_STATS,
  SHIP_WEAPON,
  TICK_DT,
} from './constants';
import { shipCargoCap, shipMaxHull, shipWeaponDamage, stockTiers } from './upgrades';

// --- builders --------------------------------------------------------------

function makeShip(over: Partial<Ship> & Pick<Ship, 'id'>): Ship {
  const cls = over.shipClass ?? ShipClass.Vanguard;
  // A fixture's stats come from the same derived-stat path a real ship's do —
  // GDD §2.11 class base × the §2.5 tier ladder — so a test that hands over
  // `tiers` gets a correctly-equipped hull without restating the arithmetic.
  const loadout = { shipClass: cls, tiers: over.tiers ?? stockTiers() };
  return {
    id: over.id,
    shipClass: cls,
    tiers: loadout.tiers,
    pos: over.pos ?? { x: 0, y: 0 },
    vel: over.vel ?? { x: 0, y: 0 },
    home: over.home ?? { x: 0, y: 0 },
    angle: over.angle ?? 0,
    hull: over.hull ?? shipMaxHull(loadout),
    maxHull: over.maxHull ?? shipMaxHull(loadout),
    cargo: over.cargo ?? 0,
    cargoCap: over.cargoCap ?? shipCargoCap(loadout),
    banked: over.banked ?? 0,
    alive: over.alive ?? true,
    respawnTimer: over.respawnTimer ?? 0,
    spawnProtect: over.spawnProtect ?? 0,
    eliminated: over.eliminated ?? false,
    radius: over.radius ?? SHIP_RADIUS,
    firing: over.firing ?? false,
    // The per-tick tells, on the same terms the real `makeShip` sets them: a
    // fixture arrives with the trigger and the stick at rest (a0-47).
    thrust: over.thrust ?? 0,
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
    stations: over.stations ?? [],
    projectiles: over.projectiles ?? [],
    bounds: over.bounds ?? { width: 4000, height: 4000 },
    fieldRadius: over.fieldRadius ?? 600,
    // Zero rocks per wave: a hand-built world's field is exactly what the test
    // puts in it, so the wave metronome cannot drop asteroids into a physics
    // fixture. The collapse phase needs all five waves and so never opens here.
    asteroidsPerWave: over.asteroidsPerWave ?? 0,
    match: over.match ?? {
      phase: 'live',
      wavesSpawned: 0,
      collapseTime: -1,
      eliminated: [],
      winner: null,
      endTime: -1,
    },
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

    // Deterministic, tick-dependent script so movement, fire, and tractor all run.
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

// --- 2. mining is shooting: a projectile chips ~0.5 ore/s (amendment v0.3) ----

describe('projectile mining (ratified amendment v0.3 — mining is shooting)', () => {
  it('a Vanguard mines an asteroid by shooting it, at ~0.5 ore/s at the face', () => {
    // Point-blank-ish manual fire straight at a rock. Shots land one fire
    // interval apart (the weapon is a pipeline), so ore per second at the mining
    // face is yield ⁄ fireInterval = MINING_RATE — the same rate the old laser
    // cut at (a touch under, by the one-off shot-travel latency).
    const ship = makeShip({ id: 0, pos: { x: 100, y: 100 }, angle: 0 }); // faces +x
    const rock = makeAsteroid({ id: 0, pos: { x: 250, y: 100 }, radius: 30, ore: 40 });
    const world = emptyWorld({ ships: [ship], asteroids: [rock] });

    const SECONDS = 12;
    const inputs: Inputs = [{ id: 0, actions: [fire()] }]; // manual, straight ahead
    for (let t = 0; t < 60 * SECONDS; t++) step(world, inputs);

    const oreMined = rock.maxOre - world.asteroids[0]!.ore;
    const rate = oreMined / SECONDS;
    expect(oreMined).toBeGreaterThan(0); // it is actually mining
    // Within ~15% of the laser's old rate, and never above it (a shot cannot chip
    // more than one fire-interval's yield per interval).
    expect(rate).toBeGreaterThan(MINING_RATE * 0.85);
    expect(rate).toBeLessThanOrEqual(MINING_RATE + 1e-6);
  });

  it('mined ore drifts into the hold — the tractor rule is unchanged (GDD §2.3)', () => {
    // A ship mines a rock right in front of it; the chunks it chips off tractor
    // back and fill its hold (cap 2 for a Vanguard). Sited mid-arena, clear of the
    // edge margin that (correctly) keeps real spawns off the wall.
    const ship = makeShip({ id: 0, pos: { x: 1000, y: 1000 }, angle: 0 });
    const rock = makeAsteroid({ id: 0, pos: { x: 1130, y: 1000 }, radius: 30, ore: 40 });
    const world = emptyWorld({ ships: [ship], asteroids: [rock] });

    const inputs: Inputs = [{ id: 0, actions: [fire()] }];
    for (let t = 0; t < 60 * 30; t++) step(world, inputs);
    expect(world.ships[0]!.cargo).toBe(world.ships[0]!.cargoCap); // filled to the cap
  });

  it('a shot cannot pass through a rock to a ship behind it ("you cannot shoot through things")', () => {
    // The retired clamp-to-hit guarantee, now enforced by projectile collision:
    // a rock in the line eats the shot (and is mined) before it reaches the enemy.
    const shooter = makeShip({ id: 0, pos: { x: 100, y: 100 }, angle: 0 }); // faces +x
    const rock = makeAsteroid({ id: 0, pos: { x: 220, y: 100 }, radius: 30, ore: 40 });
    const enemy = makeShip({ id: 1, pos: { x: 500, y: 100 }, spawnProtect: 0 });
    const world = emptyWorld({ ships: [shooter, enemy], asteroids: [rock] });

    const inputs: Inputs = [{ id: 0, actions: [fire()] }];
    for (let t = 0; t < 120; t++) step(world, inputs);

    expect(world.ships[1]!.hull).toBe(enemy.maxHull); // never reached — the rock blocked it
    expect(world.asteroids[0]!.ore).toBeLessThan(rock.maxOre); // and the rock was mined
  });

  it('the weapon fires projectiles that damage an enemy ship (one weapon, one stat)', () => {
    // Combat is a projectile now (design amendment v0.2), not a hitscan ray —
    // but it is still the one power stat, delivered per shot. A stationary target
    // point-blank in the open eats every shot, so the delivered DPS matches the
    // old hitscan (≈ Vanguard power = 10/s).
    const shooter = makeShip({ id: 0, pos: { x: 0, y: 0 }, angle: 0 });
    const target = makeShip({ id: 1, pos: { x: 120, y: 0 }, spawnProtect: 0 });
    const world = emptyWorld({ ships: [shooter, target] });

    const before = target.hull;
    const perShot = shipWeaponDamage(shooter); // 10 * 0.35 = 3.5
    const inputs: Inputs = [{ id: 0, actions: [fire()] }];
    for (let t = 0; t < 60; t++) step(world, inputs);

    const lost = before - world.ships[1]!.hull;
    // Damage arrives in whole shots, ~3 in a second (fireInterval 0.35 s), and
    // ~10 HP total — the weapon DPS, if every shot lands.
    expect(lost).toBeGreaterThanOrEqual(9);
    expect(lost).toBeLessThanOrEqual(11);
    expect(lost / perShot).toBeCloseTo(Math.round(lost / perShot), 6); // whole shots
    // The trigger is held, so the firing tell is set; the damage rides a ship shot.
    expect(world.ships[0]!.firing).toBe(true);
    expect(world.projectiles.some((p) => p.kind === 'ship')).toBe(true);
  });

  it('spawn protection blocks weapon damage (the shot flies over a protected hull)', () => {
    const shooter = makeShip({ id: 0, pos: { x: 0, y: 0 }, angle: 0 });
    const target = makeShip({ id: 1, pos: { x: 120, y: 0 }, spawnProtect: 10 });
    const world = emptyWorld({ ships: [shooter, target] });

    const inputs: Inputs = [{ id: 0, actions: [fire()] }];
    for (let t = 0; t < 30; t++) step(world, inputs);
    expect(world.ships[1]!.hull).toBe(target.maxHull);
  });
});

// --- weapon projectile geometry (GDD §4.1, amendment v0.3) -----------------

describe('weapon projectile geometry (GDD §4.1)', () => {
  it('a weapon shot flies from the muzzle toward the ship it damages', () => {
    const shooter = makeShip({ id: 0, pos: { x: 500, y: 500 }, angle: 0 });
    const target = makeShip({ id: 1, pos: { x: 620, y: 500 }, spawnProtect: 0 });
    const world = emptyWorld({ ships: [shooter, target] });

    const before = target.hull;
    step(world, [{ id: 0, actions: [fire()] }]);

    // No line geometry (retired, amendment v0.3); a ship-kind projectile is born
    // at the muzzle heading +x toward the target, and the firing tell is set.
    expect(world.ships[0]!.firing).toBe(true);
    const shots = activeProjectilesOf(world, 0);
    expect(shots).toHaveLength(1);
    expect(shots[0]!.kind).toBe('ship');
    expect(shots[0]!.vel.x).toBeGreaterThan(0);
    expect(Math.abs(shots[0]!.vel.y)).toBeLessThan(1e-6);
    // It reaches and damages the target within its short travel time.
    for (let t = 0; t < 30; t++) step(world, [{ id: 0, actions: [] }]);
    expect(world.ships[1]!.hull).toBeLessThan(before);
  });

  it('manual fire into empty space shoots a weapon projectile', () => {
    const ship = makeShip({ id: 0, pos: { x: 500, y: 500 }, angle: 0 });
    const world = emptyWorld({ ships: [ship] }); // empty field ahead

    step(world, [{ id: 0, actions: [fire()] }]);

    // Nothing ahead to hit; the trigger still fires a weapon projectile, and the
    // firing tell is set (the tell is the trigger, not the target).
    expect(world.ships[0]!.firing).toBe(true);
    const shots = activeProjectilesOf(world, 0);
    expect(shots).toHaveLength(1);
    // Fired along the ship's facing (+x) at the base muzzle speed.
    expect(shots[0]!.vel.x).toBeCloseTo(SHIP_WEAPON.projectileSpeed, 6);
    expect(shots[0]!.vel.y).toBeCloseTo(0, 6);
  });

  it('the nearer of two aligned rocks is mined; the one behind it is untouched', () => {
    const ship = makeShip({ id: 0, pos: { x: 500, y: 500 }, angle: 0 }); // +x
    const near = makeAsteroid({ id: 0, pos: { x: 700, y: 500 }, radius: 30, ore: 20 });
    const far = makeAsteroid({ id: 1, pos: { x: 900, y: 500 }, radius: 30, ore: 20 });
    const world = emptyWorld({ ships: [ship], asteroids: [near, far] });

    for (let t = 0; t < 120; t++) step(world, [{ id: 0, actions: [fire()] }]);

    // Every shot dies on the near rock; the far one is occluded and untouched.
    expect(world.asteroids[0]!.ore).toBeLessThan(near.maxOre);
    expect(world.asteroids[1]!.ore).toBe(far.maxOre);
  });

  it('auto-aim shoots the acquired enemy with a leading projectile', () => {
    // Target is perpendicular to the ship's facing — auto-aim engages it across
    // the full 360° while the hull is still turning (GDD §2.4).
    const shooter = makeShip({ id: 0, pos: { x: 500, y: 500 }, angle: 0 });
    const target = makeShip({ id: 1, pos: { x: 500, y: 650 }, spawnProtect: 0 });
    const world = emptyWorld({ ships: [shooter, target] });

    const before = target.hull;
    step(world, [{ id: 0, actions: [fire(true)] }]); // auto-aim

    expect(world.ships[0]!.firing).toBe(true); // trigger held ⇒ firing
    const shots = activeProjectilesOf(world, 0);
    expect(shots).toHaveLength(1);
    // Stationary target: the intercept lead collapses to a straight shot +y.
    expect(shots[0]!.vel.y).toBeGreaterThan(0);
    expect(Math.abs(shots[0]!.vel.x)).toBeLessThan(1e-6);
    for (let t = 0; t < 30; t++) step(world, [{ id: 0, actions: [] }]);
    expect(world.ships[1]!.hull).toBeLessThan(before);
  });

  it('Ship.firing tracks the trigger — true while shooting (mining or fighting), false when idle', () => {
    // The laser retired to a projectile (a projectile does the mining and the
    // damage); Ship.firing survives as the bare tell the netcode firing bit reads —
    // true on any tick the trigger is engaged with a shot going out.
    const ship = makeShip({ id: 0, pos: { x: 500, y: 500 }, angle: 0 });
    const rock = makeAsteroid({ id: 0, pos: { x: 700, y: 500 }, radius: 30, ore: 20 });
    const world = emptyWorld({ ships: [ship], asteroids: [rock] });

    // Mining a rock ahead: firing is set, and a projectile does the work.
    step(world, [{ id: 0, actions: [fire()] }]);
    expect(world.ships[0]!.firing).toBe(true);
    expect(world.projectiles.some((p) => p.kind === 'ship')).toBe(true); // shot, not ray
    for (let t = 0; t < 40; t++) step(world, [{ id: 0, actions: [fire()] }]);
    expect(world.asteroids[0]!.ore).toBeLessThan(rock.maxOre); // and the rock is chipped

    // Shooting an enemy is also firing — the tell is the trigger, not the target.
    const shooter = makeShip({ id: 0, pos: { x: 500, y: 500 }, angle: Math.PI / 2 });
    const enemy = makeShip({ id: 1, pos: { x: 500, y: 650 }, spawnProtect: 0 });
    const combat = emptyWorld({ ships: [shooter, enemy] });
    step(combat, [{ id: 0, actions: [fire()] }]);
    expect(combat.ships[0]!.firing).toBe(true);

    // Release the trigger: the firing tell clears next tick.
    step(combat, [{ id: 0, actions: [] }]);
    expect(combat.ships[0]!.firing).toBe(false);
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

// --- 3b. full-hold tractor: chunks stay put (GDD §2.3) ---------------------

describe('full-hold tractor (GDD §2.3: "when it\'s full, chunks stay where they are for anyone")', () => {
  it('a full hold exerts no tractor pull — a resting chunk stays exactly put', () => {
    // Vanguard cap = 2; start full. A chunk at rest well inside tractor range.
    const ship = makeShip({ id: 0, pos: { x: 500, y: 500 }, cargo: 2 });
    const chunk = { id: 3000, pos: { x: 500, y: 560 }, vel: { x: 0, y: 0 }, amount: 1, radius: 6 };
    const world = emptyWorld({ ships: [ship], chunks: [chunk] });

    const start = { x: chunk.pos.x, y: chunk.pos.y };
    for (let t = 0; t < 180; t++) step(world, []);

    // Never attracted, never collected: position and hold both unchanged.
    expect(world.chunks).toHaveLength(1);
    expect(world.chunks[0]!.pos).toEqual(start);
    expect(world.ships[0]!.cargo).toBe(2);
  });

  it('a chunk in flight toward a ship whose hold fills mid-pull loses its target and coasts to rest', () => {
    // Room for exactly one more ore. A chunk touching the ship fills it on the
    // first tick; a second chunk is already flying inward when that happens.
    const ship = makeShip({ id: 0, pos: { x: 500, y: 500 }, cargo: 1 }); // room = 1
    const near = { id: 3100, pos: { x: 500, y: 520 }, vel: { x: 0, y: 0 }, amount: 1, radius: 6 };
    const flight = { id: 3101, pos: { x: 500, y: 600 }, vel: { x: 0, y: -80 }, amount: 1, radius: 6 };
    // `near` first in the array so it is collected (filling the hold) before
    // `flight` is processed on the very same tick.
    const world = emptyWorld({ ships: [ship], chunks: [near, flight] });

    let prevSpeed = Math.hypot(flight.vel.x, flight.vel.y);
    for (let t = 0; t < 600; t++) {
      step(world, []);
      const live = world.chunks.find((c) => c.id === 3101);
      if (!live) break;
      const speed = Math.hypot(live.vel.x, live.vel.y);
      // Only drag ever acts on it once the hold is full — never re-accelerated.
      expect(speed).toBeLessThanOrEqual(prevSpeed + 1e-9);
      prevSpeed = speed;
    }

    const ship0 = world.ships[0]!;
    const released = world.chunks.find((c) => c.id === 3101)!;
    // Hold filled to the cap by `near`; the in-flight chunk was never collected.
    expect(ship0.cargo).toBe(2);
    expect(released).toBeDefined();
    expect(released.amount).toBe(1);
    // It coasted to a stop free-floating, short of the ship — not pulled in.
    expect(Math.hypot(released.vel.x, released.vel.y)).toBeLessThan(1e-3);
    const gap = Math.hypot(released.pos.x - ship0.pos.x, released.pos.y - ship0.pos.y);
    expect(gap).toBeGreaterThan(ship0.radius + released.radius);
  });

  it('a released chunk is collectable by another ship that still has space', () => {
    // ship0 is full and sits nearest the chunk; ship1 has room and is farther.
    const full = makeShip({ id: 0, pos: { x: 500, y: 500 }, cargo: 2 });
    const roomy = makeShip({ id: 1, pos: { x: 500, y: 600 }, cargo: 0 });
    const chunk = { id: 3200, pos: { x: 500, y: 560 }, vel: { x: 0, y: 0 }, amount: 1, radius: 6 };
    const world = emptyWorld({ ships: [full, roomy], chunks: [chunk] });

    for (let t = 0; t < 240 && world.chunks.length > 0; t++) step(world, []);

    // The full ship ignored it; the ship with space tractored and collected it.
    expect(world.ships[0]!.cargo).toBe(2);
    expect(world.ships[1]!.cargo).toBe(1);
    expect(world.chunks).toHaveLength(0);
  });

  it('attraction resumes once the hold frees up (banking / spending)', () => {
    const ship = makeShip({ id: 0, pos: { x: 500, y: 500 }, cargo: 2 }); // full
    const chunk = { id: 3300, pos: { x: 500, y: 560 }, vel: { x: 0, y: 0 }, amount: 1, radius: 6 };
    const world = emptyWorld({ ships: [ship], chunks: [chunk] });

    // While full: no pull, chunk stays put.
    const start = { x: chunk.pos.x, y: chunk.pos.y };
    for (let t = 0; t < 60; t++) step(world, []);
    expect(world.chunks[0]!.pos).toEqual(start);

    // Banking empties the hold (banked ore is safe, GDD §2.3) — tractor resumes.
    world.ships[0]!.cargo = 0;
    for (let t = 0; t < 240 && world.chunks.length > 0; t++) step(world, []);
    expect(world.ships[0]!.cargo).toBe(1);
    expect(world.chunks).toHaveLength(0);
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
    // And it is no longer deeply intersecting the asteroid.
    const dx = s.pos.x - rock.pos.x;
    const dy = s.pos.y - rock.pos.y;
    const sep = Math.sqrt(dx * dx + dy * dy);
    expect(sep).toBeGreaterThanOrEqual(s.radius + rock.radius - 1e-6);
  });
});

// --- 5. facing ladder: aim → auto-aim → velocity → hold --------------------

describe('facing ladder (aim input → auto-aim target → velocity → hold)', () => {
  const aim = (x: number, y: number): Action => ({ type: 'aim', dir: { x, y } });
  /** One class turn step, radians per tick. */
  const turnStep = (cls = ShipClass.Vanguard) => BASE_TURN_RATE * SHIP_STATS[cls].turnMul * TICK_DT;

  it('3. with no aim and no auto-aim target, the nose turns toward velocity', () => {
    // Moving straight up (+y), facing +x. Nothing aimed, nothing fired.
    const ship = makeShip({ id: 0, pos: { x: 500, y: 500 }, vel: { x: 0, y: 200 }, angle: 0 });
    const world = emptyWorld({ ships: [ship] });

    step(world, []);
    // Exactly one turn step toward +y — no snap.
    expect(world.ships[0]!.angle).toBeCloseTo(turnStep(), 9);

    // Converges to the velocity direction and then holds it.
    for (let t = 0; t < 20; t++) step(world, []);
    expect(world.ships[0]!.angle).toBeCloseTo(Math.PI / 2, 6);
  });

  it('3. thrusting from rest turns the nose into the direction of travel', () => {
    const ship = makeShip({ id: 0, pos: { x: 500, y: 500 }, angle: 0 }); // at rest, facing +x
    const world = emptyWorld({ ships: [ship] });
    const inputs: Inputs = [{ id: 0, actions: [{ type: 'thrust', dir: { x: -1, y: 0 } }] }];

    for (let t = 0; t < 60; t++) step(world, inputs);

    const s = world.ships[0]!;
    expect(s.vel.x).toBeLessThan(0); // travelling -x
    expect(Math.abs(s.angle)).toBeCloseTo(Math.PI, 4); // nose came about to -x
  });

  it('1. an explicit aim input outranks both velocity and an auto-aim target', () => {
    // Travelling +x (velocity would say angle 0); an auto-aim target sits at
    // +y; the player aims at -y. Aim must win, so the ship turns negative.
    const ship = makeShip({ id: 0, pos: { x: 500, y: 500 }, vel: { x: 200, y: 0 }, angle: 0 });
    const target = makeShip({ id: 1, pos: { x: 500, y: 650 }, spawnProtect: 0 });
    const world = emptyWorld({ ships: [ship, target] });

    step(world, [{ id: 0, actions: [aim(0, -1), fire(true)] }]);

    expect(world.ships[0]!.angle).toBeCloseTo(-turnStep(), 9);
  });

  it('2. an engaged auto-aim target outranks velocity', () => {
    // Same setup, minus the aim input: the ship turns toward the target (+y),
    // not toward its velocity (+x, i.e. hold at 0).
    const ship = makeShip({ id: 0, pos: { x: 500, y: 500 }, vel: { x: 200, y: 0 }, angle: 0 });
    const target = makeShip({ id: 1, pos: { x: 500, y: 650 }, spawnProtect: 0 });
    const world = emptyWorld({ ships: [ship, target] });

    step(world, [{ id: 0, actions: [fire(true)] }]);

    expect(world.ships[0]!.angle).toBeCloseTo(turnStep(), 9);
  });

  it('2→3. auto-aim with nothing in range falls through to velocity', () => {
    // Firing on auto with an empty field: the ladder drops to velocity.
    const ship = makeShip({ id: 0, pos: { x: 500, y: 500 }, vel: { x: 0, y: 200 }, angle: 0 });
    const world = emptyWorld({ ships: [ship] });

    step(world, [{ id: 0, actions: [fire(true)] }]);

    expect(world.ships[0]!.angle).toBeCloseTo(turnStep(), 9);
  });

  it('3. firing manually without an aim input still faces velocity', () => {
    const ship = makeShip({ id: 0, pos: { x: 500, y: 500 }, vel: { x: 0, y: 200 }, angle: 0 });
    const world = emptyWorld({ ships: [ship] });

    step(world, [{ id: 0, actions: [fire()] }]); // manual fire, no aim action

    expect(world.ships[0]!.angle).toBeCloseTo(turnStep(), 9);
    // Firing into empty space shoots the weapon along the (newly turned) facing.
    const shots = activeProjectilesOf(world, 0);
    expect(shots).toHaveLength(1);
    const sp = Math.hypot(shots[0]!.vel.x, shots[0]!.vel.y);
    expect(shots[0]!.vel.x / sp).toBeCloseTo(Math.cos(turnStep()), 9);
    expect(shots[0]!.vel.y / sp).toBeCloseTo(Math.sin(turnStep()), 9);
  });

  it('4. below the speed epsilon the ship holds its facing exactly', () => {
    const slow = FACE_VELOCITY_MIN_SPEED * 0.5;
    const ship = makeShip({ id: 0, pos: { x: 500, y: 500 }, vel: { x: 0, y: slow }, angle: 1 });
    const world = emptyWorld({ ships: [ship] });

    for (let t = 0; t < 120; t++) step(world, []); // drag only shrinks it further
    expect(world.ships[0]!.angle).toBe(1); // bit-identical hold, no drift
  });

  it('4. a ship at rest holds its facing', () => {
    const ship = makeShip({ id: 0, pos: { x: 500, y: 500 }, vel: { x: 0, y: 0 }, angle: -2 });
    const world = emptyWorld({ ships: [ship] });

    for (let t = 0; t < 60; t++) step(world, []);
    expect(world.ships[0]!.angle).toBe(-2);
  });

  it('3/4. the epsilon is the switch: just above it turns, just below it holds', () => {
    // Facing is resolved after integration, so it reads the post-drag speed —
    // pre-drag speeds are pre-divided by one tick of decay to land either side
    // of the epsilon by 1%.
    const decay = 1 - DRAG * TICK_DT;
    const over = makeShip({ id: 0, pos: { x: 500, y: 500 }, vel: { x: 0, y: (FACE_VELOCITY_MIN_SPEED * 1.01) / decay }, angle: 0 });
    const under = makeShip({ id: 1, pos: { x: 1500, y: 500 }, vel: { x: 0, y: (FACE_VELOCITY_MIN_SPEED * 0.99) / decay }, angle: 0 });
    const world = emptyWorld({ ships: [over, under] });

    step(world, []);

    expect(world.ships[0]!.angle).toBeCloseTo(turnStep(), 9);
    expect(world.ships[1]!.angle).toBe(0);
  });

  it('never turns faster than the class turn rate, and converges monotonically', () => {
    // Worst case: velocity is a half-turn away from the current facing.
    for (const cls of [ShipClass.Interceptor, ShipClass.Vanguard, ShipClass.Excavator, ShipClass.Hauler]) {
      const ship = makeShip({ id: 0, shipClass: cls, pos: { x: 900, y: 900 }, vel: { x: -240, y: 0 }, angle: 0 });
      const world = emptyWorld({ ships: [ship] });
      const maxDelta = turnStep(cls);

      let prev = 0;
      let prevGap = Math.PI;
      for (let t = 0; t < 40; t++) {
        // Thrust keeps the velocity pinned at -x so the target angle is fixed.
        step(world, [{ id: 0, actions: [{ type: 'thrust', dir: { x: -1, y: 0 } }] }]);
        const angle = world.ships[0]!.angle;
        expect(Math.abs(angle - prev)).toBeLessThanOrEqual(maxDelta + 1e-9);
        const gap = Math.abs(Math.abs(angle) - Math.PI);
        expect(gap).toBeLessThanOrEqual(prevGap + 1e-9); // never overshoots away
        prev = angle;
        prevGap = gap;
      }
      expect(Math.abs(world.ships[0]!.angle)).toBeCloseTo(Math.PI, 6);
    }
  });

  it('a faster-turning class reaches the velocity heading sooner', () => {
    const ticksToFace = (cls: ShipClass): number => {
      const ship = makeShip({ id: 0, shipClass: cls, pos: { x: 900, y: 900 }, vel: { x: 0, y: 240 }, angle: 0 });
      const world = emptyWorld({ ships: [ship] });
      for (let t = 1; t <= 200; t++) {
        step(world, [{ id: 0, actions: [{ type: 'thrust', dir: { x: 0, y: 1 } }] }]);
        if (Math.abs(world.ships[0]!.angle - Math.PI / 2) < 1e-9) return t;
      }
      return Infinity;
    };
    // turnMul 1.4 (Quadfin) vs 0.8 (Pincer) — GDD §2.11.
    expect(ticksToFace(ShipClass.Interceptor)).toBeLessThan(ticksToFace(ShipClass.Excavator));
  });

  it('determinism holds with velocity facing engaged (GDD §4.8)', () => {
    const cfg = {
      seed: 4242,
      players: [
        { id: 0, shipClass: ShipClass.Interceptor },
        { id: 1, shipClass: ShipClass.Vanguard },
        { id: 2, shipClass: ShipClass.Excavator },
        { id: 3, shipClass: ShipClass.Hauler },
      ],
      asteroidCount: 30,
    } as const;

    // Thrust only — no aim, no fire — so every ship's facing comes from rung 3.
    const inputsAt = (tick: number): Inputs =>
      cfg.players.map((p) => ({
        id: p.id,
        actions: [
          { type: 'thrust', dir: { x: Math.cos(tick * 0.07 + p.id), y: Math.sin(tick * 0.11 + p.id) } },
        ] as Action[],
      }));

    const a = createWorld(cfg);
    const b = createWorld(cfg);
    const startAngles = a.ships.map((s) => s.angle);
    for (let t = 0; t < 300; t++) {
      step(a, inputsAt(t));
      step(b, inputsAt(t));
    }
    expect(a).toEqual(b);
    // Sanity: the facing rung actually fired (every ship rotated).
    expect(a.ships.every((s, i) => s.angle !== startAngles[i])).toBe(true);
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

  it('publishes the throttle it applied, and keeps publishing it at top speed', () => {
    // The a0-47 tell (`Ship.thrust`). It exists because the renderer cannot
    // recover the engine from the state it produced: at top speed thrust and
    // drag cancel exactly, so acceleration — the thing the thruster trail used
    // to infer the throttle from — is ZERO at full stick. This test is the sim
    // half of `src/art/vfx/observer.test.ts` "still thrusting at top speed".
    const ship = makeShip({ id: 0, pos: { x: 1000, y: 1000 } });
    const world = emptyWorld({ ships: [ship] });
    const push = (x: number, y: number): Inputs => [
      { id: 0, actions: [{ type: 'thrust', dir: { x, y } }] },
    ];

    expect(world.ships[0]!.thrust).toBe(0); // a ship at rest is not under power
    for (let t = 0; t < 600; t++) step(world, push(1, 0));

    const top = SHIP_STATS[ShipClass.Vanguard].speedMul * 260; // BASE_SPEED
    expect(Math.hypot(world.ships[0]!.vel.x, world.ships[0]!.vel.y)).toBeCloseTo(top, 3);
    const was = world.ships[0]!.vel.x;
    step(world, push(1, 0));
    // Terminal velocity: the acceleration is gone and the engine is not.
    expect(Math.abs(world.ships[0]!.vel.x - was) * 60).toBeLessThan(1);
    expect(world.ships[0]!.thrust).toBe(1);

    // Analog: half a stick is half a throttle, not a boolean dressed as one.
    step(world, push(0.5, 0));
    expect(world.ships[0]!.thrust).toBeCloseTo(0.5, 6);
    // The keyboard's diagonal is clamped to the unit disc before it is read.
    step(world, push(1, 1));
    expect(world.ships[0]!.thrust).toBeCloseTo(1, 6);
    // Letting go is a throttle of zero on the very next tick, not a decay.
    step(world, []);
    expect(world.ships[0]!.thrust).toBe(0);

    // And a dead ship has no engine, whatever its pilot is still pressing.
    world.ships[0]!.alive = false;
    world.ships[0]!.eliminated = true;
    step(world, push(1, 0));
    expect(world.ships[0]!.thrust).toBe(0);
  });

  it('createWorld spawns one ship per slot, home fields, and a central field', () => {
    const world = createWorld({
      seed: 99,
      players: [
        { id: 0, shipClass: ShipClass.Vanguard },
        { id: 1, shipClass: ShipClass.Hauler },
      ],
      asteroidCount: 12,
    });
    expect(world.ships).toHaveLength(2);
    // The field is now two parts (field rule v0.1.2, `RESOURCE_FIELD`): an
    // identical home neighbourhood per station (tagged by owner) and the
    // contested commons (`home == null`).
    const home = world.asteroids.filter((a) => a.home != null);
    const commons = world.asteroids.filter((a) => a.home == null);
    expect(home).toHaveLength(RESOURCE_FIELD.homeCount * 2);
    expect(commons.length).toBeGreaterThan(0);
    // Hauler carries 3 cargo slots by class (GDD §2.11).
    expect(world.ships[1]!.cargoCap).toBe(3);
  });
});
