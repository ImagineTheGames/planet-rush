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
import { ShipClass, UpgradeTrack } from '@shared/types';
import {
  activeProjectilesOf,
  fireShipProjectile,
  fireTurretProjectile,
  leadAim,
  shipTopSpeed,
  step,
  type Inputs,
  type MiningStation,
  type Ship,
  type Turret,
  type World,
} from './index';
import { CORE_HP, STATION, SHIELD, SHIP_RADIUS, SHIP_WEAPON, TURRET } from './constants';
import {
  maxTier,
  shipCargoCap,
  shipMaxHull,
  shipProjectileSpeed,
  shipWeaponDamage,
  stockTiers,
} from './upgrades';
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
    firing: over.firing ?? false,
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

function makeStation(over: Partial<MiningStation> & Pick<MiningStation, 'id' | 'owner' | 'pos'>): MiningStation {
  return {
    id: over.id,
    owner: over.owner,
    pos: over.pos,
    radius: over.radius ?? STATION.radius,
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
    stations: over.stations ?? [],
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

/** The engagement range the dodge is designed around (roughly the hitscan reach
 *  the projectile weapon replaced). */
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
    // a full-speed crosser — this is why closing the distance beats a long poke.
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

// --- field report v0.2.4: the player's auto-aim leads an ORBITER ------------
//
// "Same issue with my auto targeting… if an enemy is orbiting around my station I
// can never hit him." An orbit is the hardest case for a *linear* intercept: the
// target's velocity direction turns every tick, so a lead solved this frame is
// already stale by impact. The design's answer is not a fancier solver but a
// COMMITTED range — close in and the travel time (and so the arc the target
// slips through) shrinks until the linear lead lands near-certainly. This pins
// that the player's auto-fire — the third consumer of the ONE shared `leadAim`
// alongside the turrets and the bots — connects on an orbiter, and that a naive
// aim-where-it-is shot does not. The Tap Commander pilot rides this same auto
// path (once its scheme maps to Auto-aim), so it inherits the lead with no
// solver of its own.

describe("player auto-aim leads an enemy orbiting the player's station (field report v0.2.4)", () => {
  /** Run a shooter (id 0) at the arena centre against an enemy (id 1) driven at
   *  top speed around a `radius`-circle for `ticks`, calling `onTick` to act each
   *  frame. Returns the damage the shooter dealt and the final world for
   *  digesting. The orbit is analytic (constant angular rate), so the run is a
   *  pure function of its arguments — same args, same result. */
  function orbitDuel(opts: {
    radius: number;
    ticks: number;
    onTick: (world: World, shooter: Ship, target: Ship) => void;
  }): { dealt: number; world: World; target: Ship } {
    const center = { x: 2000, y: 2000 };
    const shooter = makeShip({ id: 0, pos: { x: center.x, y: center.y }, home: center });
    const target = makeShip({
      id: 1,
      pos: { x: center.x + opts.radius, y: center.y },
      home: { x: 3500, y: 3500 },
    });
    const world = makeWorld({ ships: [shooter, target] });
    const omega = shipTopSpeed(target) / opts.radius; // tangential top speed
    const DT = 1 / 60;
    const before = target.hull;
    let theta = 0;
    for (let t = 0; t < opts.ticks; t++) {
      theta += omega * DT;
      target.pos.x = center.x + opts.radius * Math.cos(theta);
      target.pos.y = center.y + opts.radius * Math.sin(theta);
      target.vel.x = -opts.radius * omega * Math.sin(theta);
      target.vel.y = opts.radius * omega * Math.cos(theta);
      opts.onTick(world, shooter, target);
    }
    return { dealt: before - target.hull, world, target };
  }

  const autoFire: Inputs = [{ id: 0, actions: [{ type: 'fire', active: true, auto: true }] }];
  const perShot = shipWeaponDamage(makeShip({ id: 0 }));

  it('auto-fire lands on the orbiter — the lead solve tracks the curve', () => {
    const { dealt } = orbitDuel({ radius: 180, ticks: 300, onTick: (w) => step(w, autoFire) });
    // Five seconds of a committed-range burst connects many times over — well
    // clear of the "I can never hit him" the field report describes.
    expect(dealt).toBeGreaterThan(perShot * 3);
  });

  it('beats the naive aim-where-it-is shot on the same orbit (the lead is what lands it)', () => {
    // Baseline: perfect aim at where the target *is* each tick — face it, fire
    // straight down the barrel, no lead — the exact naive shot that misses.
    const { dealt: naive } = orbitDuel({
      radius: 180,
      ticks: 300,
      onTick: (w, shooter, target) => {
        shooter.angle = Math.atan2(target.pos.y - shooter.pos.y, target.pos.x - shooter.pos.x);
        step(w, [{ id: 0, actions: [{ type: 'fire', active: true, auto: false }] }]);
      },
    });
    const { dealt: lead } = orbitDuel({ radius: 180, ticks: 300, onTick: (w) => step(w, autoFire) });
    expect(lead).toBeGreaterThan(naive);
  });

  it('leaves the manual path untouched — a manual shot flies straight down the barrel', () => {
    // Manual aim stays the skill-ceiling option: the shot ignores target motion
    // entirely and leaves along the ship's facing (no lead injected).
    const shooter = makeShip({ id: 0, pos: { x: 1000, y: 1000 }, angle: 0.7 });
    const mover = makeShip({ id: 1, pos: { x: 1000, y: 1200 }, vel: { x: 300, y: 0 } });
    const world = makeWorld({ ships: [shooter, mover] });
    step(world, [{ id: 0, actions: [{ type: 'fire', active: true, auto: false }] }]);
    const shot = world.projectiles.find((p) => p.active && p.owner === 0)!;
    // Velocity bearing equals the ship's facing, not any intercept of the mover.
    expect(Math.atan2(shot.vel.y, shot.vel.x)).toBeCloseTo(0.7, 6);
  });

  it('is deterministic — the same orbit-fire scenario replays byte-identically', () => {
    const digest = () => {
      const { dealt, world } = orbitDuel({ radius: 180, ticks: 300, onTick: (w) => step(w, autoFire) });
      const shots = world.projectiles
        .filter((p) => p.active)
        .map((p) => `${p.pos.x},${p.pos.y},${p.vel.x},${p.vel.y},${p.life}`)
        .join('|');
      return `${dealt}#${shots}`;
    };
    expect(digest()).toBe(digest());
  });
});

// --- kind gating: ship shots besiege, turret shots do not ------------------

describe('a ship shot besieges structures; a turret shot hits only ships', () => {
  it('a ship weapon shot damages an enemy turret and core', () => {
    const shooter = makeShip({ id: 0, pos: { x: 1000, y: 1000 }, angle: 0 });
    const turret = makeTurret({ id: 5, owner: 1, pos: { x: 1120, y: 1000 } });
    const station = makeStation({ id: 0, owner: 1, pos: { x: 1400, y: 1000 }, turrets: [turret] });
    const world = makeWorld({ ships: [shooter], stations: [station] });

    // One shot at the turret (nearest structure ahead).
    fireShipProjectile(world, shooter, normalize({ x: 1, y: 0 }));
    for (let t = 0; t < 20 && turret.hp === TURRET.hp; t++) step(world, []);
    expect(turret.hp).toBeLessThan(TURRET.hp);
  });

  it('a turret shot flying through an enemy structure leaves it intact (only ships, p1-14)', () => {
    const enemyTurret = makeTurret({ id: 5, owner: 2, pos: { x: 1200, y: 1000 } });
    const station = makeStation({ id: 0, owner: 2, pos: { x: 1400, y: 1000 }, turrets: [enemyTurret] });
    // A turret owned by player 1 looses a shot straight at player 2's turret.
    const shooter = makeTurret({ id: 9, owner: 1, pos: { x: 1000, y: 1000 } });
    const world = makeWorld({ stations: [station] });

    fireTurretProjectile(world, shooter, 0); // bearing +x, toward the enemy turret
    const beforeCore = station.coreHp;
    for (let t = 0; t < 40; t++) step(world, []);

    // The turret shot passed over the structure — turret shots hit ships only.
    expect(enemyTurret.hp).toBe(TURRET.hp);
    expect(station.coreHp).toBe(beforeCore);
  });
});

// --- mining is shooting (ratified amendment v0.3) --------------------------

describe('a ship shot chips a rock — mining is shooting (amendment v0.3)', () => {
  it('a single shot that strikes an asteroid chips its ore and dies on the rock', () => {
    const shooter = makeShip({ id: 0, pos: { x: 1000, y: 1000 }, angle: 0 });
    const rock = {
      id: 7, pos: { x: 1120, y: 1000 }, radius: 30, ore: 40, maxOre: 40, crackStage: 0, mineBuffer: 0,
    };
    const world = makeWorld({ ships: [shooter], asteroids: [rock] });

    fireShipProjectile(world, shooter, normalize({ x: 1, y: 0 })); // straight at the rock
    for (let t = 0; t < 20 && rock.ore === rock.maxOre; t++) step(world, []);

    expect(rock.ore).toBeLessThan(rock.maxOre); // it was chipped
    expect(world.projectiles.some((p) => p.active && p.owner === 0)).toBe(false); // the shot died on the rock
  });

  it('sustained fire breaks whole ore chunks off the rock (GDD §2.3)', () => {
    const shooter = makeShip({ id: 0, pos: { x: 1000, y: 1000 }, angle: 0 });
    const rock = {
      id: 7, pos: { x: 1120, y: 1000 }, radius: 30, ore: 40, maxOre: 40, crackStage: 0, mineBuffer: 0,
    };
    const world = makeWorld({ ships: [shooter], asteroids: [rock] });

    // Hold auto-fire: enough hits fill the fractional buffer past one whole chunk.
    const inputs: Inputs = [{ id: 0, actions: [{ type: 'fire', active: true, auto: true }] }];
    for (let t = 0; t < 60 * 5 && world.chunks.length === 0; t++) step(world, inputs);
    expect(world.chunks.length).toBeGreaterThan(0);
  });

  it('conserves total ore: a rock chipped out yields exactly its ore, no more', () => {
    // A big hold so every chunk is collected; hold auto-fire until the rock is
    // gone, then the whole rock's ore is accounted for on the ship + loose chunks.
    const shooter = makeShip({ id: 0, pos: { x: 1000, y: 1000 }, angle: 0, cargoCap: 100 });
    const rock = {
      id: 7, pos: { x: 1120, y: 1000 }, radius: 30, ore: 5, maxOre: 5, crackStage: 0, mineBuffer: 0,
    };
    const world = makeWorld({ ships: [shooter], asteroids: [rock] });

    const inputs: Inputs = [{ id: 0, actions: [{ type: 'fire', active: true, auto: true }] }];
    for (let t = 0; t < 60 * 20 && world.asteroids.length > 0; t++) step(world, inputs);

    expect(world.asteroids).toHaveLength(0); // fully mined out
    const looseOre = world.chunks.reduce((n, c) => n + c.amount, 0);
    expect(world.ships[0]!.cargo + looseOre).toBeCloseTo(5, 6); // exactly the rock's ore
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

// --- the WEAPON group rides the shot (v0.2.2 field report) -----------------

describe('a fired projectile honors the SPEED and DAMAGE tiers (v0.2.2)', () => {
  it('carries the muzzle speed and per-hit damage of its exact loadout', () => {
    // A spread of (speed, damage) tier pairs — the two tracks vary independently.
    const pairs: readonly (readonly [number, number])[] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 3],
      [2, 3],
    ];
    for (const [speedTier, dmgTier] of pairs) {
      const tiers = {
        ...stockTiers(),
        [UpgradeTrack.Speed]: speedTier,
        [UpgradeTrack.Power]: dmgTier,
      };
      const ship = makeShip({ id: 0, pos: { x: 1000, y: 1000 }, tiers });
      const world = makeWorld({ ships: [ship] });
      fireShipProjectile(world, ship, normalize({ x: 1, y: 0 }));

      const shots = activeProjectilesOf(world, 0);
      expect(shots.length).toBe(1);
      const shot = shots[0]!;
      // The shot's velocity magnitude is exactly the SPEED-track muzzle speed…
      expect(Math.hypot(shot.vel.x, shot.vel.y)).toBeCloseTo(shipProjectileSpeed(ship), 6);
      // …and its damage is exactly the DAMAGE-track per-hit value.
      expect(shot.damage).toBeCloseTo(shipWeaponDamage(ship), 6);
    }
  });

  it('a SPEED-maxed shot flies strictly faster than a stock shot at the same DAMAGE', () => {
    const stock = makeShip({ id: 0, pos: { x: 0, y: 0 } });
    const fast = makeShip({
      id: 1,
      pos: { x: 500, y: 0 },
      tiers: { ...stockTiers(), [UpgradeTrack.Speed]: maxTier(UpgradeTrack.Speed) },
    });
    const world = makeWorld({ ships: [stock, fast] });
    fireShipProjectile(world, stock, normalize({ x: 1, y: 0 }));
    fireShipProjectile(world, fast, normalize({ x: 1, y: 0 }));

    const stockSpeed = Math.hypot(...velOf(world, 0));
    const fastSpeed = Math.hypot(...velOf(world, 1));
    expect(fastSpeed).toBeGreaterThan(stockSpeed);
    // Same per-hit damage — SPEED bought velocity, not bite.
    expect(activeProjectilesOf(world, 1)[0]!.damage).toBeCloseTo(
      activeProjectilesOf(world, 0)[0]!.damage,
      6,
    );
  });
});

/** The velocity of an owner's single active shot, as a tuple for `Math.hypot`. */
function velOf(world: World, owner: number): [number, number] {
  const shot = activeProjectilesOf(world, owner)[0]!;
  return [shot.vel.x, shot.vel.y];
}
