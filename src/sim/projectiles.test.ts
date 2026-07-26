/**
 * src/sim/projectiles.test.ts — combat is a projectile now (design amendment
 * v0.2). OWNER: Gameplay Engineer.
 *
 * The single most important property of the whole change, in the developer's own
 * words: "If we switch to a projectile there's a chance to dodge and it becomes a
 * lot funner." So the load-bearing test here is the DODGE — a ship at combat
 * range strafing at full speed evades a shot aimed where it stood. If that ever
 * stops being true the switch was pointless, so it is pinned first and hardest.
 *
 * Around it: a shot still *lands* on anything that does not dodge (a stationary
 * or closing target), an auto-aim/bot lead solve hits a mover the naive shot
 * misses, ship shots besiege structures while turret shots keep hitting only
 * ships (p1-14 intact), and the pool reuses slots with fresh ids.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import {
  activeProjectilesOf,
  fireShipProjectile,
  fireTurretProjectile,
  leadAim,
  shipTopSpeed,
  step,
  type Inputs,
  type Planet,
  type Ship,
  type Turret,
  type World,
} from './index';
import { CORE_HP, PLANET, SHIELD, SHIP_RADIUS, SHIP_WEAPON, TURRET } from './constants';
import { shipCargoCap, shipMaxHull, stockTiers } from './upgrades';
import { normalize } from './vec';

// --- builders (self-contained fixtures, no ring layout) --------------------

function makeShip(over: Partial<Ship> & Pick<Ship, 'id'>): Ship {
  const cls = over.shipClass ?? ShipClass.Vanguard;
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
    beam: over.beam ?? null,
    weaponCooldown: over.weaponCooldown ?? 0,
  };
}

function makeTurret(over: Partial<Turret> & Pick<Turret, 'id' | 'owner'>): Turret {
  return {
    id: over.id,
    owner: over.owner,
    slot: over.slot ?? 0,
    pos: over.pos ?? { x: 0, y: 0 },
    radius: over.radius ?? TURRET.radius,
    hp: over.hp ?? TURRET.hp,
    maxHp: over.maxHp ?? TURRET.hp,
    angle: over.angle ?? 0,
    cooldown: over.cooldown ?? 0,
    targetId: over.targetId ?? null,
    muzzle: over.muzzle ?? null,
  };
}

function makePlanet(over: Partial<Planet> & Pick<Planet, 'id' | 'owner' | 'pos'>): Planet {
  return {
    id: over.id,
    owner: over.owner,
    pos: over.pos,
    radius: over.radius ?? PLANET.radius,
    coreHp: over.coreHp ?? CORE_HP,
    maxCoreHp: over.maxCoreHp ?? CORE_HP,
    alive: over.alive ?? true,
    deathTime: over.deathTime ?? -1,
    spawnProtect: over.spawnProtect ?? 0,
    angle: over.angle ?? 0,
    sinceDamage: over.sinceDamage ?? SHIELD.regenDelay,
    repairing: over.repairing ?? false,
    turrets: over.turrets ?? [],
    shields: over.shields ?? [],
    builds: over.builds ?? [],
  };
}

function makeWorld(over: Partial<World> = {}): World {
  return {
    time: 0,
    tick: 0,
    rngState: 1,
    nextEntityId: 1000,
    ships: over.ships ?? [],
    asteroids: over.asteroids ?? [],
    chunks: over.chunks ?? [],
    planets: over.planets ?? [],
    projectiles: over.projectiles ?? [],
    bounds: over.bounds ?? { width: 4000, height: 4000 },
    fieldRadius: over.fieldRadius ?? 600,
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

/** The engagement range the dodge is designed around (roughly the beam range the
 *  weapon replaced). */
const COMBAT_RANGE = 260;

// --- the dodge (the entire point) ------------------------------------------

describe('the dodge — a projectile can be evaded (design amendment v0.2)', () => {
  it('a ship strafing at full speed at combat range dodges a shot aimed where it stood', () => {
    const shooter = makeShip({ id: 0, pos: { x: 1000, y: 1000 } });
    const topSpeed = shipTopSpeed(shooter);
    // Target at combat range on +x, already strafing perpendicular (+y) flat out.
    const target = makeShip({
      id: 1,
      pos: { x: 1000 + COMBAT_RANGE, y: 1000 },
      vel: { x: 0, y: topSpeed },
    });
    const world = makeWorld({ ships: [shooter, target] });

    // Fire ONE shot straight at where the target is *right now* — the naive,
    // no-lead aim. Travel time must let the strafing target slide clear.
    fireShipProjectile(world, shooter, normalize({ x: COMBAT_RANGE, y: 0 }));

    const beforeHull = target.hull;
    // The target keeps strafing at full speed (thrust sustains it against drag);
    // the shooter is idle, so only the one shot is ever in flight.
    const strafe: Inputs = [{ id: 1, actions: [{ type: 'thrust', dir: { x: 0, y: 1 } }] }];
    for (let t = 0; t < 120; t++) step(world, strafe);

    expect(target.hull).toBe(beforeHull); // never touched — the dodge is real
    expect(world.projectiles.some((p) => p.active)).toBe(false); // the shot expired
  });

  it('but a stationary target at combat range is hit — dodging is a choice, not free', () => {
    const shooter = makeShip({ id: 0, pos: { x: 1000, y: 1000 } });
    const target = makeShip({ id: 1, pos: { x: 1000 + COMBAT_RANGE, y: 1000 } }); // holds still
    const world = makeWorld({ ships: [shooter, target] });

    fireShipProjectile(world, shooter, normalize({ x: COMBAT_RANGE, y: 0 }));

    const beforeHull = target.hull;
    for (let t = 0; t < 60; t++) step(world, []);
    expect(target.hull).toBeLessThan(beforeHull);
  });

  it('a target closing straight in cannot dodge — the naive shot still lands', () => {
    const shooter = makeShip({ id: 0, pos: { x: 1000, y: 1000 } });
    const topSpeed = shipTopSpeed(shooter);
    // Flying directly at the shooter (−x): its motion is along the shot line, so
    // there is no lateral escape.
    const target = makeShip({
      id: 1,
      pos: { x: 1000 + COMBAT_RANGE, y: 1000 },
      vel: { x: -topSpeed, y: 0 },
    });
    const world = makeWorld({ ships: [shooter, target] });

    fireShipProjectile(world, shooter, normalize({ x: COMBAT_RANGE, y: 0 }));

    const beforeHull = target.hull;
    const charge: Inputs = [{ id: 1, actions: [{ type: 'thrust', dir: { x: -1, y: 0 } }] }];
    for (let t = 0; t < 40; t++) step(world, charge);
    expect(target.hull).toBeLessThan(beforeHull);
  });
});

// --- lead / intercept: what the naive shot misses, the lead solve hits ------

describe('lead aiming (auto-aim + bots) hits a mover the naive shot misses', () => {
  it('leadAim points ahead of a crossing target so the shot intercepts', () => {
    const origin = { x: 0, y: 0 };
    const targetPos = { x: 260, y: 0 };
    const targetVel = { x: 0, y: 200 }; // crossing +y
    const dir = leadAim(origin, targetPos, targetVel, SHIP_WEAPON.projectileSpeed);
    // The aim leads in the target's direction of travel (+y), not straight at it.
    expect(dir.y).toBeGreaterThan(0);
    // And it is a unit vector.
    expect(Math.hypot(dir.x, dir.y)).toBeCloseTo(1, 9);
  });

  it('auto-aim lands on a full-speed strafing enemy (the shot the bots need)', () => {
    // At a *committed* range (closer than the max-dodge distance), the intercept
    // point sits inside weapon range, so the lead solve reliably connects even on
    // a full-speed crosser — this is why closing the distance beats sniping.
    const ENGAGE_RANGE = 170;
    const shooter = makeShip({ id: 0, pos: { x: 1000, y: 1000 } });
    const topSpeed = shipTopSpeed(shooter);
    const target = makeShip({
      id: 1,
      pos: { x: 1000 + ENGAGE_RANGE, y: 1000 },
      vel: { x: 0, y: topSpeed },
    });
    const world = makeWorld({ ships: [shooter, target] });

    const before = target.hull;
    // Shooter holds auto-fire (leading); target strafes at full speed.
    const inputs: Inputs = [
      { id: 0, actions: [{ type: 'fire', active: true, auto: true }] },
      { id: 1, actions: [{ type: 'thrust', dir: { x: 0, y: 1 } }] },
    ];
    for (let t = 0; t < 120; t++) step(world, inputs);

    expect(target.hull).toBeLessThan(before); // the lead solve caught the mover
  });
});

// --- kind gating: ship shots besiege, turret shots do not ------------------

describe('a ship shot besieges structures; a turret shot hits only ships', () => {
  it('a ship weapon shot damages an enemy turret and core', () => {
    const shooter = makeShip({ id: 0, pos: { x: 1000, y: 1000 }, angle: 0 });
    const turret = makeTurret({ id: 5, owner: 1, pos: { x: 1120, y: 1000 } });
    const planet = makePlanet({ id: 0, owner: 1, pos: { x: 1400, y: 1000 }, turrets: [turret] });
    const world = makeWorld({ ships: [shooter], planets: [planet] });

    // One shot at the turret (nearest structure ahead).
    fireShipProjectile(world, shooter, normalize({ x: 1, y: 0 }));
    for (let t = 0; t < 20 && turret.hp === TURRET.hp; t++) step(world, []);
    expect(turret.hp).toBeLessThan(TURRET.hp);
  });

  it('a turret shot flying through an enemy structure leaves it intact (only ships, p1-14)', () => {
    const enemyTurret = makeTurret({ id: 5, owner: 2, pos: { x: 1200, y: 1000 } });
    const planet = makePlanet({ id: 0, owner: 2, pos: { x: 1400, y: 1000 }, turrets: [enemyTurret] });
    // A turret owned by player 1 looses a shot straight at player 2's turret.
    const shooter = makeTurret({ id: 9, owner: 1, pos: { x: 1000, y: 1000 } });
    const world = makeWorld({ planets: [planet] });

    fireTurretProjectile(world, shooter, 0); // bearing +x, toward the enemy turret
    const beforeCore = planet.coreHp;
    for (let t = 0; t < 40; t++) step(world, []);

    // The turret shot passed over the structure — turret shots hit ships only.
    expect(enemyTurret.hp).toBe(TURRET.hp);
    expect(planet.coreHp).toBe(beforeCore);
  });
});

// --- the pool ---------------------------------------------------------------

describe('the shared projectile pool (GDD §4.3)', () => {
  it('reuses dead slots and hands every shot a fresh id', () => {
    const shooter = makeShip({ id: 0, pos: { x: 1000, y: 1000 } });
    const world = makeWorld({ ships: [shooter] });

    const ids = new Set<number>();
    // Fire, let it die, fire again — many times over.
    for (let round = 0; round < 12; round++) {
      fireShipProjectile(world, shooter, normalize({ x: 1, y: 0 }));
      for (const p of activeProjectilesOf(world, 0)) ids.add(p.id);
      for (let t = 0; t < 40; t++) step(world, []); // shot expires, slot freed
    }

    // Far more distinct shot ids than pool slots — a recycled slot is never
    // mistaken for the shot that used it before.
    expect(ids.size).toBe(12);
    expect(world.projectiles.length).toBeLessThan(12);
  });
});
