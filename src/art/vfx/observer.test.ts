/**
 * The observer, checked against the **real** simulation.
 *
 * `src/art/` never imports `src/sim/` — the views in `./observer` are
 * structural, which is what keeps the art module a leaf (GDD §3, ownership).
 * The risk that buys is silent drift: the Gameplay Engineer renames a field, the
 * structural type stops matching, and nothing fails — the tells just quietly
 * stop firing, and every mechanic loses its tell at once.
 *
 * So the test imports the sim (a test may; the module may not) and:
 *
 *  1. asserts a real `World` is assignable to `WorldView`, at compile time;
 *  2. runs a real match through the observer and checks the tells that come out.
 *
 * A sim shape change now fails here, loudly, on the commit that makes it.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import { createWorld, step, type World } from '../../sim';
import { TELL, TELL_NAMES, TellQueue } from '../tells';
import { REFERENCE_ACCEL, REPAIR_PULSE_S, SPAWN_PULSE_S, WorldObserver, type WorldView } from './observer';

/** The compile-time half: a real World *is* a WorldView, or this file fails tsc. */
function asView(world: World): WorldView {
  return world;
}

function newWorld(): World {
  return createWorld({
    seed: 20260724,
    players: [
      { id: 0, shipClass: ShipClass.Vanguard },
      { id: 1, shipClass: ShipClass.Interceptor },
    ],
    bounds: { width: 1200, height: 1200 },
    asteroidCount: 12,
  });
}

describe('WorldObserver — the sim shape it reads', () => {
  it('accepts a real World as a WorldView (GDD §4.1: plain data, no events)', () => {
    const world = newWorld();
    const view = asView(world);
    expect(view.ships.length).toBe(2);
    expect(view.stations.length).toBe(2);
    expect(view.asteroids.length).toBeGreaterThan(0);
    expect(view.match.phase).toBe('live');
    expect(typeof view.bounds.width).toBe('number');
  });

  it('reads every field the views name, on real entities', () => {
    // Spelled out rather than implied, because the failure this catches is a
    // rename that still typechecks structurally on a partially-shared shape.
    const world = newWorld();
    const ship = world.ships[0]!;
    for (const key of ['id', 'pos', 'vel', 'angle', 'radius', 'alive', 'hull', 'maxHull', 'cargo', 'cargoCap', 'banked', 'spawnProtect', 'tiers', 'firing']) {
      expect(ship, `Ship.${key}`).toHaveProperty(key);
    }
    const station = world.stations[0]!;
    for (const key of ['id', 'owner', 'pos', 'radius', 'coreHp', 'maxCoreHp', 'alive', 'angle', 'repairing', 'turrets', 'shields', 'builds']) {
      expect(station, `MiningStation.${key}`).toHaveProperty(key);
    }
    const rock = world.asteroids[0]!;
    for (const key of ['id', 'pos', 'radius', 'ore', 'crackStage']) {
      expect(rock, `Asteroid.${key}`).toHaveProperty(key);
    }
  });

  it('runs a real match without ever overflowing the tell queue', () => {
    // The capacity claim in `../tells` — "a wave landing on a firefight next to
    // a dying station" — against an actual match rather than an estimate.
    const world = newWorld();
    const observer = new WorldObserver({ local: 0 });
    const tells = new TellQueue();
    const inputs: never[] = []; // nobody presses anything: the field alone drives it
    let seen = 0;

    for (let tick = 0; tick < 1800; tick++) {
      step(world, inputs, 1 / 60);
      tells.clear();
      observer.observe(world, 1 / 60, tells);
      seen += tells.length;
      expect(tells.dropped).toBe(0);
    }
    expect(seen).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Hand-built worlds: one moment at a time, so a failure names the mechanic.
// ---------------------------------------------------------------------------

interface Mutable {
  time: number;
  bounds: { width: number; height: number };
  ships: unknown[];
  asteroids: unknown[];
  stations: unknown[];
  projectiles: unknown[];
  match: { phase: string; wavesSpawned: number; winner: number | null };
}

function ship(over: Record<string, unknown> = {}): unknown {
  return {
    id: 0,
    pos: { x: 100, y: 100 },
    vel: { x: 0, y: 0 },
    angle: 0,
    radius: 12,
    alive: true,
    hull: 50,
    maxHull: 50,
    cargo: 0,
    cargoCap: 2,
    banked: 0,
    spawnProtect: 0,
    tiers: { power: 0, engine: 0, cargo: 0, hull: 0 },
    firing: false,
    ...over,
  };
}

function station(over: Record<string, unknown> = {}): unknown {
  return {
    id: 0,
    owner: 0,
    pos: { x: 500, y: 500 },
    radius: 60,
    coreHp: 100,
    maxCoreHp: 100,
    alive: true,
    angle: 0,
    repairing: false,
    turrets: [],
    shields: [],
    builds: [],
    ...over,
  };
}

function world(over: Partial<Mutable> = {}): Mutable {
  return {
    time: 0,
    bounds: { width: 1000, height: 1000 },
    ships: [],
    asteroids: [],
    stations: [],
    projectiles: [],
    match: { phase: 'live', wavesSpawned: 1, winner: null },
    ...over,
  };
}

/** Prime, then observe one changed frame — the observer's whole contract. */
function diff(before: Mutable, after: Mutable, dt = 1 / 60, local = 0): TellQueue {
  const observer = new WorldObserver({ local });
  const tells = new TellQueue();
  observer.observe(before as unknown as WorldView, dt, tells);
  expect(tells.length, 'the first frame must be silent').toBe(0);
  tells.clear();
  observer.observe(after as unknown as WorldView, dt, tells);
  return tells;
}

function magnitudeOf(tells: TellQueue, kind: number): number {
  const i = tells.indexOf(kind as never);
  expect(i, `no ${TELL_NAMES[kind]} tell`).toBeGreaterThanOrEqual(0);
  return tells.magnitude[i]!;
}

describe('WorldObserver — deriving the moments', () => {
  it('says nothing on the first frame — no opening barrage on a fresh match', () => {
    // Also the join-mid-match case (GDD §4.2): a client should not replay the
    // siege it missed the instant it connects.
    const observer = new WorldObserver();
    const tells = new TellQueue();
    observer.observe(world({ ships: [ship()], stations: [station()] }) as unknown as WorldView, 1 / 60, tells);
    expect(tells.length).toBe(0);
    expect(observer.ready).toBe(true);
  });

  it('cracks a rock, then bursts it when it leaves the world (GDD §2.2)', () => {
    const rock = (over: Record<string, unknown>) => ({ id: 9, pos: { x: 10, y: 20 }, radius: 12, ore: 5, crackStage: 0, ...over });
    const cracked = diff(world({ asteroids: [rock({})] }), world({ asteroids: [rock({ crackStage: 1 })] }));
    expect(cracked.has(TELL.rockCrack)).toBe(true);
    expect(magnitudeOf(cracked, TELL.rockCrack)).toBeCloseTo(0.5, 5); // stage / 2

    const burst = diff(world({ asteroids: [rock({})] }), world({ asteroids: [] }));
    expect(burst.has(TELL.rockBurst)).toBe(true);
    expect(burst.x[burst.indexOf(TELL.rockBurst)]).toBe(10); // its last known place
  });

  const firingTurret = (m: unknown, over: Record<string, unknown> = {}) =>
    station({ turrets: [{ id: 5, pos: { x: 0, y: 0 }, radius: 8, angle: 0, cooldown: 0, hp: 30, muzzle: m }], ...over });

  it('splits the muzzle flash into rock and hull voices (GDD §3.6)', () => {
    const muzzle = (hit: { x: number; y: number }) => ({
      origin: { x: 0, y: 0 },
      dir: { x: 1, y: 0 },
      hitPoint: hit,
      length: 100,
    });
    const target = ship({ id: 1, pos: { x: 300, y: 100 } });

    const onRock = diff(
      world({ ships: [target], stations: [firingTurret(null)] }),
      world({ ships: [target], stations: [firingTurret(muzzle({ x: 200, y: 100 }))] }),
    );
    expect(onRock.has(TELL.mineHit)).toBe(true);
    expect(onRock.has(TELL.weaponHit)).toBe(false);

    const onHull = diff(
      world({ ships: [target], stations: [firingTurret(null)] }),
      world({ ships: [target], stations: [firingTurret(muzzle({ x: 300, y: 100 }))] }),
    );
    expect(onHull.has(TELL.weaponHit)).toBe(true);
    expect(onHull.has(TELL.mineHit)).toBe(false);
  });

  it('says nothing for a muzzle flash that reaches full range unobstructed', () => {
    const clear = { origin: { x: 0, y: 0 }, dir: { x: 1, y: 0 }, hitPoint: null, length: 400 };
    const tells = diff(world({ stations: [firingTurret(null)] }), world({ stations: [firingTurret(clear)] }));
    expect(tells.has(TELL.mineHit)).toBe(false);
    expect(tells.has(TELL.weaponHit)).toBe(false);
  });

  it('carries the firing power and the turret owner on the muzzle voice (GDD §2.5)', () => {
    const m = { origin: { x: 0, y: 0 }, dir: { x: 1, y: 0 }, hitPoint: { x: 200, y: 100 }, length: 200 };
    const tells = diff(
      world({ stations: [firingTurret(null, { owner: 2 })] }),
      world({ stations: [firingTurret(m, { owner: 2 })] }),
    );
    expect(magnitudeOf(tells, TELL.mineHit)).toBeGreaterThan(0);
    expect(tells.player[tells.indexOf(TELL.mineHit)]).toBe(2); // the turret owner
  });

  it('fires the hold-full tell once, on the transition (GDD §2.2)', () => {
    const observer = new WorldObserver();
    const tells = new TellQueue();
    const at = (cargo: number) => world({ ships: [ship({ cargo, cargoCap: 2 })] }) as unknown as WorldView;

    observer.observe(at(0), 1 / 60, tells);
    tells.clear();
    observer.observe(at(1), 1 / 60, tells);
    expect(tells.has(TELL.oreCollect)).toBe(true);
    expect(tells.has(TELL.holdFull)).toBe(false);

    tells.clear();
    observer.observe(at(2), 1 / 60, tells);
    expect(tells.count(TELL.holdFull)).toBe(1);

    tells.clear();
    observer.observe(at(2), 1 / 60, tells); // still full, and still quiet
    expect(tells.has(TELL.holdFull)).toBe(false);
  });

  it('explodes a ship on death and announces the respawn (GDD §2.7)', () => {
    const dead = diff(world({ ships: [ship()] }), world({ ships: [ship({ alive: false })] }));
    expect(dead.has(TELL.shipExplode)).toBe(true);

    const back = diff(world({ ships: [ship({ alive: false })] }), world({ ships: [ship({ alive: true })] }));
    expect(back.has(TELL.shipSpawn)).toBe(true);
  });

  it('measures throttle from the ship rather than asking the sim for it', () => {
    const moving = ship({ vel: { x: REFERENCE_ACCEL / 60, y: 0 } });
    const tells = diff(world({ ships: [ship()] }), world({ ships: [moving] }));
    // One frame of full acceleration along the nose reads as full throttle.
    expect(magnitudeOf(tells, TELL.thrust)).toBeCloseTo(1, 2);
    // And the exhaust leaves from behind the hull, pointing backwards.
    const i = tells.indexOf(TELL.thrust);
    expect(tells.x[i]).toBeCloseTo(100 - 12, 5);
    expect(tells.angle[i]).toBeCloseTo(Math.PI, 5);
  });

  it('reads a coasting ship as no thrust at all', () => {
    const drifting = ship({ vel: { x: 200, y: 0 } });
    const tells = diff(world({ ships: [drifting] }), world({ ships: [drifting] }));
    expect(tells.has(TELL.thrust)).toBe(false);
  });

  it('pulses spawn protection on one shared clock (GDD §2.1)', () => {
    const observer = new WorldObserver();
    const tells = new TellQueue();
    const protectedShips = world({
      ships: [ship({ id: 0, spawnProtect: 9 }), ship({ id: 1, spawnProtect: 9 })],
    }) as unknown as WorldView;

    observer.observe(protectedShips, 0, tells);
    tells.clear();
    observer.observe(protectedShips, SPAWN_PULSE_S, tells);
    // Two protected ships pulse together rather than two timers drifting apart.
    expect(tells.count(TELL.spawnPulse)).toBe(2);
  });

  it('hits the core, and holds the death for the tone contract (GDD §4.7)', () => {
    const hit = diff(world({ stations: [station()] }), world({ stations: [station({ coreHp: 60 })] }));
    expect(magnitudeOf(hit, TELL.coreHit)).toBeCloseTo(0.6, 5);

    const died = diff(world({ stations: [station()] }), world({ stations: [station({ coreHp: 0, alive: false })] }));
    expect(died.count(TELL.stationDeath)).toBe(1);
    expect(died.has(TELL.coreHit)).toBe(false); // the death is the tell, not a hit
    expect(died.player[died.indexOf(TELL.stationDeath)]).toBe(0);
  });

  it('beats the repair channel and stops the instant it is interrupted (GDD §2.5)', () => {
    const observer = new WorldObserver();
    const tells = new TellQueue();
    const repairing = world({ stations: [station({ repairing: true })] }) as unknown as WorldView;

    observer.observe(repairing, 0, tells);
    tells.clear();
    observer.observe(repairing, REPAIR_PULSE_S, tells);
    expect(tells.count(TELL.repairTick)).toBe(1);

    tells.clear();
    // Any damage interrupts the channel; the heartbeat stops with it.
    observer.observe(world({ stations: [station({ repairing: false })] }) as unknown as WorldView, REPAIR_PULSE_S, tells);
    expect(tells.has(TELL.repairTick)).toBe(false);
  });

  it('flashes a turret on the cooldown reset that is the shot', () => {
    const turret = (cooldown: number) => station({ turrets: [{ id: 5, pos: { x: 520, y: 500 }, radius: 8, angle: 0, cooldown, hp: 30 }] });
    const fired = diff(world({ stations: [turret(0)] }), world({ stations: [turret(0.25)] }));
    expect(fired.has(TELL.turretFire)).toBe(true);
    // At the barrel tip, not the mount: the flash is where the shot leaves.
    expect(fired.x[fired.indexOf(TELL.turretFire)]).toBeCloseTo(528, 5);

    const cooling = diff(world({ stations: [turret(0.25)] }), world({ stations: [turret(0.2)] }));
    expect(cooling.has(TELL.turretFire)).toBe(false);
  });

  it('carries the owner on a turret death, so the right alarm rings (GDD §2.2)', () => {
    const withTurret = station({ owner: 3, turrets: [{ id: 5, pos: { x: 520, y: 500 }, radius: 8, angle: 0, cooldown: 0, hp: 30 }] });
    const tells = diff(world({ stations: [withTurret] }), world({ stations: [station({ owner: 3 })] }));
    expect(tells.has(TELL.turretDown)).toBe(true);
    expect(tells.player[tells.indexOf(TELL.turretDown)]).toBe(3);
  });

  it('announces a build placed once, and its completion when the thing appears', () => {
    const job = station({ builds: [{ id: 7, kind: 'turret', remaining: 10 }] });
    const placed = diff(world({ stations: [station()] }), world({ stations: [job] }));
    expect(placed.count(TELL.buildPlaced)).toBe(1);

    const observer = new WorldObserver();
    const tells = new TellQueue();
    observer.observe(world({ stations: [job] }) as unknown as WorldView, 0, tells);
    tells.clear();
    observer.observe(world({ stations: [job] }) as unknown as WorldView, 1 / 60, tells);
    expect(tells.has(TELL.buildPlaced)).toBe(false); // …and only once

    const done = diff(
      world({ stations: [job] }),
      world({ stations: [station({ turrets: [{ id: 8, pos: { x: 520, y: 500 }, radius: 8, angle: 0, cooldown: 0, hp: 30 }] })] }),
    );
    expect(done.has(TELL.buildComplete)).toBe(true);
  });

  it('keeps the build jobs of one station from cancelling those of another', () => {
    // The bug this guards: pruning the job memo per station drops the other
    // seven stations' jobs and re-announces them on the next frame, forever.
    const a = station({ id: 0, owner: 0, builds: [{ id: 1, kind: 'turret', remaining: 9 }] });
    const b = station({ id: 1, owner: 1, pos: { x: 800, y: 800 }, builds: [{ id: 2, kind: 'shield', remaining: 14 }] });
    const observer = new WorldObserver();
    const tells = new TellQueue();
    const both = world({ stations: [a, b] }) as unknown as WorldView;

    observer.observe(both, 0, tells);
    for (let i = 0; i < 5; i++) {
      tells.clear();
      observer.observe(both, 1 / 60, tells);
      expect(tells.has(TELL.buildPlaced)).toBe(false);
    }
  });

  it('keeps one station\'s TURRETS from killing another\'s, every frame, forever', () => {
    // The same bug as the one above, in the function directly below the comment
    // warning about it — and it shipped. The turret memo map is world-wide but
    // was swept inside the PER-STATION pass, so station 0's turn deleted every
    // other station's turrets (announcing a `turretDown` each), and their own
    // turns found them missing and announced a `buildComplete`. Measured on a
    // real twenty-second match before the fix: 1176 turret deaths and 1183
    // completions, none of which happened.
    //
    // It survived because it is invisible at N=1: a single-station fixture, which
    // is what every other turret test here uses, cannot express it. And because
    // nothing DREW the tells, so the only witness was a mix quietly sounding a
    // turret dying sixty times a second.
    const gun = (id: number, x: number) => ({ id, pos: { x, y: 500 }, radius: 8, angle: 0, cooldown: 0, hp: 30 });
    const a = station({ id: 0, owner: 0, turrets: [gun(5, 520)] });
    const b = station({ id: 1, owner: 1, pos: { x: 800, y: 800 }, turrets: [gun(6, 820)] });
    const observer = new WorldObserver();
    const tells = new TellQueue();
    const both = world({ stations: [a, b] }) as unknown as WorldView;

    observer.observe(both, 0, tells);
    for (let i = 0; i < 5; i++) {
      tells.clear();
      observer.observe(both, 1 / 60, tells);
      expect(tells.has(TELL.turretDown)).toBe(false);
      expect(tells.has(TELL.buildComplete)).toBe(false);
    }

    // …and a turret that really is picked off still reports, from the memo, with
    // its owner intact — the sweep moved, the tell did not.
    tells.clear();
    observer.observe(world({ stations: [a, station({ id: 1, owner: 1, pos: { x: 800, y: 800 } })] }) as unknown as WorldView, 1 / 60, tells);
    expect(tells.count(TELL.turretDown)).toBe(1);
    expect(tells.player[tells.indexOf(TELL.turretDown)]).toBe(1);
    expect(tells.x[tells.indexOf(TELL.turretDown)]).toBeCloseTo(820, 5);
  });

  it('keeps one station\'s SHIELDS from collapsing another\'s, every frame, forever', () => {
    const bubble = (id: number) => ({ id, hp: 40, maxHp: 40, radius: 80 });
    const a = station({ id: 0, owner: 0, shields: [bubble(3)] });
    const b = station({ id: 1, owner: 1, pos: { x: 800, y: 800 }, shields: [bubble(4)] });
    const observer = new WorldObserver();
    const tells = new TellQueue();
    const both = world({ stations: [a, b] }) as unknown as WorldView;

    observer.observe(both, 0, tells);
    for (let i = 0; i < 5; i++) {
      tells.clear();
      observer.observe(both, 1 / 60, tells);
      expect(tells.has(TELL.shieldDown)).toBe(false);
      expect(tells.has(TELL.buildComplete)).toBe(false);
    }

    // A bubble that really pops still reports at ITS OWN station, not at
    // whichever one the loop happened to be holding when the sweep ran.
    tells.clear();
    observer.observe(world({ stations: [a, station({ id: 1, owner: 1, pos: { x: 800, y: 800 } })] }) as unknown as WorldView, 1 / 60, tells);
    expect(tells.count(TELL.shieldDown)).toBe(1);
    expect(tells.player[tells.indexOf(TELL.shieldDown)]).toBe(1);
    expect(tells.x[tells.indexOf(TELL.shieldDown)]).toBeCloseTo(800, 5);
  });

  it('shimmers a shield on damage and collapses it when the bubble goes', () => {
    const withShield = (hp: number) => station({ shields: [{ id: 3, hp, maxHp: 40, radius: 80 }] });
    const hit = diff(world({ stations: [withShield(40)] }), world({ stations: [withShield(28)] }));
    expect(magnitudeOf(hit, TELL.shieldHit)).toBeCloseTo(0.7, 5); // what is left

    const popped = diff(world({ stations: [withShield(4)] }), world({ stations: [station()] }));
    expect(popped.has(TELL.shieldDown)).toBe(true);
  });

  it('tells a turret shot landing from one that simply ran out of road', () => {
    const shot = (over: Record<string, unknown>) => ({ id: 1, active: true, pos: { x: 500, y: 500 }, vel: { x: 300, y: 0 }, damage: 4, life: 2, ...over });
    const hit = diff(world({ projectiles: [shot({})] }), world({ projectiles: [shot({ active: false })] }));
    expect(hit.has(TELL.shotImpact)).toBe(true);

    const expired = diff(
      world({ projectiles: [shot({ life: 0.001 })] }),
      world({ projectiles: [shot({ active: false, life: 0 })] }),
    );
    expect(expired.has(TELL.shotImpact)).toBe(false);

    const left = diff(
      world({ projectiles: [shot({ pos: { x: 999, y: 500 } })] }),
      world({ projectiles: [shot({ active: false, pos: { x: 1200, y: 500 } })] }),
    );
    expect(left.has(TELL.shotImpact)).toBe(false);
  });

  it('reads the clock: waves, collapse, and the end', () => {
    const at = (over: Record<string, unknown>) => world({ match: { phase: 'live', wavesSpawned: 1, winner: null, ...over } });

    const wave = diff(at({}), at({ wavesSpawned: 2 }));
    expect(magnitudeOf(wave, TELL.waveArrive)).toBeCloseTo(0.4, 5); // 2 of 5

    const collapse = diff(at({}), at({ phase: 'collapse' }));
    expect(collapse.has(TELL.collapseBegin)).toBe(true);

    const won = diff(at({}), at({ phase: 'ended', winner: 0 }), 1 / 60, 0);
    expect(magnitudeOf(won, TELL.matchEnd)).toBe(1);
    const lost = diff(at({}), at({ phase: 'ended', winner: 1 }), 1 / 60, 0);
    expect(magnitudeOf(lost, TELL.matchEnd)).toBe(0);
  });

  it('ends the match once, not every frame afterwards', () => {
    const observer = new WorldObserver({ local: 0 });
    const tells = new TellQueue();
    const live = world() as unknown as WorldView;
    const over = world({ match: { phase: 'ended', wavesSpawned: 5, winner: 0 } }) as unknown as WorldView;

    observer.observe(live, 0, tells);
    tells.clear();
    observer.observe(over, 1 / 60, tells);
    expect(tells.count(TELL.matchEnd)).toBe(1);
    tells.clear();
    observer.observe(over, 1 / 60, tells);
    expect(tells.has(TELL.matchEnd)).toBe(false);
  });

  it('forgets everything on reset, and primes again in silence', () => {
    const observer = new WorldObserver();
    const tells = new TellQueue();
    const alive = world({ ships: [ship()] }) as unknown as WorldView;
    observer.observe(alive, 0, tells);
    observer.reset();
    expect(observer.ready).toBe(false);
    tells.clear();
    observer.observe(world({ ships: [ship({ alive: false })] }) as unknown as WorldView, 1 / 60, tells);
    expect(tells.length).toBe(0);
  });
});
