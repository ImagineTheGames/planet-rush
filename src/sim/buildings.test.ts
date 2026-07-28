/**
 * src/sim/buildings.test.ts — day-2 coverage: stations, the build economy, and
 * the siege rules that hang off them (GDD §2.1, §2.5, §2.6, §2.8).
 *
 * The five contract checks from the brief:
 *   1. construction timers — a turret takes exactly 10 s, a shield 15;
 *   2. repair — a DISCRETE 1-ore / REPAIR_HP_PER_ORE purchase (developer,
 *      2026-07-26, supersedes the GDD §2.5 channel — see design-amendments.md);
 *   3. the shield regen window — nothing for 8 s, then 2 HP/s;
 *   4. turret target acquisition — nearest enemy in range, and nobody else;
 *   5. per-station caps — 4 turrets, 2 shields, queued jobs included.
 * Plus the economy around them (cost, docking, banking), the weapon's new
 * targets, turret DPS end to end, and determinism with all of it running.
 */

import { describe, it, expect } from 'vitest';
import type { Action, BuildItem } from '@shared/types';
import { ShipClass } from '@shared/types';
import { createWorld, step, type Inputs } from './index';
import {
  damageStation,
  isDocked,
  placeOrder,
  updateStations,
  stationOf,
  stationTargetRadius,
  shieldPool,
  spendOre,
  turretCount,
  turretMountPos,
  turretTier,
} from './buildings';
import {
  CORE_HP,
  STATION,
  PROJECTILE,
  PROJECTILE_CORE_FACTOR,
  REPAIR_COOLDOWN_SECONDS,
  REPAIR_HP_PER_ORE,
  REPAIR_ORE_COST,
  REPAIR_TELL_HOLD,
  SHIELD,
  SHIP_RADIUS,
  TICK_DT,
  TURRET,
} from './constants';
import { shipCargoCap, shipMaxHull, shipWeaponDamage, stockTiers } from './upgrades';
import type { MiningStation, Projectile, Shield, Ship, Turret, World } from './state';

// --- builders --------------------------------------------------------------

/**
 * Fixtures are written in station-relative coordinates and placed around this
 * point, well inside the test arena. The arena walls are real — a ship at a
 * negative x is clamped to the wall by `integrate`, which would quietly move
 * the attacker in every siege test below.
 */
const ORIGIN = 2000;

/** A world position `x`/`y` units from {@link ORIGIN}. */
const at = (x: number, y: number) => ({ x: ORIGIN + x, y: ORIGIN + y });

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
    pos: over.pos ?? at(0, 0),
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
  };
}

/** A station with spawn protection already expired and the regen window open —
 *  the state a match is in for all but its first 10 seconds. */
function makeStation(over: Partial<MiningStation> & Pick<MiningStation, 'id' | 'owner'>): MiningStation {
  return {
    id: over.id,
    owner: over.owner,
    pos: over.pos ?? at(0, 0),
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
    muzzle: over.muzzle ?? null,
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
    stations: over.stations ?? [],
    projectiles: over.projectiles ?? [],
    bounds: over.bounds ?? { width: 4000, height: 4000 },
    fieldRadius: over.fieldRadius ?? 600,
    // Zero rocks per wave: a hand-built world's field is exactly what the test
    // puts in it, so the wave metronome cannot drop asteroids into a siege
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
    const station = makeStation({ id: 0, owner: 0, pos: at(0, 0) });
    const world = makeWorld({ ships: [ship], stations: [station] });

    step(world, order(0, 'turret'));
    // Paid immediately, built later — the whole point of the mechanic.
    expect(ship.banked).toBe(10 - TURRET.cost);
    expect(station.builds).toHaveLength(1);
    expect(station.turrets).toHaveLength(0);

    const started = world.time;
    const ticks = stepUntil(world, () => station.turrets.length === 1, 2000);
    const elapsed = world.time - started;

    expect(ticks).toBeLessThanOrEqual(2000);
    expect(Math.abs(elapsed - TURRET.buildTime)).toBeLessThanOrEqual(TICK_DT + 1e-9);
    expect(station.builds).toHaveLength(0);
    expect(station.turrets[0]!.hp).toBe(TURRET.hp);
    // It stands on its reserved mount slot, on the station's surface ring.
    const mount = turretMountPos(station, 0);
    expect(station.turrets[0]!.pos).toEqual(mount);
  });

  it('a shield takes its own, longer build time and arrives at full HP', () => {
    const ship = makeShip({ id: 0, pos: at(100, 0), banked: 10 });
    const station = makeStation({ id: 0, owner: 0 });
    const world = makeWorld({ ships: [ship], stations: [station] });

    step(world, order(0, 'shield'));
    expect(ship.banked).toBe(10 - SHIELD.cost);

    const started = world.time;
    const ticks = stepUntil(world, () => station.shields.length === 1, 2000);
    const elapsed = world.time - started;

    expect(ticks).toBeLessThanOrEqual(2000);
    expect(Math.abs(elapsed - SHIELD.buildTime)).toBeLessThanOrEqual(TICK_DT + 1e-9);
    expect(SHIELD.buildTime).toBeGreaterThan(TURRET.buildTime);
    expect(station.shields[0]!.hp).toBe(SHIELD.hp);
  });

  it('nothing is built while the order is still refused (no ore, no charge)', () => {
    const ship = makeShip({ id: 0, pos: at(100, 0), banked: 1, cargo: 1 });
    const station = makeStation({ id: 0, owner: 0 });
    const world = makeWorld({ ships: [ship], stations: [station] });

    expect(placeOrder(world, ship, 'turret')).toBe('cannot-afford');
    expect(ship.banked + ship.cargo).toBe(2);
    expect(station.builds).toHaveLength(0);
  });
});

// --- 2. the ore wallet, docking, and banking -------------------------------

describe('the wheel is validated by the sim, never trusted (GDD §2.5)', () => {
  it('refuses an order from a ship that is not at its own station', () => {
    const ship = makeShip({ id: 0, pos: at(STATION.dockRange + 1, 0), banked: 10 });
    const station = makeStation({ id: 0, owner: 0 });
    const world = makeWorld({ ships: [ship], stations: [station] });

    expect(isDocked(ship, station)).toBe(false);
    expect(placeOrder(world, ship, 'turret')).toBe('not-docked');
    expect(ship.banked).toBe(10);

    ship.pos.x = at(STATION.dockRange - 1, 0).x;
    expect(isDocked(ship, station)).toBe(true);
    expect(placeOrder(world, ship, 'turret')).toBe('ok');
  });

  it('refuses a build on a station that is not yours', () => {
    const ship = makeShip({ id: 1, pos: at(0, 0), banked: 10 });
    const station = makeStation({ id: 0, owner: 0 });
    const world = makeWorld({ ships: [ship], stations: [station] });

    expect(placeOrder(world, ship, 'turret')).toBe('no-station');
    expect(ship.banked).toBe(10);
  });

  it('spends the hold before the bank, so banking stays a real decision', () => {
    const ship = makeShip({ id: 0, cargo: 2, banked: 5 });
    const world = makeWorld({ ships: [ship] });
    expect(spendOre(world, ship, 3)).toBe(true);
    expect(ship.cargo).toBe(0);
    expect(ship.banked).toBe(4);

    expect(spendOre(world, ship, 99)).toBe(false);
    expect(ship.banked).toBe(4); // refused costs nothing
  });

  it('BANK moves the whole hold into the safe total', () => {
    const ship = makeShip({ id: 0, pos: at(50, 0), cargo: 2, banked: 1 });
    const station = makeStation({ id: 0, owner: 0 });
    const world = makeWorld({ ships: [ship], stations: [station] });

    step(world, order(0, 'bank'));
    expect(ship.cargo).toBe(0);
    expect(ship.banked).toBe(3);
    expect(placeOrder(world, ship, 'bank')).toBe('nothing-to-bank');
  });
});

// --- 3. per-station caps ----------------------------------------------------

describe('per-station caps are design rules (GDD §2.5)', () => {
  it('stops at 4 turrets, counting jobs still under construction', () => {
    const ship = makeShip({ id: 0, pos: at(50, 0), banked: 100 });
    const station = makeStation({ id: 0, owner: 0 });
    const world = makeWorld({ ships: [ship], stations: [station] });

    for (let i = 0; i < TURRET.capPerStation; i++) expect(placeOrder(world, ship, 'turret')).toBe('ok');
    // The cap binds against the queue, not just against finished turrets.
    expect(placeOrder(world, ship, 'turret')).toBe('cap-reached');
    expect(ship.banked).toBe(100 - TURRET.capPerStation * TURRET.cost);
    expect(turretCount(station)).toBe(TURRET.capPerStation);
    // Every queued job holds a distinct mount slot.
    expect(new Set(station.builds.map((b) => b.slot)).size).toBe(TURRET.capPerStation);

    stepUntil(world, () => station.builds.length === 0, 2000);
    expect(station.turrets).toHaveLength(TURRET.capPerStation);
    // The cap still binds — the ring never grows past four — but a built-out ring
    // does not dead-end the wedge: the same TURRET order now UPGRADES the weakest
    // turret one Mk (parity field report v0.2.2), so it answers 'ok', the count
    // holds at four, and a turret has climbed off Mk I.
    expect(placeOrder(world, ship, 'turret')).toBe('ok');
    expect(turretCount(station)).toBe(TURRET.capPerStation);
    expect(Math.max(...station.turrets.map(turretTier))).toBe(1);
  });

  it('stops at 2 shields ("stacks to two")', () => {
    const ship = makeShip({ id: 0, pos: at(50, 0), banked: 100 });
    const station = makeStation({ id: 0, owner: 0 });
    const world = makeWorld({ ships: [ship], stations: [station] });

    for (let i = 0; i < SHIELD.capPerStation; i++) expect(placeOrder(world, ship, 'shield')).toBe('ok');
    expect(placeOrder(world, ship, 'shield')).toBe('cap-reached');
    expect(ship.banked).toBe(100 - SHIELD.capPerStation * SHIELD.cost);

    stepUntil(world, () => station.shields.length === SHIELD.capPerStation, 2000);
    expect(shieldPool(station)).toBe(SHIELD.capPerStation * SHIELD.hp);
  });

  it('a dead turret frees its slot for a rebuild', () => {
    const ship = makeShip({ id: 0, pos: at(50, 0), banked: 100 });
    const station = makeStation({
      id: 0,
      owner: 0,
      turrets: [0, 1, 2, 3].map((slot) => makeTurret({ id: slot, owner: 0, slot })),
    });
    const world = makeWorld({ ships: [ship], stations: [station] });

    // A full standing ring builds no fifth turret — the order upgrades instead
    // ('ok', count unchanged). Killing a turret frees its slot, and the very next
    // order goes back to BUILDING (a free slot always builds before it upgrades).
    expect(placeOrder(world, ship, 'turret')).toBe('ok');
    expect(turretCount(station)).toBe(TURRET.capPerStation);
    station.turrets[2]!.hp = 0;
    step(world, []); // end-of-tick sweep removes it
    expect(station.turrets).toHaveLength(3);
    expect(placeOrder(world, ship, 'turret')).toBe('ok');
    expect(station.builds[0]!.slot).toBe(2);
  });
});

// --- 4. the shield regen window -------------------------------------------

describe('shield regeneration (GDD §2.6: "pressure beats regeneration")', () => {
  it('regenerates nothing inside the 8 s window, then 2 HP/s', () => {
    const shield = makeShield({ id: 1, hp: 10 });
    const station = makeStation({ id: 0, owner: 0, shields: [shield], sinceDamage: 0 });
    const world = makeWorld({ stations: [station] });

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
    const station = makeStation({ id: 0, owner: 0, shields: [shield] });
    const world = makeWorld({ stations: [station] });

    damageStation(world, station, 5);
    expect(shield.hp).toBe(15);
    expect(station.sinceDamage).toBe(0);

    for (let t = 0; t < Math.round((SHIELD.regenDelay - TICK_DT) / TICK_DT); t++) step(world, []);
    expect(shield.hp).toBe(15);
  });

  it('never regenerates past its cap, and each generator regenerates its own', () => {
    const a = makeShield({ id: 1, hp: SHIELD.hp - 1 });
    const b = makeShield({ id: 2, hp: 0 });
    const station = makeStation({ id: 0, owner: 0, shields: [a, b] });
    const world = makeWorld({ stations: [station] });

    for (let t = 0; t < Math.round(2 / TICK_DT); t++) step(world, []);
    expect(a.hp).toBe(SHIELD.hp);
    expect(b.hp).toBeCloseTo(2 * SHIELD.regenPerSecond, 1);
  });
});

// --- 5. repair core: a DISCRETE purchase (developer, 2026-07-26) ------------
//
// Ratified model: one tap = one purchase. Spends REPAIR_ORE_COST (1) ore from
// the bank/hold, restores REPAIR_HP_PER_ORE (15) core HP, clamped at max. No
// channel, no continuous drain, no stacking — N taps are N distinct spends. This
// supersedes the GDD §2.5 channel line (docs/design-amendments.md).

describe('repair core (discrete: 1 tap = 1 ore -> REPAIR_HP_PER_ORE HP)', () => {
  const dockedRepairWorld = (coreHp = 50, ore = 10) => {
    const ship = makeShip({ id: 0, pos: at(80, 0), banked: ore });
    const station = makeStation({ id: 0, owner: 0, coreHp });
    return { ship, station, world: makeWorld({ ships: [ship], stations: [station] }) };
  };

  it('one tap spends exactly 1 ore and restores REPAIR_HP_PER_ORE core HP', () => {
    const { ship, station, world } = dockedRepairWorld(50, 10);
    expect(placeOrder(world, ship, 'repair')).toBe('ok');
    expect(station.coreHp).toBe(50 + REPAIR_HP_PER_ORE);
    expect(ship.banked).toBeCloseTo(10 - REPAIR_ORE_COST, 6);
  });

  it('draws the ore hold-first, then the bank — like every other purchase', () => {
    const { ship, station, world } = dockedRepairWorld(50, 0);
    ship.cargo = 3;
    expect(placeOrder(world, ship, 'repair')).toBe('ok');
    expect(ship.cargo).toBeCloseTo(3 - REPAIR_ORE_COST, 6);
    expect(ship.banked).toBe(0);
    expect(station.coreHp).toBe(50 + REPAIR_HP_PER_ORE);
  });

  it('clamps at the core max: a near-full core costs the full ore and heals to full', () => {
    // Missing 10 HP < REPAIR_HP_PER_ORE (15): the tap still costs a whole ore and
    // the core clamps to max, never overshooting — the wedge SHOWS the real
    // number, so the player chooses informed (developer p5-08).
    const { ship, station, world } = dockedRepairWorld(CORE_HP - 10, 5);
    expect(placeOrder(world, ship, 'repair')).toBe('ok');
    expect(station.coreHp).toBe(station.maxCoreHp);
    expect(ship.banked).toBeCloseTo(5 - REPAIR_ORE_COST, 6);
  });

  it('one tap heals once; the four rapid re-taps behind it are refused, cooling down', () => {
    // The developer's loop bug stayed killed — one press is exactly one
    // ore-spend — but the ratified cooldown (2026-07-28) now RATIONS the re-tap:
    // the first press buys 15 HP, and the four presses chasing it inside
    // REPAIR_COOLDOWN_SECONDS are refused `cooling-down`, spending nothing.
    const { ship, station, world } = dockedRepairWorld(20, 10);
    expect(placeOrder(world, ship, 'repair')).toBe('ok');
    for (let i = 0; i < 4; i++) expect(placeOrder(world, ship, 'repair')).toBe('cooling-down');
    expect(station.coreHp).toBe(20 + REPAIR_HP_PER_ORE); // just the one heal
    expect(ship.banked).toBeCloseTo(10 - REPAIR_ORE_COST, 6); // just the one ore

    // No channel: time passing with no press moves neither HP nor ore.
    const hp = station.coreHp;
    const ore = ship.banked;
    for (let t = 0; t < 120; t++) step(world, []);
    expect(station.coreHp).toBe(hp);
    expect(ship.banked).toBeCloseTo(ore, 6);
  });

  it('refuses a full core, spending nothing', () => {
    const { ship, station, world } = dockedRepairWorld(CORE_HP, 10);
    expect(placeOrder(world, ship, 'repair')).toBe('core-full');
    expect(ship.banked).toBe(10);
    expect(station.coreHp).toBe(station.maxCoreHp);
  });

  it('refuses an empty bank, and a bank short of one whole ore, spending nothing', () => {
    const empty = dockedRepairWorld(50, 0);
    expect(placeOrder(empty.world, empty.ship, 'repair')).toBe('cannot-afford');
    expect(empty.station.coreHp).toBe(50);

    const short = dockedRepairWorld(50, 0);
    short.ship.cargo = 0.5; // less than one whole ore
    expect(placeOrder(short.world, short.ship, 'repair')).toBe('cannot-afford');
    expect(short.ship.cargo).toBe(0.5); // untouched
    expect(short.station.coreHp).toBe(50);
  });

  it('refuses once collapse has begun — repair shuts off (GDD §2.3)', () => {
    const { ship, station, world } = dockedRepairWorld(50, 10);
    world.match.collapseTime = 0; // isCollapsed(world) is now true
    expect(placeOrder(world, ship, 'repair')).toBe('collapsed');
    expect(ship.banked).toBe(10);
    expect(station.coreHp).toBe(50);
  });

  it('refuses an undocked ship, spending nothing', () => {
    const { ship, station, world } = dockedRepairWorld(50, 10);
    ship.pos = at(1000, 0);
    expect(placeOrder(world, ship, 'repair')).toBe('not-docked');
    expect(ship.banked).toBe(10);
    expect(station.coreHp).toBe(50);
  });

  it('damage does not cancel a heal that already resolved — no channel to interrupt', () => {
    const { ship, station, world } = dockedRepairWorld(50, 10);
    expect(placeOrder(world, ship, 'repair')).toBe('ok');
    const healed = station.coreHp; // 65: the 15 HP is banked into the core
    damageStation(world, station, 5);
    // The hit takes its 5 off the top; it does not "drop" a repair, because
    // the purchase is done — there is nothing left running to interrupt.
    expect(station.coreHp).toBe(healed - 5);
  });

  it('a shield stands in front of the core during a repair, exactly as always', () => {
    const { ship, station, world } = dockedRepairWorld(50, 10);
    station.shields.push(makeShield({ id: 9 }));
    expect(placeOrder(world, ship, 'repair')).toBe('ok');
    damageStation(world, station, 3);
    expect(shieldPool(station)).toBe(SHIELD.hp - 3); // the core never felt it
    expect(station.coreHp).toBe(50 + REPAIR_HP_PER_ORE); // and kept its heal
  });

  it('lights a repair TELL that holds for the pacing window, then releases when quiet', () => {
    // The tell is a render/AI-pacing signal — not a channel: it heals nothing
    // beyond the one purchase, but it holds for REPAIR_TELL_HOLD seconds so a
    // renderer can glow and a bot paces its next order rather than buying 15 HP
    // every tick.
    const { station, world } = dockedRepairWorld(50, 10);
    step(world, order(0, 'repair'));
    expect(station.repairing).toBe(true);
    expect(station.coreHp).toBe(50 + REPAIR_HP_PER_ORE);

    for (let t = 0; t < 30; t++) step(world, []); // still inside the hold window…
    expect(station.repairing).toBe(true);
    expect(station.coreHp).toBe(50 + REPAIR_HP_PER_ORE); // …and no channel heals it further

    // Once the hold has fully elapsed on a quiet core, the tell releases.
    const settle = Math.round(REPAIR_TELL_HOLD / TICK_DT) + 5;
    for (let t = 0; t < settle; t++) step(world, []);
    expect(station.repairing).toBe(false);
  });

  it('holds the tell while the core stays under fire — pressure beats repair (GDD §2.6)', () => {
    // A besieged core keeps `sinceDamage` low, so the tell never releases and a
    // bot reading `!repairing` holds off resuming repair under fire — it must
    // drive the attacker off first. (A human is never gated: `placeOrder` above
    // ignores the tell entirely.)
    const { station, world } = dockedRepairWorld(50, 10);
    step(world, order(0, 'repair'));
    expect(station.repairing).toBe(true);

    const underFire = Math.round((REPAIR_TELL_HOLD * 2) / TICK_DT);
    for (let t = 0; t < underFire; t++) {
      station.sinceDamage = 0; // a fresh hit landed this tick — the core is under fire
      step(world, []);
    }
    expect(station.repairing).toBe(true); // held: a defender cannot repair under fire
  });

  it('clears the repair TELL once the core is topped back to full', () => {
    const { station, world } = dockedRepairWorld(CORE_HP - 5, 10); // one tap fills it
    step(world, order(0, 'repair'));
    expect(station.coreHp).toBe(station.maxCoreHp);
    // The purchase lit the tell; the next maintenance pass sees a full core and
    // drops it — nothing left to repair, nothing to glow.
    step(world, []);
    expect(station.repairing).toBe(false);
  });

  it('is deterministic: two identical repair sequences deep-equal', () => {
    const run = () => {
      const { ship, world } = dockedRepairWorld(20, 10);
      for (let i = 0; i < 3; i++) placeOrder(world, ship, 'repair');
      return { coreHp: world.stations[0]!.coreHp, banked: ship.banked };
    };
    expect(run()).toEqual(run());
  });
});

// --- 5b. repair cooldown (RATIFIED developer, 2026-07-28) -------------------

describe('repair cooldown (per station, 15 s: repair is a rationed patch, not a heal-tank)', () => {
  /** A ship docked at its own damaged core, banked with plenty of ore. */
  const docked = (coreHp = 50, ore = 100) => {
    const ship = makeShip({ id: 0, pos: at(80, 0), banked: ore });
    const station = makeStation({ id: 0, owner: 0, coreHp });
    return { ship, station, world: makeWorld({ ships: [ship], stations: [station] }) };
  };

  it('arms the gate to REPAIR_COOLDOWN_SECONDS and refuses the very next order, spending nothing', () => {
    const { ship, station, world } = docked(50, 100);
    expect(placeOrder(world, ship, 'repair')).toBe('ok');
    expect(station.repairGate).toBeCloseTo(REPAIR_COOLDOWN_SECONDS, 9);

    const bank = ship.banked;
    const hp = station.coreHp;
    expect(placeOrder(world, ship, 'repair')).toBe('cooling-down');
    expect(ship.banked).toBe(bank); // a cooling core never charges the bank
    expect(station.coreHp).toBe(hp); // and never heals
  });

  it('exposes a live, ticking remaining time on the station — the wheel countdown source (p4-17)', () => {
    // No UI-side timer: the "REPAIR in Ns" copy reads `station.repairGate` straight
    // from sim state, so it must fall by exactly `dt` each tick.
    const { ship, station, world } = docked(50, 100);
    expect(placeOrder(world, ship, 'repair')).toBe('ok');
    const before = station.repairGate!;
    step(world, []);
    step(world, []);
    expect(station.repairGate!).toBeLessThan(before);
    expect(station.repairGate!).toBeCloseTo(REPAIR_COOLDOWN_SECONDS - 2 * TICK_DT, 6);
    expect(placeOrder(world, ship, 'repair')).toBe('cooling-down'); // still refused mid-countdown
  });

  it('re-allows on the exact tick the gate drains, and refuses the tick before', () => {
    const { ship, station, world } = docked(50, 100);
    expect(placeOrder(world, ship, 'repair')).toBe('ok'); // arms the 15 s gate

    // Idle-step until a single tick of cooldown remains.
    let guard = 0;
    while ((station.repairGate ?? 0) > TICK_DT + 1e-9 && guard++ < 5000) step(world, []);
    const bank = ship.banked;
    expect(placeOrder(world, ship, 'repair')).toBe('cooling-down'); // one tick still on the clock
    expect(ship.banked).toBe(bank);

    // The tick that drains the last of the gate re-arms the wedge.
    step(world, []);
    expect(station.repairGate ?? 0).toBeLessThanOrEqual(1e-9);
    expect(placeOrder(world, ship, 'repair')).toBe('ok');
  });

  it('is a pure time lockout: the gate drains even while the owner is undocked and away', () => {
    const { ship, station, world } = docked(50, 100);
    expect(placeOrder(world, ship, 'repair')).toBe('ok');
    ship.pos = at(5000, 0); // fly off — the core is alone, no one docked to heal it
    expect(isDocked(ship, station)).toBe(false);

    // A full cooldown of sim-time passes with the owner gone (dt-parametric).
    updateStations(world, REPAIR_COOLDOWN_SECONDS);
    expect(station.repairGate ?? 0).toBeLessThanOrEqual(1e-9);

    ship.pos = at(80, 0); // dock again — the gate is clear, repair is armed
    expect(placeOrder(world, ship, 'repair')).toBe('ok');
  });

  it('cools each station independently — one cooling core never blocks another (encoded now for N>1)', () => {
    const shipA = makeShip({ id: 0, pos: at(80, 0), banked: 100 });
    const stationA = makeStation({ id: 0, owner: 0, pos: at(0, 0), coreHp: 50 });
    const shipB = makeShip({ id: 1, pos: at(80, 500), banked: 100 });
    const stationB = makeStation({ id: 1, owner: 1, pos: at(0, 500), coreHp: 50 });
    const world = makeWorld({ ships: [shipA, shipB], stations: [stationA, stationB] });

    expect(placeOrder(world, shipA, 'repair')).toBe('ok'); // A repairs -> A cooling
    expect(placeOrder(world, shipA, 'repair')).toBe('cooling-down');
    // B is untouched by A's cooldown — its gate is its own.
    expect(placeOrder(world, shipB, 'repair')).toBe('ok');
    expect(stationA.repairGate).toBeCloseTo(REPAIR_COOLDOWN_SECONDS, 9);
    expect(stationB.repairGate).toBeCloseTo(REPAIR_COOLDOWN_SECONDS, 9);
  });

  it('rations a repair-spamming defender to about one heal per cooldown — stall-free (composes with p5-07b)', () => {
    // Bots inherit the gate through this same order path (their p5-07b rationing
    // sits on top). A defender pressing repair every tick under fire must still get
    // a DEFINITE answer every tick — never a stall — and bank at most one heal per
    // 15 s window, so turtle survivability drops slightly rather than snapping.
    const { ship, world, station } = docked(30, 1000);
    let heals = 0;
    const ticks = Math.round((REPAIR_COOLDOWN_SECONDS * 2) / TICK_DT);
    for (let t = 0; t < ticks; t++) {
      const r = placeOrder(world, ship, 'repair');
      expect(['ok', 'cooling-down', 'core-full']).toContain(r); // always resolved, never hung
      if (r === 'ok') heals++;
      station.sinceDamage = 0; // under continuous fire — the tell can never pace it
      step(world, []);
    }
    // Two cooldown windows of spam buy ~two heals, not 15 HP every tick.
    expect(heals).toBeGreaterThanOrEqual(2);
    expect(heals).toBeLessThanOrEqual(3);
  });

  it('is deterministic: two identical repair-then-wait-then-repair runs deep-equal', () => {
    const run = (): World => {
      const { ship, world } = docked(20, 100);
      placeOrder(world, ship, 'repair');
      for (let t = 0; t < 40; t++) step(world, []); // still cooling
      placeOrder(world, ship, 'repair'); // refused, still cooling
      for (let t = 0; t < 900; t++) step(world, []); // past the gate
      placeOrder(world, ship, 'repair'); // allowed again
      return world;
    };
    expect(run()).toEqual(run());
  });
});

// --- 6. turret target acquisition and fire ---------------------------------

describe('turret auto-fire (GDD §2.6: "turrets deter; the ship defends")', () => {
  const turretWorld = (enemyAt: { x: number; y: number }, over: Partial<Ship> = {}) => {
    const turret = makeTurret({ id: 1, owner: 0, pos: at(0, 0) });
    const station = makeStation({ id: 0, owner: 0, turrets: [turret] });
    const defender = makeShip({ id: 0, pos: at(0, 40) });
    const enemy = makeShip({ id: 1, pos: at(enemyAt.x, enemyAt.y), hull: 1000, maxHull: 1000, ...over });
    return { turret, station, enemy, world: makeWorld({ ships: [defender, enemy], stations: [station] }) };
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

  it('flashes a short flare at the muzzle, never a line to the target (v0.2.2 field report)', () => {
    // A turret firing at a ship far across its range. The muzzle record is the
    // fire *tell* — a burst at the barrel — not the mining-laser beam the funeral
    // retired: it must not carry geometry that reaches the target.
    const targetX = TURRET.range - 20;
    const { turret, enemy, world } = turretWorld({ x: targetX, y: 0 });

    // Step until the turret actually looses a shot (muzzle set on that tick only).
    stepUntil(world, () => turret.muzzle != null, 200);
    const muzzle = turret.muzzle!;
    expect(muzzle).not.toBeNull();

    // The flare is the short, fixed muzzle-flash stub — NOT the barrel→ship
    // distance. That distance is well over 200 units; the flare is 16.
    expect(muzzle.length).toBe(TURRET.muzzleFlashLength);
    const barrelToTarget = Math.hypot(enemy.pos.x - muzzle.origin.x, enemy.pos.y - muzzle.origin.y);
    expect(muzzle.length).toBeLessThan(barrelToTarget / 4);

    // Its far endpoint (what a renderer would stroke to) stays right at the
    // muzzle — nowhere near the ship. No stroked primitive spans turret→target.
    const endX = muzzle.origin.x + muzzle.dir.x * muzzle.length;
    const endY = muzzle.origin.y + muzzle.dir.y * muzzle.length;
    const endToTarget = Math.hypot(enemy.pos.x - endX, enemy.pos.y - endY);
    expect(endToTarget).toBeGreaterThan(barrelToTarget - muzzle.length - 1e-6);

    // No impact point out at the ship (the projectile owns the impact now), so a
    // renderer draws no glow at the target from the flash.
    expect(muzzle.hitPoint).toBeNull();

    // The shot itself still stays: a live projectile is on its way to the ship.
    expect(live(world).length).toBeGreaterThan(0);
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
    expect(world.stations[0]!.turrets).toHaveLength(0); // swept at end of tick
  });
});

// --- 7. the weapon's day-2 targets -----------------------------------------

describe('the weapon finishes its target list (GDD §2.4, design amendment v0.2)', () => {
  it('a shot strips the shield before the core, at the core rate', () => {
    const station = makeStation({ id: 0, owner: 0, shields: [makeShield({ id: 9 })] });
    const attacker = makeShip({ id: 1, pos: at(-(SHIELD.radius + 60), 0), angle: 0 });
    const world = makeWorld({ ships: [attacker], stations: [station] });

    expect(stationTargetRadius(station)).toBe(SHIELD.radius);

    const fire: Inputs = [{ id: 1, actions: [{ type: 'fire', active: true, auto: false }] }];
    const perShot = shipWeaponDamage(attacker) * PROJECTILE_CORE_FACTOR; // core rate
    for (let t = 0; t < Math.round(2 / TICK_DT); t++) step(world, fire);

    // Shots land on the bubble; the core behind it never feels them (GDD §2.6).
    expect(station.coreHp).toBe(CORE_HP);
    const drained = SHIELD.hp - shieldPool(station);
    expect(drained).toBeGreaterThan(0);
    expect(drained / perShot).toBeCloseTo(Math.round(drained / perShot), 6); // whole shots
    // The trigger is held against the bubble, so the firing tell is set.
    expect(attacker.firing).toBe(true);
  });

  it('a shot kills a turret at the ship rate and leaves the core alone', () => {
    const turret = makeTurret({ id: 5, owner: 0, pos: at(-200, 0) });
    const station = makeStation({ id: 0, owner: 0, turrets: [turret] });
    const attacker = makeShip({ id: 1, pos: at(-200 - 120, 0), angle: 0 });
    const world = makeWorld({ ships: [attacker], stations: [station] });

    const fire: Inputs = [{ id: 1, actions: [{ type: 'fire', active: true, auto: false }] }];
    const ticks = stepUntil(world, () => station.turrets.length === 0, 2000, fire);

    // 30 HP at the Vanguard's 10 DPS ≈ 3 s of landed shots, plus a little
    // projectile travel — the shots block on the turret, never reaching the core.
    expect(ticks * TICK_DT).toBeGreaterThan(2.5);
    expect(ticks * TICK_DT).toBeLessThan(4.5);
    expect(station.coreHp).toBe(CORE_HP);
  });

  it('never shoots its owner\'s own station or turrets', () => {
    const turret = makeTurret({ id: 5, owner: 0, pos: at(100, 0) });
    const station = makeStation({ id: 0, owner: 0, pos: at(200, 0), turrets: [turret] });
    const owner = makeShip({ id: 0, pos: at(0, 0), angle: 0 });
    const world = makeWorld({ ships: [owner], stations: [station] });

    const fire: Inputs = [{ id: 0, actions: [{ type: 'fire', active: true, auto: true }] }];
    for (let t = 0; t < 60; t++) step(world, fire);

    expect(turret.hp).toBe(TURRET.hp);
    expect(station.coreHp).toBe(CORE_HP);
    // Auto-aim found no valid enemy target, so nothing was mined or fired.
    expect(owner.firing).toBe(false);
    expect(live(world)).toHaveLength(0);
  });

  it('spawn protection covers the core for its 10 seconds (GDD §2.1)', () => {
    const station = makeStation({ id: 0, owner: 0, spawnProtect: 10 });
    const attacker = makeShip({ id: 1, pos: at(-(STATION.radius + 60), 0), angle: 0 });
    const world = makeWorld({ ships: [attacker], stations: [station] });

    const fire: Inputs = [{ id: 1, actions: [{ type: 'fire', active: true, auto: false }] }];
    for (let t = 0; t < 60; t++) step(world, fire);
    expect(station.coreHp).toBe(CORE_HP);
  });

  it('a core taken to zero becomes a wreck that cannot shoot, shield or repair', () => {
    const station = makeStation({
      id: 0,
      owner: 0,
      coreHp: 4,
      turrets: [makeTurret({ id: 5, owner: 0 })],
      shields: [makeShield({ id: 6, hp: 0 })],
      repairing: true,
    });
    const world = makeWorld({ ships: [makeShip({ id: 0, banked: 10 })], stations: [station] });

    damageStation(world, station, 4);
    expect(station.alive).toBe(false);
    expect(station.coreHp).toBe(0);
    expect(station.repairing).toBe(false);

    step(world, []);
    expect(station.turrets).toHaveLength(0);
    expect(live(world)).toHaveLength(0);
  });
});

// --- 8. the ring layout and determinism ------------------------------------

describe('the ring layout (GDD §2.1)', () => {
  it('gives every slot a station on its own spoke, outboard of its ship', () => {
    const world = createWorld({
      seed: 5,
      players: [
        { id: 0, shipClass: ShipClass.Vanguard },
        { id: 1, shipClass: ShipClass.Hauler },
        { id: 2, shipClass: ShipClass.Interceptor },
      ],
      asteroidCount: 8,
    });

    expect(world.stations).toHaveLength(3);
    const cx = world.bounds.width / 2;
    const cy = world.bounds.height / 2;
    const radii = world.stations.map((p) => Math.hypot(p.pos.x - cx, p.pos.y - cy));

    for (const p of world.stations) {
      expect(p.coreHp).toBe(CORE_HP);
      expect(p.spawnProtect).toBeGreaterThan(0);
      const ship = world.ships.find((s) => s.id === p.owner)!;
      // The ship spawns between the field and its station, inside dock range.
      expect(Math.hypot(ship.pos.x - cx, ship.pos.y - cy)).toBeLessThan(
        Math.hypot(p.pos.x - cx, p.pos.y - cy),
      );
      expect(isDocked(ship, p)).toBe(true);
      expect(stationOf(world, p.owner)).toBe(p);
      // Wholly inside the arena, so nothing is built outside the play area.
      expect(p.pos.x - p.radius).toBeGreaterThanOrEqual(0);
      expect(p.pos.x + p.radius).toBeLessThanOrEqual(world.bounds.width);
    }
    // One ring: every station the same distance from the centre.
    for (const r of radii) expect(r).toBeCloseTo(radii[0]!, 6);
  });

  it('a station is a solid body — you dock at your world, you do not fly through it', () => {
    const station = makeStation({ id: 0, owner: 0, pos: at(0, 0) });
    const ship = makeShip({ id: 0, pos: at(-200, 0), vel: { x: 400, y: 0 } });
    const world = makeWorld({ ships: [ship], stations: [station] });

    const thrust: Inputs = [{ id: 0, actions: [{ type: 'thrust', dir: { x: 1, y: 0 } }] }];
    for (let t = 0; t < Math.round(3 / TICK_DT); t++) {
      step(world, thrust);
      const gap = Math.hypot(ship.pos.x - station.pos.x, ship.pos.y - station.pos.y);
      expect(gap).toBeGreaterThanOrEqual(station.radius + ship.radius - 1e-6);
    }
    // Still docked at the surface it bounced off, which is the point.
    expect(isDocked(ship, station)).toBe(true);
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
    expect(a.stations.some((p) => p.turrets.length + p.builds.length > 0)).toBe(true);
  });
});
