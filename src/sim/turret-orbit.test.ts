/**
 * src/sim/turret-orbit.test.ts — turrets orbit the planet rim toward the threat
 * (field report P1). A turret is no longer pinned to its build spot: it slides
 * along its planet's surface ring toward the point whose outward normal faces
 * its current target, and the whole design turns on the "don't go crazy" clause.
 *
 * The contract checks from the brief:
 *   1. converges to the facing-normal point for a single enemy;
 *   2. hysteresis holds the target against a marginally-closer newcomer, and
 *      still switches for a decisively-closer one;
 *   3. two equidistant enemies settle to a stable angle within N ticks and stay
 *      (no endless orbiting);
 *   4. the slide speed cap is never exceeded;
 *   5. determinism — same seed / same fixture, same trajectory;
 *   plus: multiple turrets on one planet keep an angular separation, and the
 *   turret's `pos` (sprite + muzzle origin) tracks the orbit angle.
 */

import { describe, it, expect } from 'vitest';
import { step, type Inputs } from './index';
import { turretHomeAngle, turretOrbitPos } from './buildings';
import { PLANET, SHIP_RADIUS, TICK_DT, TURRET } from './constants';
import { ShipClass } from '@shared/types';
import { stockTiers } from './upgrades';
import type { Planet, Ship, Turret, World } from './state';

// --- builders --------------------------------------------------------------
//
// Planets sit at the arena centre; everything is placed planet-relative so the
// bearing arithmetic reads directly. Enemies get a huge hull so a multi-second
// slide never resolves by the target simply dying under turret fire.

const CENTER = 2000;
const ORBIT_R = PLANET.radius + TURRET.mountOffset + TURRET.radius;

/** A turret mounted on `slot`, born on its home rim angle, ready to slide. */
function makeTurret(id: number, slot: number, planetAngle = 0): Turret {
  const home = turretHomeAngle({ angle: planetAngle } as Planet, slot);
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

function makePlanet(turrets: Turret[]): Planet {
  return {
    id: 0,
    owner: 0,
    pos: { x: CENTER, y: CENTER },
    radius: PLANET.radius,
    coreHp: 100,
    maxCoreHp: 100,
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

/** An enemy ship (slot != the turret owner's 0), parked at a rim bearing. */
function enemyAt(id: number, x: number, y: number): Ship {
  const loadout = { shipClass: ShipClass.Vanguard, tiers: stockTiers() };
  return {
    id,
    shipClass: ShipClass.Vanguard,
    tiers: loadout.tiers,
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
    firing: false,
  };
}

/** A world holding one planet's turrets against a set of enemy ships. Zero
 *  asteroids-per-wave so the metronome never drops rocks into the fixture. */
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
const turretOf = (w: World): Turret => w.planets[0]!.turrets[0]!;

// --- 1. converges to the facing-normal point -------------------------------

describe('single enemy: the turret slides to the facing-normal point', () => {
  it('converges its orbit angle to the bearing from the planet to the enemy', () => {
    // Enemy straight "up" from the planet centre — bearing +π/2. The turret is
    // born on slot 0 (home angle 0, the +x side of the rim), so it has a quarter
    // turn to slide.
    const turret = makeTurret(1, 0);
    const enemy = enemyAt(1, 0, 200);
    const world = makeWorld([turret], [enemy]);

    const bearing = Math.PI / 2;
    for (let t = 0; t < Math.round(4 / TICK_DT); t++) step(world, NO_INPUT);

    expect(Math.abs(angleDiff(turretOf(world).orbitAngle!, bearing))).toBeLessThan(1e-6);
  });

  it("the turret's pos (sprite + muzzle origin) tracks the orbit angle onto the rim", () => {
    const turret = makeTurret(1, 0);
    const world = makeWorld([turret], [enemyAt(1, 0, 200)]);
    for (let t = 0; t < Math.round(4 / TICK_DT); t++) step(world, NO_INPUT);

    const tt = turretOf(world);
    // pos sits on the rim at exactly orbitAngle — the point whose normal faces up.
    expect(tt.pos.x).toBeCloseTo(CENTER + Math.cos(tt.orbitAngle!) * ORBIT_R, 6);
    expect(tt.pos.y).toBeCloseTo(CENTER + Math.sin(tt.orbitAngle!) * ORBIT_R, 6);
    // And that point is the top of the rim, facing the enemy.
    expect(tt.pos.x).toBeCloseTo(CENTER, 4);
    expect(tt.pos.y).toBeCloseTo(CENTER + ORBIT_R, 4);
  });

  it('takes the short way around (never spins the long way)', () => {
    // Enemy just below +x (bearing slightly negative): the turret at home angle 0
    // must dip down a hair, not swing all the way around.
    const turret = makeTurret(1, 0);
    const world = makeWorld([turret], [enemyAt(1, 200, -30)]);
    const bearing = Math.atan2(-30, 200);
    for (let t = 0; t < Math.round(2 / TICK_DT); t++) step(world, NO_INPUT);
    const a = turretOf(world).orbitAngle!;
    expect(a).toBeLessThanOrEqual(1e-9); // moved to the negative side
    expect(Math.abs(angleDiff(a, bearing))).toBeLessThan(1e-6);
  });

  it('drifts back to its home mount angle once the enemy leaves', () => {
    const turret = makeTurret(1, 0);
    const enemy = enemyAt(1, 0, 200);
    const world = makeWorld([turret], [enemy]);
    for (let t = 0; t < Math.round(4 / TICK_DT); t++) step(world, NO_INPUT);
    expect(turretOf(world).orbitAngle!).toBeCloseTo(Math.PI / 2, 5);

    // Enemy gone: the turret slides back to home angle 0 (slot 0).
    enemy.alive = false;
    for (let t = 0; t < Math.round(4 / TICK_DT); t++) step(world, NO_INPUT);
    expect(Math.abs(angleDiff(turretOf(world).orbitAngle!, 0))).toBeLessThan(1e-6);
  });
});

// --- 2. hysteresis ---------------------------------------------------------

describe('hysteresis holds the target (the "don\'t go crazy" clause)', () => {
  // The turret is born on slot 0's home point, the +x side of the rim
  // (≈ ORBIT_R out along +x). Enemies below sit along +x too, so the turret's
  // desired bearing stays ~0 and it does not slide — distances are then measured
  // cleanly from a stationary turret, exactly what a hysteresis test wants.
  const rimX = ORBIT_R; // turret's x offset from the planet centre at home angle 0

  it('keeps its target against a newcomer that is only marginally closer', () => {
    // Current target A is 150 out from the turret; newcomer B is 140 out — ~7%
    // closer, well inside the 25% hysteresis, so the turret must not defect.
    const turret = makeTurret(1, 0);
    const a = enemyAt(1, rimX + 150, 0);
    const world = makeWorld([turret], [a]);
    step(world, NO_INPUT);
    expect(turretOf(world).targetId).toBe(1);

    const b = enemyAt(2, rimX + 140, 0);
    world.ships.push(b);
    for (let t = 0; t < 60; t++) step(world, NO_INPUT);
    expect(turretOf(world).targetId).toBe(1); // still A
  });

  it('switches to a newcomer that is decisively (>25%) closer', () => {
    const turret = makeTurret(1, 0);
    const a = enemyAt(1, rimX + 150, 0);
    const world = makeWorld([turret], [a]);
    step(world, NO_INPUT);
    expect(turretOf(world).targetId).toBe(1);

    // B is 60 out — under half A's 150 distance from the turret, decisively closer.
    const b = enemyAt(2, rimX + 60, 0);
    world.ships.push(b);
    step(world, NO_INPUT);
    expect(turretOf(world).targetId).toBe(2);
  });

  it('gives up a target that dies or leaves range and re-acquires', () => {
    // A is the nearest (100 out along +x); B is farther (200 out, up the rim).
    const turret = makeTurret(1, 0);
    const a = enemyAt(1, rimX + 100, 0);
    const b = enemyAt(2, rimX, 200);
    const world = makeWorld([turret], [a, b]);
    step(world, NO_INPUT);
    expect(turretOf(world).targetId).toBe(1);

    a.alive = false; // A dies → the turret falls through to B, still in range
    step(world, NO_INPUT);
    expect(turretOf(world).targetId).toBe(2);
  });
});

// --- 3. two equidistant enemies settle -------------------------------------

describe('two equidistant enemies: the turret settles, never orbits', () => {
  it('picks one, settles to a stable angle within N ticks, and stays', () => {
    // A and B are mirror images across the +x axis, both 160 out — exactly
    // equidistant from a turret born at home angle 0.
    const turret = makeTurret(1, 0);
    const a = enemyAt(1, 150, 60);
    const b = enemyAt(2, 150, -60);
    const world = makeWorld([turret], [a, b]);

    const N = Math.round(3 / TICK_DT);
    for (let t = 0; t < N; t++) step(world, NO_INPUT);

    const settled = turretOf(world).orbitAngle!;
    const targetHeld = turretOf(world).targetId;
    expect(targetHeld).not.toBeNull();

    // Run well past settling: the angle must not wander by more than a slide step.
    let maxDrift = 0;
    for (let t = 0; t < Math.round(5 / TICK_DT); t++) {
      const before = turretOf(world).orbitAngle!;
      step(world, NO_INPUT);
      maxDrift = Math.max(maxDrift, Math.abs(angleDiff(turretOf(world).orbitAngle!, before)));
      // And it never abandons the enemy it settled on — no flapping.
      expect(turretOf(world).targetId).toBe(targetHeld);
    }
    expect(Math.abs(angleDiff(turretOf(world).orbitAngle!, settled))).toBeLessThan(1e-6);
    expect(maxDrift).toBeLessThan(1e-9);
  });

  it('does not oscillate while converging (monotone approach to its pick)', () => {
    const turret = makeTurret(1, 0);
    const a = enemyAt(1, 150, 60);
    const b = enemyAt(2, 150, -60);
    const world = makeWorld([turret], [a, b]);

    // Sign of the per-tick step must never flip: a glide, not a wobble.
    let sign = 0;
    for (let t = 0; t < Math.round(3 / TICK_DT); t++) {
      const before = turretOf(world).orbitAngle!;
      step(world, NO_INPUT);
      const d = angleDiff(turretOf(world).orbitAngle!, before);
      if (Math.abs(d) < 1e-12) continue;
      const s = Math.sign(d);
      if (sign === 0) sign = s;
      else expect(s).toBe(sign);
    }
  });
});

// --- 4. slide speed cap ----------------------------------------------------

describe('the slide speed cap is never exceeded', () => {
  it('moves at most TURRET.orbitSpeed * dt radians per tick, all match long', () => {
    // A hard case: enemy on the far side of the rim (bearing ≈ π), so the turret
    // has the maximum possible slide to make.
    const turret = makeTurret(1, 0);
    const enemy = enemyAt(1, -220, 8); // just off the -x axis, inside range
    const world = makeWorld([turret], [enemy]);

    const cap = TURRET.orbitSpeed * TICK_DT + 1e-9;
    for (let t = 0; t < Math.round(6 / TICK_DT); t++) {
      const before = turretOf(world).orbitAngle!;
      step(world, NO_INPUT);
      expect(Math.abs(angleDiff(turretOf(world).orbitAngle!, before))).toBeLessThanOrEqual(cap);
    }
  });
});

// --- 5. determinism --------------------------------------------------------

describe('determinism (GDD §4.8)', () => {
  it('same fixture, same trajectory — orbit angle, pos, and target all match', () => {
    const build = () => {
      const t = makeTurret(1, 0);
      return makeWorld([t], [enemyAt(1, 120, 90), enemyAt(2, -100, 40)]);
    };
    const a = build();
    const b = build();

    const trajA: number[] = [];
    const trajB: number[] = [];
    for (let t = 0; t < Math.round(5 / TICK_DT); t++) {
      step(a, NO_INPUT);
      step(b, NO_INPUT);
      trajA.push(turretOf(a).orbitAngle!);
      trajB.push(turretOf(b).orbitAngle!);
    }
    expect(trajA).toEqual(trajB);
    // Full end-state agreement, not just the angle.
    expect(JSON.stringify(a.planets)).toBe(JSON.stringify(b.planets));
  });
});

// --- 6. multiple turrets keep an angular separation ------------------------

describe('two turrets on one planet fan out instead of stacking (§3)', () => {
  it('holds an angular gap when both slide toward the same enemy', () => {
    // Two turrets, one enemy. Both want the same bearing; the fan must keep them
    // apart by about TURRET.orbitSeparation rather than landing on one point.
    const t0 = makeTurret(1, 0);
    const t1 = makeTurret(2, 1);
    const world = makeWorld([t0, t1], [enemyAt(1, 0, 200)]);

    for (let t = 0; t < Math.round(4 / TICK_DT); t++) step(world, NO_INPUT);

    const [a0, a1] = world.planets[0]!.turrets.map((t) => t.orbitAngle!);
    const gap = Math.abs(angleDiff(a0!, a1!));
    expect(gap).toBeGreaterThan(TURRET.orbitSeparation - 1e-6);
    // Symmetric about the bearing (+π/2): the pair straddles the facing normal.
    const mid = (a0! + a1!) / 2;
    expect(Math.abs(angleDiff(mid, Math.PI / 2))).toBeLessThan(1e-6);
    // Distinct rim points — never the same spot.
    expect(gap).toBeGreaterThan(0.1);
  });

  it('is stable — once fanned and settled the pair stops moving', () => {
    const world = makeWorld([makeTurret(1, 0), makeTurret(2, 1)], [enemyAt(1, 0, 200)]);
    for (let t = 0; t < Math.round(4 / TICK_DT); t++) step(world, NO_INPUT);
    const snap = world.planets[0]!.turrets.map((t) => t.orbitAngle!);
    for (let t = 0; t < Math.round(3 / TICK_DT); t++) step(world, NO_INPUT);
    const after = world.planets[0]!.turrets.map((t) => t.orbitAngle!);
    for (let i = 0; i < snap.length; i++) expect(Math.abs(angleDiff(after[i]!, snap[i]!))).toBeLessThan(1e-6);
  });
});

// A guard so an accidental retune of the slide cap to something teleport-fast is
// caught here rather than as a mystery in a golden scene: the cap is a real cap.
describe('the slide is a glide, not a teleport', () => {
  it('takes more than a handful of ticks to cross a quarter turn', () => {
    const world = makeWorld([makeTurret(1, 0)], [enemyAt(1, 0, 200)]);
    let ticks = 0;
    while (Math.abs(angleDiff(turretOf(world).orbitAngle!, Math.PI / 2)) > 1e-4 && ticks < 10000) {
      step(world, NO_INPUT);
      ticks++;
    }
    // Quarter turn at the capped rate is ~ (π/2)/orbitSpeed seconds of ticks.
    const expected = Math.PI / 2 / TURRET.orbitSpeed / TICK_DT;
    expect(ticks).toBeGreaterThan(expected * 0.5);
  });
});
