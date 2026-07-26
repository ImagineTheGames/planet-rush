/**
 * tests/sim/turret-coverage.test.ts — turrets cover the WHOLE planet, not just
 * the arc they happen to be sitting in. OWNER: Gameplay Engineer (field report
 * v0.1.3; GDD §2.6).
 *
 * The bug, verbatim: "another enemy came on the other side of the planet and the
 * turret didn't engage." A turret fought one attacker and ignored a second on
 * the planet's far side. Root cause against the p1-03 orbit rules — threat
 * detection was measured from the turret's *current* rim spot, so anything
 * outside beam range of where it happened to be sitting was invisible, even
 * though the whole point of orbiting is to slide around and reach it.
 *
 * These pins hold the fix, one field-report clause each:
 *   §1 detection is PLANET-centric — a far-side enemy inside the planet's threat
 *      radius is a target even outside beam range of the turret's current spot;
 *   §2 the turret slides to the facing-normal point (clear line of sight) and the
 *      damage actually lands — the exact field scenario, end to end;
 *   §3 retarget is immediate (zero idle ticks after a target dies), and an enemy
 *      actively beaming the core outranks a merely-closer loiterer;
 *   §4 two turrets, two attackers on opposite sides → one turret each, not both
 *      stacking on one;
 *   plus determinism, and the p1-03 no-thrash stability guarantee still green.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import {
  BEAM_RANGE,
  PLANET,
  SHIP_RADIUS,
  TICK_DT,
  TURRET,
  planetThreatRadius,
  step,
  stockTiers,
  turretHomeAngle,
  turretOrbitPos,
  type Inputs,
  type Planet,
  type Ship,
  type Turret,
  type World,
} from '../../src/sim';

// --- builders --------------------------------------------------------------
//
// One planet at the arena centre; everything is placed planet-relative so the
// bearing arithmetic reads straight off the numbers. Enemies get a huge hull so
// a multi-second slide never resolves by the target simply dying under fire.

const CENTER = 2000;

/** A sliding turret mounted on `slot`, born on its home rim angle. */
function makeTurret(id: number, slot: number): Turret {
  const home = turretHomeAngle({ angle: 0 } as Planet, slot);
  const pos = turretOrbitPos({ pos: { x: CENTER, y: CENTER }, radius: PLANET.radius } as Planet, home);
  return {
    id,
    owner: 0,
    slot,
    pos: { x: pos.x, y: pos.y },
    radius: TURRET.radius,
    hp: TURRET.hp,
    maxHp: TURRET.hp,
    angle: home,
    orbitAngle: home,
    cooldown: 0,
    targetId: null,
    muzzle: null,
  };
}

/** A planet owned by slot 0, its core deep enough to outlast any test. */
function makePlanet(turrets: Turret[]): Planet {
  return {
    id: 0,
    owner: 0,
    pos: { x: CENTER, y: CENTER },
    radius: PLANET.radius,
    coreHp: 1e6,
    maxCoreHp: 1e6,
    alive: true,
    deathTime: -1,
    spawnProtect: 0,
    angle: 0,
    sinceDamage: 100,
    repairing: false,
    turrets,
    shields: [],
    builds: [],
  };
}

/** An enemy ship (id != 0, the planet owner) parked at a planet-relative point. */
function enemyAt(id: number, x: number, y: number): Ship {
  return {
    id,
    shipClass: ShipClass.Vanguard,
    tiers: stockTiers(),
    pos: { x: CENTER + x, y: CENTER + y },
    vel: { x: 0, y: 0 },
    home: { x: CENTER + x, y: CENTER + y },
    angle: 0,
    hull: 1e6,
    maxHull: 1e6,
    cargo: 0,
    cargoCap: 2,
    banked: 0,
    alive: true,
    respawnTimer: 0,
    spawnProtect: 0,
    eliminated: false,
    radius: SHIP_RADIUS,
    beam: null,
  };
}

/** A world of one planet's turrets against a set of enemy ships. Zero rocks per
 *  wave so the metronome never drops asteroids into the fixture. */
function makeWorld(turrets: Turret[], enemies: Ship[]): World {
  return {
    time: 0,
    tick: 0,
    rngState: 1,
    nextEntityId: 1000,
    ships: enemies,
    asteroids: [],
    chunks: [],
    planets: [makePlanet(turrets)],
    projectiles: [],
    bounds: { width: 2 * CENTER, height: 2 * CENTER },
    fieldRadius: 600,
    asteroidsPerWave: 0,
    match: { phase: 'live', wavesSpawned: 0, collapseTime: -1, eliminated: [], winner: null, endTime: -1 },
  };
}

/** Shortest signed distance between two angles, in (-π, π]. */
function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

const NO_INPUT: Inputs = [];
const planetOf = (w: World): Planet => w.planets[0]!;
const turretsOf = (w: World): Turret[] => w.planets[0]!.turrets;
const shipById = (w: World, id: number): Ship => w.ships.find((s) => s.id === id)!;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

// --- §1/§2: the exact field scenario ---------------------------------------

describe('a far-side attacker is engaged: slides, clears the planet, damage lands', () => {
  it('detects a threat inside the planet radius even outside the turret spot range (§1)', () => {
    // Turret born on slot 0's home (the +x rim). Enemy on the FAR side (−x), well
    // inside the planet threat radius but beyond beam range of where the turret
    // currently sits — the turret-centric scan the field report indicts would
    // never see it.
    const turret = makeTurret(1, 0);
    const enemy = enemyAt(1, -250, 0);
    const world = makeWorld([turret], [enemy]);

    // Precondition: the enemy really is out of beam range of the turret's spot…
    expect(dist(turret.pos, enemy.pos)).toBeGreaterThan(TURRET.range);
    // …yet inside the planet's threat radius, which is what a turret can slide to.
    expect(dist(planetOf(world).pos, enemy.pos)).toBeLessThan(planetThreatRadius(planetOf(world)));

    step(world, NO_INPUT);
    // Engaged this tick, not ignored — the whole point of the fix.
    expect(turretsOf(world)[0]!.targetId).toBe(1);
  });

  it('slides to the facing normal (LOS clear) and lands damage on the far-side enemy (§2)', () => {
    const turret = makeTurret(1, 0);
    const enemy = enemyAt(1, -250, 0);
    const world = makeWorld([turret], [enemy]);
    const startHull = enemy.hull;

    for (let t = 0; t < Math.round(6 / TICK_DT); t++) step(world, NO_INPUT);

    const tt = turretsOf(world)[0]!;
    // The turret has slid around to the enemy's bearing (−x, π) — the facing
    // normal, the rim point with clear line of sight to the far side.
    expect(Math.abs(angleDiff(tt.orbitAngle!, Math.PI))).toBeLessThan(1e-3);
    // It stands on the same side as the enemy, the planet body no longer between
    // them (turret at −ORBIT_R, enemy at −250, planet centred at 0).
    expect(tt.pos.x).toBeLessThan(CENTER);
    // And the damage actually landed: the field report's "didn't engage" is now
    // "engaged and hurt it."
    expect(shipById(world, 1).hull).toBeLessThan(startHull);
  });
});

// --- §3: immediate retarget, and attacker-over-loiterer priority -----------

describe('retarget is immediate and threat-ranked (§3)', () => {
  it('re-acquires the same tick a target dies — zero idle gap', () => {
    // A is the nearer of two in-range enemies, so it is picked first; B waits.
    const turret = makeTurret(1, 0);
    const a = enemyAt(1, 150, 0);
    const b = enemyAt(2, 175, 0);
    const world = makeWorld([turret], [a, b]);

    step(world, NO_INPUT);
    expect(turretsOf(world)[0]!.targetId).toBe(1);

    // A dies. The very next step must land on B — never a tick of null between.
    shipById(world, 1).alive = false;
    step(world, NO_INPUT);
    expect(turretsOf(world)[0]!.targetId).toBe(2);
  });

  it('prioritises an enemy beaming the core over a closer loiterer', () => {
    // Loiterer parked close on the +x side (100 out). Attacker farther out on the
    // −x side (200 out) but actively auto-beaming the core. Threat beats distance.
    const turret = makeTurret(10, 0);
    const loiterer = enemyAt(2, 100, 0);
    const attacker = enemyAt(1, -200, 0);
    const world = makeWorld([turret], [attacker, loiterer]);

    // The attacker is inside beam range of the core and the core is its nearest
    // target, so auto-aim puts its beam on the core.
    expect(dist(attacker.pos, planetOf(world).pos)).toBeLessThan(BEAM_RANGE);

    const fire: Inputs = [{ id: 1, actions: [{ type: 'fire', active: true, auto: true }] }];
    step(world, fire);

    // The nearer loiterer (100) is ignored for the farther attacker (200) that is
    // shooting the core.
    expect(turretsOf(world)[0]!.targetId).toBe(1);
  });

  it('breaks a locked loiterer the instant an attacker opens up on the core (priority is not hysteresis)', () => {
    // The turret first settles on the near loiterer with nobody shooting. Then a
    // farther enemy opens fire on the core: threat outranks the held pick at
    // once, no 25% hysteresis margin required — the whole point of §3.
    const turret = makeTurret(10, 0);
    const loiterer = enemyAt(2, 100, 0);
    const attacker = enemyAt(1, -200, 0);
    const world = makeWorld([turret], [attacker, loiterer]);

    // Quiet phase: nobody fires, so the turret locks the nearer loiterer.
    for (let t = 0; t < 10; t++) step(world, NO_INPUT);
    expect(turretsOf(world)[0]!.targetId).toBe(2);

    // The attacker opens fire on the core. One step, and the turret drops the
    // loiterer it was holding for the ship shooting the core.
    const fire: Inputs = [{ id: 1, actions: [{ type: 'fire', active: true, auto: true }] }];
    step(world, fire);
    expect(turretsOf(world)[0]!.targetId).toBe(1);
  });
});

// --- §4: two turrets split two attackers -----------------------------------

describe('two turrets, two attackers on opposite sides → one each (§4)', () => {
  it('splits the pair instead of stacking both on one', () => {
    // Turrets on slots 0 (+x home) and 1 (+y home). Enemies due east and due
    // west, exactly equidistant from the core, so nothing but the split rule
    // decides who covers whom.
    const world = makeWorld(
      [makeTurret(10, 0), makeTurret(11, 1)],
      [enemyAt(1, 200, 0), enemyAt(2, -200, 0)],
    );

    for (let t = 0; t < Math.round(4 / TICK_DT); t++) step(world, NO_INPUT);

    const [t0, t1] = turretsOf(world);
    // Distinct targets — the pair is divided, not doubled up.
    expect(t0!.targetId).not.toBeNull();
    expect(t1!.targetId).not.toBeNull();
    expect(t0!.targetId).not.toBe(t1!.targetId);
    // Both enemies are engaged: the two ids together are exactly {1, 2}.
    expect([t0!.targetId, t1!.targetId].sort()).toEqual([1, 2]);
    // And they sit on opposite sides of the rim — one east (~0), one west (~π).
    const gap = Math.abs(angleDiff(t0!.orbitAngle!, t1!.orbitAngle!));
    expect(gap).toBeGreaterThan(Math.PI - 1e-2);
  });

  it('the split is stable — no thrash once each turret has its side (p1-03)', () => {
    const world = makeWorld(
      [makeTurret(10, 0), makeTurret(11, 1)],
      [enemyAt(1, 200, 0), enemyAt(2, -200, 0)],
    );
    for (let t = 0; t < Math.round(4 / TICK_DT); t++) step(world, NO_INPUT);

    const targets = turretsOf(world).map((t) => t.targetId);
    const angles = turretsOf(world).map((t) => t.orbitAngle!);
    for (let t = 0; t < Math.round(4 / TICK_DT); t++) {
      step(world, NO_INPUT);
      const now = turretsOf(world);
      // Neither the assignment nor the settled angle wanders — a glide, not a
      // tug-of-war between the sticky pick and the split.
      expect(now.map((t) => t.targetId)).toEqual(targets);
      for (let i = 0; i < now.length; i++) {
        expect(Math.abs(angleDiff(now[i]!.orbitAngle!, angles[i]!))).toBeLessThan(1e-6);
      }
    }
  });
});

// --- determinism (GDD §4.8) ------------------------------------------------

describe('determinism (GDD §4.8)', () => {
  it('same fixture, same trajectory — split, angles, targets, hulls all match', () => {
    const build = () =>
      makeWorld(
        [makeTurret(10, 0), makeTurret(11, 1)],
        [enemyAt(1, 220, 30), enemyAt(2, -210, -40)],
      );
    const a = build();
    const b = build();

    for (let t = 0; t < Math.round(5 / TICK_DT); t++) {
      step(a, NO_INPUT);
      step(b, NO_INPUT);
    }
    // Full end-state agreement — planets (turret angles + targets) and ships.
    expect(JSON.stringify(a.planets)).toBe(JSON.stringify(b.planets));
    expect(JSON.stringify(a.ships)).toBe(JSON.stringify(b.ships));
  });
});
