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
import { createWorld, shipTopSpeed, step, type World } from '../../sim';
import { IMPACT, TELL, TELL_NAMES, TellQueue } from '../tells';
import { REPAIR_PULSE_S, SPAWN_PULSE_S, THRUST_DEADZONE, WorldObserver, type WorldView } from './observer';

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
    for (const key of ['id', 'pos', 'vel', 'angle', 'radius', 'alive', 'hull', 'maxHull', 'cargo', 'cargoCap', 'banked', 'spawnProtect', 'tiers', 'firing', 'thrust']) {
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
    thrust: 0,
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

  it('reads the throttle the sim applied, and puts the exhaust behind the hull', () => {
    const moving = ship({ thrust: 1 });
    const tells = diff(world({ ships: [ship()] }), world({ ships: [moving] }));
    // Full stick reads as full throttle — no reference constant in between.
    expect(magnitudeOf(tells, TELL.thrust)).toBeCloseTo(1, 5);
    // And the exhaust leaves from behind the hull, pointing backwards.
    const i = tells.indexOf(TELL.thrust);
    expect(tells.x[i]).toBeCloseTo(100 - 12, 5);
    expect(tells.angle[i]).toBeCloseTo(Math.PI, 5);
  });

  it('carries a part-open throttle through, so easing off thins the trail', () => {
    // The emitter sizes count, speed, lifetime and alpha off this magnitude
    // (`./emitters` thrusterTrail), so a half-open stick must arrive as a half —
    // not as a 1 the moment it clears the deadzone.
    const half = diff(world({ ships: [ship()] }), world({ ships: [ship({ thrust: 0.5 })] }));
    expect(magnitudeOf(half, TELL.thrust)).toBeCloseTo(0.5, 5);
    // The deadzone is the trail's only remaining tuning: a stick this close to
    // rest is a thumb leaving it, not an engine.
    const nudge = diff(world({ ships: [ship()] }), world({ ships: [ship({ thrust: THRUST_DEADZONE / 2 })] }));
    expect(nudge.has(TELL.thrust)).toBe(false);
    const open = diff(world({ ships: [ship()] }), world({ ships: [ship({ thrust: THRUST_DEADZONE })] }));
    expect(open.has(TELL.thrust)).toBe(true);
  });

  it('still thrusting at top speed', () => {
    // The a0-47 report: *"the ship's rocket and trails only appear when he's
    // fully stopped and goes to move, but then it stops like after 1 second."*
    // At top speed thrust and drag cancel EXACTLY — that is what top speed is —
    // so a throttle inferred from acceleration reads zero at the one moment the
    // engine is working hardest. Driven through the real sim, at full stick,
    // held until the velocity has plateaued.
    const arena = createWorld({
      seed: 20260814,
      players: [{ id: 0, shipClass: ShipClass.Vanguard }],
      bounds: { width: 4000, height: 4000 },
      asteroidCount: 0,
    });
    const flier = arena.ships[0]!;
    // Aim the run at the arena centre so 4 s of flight cannot reach a wall.
    const cx = 2000 - flier.pos.x;
    const cy = 2000 - flier.pos.y;
    const l = Math.hypot(cx, cy) || 1;
    const inputs = [{ id: 0, actions: [{ type: 'thrust' as const, dir: { x: cx / l, y: cy / l } }] }];

    for (let tick = 0; tick < 240; tick++) step(arena, inputs, 1 / 60);

    // Precondition: the engine is at full stretch and the acceleration it buys
    // is gone — the exact state the old inference read as "coasting".
    expect(Math.hypot(flier.vel.x, flier.vel.y)).toBeCloseTo(shipTopSpeed(flier), 3);
    const was = { x: flier.vel.x, y: flier.vel.y };
    step(arena, inputs, 1 / 60);
    expect(Math.hypot(flier.vel.x - was.x, flier.vel.y - was.y) * 60).toBeLessThan(1);

    // Two consecutive frames at top speed, both of which must trail.
    const observer = new WorldObserver({ local: 0 });
    const tells = new TellQueue();
    observer.observe(arena, 1 / 60, tells); // primes, silent
    for (const frame of [1, 2]) {
      step(arena, inputs, 1 / 60);
      tells.clear();
      observer.observe(arena, 1 / 60, tells);
      expect(tells.has(TELL.thrust), `frame ${frame} at top speed`).toBe(true);
      expect(magnitudeOf(tells, TELL.thrust)).toBeCloseTo(1, 5);
    }
  });

  it('a coasting ship at top speed with zero intent emits nothing', () => {
    // The negative half of the pair above (LESSONS §26): either test alone is
    // satisfied by an always-on (or always-off) trail; together they pin it.
    const coasting = ship({ vel: { x: 300, y: 0 }, thrust: 0 });
    const observer = new WorldObserver();
    const tells = new TellQueue();
    const frame = world({ ships: [coasting] }) as unknown as WorldView;
    observer.observe(frame, 1 / 60, tells);
    for (const n of [1, 2]) {
      tells.clear();
      observer.observe(frame, 1 / 60, tells);
      expect(tells.has(TELL.thrust), `coasting frame ${n}`).toBe(false);
    }
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

  it('tells a shot landing on a hull from one landing on rock, a shield, or a station', () => {
    // a0-68. *"none of these sound like impact sounds, they should also be
    // different depending on the thing that was hit..."* — so the tell carries
    // the surface, derived here, in the one place both the VFX and the audio read
    // and the one that runs the same on a predicted world as on a snapshot.
    //
    // The order is `src/sim/projectiles.ts` resolveHit's order, and these cases
    // are its branches.
    const shot = (over: Record<string, unknown> = {}) => ({
      id: 1,
      active: true,
      pos: { x: 200, y: 200 },
      vel: { x: 300, y: 0 },
      damage: 4,
      life: 2,
      ...over,
    });
    const landed = (at: { x: number; y: number }, rest: Partial<Mutable>) =>
      diff(
        world({ ...rest, projectiles: [shot({ pos: at })] }),
        world({ ...rest, projectiles: [shot({ pos: at, active: false })] }),
      );
    const surfaceOf = (tells: TellQueue): number => {
      const i = tells.indexOf(TELL.shotImpact);
      expect(i, 'no shotImpact tell').toBeGreaterThanOrEqual(0);
      return tells.variantAt(i);
    };

    // Nothing there: rock is the fall-through, as it has been since `hitsHull`.
    expect(surfaceOf(landed({ x: 200, y: 200 }, {}))).toBe(IMPACT.rock);

    // A hull.
    const hull = landed({ x: 300, y: 300 }, { ships: [ship({ id: 3, pos: { x: 300, y: 300 } })] });
    expect(surfaceOf(hull)).toBe(IMPACT.hull);

    // An asteroid, stated rather than inferred from the fall-through.
    const rock = landed({ x: 700, y: 120 }, {
      asteroids: [{ id: 9, pos: { x: 700, y: 120 }, radius: 30, ore: 40, crackStage: 0 }],
    });
    expect(surfaceOf(rock)).toBe(IMPACT.rock);

    // A turret, a satellite and a bare core all read as anchored station metal —
    // the fold is a decision (`IMPACT_OF`), so it is asserted rather than assumed.
    const turret = landed({ x: 560, y: 500 }, {
      stations: [station({ turrets: [{ id: 7, pos: { x: 560, y: 500 }, radius: 10, angle: 0, cooldown: 0, hp: 30 }] })],
    });
    expect(surfaceOf(turret)).toBe(IMPACT.station);

    const satellite = landed({ x: 620, y: 500 }, {
      stations: [station({ satellites: [{ id: 8, pos: { x: 620, y: 500 }, radius: 8, hp: 20 }] })],
    });
    expect(surfaceOf(satellite)).toBe(IMPACT.station);

    expect(surfaceOf(landed({ x: 500, y: 500 }, { stations: [station()] }))).toBe(IMPACT.station);

    // A live bubble stands in front of the core and eats the whole hit
    // (`damageStation` spends it on shields before the core sees any).
    const shielded = landed({ x: 500, y: 500 }, {
      stations: [station({ shields: [{ id: 5, hp: 40, maxHp: 40, radius: 90 }] })],
    });
    expect(surfaceOf(shielded)).toBe(IMPACT.shield);

    // A DEAD bubble does not: the round reached the metal.
    const popped = landed({ x: 500, y: 500 }, {
      stations: [station({ shields: [{ id: 5, hp: 0, maxHp: 40, radius: 90 }] })],
    });
    expect(surfaceOf(popped)).toBe(IMPACT.station);

    // "You cannot shoot through things" — resolveHit tests rock BEFORE structures,
    // so a rock sitting over a station's footprint eats the shot bound for it.
    const covered = landed({ x: 500, y: 500 }, {
      stations: [station()],
      asteroids: [{ id: 9, pos: { x: 500, y: 500 }, radius: 30, ore: 40, crackStage: 0 }],
    });
    expect(surfaceOf(covered)).toBe(IMPACT.rock);
  });

  it('calls the killing blow a HULL hit, not a shot into stone', () => {
    // The frame-boundary case that made `ShipMemo.hullFrame` necessary, and the
    // reason it is not defensive coding: `resolveHit` only strikes a LIVE ship, so
    // this IS a hull hit — but the observer is looking at a world in which the
    // hull is already dead, a geometric scan skips it, and the impact falls
    // through to the default surface. The shot that kills somebody would have
    // sounded like a shot into rock.
    const shot = (over: Record<string, unknown> = {}) => ({
      id: 1,
      active: true,
      pos: { x: 300, y: 300 },
      vel: { x: 300, y: 0 },
      damage: 9,
      life: 2,
      ...over,
    });
    const tells = diff(
      world({ ships: [ship({ id: 3, pos: { x: 300, y: 300 }, alive: true })], projectiles: [shot()] }),
      world({
        ships: [ship({ id: 3, pos: { x: 300, y: 300 }, alive: false, hull: 0 })],
        projectiles: [shot({ active: false })],
      }),
    );
    const i = tells.indexOf(TELL.shotImpact);
    expect(i, 'no shotImpact tell').toBeGreaterThanOrEqual(0);
    expect(tells.variantAt(i)).toBe(IMPACT.hull);
    // …and the death itself still sounds, in the same frame.
    expect(tells.has(TELL.shipExplode)).toBe(true);
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
