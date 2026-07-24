/**
 * src/sim/buildings.test.ts — day-2 coverage: planets, the build economy, and
 * the siege rules that hang off them (GDD §2.1, §2.5, §2.6, §2.8).
 *
 * The five contract checks from the brief:
 *   1. construction timers — a turret takes exactly 10 s, a shield 15;
 *   2. repair interruption — any core/shield damage drops the channel;
 *   3. the shield regen window — nothing for 8 s, then 2 HP/s;
 *   4. turret target acquisition — nearest enemy in range, and nobody else;
 *   5. per-planet caps — 4 turrets, 2 shields, queued jobs included.
 * Plus the economy around them (cost, docking, banking), the beam's new
 * targets, turret DPS end to end, and determinism with all of it running.
 */

import { describe, it, expect } from 'vitest';
import type { Action, BuildItem } from '@shared/types';
import { ShipClass } from '@shared/types';
import { createWorld, step, type Inputs } from './index';
import {
  damagePlanet,
  isDocked,
  placeOrder,
  planetOf,
  planetTargetRadius,
  shieldPool,
  spendOre,
  turretCount,
  turretMountPos,
} from './buildings';
import {
  BEAM_RANGE,
  CARGO_BASE,
  CORE_HP,
  PLANET,
  PROJECTILE,
  REPAIR,
  SHIELD,
  SHIP_RADIUS,
  SHIP_STATS,
  TICK_DT,
  TURRET,
  beamCoreDps,
} from './constants';
import type { Planet, Projectile, Shield, Ship, Turret, World } from './state';

// --- builders --------------------------------------------------------------

/**
 * Fixtures are written in planet-relative coordinates and placed around this
 * point, well inside the test arena. The arena walls are real — a ship at a
 * negative x is clamped to the wall by `integrate`, which would quietly move
 * the attacker in every siege test below.
 */
const ORIGIN = 2000;

/** A world position `x`/`y` units from {@link ORIGIN}. */
const at = (x: number, y: number) => ({ x: ORIGIN + x, y: ORIGIN + y });

function makeShip(over: Partial<Ship> & Pick<Ship, 'id'>): Ship {
  const cls = over.shipClass ?? ShipClass.Vanguard;
  const stats = SHIP_STATS[cls];
  return {
    id: over.id,
    shipClass: cls,
    pos: over.pos ?? at(0, 0),
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
    beam: over.beam ?? null,
  };
}

/** A planet with spawn protection already expired and the regen window open —
 *  the state a match is in for all but its first 10 seconds. */
function makePlanet(over: Partial<Planet> & Pick<Planet, 'id' | 'owner'>): Planet {
  return {
    id: over.id,
    owner: over.owner,
    pos: over.pos ?? at(0, 0),
    radius: over.radius ?? PLANET.radius,
    coreHp: over.coreHp ?? CORE_HP,
    maxCoreHp: over.maxCoreHp ?? CORE_HP,
    alive: over.alive ?? true,
    spawnProtect: over.spawnProtect ?? 0,
    angle: over.angle ?? 0,
    sinceDamage: over.sinceDamage ?? SHIELD.regenDelay,
    repairing: over.repairing ?? false,
    turrets: over.turrets ?? [],
    shields: over.shields ?? [],
    builds: over.builds ?? [],
  };
}

function makeTurret(over: Partial<Turret> & Pick<Turret, 'id' | 'owner'>): Turret {
  return {
    id: over.id,
    owner: over.owner,
    slot: over.slot ?? 0,
    pos: over.pos ?? at(0, 0),
    radius: over.radius ?? TURRET.radius,
    hp: over.hp ?? TURRET.hp,
    maxHp: over.maxHp ?? TURRET.hp,
    angle: over.angle ?? 0,
    cooldown: over.cooldown ?? 0,
    targetId: over.targetId ?? null,
  };
}

function makeShield(over: Partial<Shield> & Pick<Shield, 'id'>): Shield {
  return {
    id: over.id,
    hp: over.hp ?? SHIELD.hp,
    maxHp: over.maxHp ?? SHIELD.hp,
    radius: over.radius ?? SHIELD.radius,
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
  };
}

const orderAction = (item: BuildItem): Action => ({ type: 'buildOrder', item });
const order = (id: number, item: BuildItem): Inputs => [{ id, actions: [orderAction(item)] }];
const live = (world: World): Projectile[] => world.projectiles.filter((p) => p.active);

/** Step until `done()` or `limit` ticks elapse; returns the ticks actually run
 *  (a hung expectation is a failed test, not a hung suite — GDD §3.8). */
function stepUntil(world: World, done: () => boolean, limit: number, inputs: Inputs = []): number {
  for (let t = 1; t <= limit; t++) {
    step(world, inputs);
    if (done()) return t;
  }
  return limit + 1;
}

// --- 1. construction timers ------------------------------------------------

describe('construction timers (GDD §2.5: "bought before the attack, not during it")', () => {
  it('a turret assembles over exactly TURRET.buildTime, then stands up', () => {
    const ship = makeShip({ id: 0, pos: at(100, 0), banked: 10 });
    const planet = makePlanet({ id: 0, owner: 0, pos: at(0, 0) });
    const world = makeWorld({ ships: [ship], planets: [planet] });

    step(world, order(0, 'turret'));
    // Paid immediately, built later — the whole point of the mechanic.
    expect(ship.banked).toBe(10 - TURRET.cost);
    expect(planet.builds).toHaveLength(1);
    expect(planet.turrets).toHaveLength(0);

    const started = world.time;
    const ticks = stepUntil(world, () => planet.turrets.length === 1, 2000);
    const elapsed = world.time - started;

    expect(ticks).toBeLessThanOrEqual(2000);
    expect(Math.abs(elapsed - TURRET.buildTime)).toBeLessThanOrEqual(TICK_DT + 1e-9);
    expect(planet.builds).toHaveLength(0);
    expect(planet.turrets[0]!.hp).toBe(TURRET.hp);
    // It stands on its reserved mount slot, on the planet's surface ring.
    const mount = turretMountPos(planet, 0);
    expect(planet.turrets[0]!.pos).toEqual(mount);
  });

  it('a shield takes its own, longer build time and arrives at full HP', () => {
    const ship = makeShip({ id: 0, pos: at(100, 0), banked: 10 });
    const planet = makePlanet({ id: 0, owner: 0 });
    const world = makeWorld({ ships: [ship], planets: [planet] });

    step(world, order(0, 'shield'));
    expect(ship.banked).toBe(10 - SHIELD.cost);

    const started = world.time;
    const ticks = stepUntil(world, () => planet.shields.length === 1, 2000);
    const elapsed = world.time - started;

    expect(ticks).toBeLessThanOrEqual(2000);
    expect(Math.abs(elapsed - SHIELD.buildTime)).toBeLessThanOrEqual(TICK_DT + 1e-9);
    expect(SHIELD.buildTime).toBeGreaterThan(TURRET.buildTime);
    expect(planet.shields[0]!.hp).toBe(SHIELD.hp);
  });

  it('nothing is built while the order is still refused (no ore, no charge)', () => {
    const ship = makeShip({ id: 0, pos: at(100, 0), banked: 1, cargo: 1 });
    const planet = makePlanet({ id: 0, owner: 0 });
    const world = makeWorld({ ships: [ship], planets: [planet] });

    expect(placeOrder(world, ship, 'turret')).toBe('cannot-afford');
    expect(ship.banked + ship.cargo).toBe(2);
    expect(planet.builds).toHaveLength(0);
  });
});

// --- 2. the ore wallet, docking, and banking -------------------------------

describe('the wheel is validated by the sim, never trusted (GDD §2.5)', () => {
  it('refuses an order from a ship that is not at its own planet', () => {
    const ship = makeShip({ id: 0, pos: at(PLANET.dockRange + 1, 0), banked: 10 });
    const planet = makePlanet({ id: 0, owner: 0 });
    const world = makeWorld({ ships: [ship], planets: [planet] });

    expect(isDocked(ship, planet)).toBe(false);
    expect(placeOrder(world, ship, 'turret')).toBe('not-docked');
    expect(ship.banked).toBe(10);

    ship.pos.x = at(PLANET.dockRange - 1, 0).x;
    expect(isDocked(ship, planet)).toBe(true);
    expect(placeOrder(world, ship, 'turret')).toBe('ok');
  });

  it('refuses a build on a planet that is not yours', () => {
    const ship = makeShip({ id: 1, pos: at(0, 0), banked: 10 });
    const planet = makePlanet({ id: 0, owner: 0 });
    const world = makeWorld({ ships: [ship], planets: [planet] });

    expect(placeOrder(world, ship, 'turret')).toBe('no-planet');
    expect(ship.banked).toBe(10);
  });

  it('spends the hold before the bank, so banking stays a real decision', () => {
    const ship = makeShip({ id: 0, cargo: 2, banked: 5 });
    expect(spendOre(ship, 3)).toBe(true);
    expect(ship.cargo).toBe(0);
    expect(ship.banked).toBe(4);

    expect(spendOre(ship, 99)).toBe(false);
    expect(ship.banked).toBe(4); // refused costs nothing
  });

  it('BANK moves the whole hold into the safe total', () => {
    const ship = makeShip({ id: 0, pos: at(50, 0), cargo: 2, banked: 1 });
    const planet = makePlanet({ id: 0, owner: 0 });
    const world = makeWorld({ ships: [ship], planets: [planet] });

    step(world, order(0, 'bank'));
    expect(ship.cargo).toBe(0);
    expect(ship.banked).toBe(3);
    expect(placeOrder(world, ship, 'bank')).toBe('nothing-to-bank');
  });
});

// --- 3. per-planet caps ----------------------------------------------------

describe('per-planet caps are design rules (GDD §2.5)', () => {
  it('stops at 4 turrets, counting jobs still under construction', () => {
    const ship = makeShip({ id: 0, pos: at(50, 0), banked: 100 });
    const planet = makePlanet({ id: 0, owner: 0 });
    const world = makeWorld({ ships: [ship], planets: [planet] });

    for (let i = 0; i < TURRET.capPerPlanet; i++) expect(placeOrder(world, ship, 'turret')).toBe('ok');
    // The cap binds against the queue, not just against finished turrets.
    expect(placeOrder(world, ship, 'turret')).toBe('cap-reached');
    expect(ship.banked).toBe(100 - TURRET.capPerPlanet * TURRET.cost);
    expect(turretCount(planet)).toBe(TURRET.capPerPlanet);
    // Every queued job holds a distinct mount slot.
    expect(new Set(planet.builds.map((b) => b.slot)).size).toBe(TURRET.capPerPlanet);

    stepUntil(world, () => planet.builds.length === 0, 2000);
    expect(planet.turrets).toHaveLength(TURRET.capPerPlanet);
    expect(placeOrder(world, ship, 'turret')).toBe('cap-reached');
  });

  it('stops at 2 shields ("stacks to two")', () => {
    const ship = makeShip({ id: 0, pos: at(50, 0), banked: 100 });
    const planet = makePlanet({ id: 0, owner: 0 });
    const world = makeWorld({ ships: [ship], planets: [planet] });

    for (let i = 0; i < SHIELD.capPerPlanet; i++) expect(placeOrder(world, ship, 'shield')).toBe('ok');
    expect(placeOrder(world, ship, 'shield')).toBe('cap-reached');
    expect(ship.banked).toBe(100 - SHIELD.capPerPlanet * SHIELD.cost);

    stepUntil(world, () => planet.shields.length === SHIELD.capPerPlanet, 2000);
    expect(shieldPool(planet)).toBe(SHIELD.capPerPlanet * SHIELD.hp);
  });

  it('a dead turret frees its slot for a rebuild', () => {
    const ship = makeShip({ id: 0, pos: at(50, 0), banked: 100 });
    const planet = makePlanet({
      id: 0,
      owner: 0,
      turrets: [0, 1, 2, 3].map((slot) => makeTurret({ id: slot, owner: 0, slot })),
    });
    const world = makeWorld({ ships: [ship], planets: [planet] });

    expect(placeOrder(world, ship, 'turret')).toBe('cap-reached');
    planet.turrets[2]!.hp = 0;
    step(world, []); // end-of-tick sweep removes it
    expect(planet.turrets).toHaveLength(3);
    expect(placeOrder(world, ship, 'turret')).toBe('ok');
    expect(planet.builds[0]!.slot).toBe(2);
  });
});

// --- 4. the shield regen window -------------------------------------------

describe('shield regeneration (GDD §2.6: "pressure beats regeneration")', () => {
  it('regenerates nothing inside the 8 s window, then 2 HP/s', () => {
    const shield = makeShield({ id: 1, hp: 10 });
    const planet = makePlanet({ id: 0, owner: 0, shields: [shield], sinceDamage: 0 });
    const world = makeWorld({ planets: [planet] });

    // One tick short of the delay: still nothing.
    const insideWindow = Math.round((SHIELD.regenDelay - TICK_DT) / TICK_DT);
    for (let t = 0; t < insideWindow; t++) step(world, []);
    expect(shield.hp).toBe(10);

    // One second past it: exactly the regen rate, no catch-up for the wait.
    const oneSecond = Math.round(1 / TICK_DT);
    for (let t = 0; t < oneSecond + 1; t++) step(world, []);
    expect(shield.hp).toBeCloseTo(10 + SHIELD.regenPerSecond, 1);
  });

  it('a hit re-closes the window: the clock restarts from that hit', () => {
    const shield = makeShield({ id: 1, hp: 20 });
    const planet = makePlanet({ id: 0, owner: 0, shields: [shield] });
    const world = makeWorld({ planets: [planet] });

    damagePlanet(world, planet, 5);
    expect(shield.hp).toBe(15);
    expect(planet.sinceDamage).toBe(0);

    for (let t = 0; t < Math.round((SHIELD.regenDelay - TICK_DT) / TICK_DT); t++) step(world, []);
    expect(shield.hp).toBe(15);
  });

  it('never regenerates past its cap, and each generator regenerates its own', () => {
    const a = makeShield({ id: 1, hp: SHIELD.hp - 1 });
    const b = makeShield({ id: 2, hp: 0 });
    const planet = makePlanet({ id: 0, owner: 0, shields: [a, b] });
    const world = makeWorld({ planets: [planet] });

    for (let t = 0; t < Math.round(2 / TICK_DT); t++) step(world, []);
    expect(a.hp).toBe(SHIELD.hp);
    expect(b.hp).toBeCloseTo(2 * SHIELD.regenPerSecond, 1);
  });
});

// --- 5. the repair channel -------------------------------------------------

describe('repair channel (GDD §2.5: a channel, not a purchase)', () => {
  const dockedRepairWorld = (coreHp = 50, ore = 10) => {
    const ship = makeShip({ id: 0, pos: at(80, 0), banked: ore });
    const planet = makePlanet({ id: 0, owner: 0, coreHp });
    return { ship, planet, world: makeWorld({ ships: [ship], planets: [planet] }) };
  };

  it('ticks the core back at 2 HP/s and charges 1 ore per 5 HP', () => {
    const { ship, planet, world } = dockedRepairWorld();
    step(world, order(0, 'repair'));
    expect(planet.repairing).toBe(true);

    const seconds = 2;
    for (let t = 0; t < Math.round(seconds / TICK_DT); t++) step(world, []);

    const healed = planet.coreHp - 50;
    expect(healed).toBeCloseTo(REPAIR.hpPerSecond * seconds, 1);
    expect(10 - ship.banked).toBeCloseTo(healed * REPAIR.orePerHp, 6);
  });

  it('any damage to the core interrupts it — the defender must drive them off', () => {
    const { planet, world } = dockedRepairWorld();
    step(world, order(0, 'repair'));
    for (let t = 0; t < 30; t++) step(world, []);
    const healed = planet.coreHp;
    expect(healed).toBeGreaterThan(50);

    damagePlanet(world, planet, 1);
    expect(planet.repairing).toBe(false);

    const after = planet.coreHp;
    for (let t = 0; t < 60; t++) step(world, []);
    expect(planet.coreHp).toBe(after); // no healing without a fresh order
  });

  it('damage absorbed by a shield interrupts it too', () => {
    const { planet, world } = dockedRepairWorld();
    planet.shields.push(makeShield({ id: 9 }));
    step(world, order(0, 'repair'));
    expect(planet.repairing).toBe(true);

    damagePlanet(world, planet, 3);
    expect(shieldPool(planet)).toBe(SHIELD.hp - 3); // the core never felt it
    expect(planet.repairing).toBe(false);
  });

  it('an enemy beam on the core interrupts it end to end', () => {
    const { planet, world } = dockedRepairWorld();
    const attacker = makeShip({
      id: 1,
      pos: at(-(planet.radius + 100), 0),
      angle: 0, // aimed straight at the core
    });
    world.ships.push(attacker);

    step(world, order(0, 'repair'));
    for (let t = 0; t < 10; t++) step(world, []);
    expect(planet.repairing).toBe(true);

    const fire: Inputs = [{ id: 1, actions: [{ type: 'fire', active: true, auto: false }] }];
    step(world, fire);
    expect(planet.repairing).toBe(false);
    expect(planet.coreHp).toBeLessThan(planet.maxCoreHp);
  });

  it('closes when the ship leaves, and when the ore runs out', () => {
    const away = dockedRepairWorld();
    step(away.world, order(0, 'repair'));
    away.ship.pos.x = at(1000, 0).x;
    step(away.world, []);
    expect(away.planet.repairing).toBe(false);

    const broke = dockedRepairWorld(50, 0.4); // 0.4 ore = 2 HP = one second
    step(broke.world, order(0, 'repair'));
    stepUntil(broke.world, () => !broke.planet.repairing, 600);
    expect(broke.ship.banked).toBeCloseTo(0, 6);
    expect(broke.planet.coreHp).toBeCloseTo(52, 1);
  });

  it('refuses to open on a full core', () => {
    const { ship, world } = dockedRepairWorld(CORE_HP);
    expect(placeOrder(world, ship, 'repair')).toBe('core-full');
  });
});

// --- 6. turret target acquisition and fire ---------------------------------

describe('turret auto-fire (GDD §2.6: "turrets deter; the ship defends")', () => {
  const turretWorld = (enemyAt: { x: number; y: number }, over: Partial<Ship> = {}) => {
    const turret = makeTurret({ id: 1, owner: 0, pos: at(0, 0) });
    const planet = makePlanet({ id: 0, owner: 0, turrets: [turret] });
    const defender = makeShip({ id: 0, pos: at(0, 40) });
    const enemy = makeShip({ id: 1, pos: at(enemyAt.x, enemyAt.y), hull: 1000, maxHull: 1000, ...over });
    return { turret, planet, enemy, world: makeWorld({ ships: [defender, enemy], planets: [planet] }) };
  };

  it('acquires an enemy ship inside range and ignores its own fleet', () => {
    const { turret, world } = turretWorld({ x: TURRET.range - 20, y: 0 });
    step(world, []);
    expect(turret.targetId).toBe(1); // never 0, the owner's own ship at 40 units
  });

  it('does not acquire past its range', () => {
    const { turret, world } = turretWorld({ x: TURRET.range + 20, y: 0 });
    step(world, []);
    expect(turret.targetId).toBeNull();
    expect(live(world)).toHaveLength(0);
  });

  it('takes the nearest of several enemies', () => {
    const { turret, world } = turretWorld({ x: 200, y: 0 });
    world.ships.push(makeShip({ id: 2, pos: at(100, 0) }));
    step(world, []);
    expect(turret.targetId).toBe(2);
  });

  it('never opens fire on a spawn-protected ship (GDD §2.1)', () => {
    const { turret, world } = turretWorld({ x: 120, y: 0 }, { spawnProtect: 10 });
    step(world, []);
    expect(turret.targetId).toBeNull();
    expect(live(world)).toHaveLength(0);
  });

  it('drops a dead target rather than shooting a corpse', () => {
    const { turret, enemy, world } = turretWorld({ x: 120, y: 0 });
    step(world, []);
    expect(turret.targetId).toBe(1);
    enemy.alive = false;
    step(world, []);
    expect(turret.targetId).toBeNull();
  });

  it('turns its barrel toward the target at the turret turn rate', () => {
    const { turret, world } = turretWorld({ x: 0, y: 150 });
    turret.angle = 0; // target is at +90°
    step(world, []);
    expect(turret.angle).toBeCloseTo(TURRET.turnRate * TICK_DT, 6);
  });

  it('delivers its design DPS to a ship parked in range', () => {
    const { enemy, world } = turretWorld({ x: 150, y: 0 });
    const seconds = 10;
    for (let t = 0; t < Math.round(seconds / TICK_DT); t++) step(world, []);

    const dealt = 1000 - enemy.hull;
    // One shot of slack either way: fire is quantized to `fireInterval`, and a
    // shot in flight at the bell has not landed yet.
    expect(dealt).toBeGreaterThan(TURRET.dps * seconds - PROJECTILE.damage * 2);
    expect(dealt).toBeLessThanOrEqual(TURRET.dps * seconds + PROJECTILE.damage);
  });

  it('pools its projectiles — the array stops growing once shots recycle', () => {
    const { world } = turretWorld({ x: 200, y: 0 });
    for (let t = 0; t < Math.round(2 / TICK_DT); t++) step(world, []);
    const pooled = world.projectiles.length;
    for (let t = 0; t < Math.round(20 / TICK_DT); t++) step(world, []);
    expect(world.projectiles.length).toBe(pooled);
    expect(pooled).toBeLessThanOrEqual(4);
  });

  it('gives every shot a fresh id, so a recycled slot is not a teleporting shot', () => {
    const { world } = turretWorld({ x: 200, y: 0 });
    const seen = new Set<number>();
    for (let t = 0; t < Math.round(10 / TICK_DT); t++) {
      step(world, []);
      for (const p of live(world)) seen.add(p.id);
    }
    // Far more distinct shots than pool slots — ids never come back round.
    expect(seen.size).toBeGreaterThan(world.projectiles.length);
    expect(seen.size).toBeGreaterThan(10);
  });

  it('a turret killed this tick does not also get a shot off', () => {
    const { turret, world } = turretWorld({ x: 200, y: 0 });
    turret.hp = 0;
    step(world, []);
    expect(live(world)).toHaveLength(0);
    expect(world.planets[0]!.turrets).toHaveLength(0); // swept at end of tick
  });
});

// --- 7. the beam's day-2 targets -------------------------------------------

describe('the beam finishes its target list (GDD §2.4)', () => {
  it('strips the shield before the core, at the core rate', () => {
    const planet = makePlanet({ id: 0, owner: 0, shields: [makeShield({ id: 9 })] });
    const attacker = makeShip({ id: 1, pos: at(-(SHIELD.radius + 60), 0), angle: 0 });
    const world = makeWorld({ ships: [attacker], planets: [planet] });

    expect(planetTargetRadius(planet)).toBe(SHIELD.radius);

    const fire: Inputs = [{ id: 1, actions: [{ type: 'fire', active: true, auto: false }] }];
    const seconds = 1;
    for (let t = 0; t < Math.round(seconds / TICK_DT); t++) step(world, fire);

    expect(planet.coreHp).toBe(CORE_HP);
    expect(shieldPool(planet)).toBeCloseTo(SHIELD.hp - beamCoreDps(ShipClass.Vanguard) * seconds, 1);
    // The beam stops on the bubble, not on the core behind it.
    expect(attacker.beam!.length).toBeCloseTo(60, 6);
  });

  it('kills a turret at the ship rate and leaves the core alone', () => {
    const turret = makeTurret({ id: 5, owner: 0, pos: at(-200, 0) });
    const planet = makePlanet({ id: 0, owner: 0, turrets: [turret] });
    const attacker = makeShip({ id: 1, pos: at(-200 - BEAM_RANGE / 2, 0), angle: 0 });
    const world = makeWorld({ ships: [attacker], planets: [planet] });

    const fire: Inputs = [{ id: 1, actions: [{ type: 'fire', active: true, auto: false }] }];
    const ticks = stepUntil(world, () => planet.turrets.length === 0, 1000, fire);

    // 30 HP at the Vanguard's 10 DPS ≈ 3 s.
    expect(ticks * TICK_DT).toBeCloseTo(TURRET.hp / SHIP_STATS[ShipClass.Vanguard].beam, 1);
    expect(planet.coreHp).toBe(CORE_HP);
  });

  it('never targets its owner\'s own planet or turrets', () => {
    const turret = makeTurret({ id: 5, owner: 0, pos: at(100, 0) });
    const planet = makePlanet({ id: 0, owner: 0, pos: at(200, 0), turrets: [turret] });
    const owner = makeShip({ id: 0, pos: at(0, 0), angle: 0 });
    const world = makeWorld({ ships: [owner], planets: [planet] });

    const fire: Inputs = [{ id: 0, actions: [{ type: 'fire', active: true, auto: true }] }];
    for (let t = 0; t < 60; t++) step(world, fire);

    expect(turret.hp).toBe(TURRET.hp);
    expect(planet.coreHp).toBe(CORE_HP);
    expect(owner.beam!.hitPoint).toBeNull();
  });

  it('spawn protection covers the core for its 10 seconds (GDD §2.1)', () => {
    const planet = makePlanet({ id: 0, owner: 0, spawnProtect: 10 });
    const attacker = makeShip({ id: 1, pos: at(-(PLANET.radius + 60), 0), angle: 0 });
    const world = makeWorld({ ships: [attacker], planets: [planet] });

    const fire: Inputs = [{ id: 1, actions: [{ type: 'fire', active: true, auto: false }] }];
    for (let t = 0; t < 60; t++) step(world, fire);
    expect(planet.coreHp).toBe(CORE_HP);
  });

  it('a core taken to zero becomes a wreck that cannot shoot, shield or repair', () => {
    const planet = makePlanet({
      id: 0,
      owner: 0,
      coreHp: 4,
      turrets: [makeTurret({ id: 5, owner: 0 })],
      shields: [makeShield({ id: 6, hp: 0 })],
      repairing: true,
    });
    const world = makeWorld({ ships: [makeShip({ id: 0, banked: 10 })], planets: [planet] });

    damagePlanet(world, planet, 4);
    expect(planet.alive).toBe(false);
    expect(planet.coreHp).toBe(0);
    expect(planet.repairing).toBe(false);

    step(world, []);
    expect(planet.turrets).toHaveLength(0);
    expect(live(world)).toHaveLength(0);
  });
});

// --- 8. the ring layout and determinism ------------------------------------

describe('the ring layout (GDD §2.1)', () => {
  it('gives every slot a planet on its own spoke, outboard of its ship', () => {
    const world = createWorld({
      seed: 5,
      players: [
        { id: 0, shipClass: ShipClass.Vanguard },
        { id: 1, shipClass: ShipClass.Hauler },
        { id: 2, shipClass: ShipClass.Interceptor },
      ],
      asteroidCount: 8,
    });

    expect(world.planets).toHaveLength(3);
    const cx = world.bounds.width / 2;
    const cy = world.bounds.height / 2;
    const radii = world.planets.map((p) => Math.hypot(p.pos.x - cx, p.pos.y - cy));

    for (const p of world.planets) {
      expect(p.coreHp).toBe(CORE_HP);
      expect(p.spawnProtect).toBeGreaterThan(0);
      const ship = world.ships.find((s) => s.id === p.owner)!;
      // The ship spawns between the field and its planet, inside dock range.
      expect(Math.hypot(ship.pos.x - cx, ship.pos.y - cy)).toBeLessThan(
        Math.hypot(p.pos.x - cx, p.pos.y - cy),
      );
      expect(isDocked(ship, p)).toBe(true);
      expect(planetOf(world, p.owner)).toBe(p);
      // Wholly inside the arena, so nothing is built outside the play area.
      expect(p.pos.x - p.radius).toBeGreaterThanOrEqual(0);
      expect(p.pos.x + p.radius).toBeLessThanOrEqual(world.bounds.width);
    }
    // One ring: every planet the same distance from the centre.
    for (const r of radii) expect(r).toBeCloseTo(radii[0]!, 6);
  });

  it('a planet is a solid body — you dock at your world, you do not fly through it', () => {
    const planet = makePlanet({ id: 0, owner: 0, pos: at(0, 0) });
    const ship = makeShip({ id: 0, pos: at(-200, 0), vel: { x: 400, y: 0 } });
    const world = makeWorld({ ships: [ship], planets: [planet] });

    const thrust: Inputs = [{ id: 0, actions: [{ type: 'thrust', dir: { x: 1, y: 0 } }] }];
    for (let t = 0; t < Math.round(3 / TICK_DT); t++) {
      step(world, thrust);
      const gap = Math.hypot(ship.pos.x - planet.pos.x, ship.pos.y - planet.pos.y);
      expect(gap).toBeGreaterThanOrEqual(planet.radius + ship.radius - 1e-6);
    }
    // Still docked at the surface it bounced off, which is the point.
    expect(isDocked(ship, planet)).toBe(true);
  });

  it('two runs with orders, turret fire and repair deep-equal (GDD §4.8)', () => {
    const cfg = {
      seed: 2026,
      players: [
        { id: 0, shipClass: ShipClass.Vanguard },
        { id: 1, shipClass: ShipClass.Excavator },
      ],
      asteroidCount: 24,
    } as const;

    // A script that exercises the whole day-2 surface: mine, order, fight.
    const inputsAt = (tick: number): Inputs =>
      cfg.players.map((p) => {
        const actions: Action[] = [
          { type: 'thrust', dir: { x: Math.sin(tick * 0.05 + p.id), y: Math.cos(tick * 0.07 + p.id) } },
          { type: 'fire', active: tick % 3 !== 0, auto: true },
        ];
        if (tick % 97 === 0) actions.push(orderAction('turret'));
        if (tick % 131 === 0) actions.push(orderAction('shield'));
        if (tick % 61 === 0) actions.push(orderAction('bank'));
        if (tick % 53 === 0) actions.push(orderAction('repair'));
        return { id: p.id, actions };
      });

    const a = createWorld(cfg);
    const b = createWorld(cfg);
    for (let t = 0; t < 900; t++) {
      step(a, inputsAt(t));
      step(b, inputsAt(t));
    }
    expect(a).toEqual(b);
    // Sanity: the script actually built something.
    expect(a.planets.some((p) => p.turrets.length + p.builds.length > 0)).toBe(true);
  });
});
