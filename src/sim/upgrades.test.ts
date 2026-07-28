/**
 * src/sim/upgrades.test.ts — day-4 coverage: ship classes take effect
 * (GDD §2.5, §2.11, §2.8).
 *
 * The three contract checks from the brief:
 *   1. every class's derived stats match the GDD §2.11 table — speed, accel,
 *      turn, hull, power, cargo — and match it *through the sim*, not just in
 *      arithmetic;
 *   2. upgrades persist through respawn;
 *   3. a maxed Interceptor is still the fastest thing on the map and a maxed
 *      Hauler still the toughest.
 * Plus what makes those true: the ladder's escalating costs, tiers multiplying
 * the class base, the cargo cap, the purchase's validation and wallet, the
 * action-stream path a bot uses, and determinism with all of it running.
 */

import { describe, it, expect } from 'vitest';
import type { Action } from '@shared/types';
import { ShipClass, UpgradeTrack } from '@shared/types';
import { createWorld, step, type Inputs } from './index';
import { buyUpgrade, spendableOre } from './buildings';
import {
  BASE_ACCEL,
  BASE_SPEED,
  BASE_TURN_RATE,
  WEAPON_DPS_CORE,
  WEAPON_DPS_SHIP,
  CARGO_CAP_MAX,
  CARGO_PER_TIER,
  CORE_HP,
  MINING_RATE,
  STATION,
  SHIELD,
  SHIP_RADIUS,
  SHIP_STATS,
  SHIP_WEAPON,
  SHOT_SPEED_STEPS,
  TICK_DT,
  TRACK_ORDER,
  UPGRADES,
} from './constants';
import {
  maxTier,
  nextUpgradeCost,
  oreSpentOnUpgrades,
  shipAccel,
  shipPower,
  shipCoreDps,
  shipWeaponDps,
  shipWeaponDamage,
  shipProjectileSpeed,
  shipProjectileLife,
  shipCargoCap,
  shipMaxHull,
  shipMiningRate,
  shipTopSpeed,
  shipTurnRate,
  shotDamage,
  shotSpeed,
  stockTiers,
  tierOf,
  type ShipLoadout,
  type UpgradeTiers,
} from './upgrades';
import type { Asteroid, MiningStation, Ship, World } from './state';

// --- builders --------------------------------------------------------------
//
// Same conventions as the day-1/day-2 fixtures: station-relative coordinates well
// inside the arena (the walls are real and would quietly move a ship), and zero
// rocks per wave so the metronome cannot drop asteroids into a test.

const ORIGIN = 2000;
const at = (x: number, y: number) => ({ x: ORIGIN + x, y: ORIGIN + y });

const ALL_CLASSES: readonly ShipClass[] = [
  ShipClass.Interceptor,
  ShipClass.Vanguard,
  ShipClass.Excavator,
  ShipClass.Hauler,
];

/** A loadout at a given tier on every track — the shape the derived-stat
 *  functions take, with no world attached. */
function loadout(shipClass: ShipClass, tier = 0): ShipLoadout {
  return { shipClass, tiers: tiersAt(tier) };
}

/** Every track at `tier`, clamped by each track's own ladder. */
function tiersAt(tier: number): UpgradeTiers {
  const tiers = stockTiers();
  for (const track of TRACK_ORDER) tiers[track] = Math.min(tier, maxTier(track));
  return tiers;
}

/** Every track at its maximum — a fully-kitted hull. */
const maxedTiers = (): UpgradeTiers => tiersAt(Number.MAX_SAFE_INTEGER);

function makeShip(over: Partial<Ship> & Pick<Ship, 'id'>): Ship {
  const cls = over.shipClass ?? ShipClass.Vanguard;
  const load = { shipClass: cls, tiers: over.tiers ?? stockTiers() };
  return {
    id: over.id,
    shipClass: cls,
    tiers: load.tiers,
    pos: over.pos ?? at(0, 0),
    vel: over.vel ?? { x: 0, y: 0 },
    home: over.home ?? at(0, 0),
    angle: over.angle ?? 0,
    hull: over.hull ?? shipMaxHull(load),
    maxHull: over.maxHull ?? shipMaxHull(load),
    cargo: over.cargo ?? 0,
    cargoCap: over.cargoCap ?? shipCargoCap(load),
    banked: over.banked ?? 0,
    alive: over.alive ?? true,
    respawnTimer: over.respawnTimer ?? 0,
    spawnProtect: over.spawnProtect ?? 0,
    eliminated: over.eliminated ?? false,
    radius: over.radius ?? SHIP_RADIUS,
    firing: over.firing ?? false,
  };
}

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

function makeAsteroid(over: Partial<Asteroid> & Pick<Asteroid, 'id'>): Asteroid {
  const ore = over.ore ?? 100;
  return {
    id: over.id,
    pos: over.pos ?? at(0, 0),
    radius: over.radius ?? 30,
    ore,
    maxOre: over.maxOre ?? ore,
    crackStage: over.crackStage ?? 0,
    mineBuffer: over.mineBuffer ?? 0,
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

/** A ship docked at its own live station with `ore` banked — the state every
 *  purchase test needs, since the wheel and the panel are only live at home. */
function dockedWorld(shipClass: ShipClass, ore: number, tiers?: UpgradeTiers): { world: World; ship: Ship } {
  const ship = makeShip({
    id: 0,
    pos: at(0, 0),
    home: at(0, 0),
    banked: ore,
    shipClass,
    ...(tiers ? { tiers } : {}),
  });
  const world = makeWorld({ ships: [ship], stations: [makeStation({ id: 0, owner: 0, pos: at(0, 0) })] });
  return { world, ship };
}

const buyAction = (track: UpgradeTrack): Action => ({ type: 'upgradeOrder', track });
const buy = (id: number, track: UpgradeTrack): Inputs => [{ id, actions: [buyAction(track)] }];
const thrust = (x: number, y: number): Action => ({ type: 'thrust', dir: { x, y } });
const fire = (): Action => ({ type: 'fire', active: true, auto: false });

/** Ticks of full thrust before a measured speed is the terminal one. Drag pulls
 *  the velocity to the top-speed clamp inside a third of a second at every class
 *  and tier, and two seconds keeps even a maxed Interceptor clear of the walls. */
const TERMINAL_TICKS = 120;

// ---------------------------------------------------------------------------
// 1. The GDD §2.11 stat table
// ---------------------------------------------------------------------------

describe('the class stat table (GDD §2.11)', () => {
  // The table, transcribed from the GDD rather than from `SHIP_STATS`, so this
  // test fails if the constants drift away from the design document:
  //
  //   Interceptor (Quadfin)     130% / 120% / 140% / 35 /  8 / 2
  //   Vanguard    (Anvil)       100% / 100% / 100% / 50 / 10 / 2
  //   Excavator   (Pincer)       90% / 100% /  80% / 55 / 13 / 2
  //   Hauler      (Hammerhead)   85% /  80% /  85% / 70 /  9 / 3
  const TABLE: Readonly<
    Record<ShipClass, { speed: number; accel: number; turn: number; hull: number; power: number; cargo: number }>
  > = {
    [ShipClass.Interceptor]: { speed: 1.3, accel: 1.2, turn: 1.4, hull: 35, power: 8, cargo: 2 },
    [ShipClass.Vanguard]: { speed: 1.0, accel: 1.0, turn: 1.0, hull: 50, power: 10, cargo: 2 },
    [ShipClass.Excavator]: { speed: 0.9, accel: 1.0, turn: 0.8, hull: 55, power: 13, cargo: 2 },
    [ShipClass.Hauler]: { speed: 0.85, accel: 0.8, turn: 0.85, hull: 70, power: 9, cargo: 3 },
  };

  it.each(ALL_CLASSES)('derives every stock stat from the table: %s', (cls) => {
    const row = TABLE[cls];
    const stock = loadout(cls);

    expect(shipTopSpeed(stock)).toBeCloseTo(BASE_SPEED * row.speed, 9);
    expect(shipAccel(stock)).toBeCloseTo(BASE_ACCEL * row.accel, 9);
    expect(shipTurnRate(stock)).toBeCloseTo(BASE_TURN_RATE * row.turn, 9);
    expect(shipMaxHull(stock)).toBeCloseTo(row.hull, 9);
    expect(shipPower(stock)).toBeCloseTo(row.power, 9);
    expect(shipCargoCap(stock)).toBe(row.cargo);
  });

  it('keeps the constants table and the GDD table in step', () => {
    for (const cls of ALL_CLASSES) {
      const row = TABLE[cls];
      const stats = SHIP_STATS[cls];
      expect(stats.speedMul).toBeCloseTo(row.speed, 9);
      expect(stats.accelMul).toBeCloseTo(row.accel, 9);
      expect(stats.turnMul).toBeCloseTo(row.turn, 9);
      expect(stats.hull).toBe(row.hull);
      expect(stats.power).toBe(row.power);
      expect(stats.cargo).toBe(row.cargo);
    }
  });

  it('pins the Vanguard to the §2.8 baselines it is the reference for', () => {
    // GDD §2.8 states hull 50, weapon-vs-ships 10, weapon-vs-core 5, mining 0.5 —
    // and §2.11 makes the Vanguard the 100% hull those numbers describe. If this
    // fails, one of the two tables moved without the other.
    const van = loadout(ShipClass.Vanguard);
    expect(shipMaxHull(van)).toBe(50);
    expect(shipWeaponDps(van)).toBeCloseTo(WEAPON_DPS_SHIP, 9);
    expect(shipCoreDps(van)).toBeCloseTo(WEAPON_DPS_CORE, 9);
    expect(shipMiningRate(van)).toBeCloseTo(MINING_RATE, 9);
  });

  it('scales mining and core damage off the one power stat (GDD §2.5)', () => {
    // One weapon, one stat: the Excavator's 13 power must buy it exactly the same
    // proportional advantage at the rock face as at an enemy core.
    for (const cls of ALL_CLASSES) {
      const load = loadout(cls);
      const ratio = shipPower(load) / SHIP_STATS[ShipClass.Vanguard].power;
      expect(shipMiningRate(load)).toBeCloseTo(MINING_RATE * ratio, 9);
      expect(shipCoreDps(load)).toBeCloseTo(WEAPON_DPS_CORE * ratio, 9);
      expect(shipWeaponDps(load)).toBeCloseTo(WEAPON_DPS_SHIP * ratio, 9);
    }
  });

  it('gives each class the top speed it says it has, in the running sim', () => {
    // The table is only real if the step honours it. Hold full thrust for two
    // seconds — long enough for the top-speed clamp to pin the velocity exactly,
    // short enough that the fastest hull never reaches an arena wall, which would
    // zero the very component being measured.
    for (const cls of ALL_CLASSES) {
      const ship = makeShip({ id: 0, pos: at(0, 0), shipClass: cls });
      const world = makeWorld({ ships: [ship] });
      const inputs: Inputs = [{ id: 0, actions: [thrust(1, 0)] }];
      for (let t = 0; t < TERMINAL_TICKS; t++) step(world, inputs);
      const speed = Math.hypot(ship.vel.x, ship.vel.y);
      expect(speed).toBeCloseTo(shipTopSpeed(ship), 6);
    }
  });

  it('gives each class the mining rate it says it has, in the running sim', () => {
    for (const cls of ALL_CLASSES) {
      const ship = makeShip({ id: 0, pos: at(0, 0), shipClass: cls, cargoCap: 999, angle: 0 });
      const rock = makeAsteroid({ id: 1, pos: at(120, 0), ore: 1000 });
      const world = makeWorld({ ships: [ship], asteroids: [rock] });
      const before = rock.ore;
      const SECONDS = 15;
      for (let t = 0; t < 60 * SECONDS; t++) step(world, [{ id: 0, actions: [fire()] }]);
      const rate = (before - rock.ore) / SECONDS;
      // Mining is a projectile now (amendment v0.3): shots land one fire-interval
      // apart, so the running-sim rate is the class's `shipMiningRate`, a hair
      // under by the one-off shot-travel latency. Within ~15%, and never above.
      expect(rate).toBeGreaterThan(shipMiningRate(ship) * 0.85);
      expect(rate).toBeLessThanOrEqual(shipMiningRate(ship) + 1e-6);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The ladder: escalating cost, multiplied bases, the cargo cap
// ---------------------------------------------------------------------------

describe('the upgrade ladder (GDD §2.5, §2.8)', () => {
  it('offers buyable tiers per track, priced cheap-first and escalating', () => {
    for (const track of TRACK_ORDER) {
      const spec = UPGRADES[track];
      // `costs` is always one shorter than `steps` — one price per step up.
      expect(spec.costs.length).toBe(spec.steps.length - 1);
      expect(maxTier(track)).toBe(spec.steps.length - 1);
      // Every track has at least one buyable tier, and each is dearer than the
      // last (GDD §2.5 escalating cost).
      expect(maxTier(track)).toBeGreaterThanOrEqual(1);
      for (let i = 1; i < spec.costs.length; i++) {
        expect(spec.costs[i]!).toBeGreaterThan(spec.costs[i - 1]!);
      }
      // Never free.
      expect(spec.costs[0]!).toBeGreaterThan(0);
      // "first tier cheap" (GDD §2.8) — cheaper than a shield — holds for the
      // four §2.5 tracks. SPEED is the deliberate exception: it is priced a tier
      // above DAMAGE (the stronger buy, v0.2.2 field report), so its first tier
      // sits above a shield's cost on purpose.
      if (track !== UpgradeTrack.Speed) {
        expect(spec.costs[0]!).toBeLessThanOrEqual(SHIELD.cost);
      }
    }
    // SPEED's opening tier is dearer than a shield — and a tier above DAMAGE's.
    expect(UPGRADES[UpgradeTrack.Speed].costs[0]!).toBeGreaterThan(SHIELD.cost);
    expect(UPGRADES[UpgradeTrack.Speed].costs[0]!).toBe(UPGRADES[UpgradeTrack.Power].costs[1]!);
    // The four §2.5 tracks each offer three tiers; SPEED is the ratified
    // two-tier ladder (base → +15% → +30%, v0.2.2 field report).
    expect(maxTier(UpgradeTrack.Power)).toBe(3);
    expect(maxTier(UpgradeTrack.Engine)).toBe(3);
    expect(maxTier(UpgradeTrack.Cargo)).toBe(3);
    expect(maxTier(UpgradeTrack.Hull)).toBe(3);
    expect(maxTier(UpgradeTrack.Speed)).toBe(2);
  });

  it('prices the next step and only the next step', () => {
    const spec = UPGRADES[UpgradeTrack.Power];
    for (let tier = 0; tier < maxTier(UpgradeTrack.Power); tier++) {
      const load = { shipClass: ShipClass.Vanguard, tiers: { ...stockTiers(), [UpgradeTrack.Power]: tier } };
      expect(nextUpgradeCost(load, UpgradeTrack.Power)).toBe(spec.costs[tier]);
    }
    const maxed = { shipClass: ShipClass.Vanguard, tiers: { ...stockTiers(), [UpgradeTrack.Power]: 3 } };
    expect(nextUpgradeCost(maxed, UpgradeTrack.Power)).toBeNull();
  });

  it('bills a fully-maxed hull for the whole ladder', () => {
    const total = TRACK_ORDER.reduce((n, track) => n + UPGRADES[track].costs.reduce((m, c) => m + c, 0), 0);
    expect(oreSpentOnUpgrades({ shipClass: ShipClass.Vanguard, tiers: maxedTiers() })).toBe(total);
    expect(oreSpentOnUpgrades(loadout(ShipClass.Vanguard))).toBe(0);
    // A maxed hull costs a meaningful slice of the whole match's finite field
    // (~400 ore across eight players, GDD §2.8): nobody maxes everything.
    expect(total).toBeGreaterThan(50);
  });

  it('multiplies the class base rather than replacing it (GDD §2.5)', () => {
    // The load-bearing property: the same tier is worth proportionally more to
    // the class that was already better at that stat, so class identity holds.
    for (const cls of ALL_CLASSES) {
      const stock = loadout(cls);
      for (let tier = 1; tier <= 3; tier++) {
        const kitted = loadout(cls, tier);
        const engineStep = UPGRADES[UpgradeTrack.Engine].steps[tier]!;
        const hullStep = UPGRADES[UpgradeTrack.Hull].steps[tier]!;
        const powerStep = UPGRADES[UpgradeTrack.Power].steps[tier]!;

        expect(shipTopSpeed(kitted)).toBeCloseTo(shipTopSpeed(stock) * engineStep, 9);
        expect(shipAccel(kitted)).toBeCloseTo(shipAccel(stock) * engineStep, 9);
        expect(shipMaxHull(kitted)).toBeCloseTo(shipMaxHull(stock) * hullStep, 9);
        expect(shipPower(kitted)).toBeCloseTo(shipPower(stock) * powerStep, 9);
        // Mining and core damage ride the power stat, so they scale with it.
        expect(shipMiningRate(kitted)).toBeCloseTo(shipMiningRate(stock) * powerStep, 9);
        expect(shipCoreDps(kitted)).toBeCloseTo(shipCoreDps(stock) * powerStep, 9);
      }
    }
  });

  it('leaves turn rate to the airframe — no tier buys agility', () => {
    for (const cls of ALL_CLASSES) {
      expect(shipTurnRate(loadout(cls, 3))).toBeCloseTo(shipTurnRate(loadout(cls)), 9);
    }
    // …so the Interceptor still out-turns everything at every tier, including a
    // maxed rival against a stock Interceptor.
    const stockInterceptor = shipTurnRate(loadout(ShipClass.Interceptor));
    for (const cls of ALL_CLASSES) {
      if (cls === ShipClass.Interceptor) continue;
      expect(shipTurnRate(loadout(cls, 3))).toBeLessThan(stockInterceptor);
    }
  });

  it('grows the hold by +2 a tier and stops at 8 (GDD §2.8)', () => {
    for (const cls of ALL_CLASSES) {
      const base = SHIP_STATS[cls].cargo;
      for (let tier = 0; tier <= 3; tier++) {
        const expected = Math.min(CARGO_CAP_MAX, base + CARGO_PER_TIER * tier);
        expect(shipCargoCap(loadout(cls, tier))).toBe(expected);
      }
      expect(shipCargoCap(loadout(cls, 3))).toBeLessThanOrEqual(CARGO_CAP_MAX);
    }
    // The cap is what binds, not the ladder: the Hauler's extra slot is a head
    // start, not a permanent lead — everyone tops out at 8.
    expect(shipCargoCap(loadout(ShipClass.Hauler, 3))).toBe(CARGO_CAP_MAX);
    expect(shipCargoCap(loadout(ShipClass.Vanguard, 3))).toBe(CARGO_CAP_MAX);
    expect(shipCargoCap(loadout(ShipClass.Hauler, 1))).toBeGreaterThan(
      shipCargoCap(loadout(ShipClass.Vanguard, 1)),
    );
  });

  it('clamps a tier it did not write, rather than deriving a NaN stat', () => {
    const wild = { shipClass: ShipClass.Vanguard, tiers: { ...stockTiers(), [UpgradeTrack.Hull]: 99 } };
    expect(tierOf(wild, UpgradeTrack.Hull)).toBe(3);
    expect(shipMaxHull(wild)).toBeCloseTo(shipMaxHull(loadout(ShipClass.Vanguard, 3)), 9);

    const negative = { shipClass: ShipClass.Vanguard, tiers: { ...stockTiers(), [UpgradeTrack.Hull]: -4 } };
    expect(tierOf(negative, UpgradeTrack.Hull)).toBe(0);
    expect(shipMaxHull(negative)).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// 3. Class identity survives the ladder (the brief's headline check)
// ---------------------------------------------------------------------------

describe('class identity at every tier (GDD §2.5, §2.11)', () => {
  it('a maxed Interceptor is still the fastest thing on the map', () => {
    const interceptor = shipTopSpeed({ shipClass: ShipClass.Interceptor, tiers: maxedTiers() });
    for (const cls of ALL_CLASSES) {
      if (cls === ShipClass.Interceptor) continue;
      expect(shipTopSpeed({ shipClass: cls, tiers: maxedTiers() })).toBeLessThan(interceptor);
    }
    // And its lead is *exactly* the lead the class table gave it: because the
    // ladder is one multiplier table shared by all four hulls, spending the whole
    // match's ore on engines cannot narrow the gap by a single unit per second.
    for (const cls of ALL_CLASSES) {
      if (cls === ShipClass.Interceptor) continue;
      const stockRatio = shipTopSpeed(loadout(ShipClass.Interceptor)) / shipTopSpeed(loadout(cls));
      const maxedRatio = interceptor / shipTopSpeed({ shipClass: cls, tiers: maxedTiers() });
      expect(maxedRatio).toBeCloseTo(stockRatio, 9);
    }
  });

  it('a maxed Hauler is still the toughest', () => {
    const hauler = shipMaxHull({ shipClass: ShipClass.Hauler, tiers: maxedTiers() });
    for (const cls of ALL_CLASSES) {
      if (cls === ShipClass.Hauler) continue;
      expect(shipMaxHull({ shipClass: cls, tiers: maxedTiers() })).toBeLessThan(hauler);
    }
  });

  it('keeps every stat ordering identical at stock and at max', () => {
    // The general statement of the two checks above: for each stat, sorting the
    // four hulls by it gives the same order however much ore has been spent —
    // as long as every hull is at the same tier.
    const stats = [shipTopSpeed, shipAccel, shipTurnRate, shipMaxHull, shipPower, shipMiningRate];
    for (const stat of stats) {
      const order = (tier: number) =>
        [...ALL_CLASSES].sort((a, b) => stat(loadout(b, tier)) - stat(loadout(a, tier))).join(',');
      expect(order(3)).toBe(order(0));
    }
  });

  it('keeps the Excavator the mining engine, at stock and maxed', () => {
    for (const tier of [0, 3]) {
      const excavator = shipMiningRate(loadout(ShipClass.Excavator, tier));
      for (const cls of ALL_CLASSES) {
        if (cls === ShipClass.Excavator) continue;
        expect(shipMiningRate(loadout(cls, tier))).toBeLessThan(excavator);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3b. The WEAPON group — DAMAGE and SPEED are two tracks (v0.2.2 field report)
// ---------------------------------------------------------------------------
//
// The developer's projectile design is "upgrades to make them faster, stronger"
// — two separate buys. DAMAGE (`UpgradeTrack.Power`) is how hard a shot bites;
// SPEED (`UpgradeTrack.Speed`) is muzzle velocity, and nothing else. The two are
// a WEAPON group in the ladder metadata, and they move independently.

describe('the WEAPON group — DAMAGE and SPEED (v0.2.2 field report)', () => {
  it('carries wedge metadata: label, unit, and the weapon group tag', () => {
    const damage = UPGRADES[UpgradeTrack.Power];
    const speed = UPGRADES[UpgradeTrack.Speed];
    // DAMAGE reads "DAMAGE /hit"; the enum key stays `Power` but the wedge label
    // is the relabel the field report asked for.
    expect(damage.label).toBe('DAMAGE');
    expect(damage.unit).toBe('/hit');
    expect(damage.group).toBe('weapon');
    // SPEED reads "SPEED %".
    expect(speed.label).toBe('SPEED');
    expect(speed.unit).toBe('%');
    expect(speed.group).toBe('weapon');
    // Every wedge names what it upgrades and carries a unit string — no bare,
    // ambiguous number (field report item 4).
    for (const track of TRACK_ORDER) {
      const spec = UPGRADES[track];
      expect(spec.label.length).toBeGreaterThan(0);
      expect(typeof spec.unit).toBe('string');
    }
    // DAMAGE and SPEED are the only members of the weapon group, and they are
    // contiguous in the iteration order so the sub-wheel reads as one unit.
    const weapon = TRACK_ORDER.filter((t) => UPGRADES[t].group === 'weapon');
    expect(weapon).toEqual([UpgradeTrack.Power, UpgradeTrack.Speed]);
  });

  it('SPEED tiers scale muzzle velocity — base → +15% → +30% — and nothing else', () => {
    const base = SHIP_WEAPON.projectileSpeed;
    for (const cls of ALL_CLASSES) {
      const stock: ShipLoadout = { shipClass: cls, tiers: stockTiers() };
      // Every hull's stock shot shares one dodgeable base velocity — class
      // identity lives in DAMAGE, never in speed.
      expect(shipProjectileSpeed(stock)).toBeCloseTo(base, 9);
      for (let tier = 1; tier <= maxTier(UpgradeTrack.Speed); tier++) {
        const kitted: ShipLoadout = {
          shipClass: cls,
          tiers: { ...stockTiers(), [UpgradeTrack.Speed]: tier },
        };
        expect(shipProjectileSpeed(kitted)).toBeCloseTo(base * SHOT_SPEED_STEPS[tier]!, 9);
        // A SPEED buy leaves per-hit damage untouched — the split is real.
        expect(shipWeaponDamage(kitted)).toBeCloseTo(shipWeaponDamage(stock), 9);
        // A faster shot reaches the SAME range, not further (life = range / speed).
        expect(shipProjectileLife(kitted)).toBeCloseTo(
          SHIP_WEAPON.range / shipProjectileSpeed(kitted),
          9,
        );
      }
    }
    // The ratified deltas, spelled out: +15% then +30% over base.
    expect(SHOT_SPEED_STEPS[1]! / SHOT_SPEED_STEPS[0]!).toBeCloseTo(1.15, 9);
    expect(SHOT_SPEED_STEPS[2]! / SHOT_SPEED_STEPS[0]!).toBeCloseTo(1.3, 9);
  });

  it('DAMAGE tiers scale per-hit damage and leave muzzle velocity alone', () => {
    for (const cls of ALL_CLASSES) {
      const stock: ShipLoadout = { shipClass: cls, tiers: stockTiers() };
      for (let tier = 1; tier <= maxTier(UpgradeTrack.Power); tier++) {
        const kitted: ShipLoadout = {
          shipClass: cls,
          tiers: { ...stockTiers(), [UpgradeTrack.Power]: tier },
        };
        const step = UPGRADES[UpgradeTrack.Power].steps[tier]!;
        expect(shipWeaponDamage(kitted)).toBeCloseTo(shipWeaponDamage(stock) * step, 9);
        // Buying DAMAGE never speeds the shot up — that is SPEED's job alone.
        expect(shipProjectileSpeed(kitted)).toBeCloseTo(shipProjectileSpeed(stock), 9);
      }
    }
  });

  it('shotDamage / shotSpeed are the canonical WEAPON-group accessors', () => {
    for (const cls of ALL_CLASSES) {
      for (let tier = 0; tier <= 2; tier++) {
        const load: ShipLoadout = {
          shipClass: cls,
          tiers: {
            ...stockTiers(),
            [UpgradeTrack.Power]: tier,
            [UpgradeTrack.Speed]: Math.min(tier, maxTier(UpgradeTrack.Speed)),
          },
        };
        expect(shotDamage(load)).toBe(shipWeaponDamage(load));
        expect(shotSpeed(load)).toBe(shipProjectileSpeed(load));
      }
    }
  });

  it("charges SPEED's escalating cost — a tier above DAMAGE — one step at a time", () => {
    const spec = UPGRADES[UpgradeTrack.Speed];
    const total = spec.costs.reduce((n, c) => n + c, 0);
    const { world, ship } = dockedWorld(ShipClass.Vanguard, total);
    for (let tier = 0; tier < maxTier(UpgradeTrack.Speed); tier++) {
      const before = spendableOre(ship);
      const beforeSpeed = shipProjectileSpeed(ship);
      expect(buyUpgrade(world, ship, UpgradeTrack.Speed)).toBe('ok');
      expect(ship.tiers[UpgradeTrack.Speed]).toBe(tier + 1);
      expect(before - spendableOre(ship)).toBeCloseTo(spec.costs[tier]!, 9);
      // The purchase actually made the shot faster.
      expect(shipProjectileSpeed(ship)).toBeGreaterThan(beforeSpeed);
    }
    expect(spendableOre(ship)).toBeCloseTo(0, 9);
    // Priced a tier above DAMAGE at each rung — speed is the stronger buy.
    const damage = UPGRADES[UpgradeTrack.Power];
    expect(spec.costs[0]!).toBe(damage.costs[1]!);
    expect(spec.costs[1]!).toBe(damage.costs[2]!);
  });
});

// ---------------------------------------------------------------------------
// 4. Buying a tier (GDD §2.5 — validated like any wheel order)
// ---------------------------------------------------------------------------

describe('buying an upgrade (GDD §2.5)', () => {
  it('spends the escalating cost and raises the tier, one step at a time', () => {
    const spec = UPGRADES[UpgradeTrack.Power];
    const total = spec.costs.reduce((n, c) => n + c, 0);
    const { world, ship } = dockedWorld(ShipClass.Vanguard, total);

    for (let tier = 0; tier < 3; tier++) {
      const before = spendableOre(ship);
      expect(buyUpgrade(world, ship, UpgradeTrack.Power)).toBe('ok');
      expect(ship.tiers[UpgradeTrack.Power]).toBe(tier + 1);
      expect(before - spendableOre(ship)).toBeCloseTo(spec.costs[tier]!, 9);
    }
    expect(spendableOre(ship)).toBeCloseTo(0, 9);
    expect(shipPower(ship)).toBeCloseTo(SHIP_STATS[ShipClass.Vanguard].power * spec.steps[3]!, 9);
  });

  it('refuses a fourth tier — the ladder has an end', () => {
    const { world, ship } = dockedWorld(ShipClass.Vanguard, 100, maxedTiers());
    for (const track of TRACK_ORDER) {
      expect(buyUpgrade(world, ship, track)).toBe('maxed');
    }
    expect(spendableOre(ship)).toBe(100);
  });

  it('refuses a purchase the player cannot afford, and charges nothing', () => {
    const cost = UPGRADES[UpgradeTrack.Power].costs[0]!;
    const { world, ship } = dockedWorld(ShipClass.Vanguard, cost - 1);
    expect(buyUpgrade(world, ship, UpgradeTrack.Power)).toBe('cannot-afford');
    expect(ship.tiers[UpgradeTrack.Power]).toBe(0);
    expect(spendableOre(ship)).toBe(cost - 1);
  });

  it('requires the ship to be at its own living station', () => {
    const cost = UPGRADES[UpgradeTrack.Power].costs[0]!;

    // Out in the field, far from home: the panel is not live (GDD §2.5).
    const away = dockedWorld(ShipClass.Vanguard, cost);
    away.ship.pos = at(STATION.dockRange + 50, 0);
    expect(buyUpgrade(away.world, away.ship, UpgradeTrack.Power)).toBe('not-docked');

    // Docked, but the home is a wreck: this player's match is over.
    const dead = dockedWorld(ShipClass.Vanguard, cost);
    dead.world.stations[0]!.alive = false;
    expect(buyUpgrade(dead.world, dead.ship, UpgradeTrack.Power)).toBe('station-dead');

    // No station at all (a spectator, or a slot with no home).
    const homeless = dockedWorld(ShipClass.Vanguard, cost);
    homeless.world.stations = [];
    expect(buyUpgrade(homeless.world, homeless.ship, UpgradeTrack.Power)).toBe('no-station');

    // A dead ship buys nothing, even sitting on top of its station — and the
    // refusal names the true reason, `dead`, not a misleading `not-docked`: a
    // purchase is a live action, and a wreck on the respawn clock takes none
    // (v0.2.2 field report, ratified; see tests/sim/upgrade-after-respawn).
    const corpse = dockedWorld(ShipClass.Vanguard, cost);
    corpse.ship.alive = false;
    expect(buyUpgrade(corpse.world, corpse.ship, UpgradeTrack.Power)).toBe('dead');
  });

  it('pays hold-first, then the bank — banking is still a real decision', () => {
    const cost = UPGRADES[UpgradeTrack.Cargo].costs[0]!;
    const { world, ship } = dockedWorld(ShipClass.Hauler, cost);
    ship.cargo = 1;
    ship.banked = cost - 1;

    expect(buyUpgrade(world, ship, UpgradeTrack.Cargo)).toBe('ok');
    expect(ship.cargo).toBe(0);
    expect(ship.banked).toBeCloseTo(0, 9);
  });

  it('still sells tiers after collapse — the supply ends, the shop does not', () => {
    // GDD §2.3 spells collapse out as exactly three rules: no shield regen, no
    // repair, no new ore. Ore already in hand still buys what it always bought,
    // which is what makes banking instead of turtling pay off (GDD §2.6).
    const { world, ship } = dockedWorld(ShipClass.Vanguard, 20);
    world.match.collapseTime = 1;
    world.match.phase = 'collapse';
    expect(buyUpgrade(world, ship, UpgradeTrack.Power)).toBe('ok');
    expect(ship.tiers[UpgradeTrack.Power]).toBe(1);
  });

  it('widens the hold immediately, and never over the cap', () => {
    const { world, ship } = dockedWorld(ShipClass.Hauler, 100);
    expect(ship.cargoCap).toBe(3);
    expect(buyUpgrade(world, ship, UpgradeTrack.Cargo)).toBe('ok');
    expect(ship.cargoCap).toBe(5);
    expect(buyUpgrade(world, ship, UpgradeTrack.Cargo)).toBe('ok');
    expect(ship.cargoCap).toBe(7);
    expect(buyUpgrade(world, ship, UpgradeTrack.Cargo)).toBe('ok');
    expect(ship.cargoCap).toBe(CARGO_CAP_MAX);
  });

  it('bolts on new plate without healing the damage already taken (GDD §2.5)', () => {
    // Hull is not repairable at all. Buying a tier hands over the *difference*,
    // so a wounded ship keeps every point of damage it was carrying.
    const { world, ship } = dockedWorld(ShipClass.Vanguard, 100);
    ship.hull = 10;
    const missingBefore = ship.maxHull - ship.hull;

    expect(buyUpgrade(world, ship, UpgradeTrack.Hull)).toBe('ok');
    expect(ship.maxHull).toBeCloseTo(50 * UPGRADES[UpgradeTrack.Hull].steps[1]!, 9);
    expect(ship.hull).toBeCloseTo(10 + (ship.maxHull - 50), 9);
    expect(ship.maxHull - ship.hull).toBeCloseTo(missingBefore, 9);
    expect(ship.hull).toBeLessThan(ship.maxHull);
  });
});

// ---------------------------------------------------------------------------
// 5. Through the action stream — the path a bot and a human share
// ---------------------------------------------------------------------------

describe('the upgradeOrder action (GDD §2.4, §2.9)', () => {
  it('buys one tier per press and never latches', () => {
    const { world, ship } = dockedWorld(ShipClass.Vanguard, 100);
    const inputs = buy(0, UpgradeTrack.Engine);

    step(world, inputs);
    expect(ship.tiers[UpgradeTrack.Engine]).toBe(1);

    // The action is one-shot: it is acted on for the tick it appears in. Ticks
    // that carry no order buy nothing, so a held key cannot drain a bank.
    for (let t = 0; t < 30; t++) step(world, []);
    expect(ship.tiers[UpgradeTrack.Engine]).toBe(1);

    step(world, inputs);
    expect(ship.tiers[UpgradeTrack.Engine]).toBe(2);
  });

  it('makes a bought engine tier visible as real speed in the sim', () => {
    const { world, ship } = dockedWorld(ShipClass.Vanguard, 100);
    const stockTop = shipTopSpeed(ship);

    step(world, buy(0, UpgradeTrack.Engine));
    expect(shipTopSpeed(ship)).toBeCloseTo(stockTop * UPGRADES[UpgradeTrack.Engine].steps[1]!, 9);

    // Fly it: the measured terminal speed is the upgraded one, and the ship is
    // faster than a stock hull of the same class flown for the same time.
    const control = makeShip({ id: 1, pos: at(0, 800), shipClass: ShipClass.Vanguard });
    world.ships.push(control);
    const inputs: Inputs = [
      { id: 0, actions: [thrust(0, -1)] },
      { id: 1, actions: [thrust(0, -1)] },
    ];
    for (let t = 0; t < TERMINAL_TICKS; t++) step(world, inputs);

    expect(Math.hypot(ship.vel.x, ship.vel.y)).toBeCloseTo(shipTopSpeed(ship), 6);
    expect(Math.hypot(control.vel.x, control.vel.y)).toBeCloseTo(stockTop, 6);
    expect(Math.hypot(ship.vel.x, ship.vel.y)).toBeGreaterThan(Math.hypot(control.vel.x, control.vel.y));
  });

  it('makes a bought power tier mine faster and hit harder', () => {
    const spec = UPGRADES[UpgradeTrack.Power];
    const { world, ship } = dockedWorld(ShipClass.Vanguard, 100);
    step(world, buy(0, UpgradeTrack.Power));
    expect(ship.tiers[UpgradeTrack.Power]).toBe(1);

    // Mining faster: mining is a projectile now (amendment v0.3), so compare the
    // upgraded ship's ore/s against a stock control over the same window and
    // standoff rather than pin an exact continuous rate. The chip rides the power
    // multiplier, so the ratio is the power tier's step.
    const measure = (tiers: UpgradeTiers): number => {
      const shooter = makeShip({ id: 0, pos: at(0, 0), angle: 0, cargoCap: 999, tiers });
      const rock = makeAsteroid({ id: 7, pos: at(120, 0), ore: 1000 });
      const w = makeWorld({ ships: [shooter], asteroids: [rock] });
      const before = rock.ore;
      const SECONDS = 12;
      for (let t = 0; t < 60 * SECONDS; t++) step(w, [{ id: 0, actions: [fire()] }]);
      return (before - rock.ore) / SECONDS;
    };
    const upgraded = measure(ship.tiers);
    const stock = measure(stockTiers());
    expect(upgraded).toBeGreaterThan(stock); // the bought power tier mines faster
    expect(upgraded / stock).toBeCloseTo(spec.steps[1]!, 1); // ×1.25, the power step

    // Weapon: the same tier, the same multiplier, against an enemy core.
    expect(shipWeaponDps(ship)).toBeCloseTo(WEAPON_DPS_SHIP * spec.steps[1]!, 9);
    expect(shipCoreDps(ship)).toBeCloseTo(WEAPON_DPS_CORE * spec.steps[1]!, 9);
  });

  it('replays identically — a purchase is deterministic (GDD §4.8)', () => {
    const config = {
      seed: 0xd4c1a55e,
      players: [
        { id: 0, shipClass: ShipClass.Interceptor },
        { id: 1, shipClass: ShipClass.Hauler },
      ],
      asteroidCount: 6,
    } as const;

    const script = (tick: number): Inputs => [
      {
        id: 0,
        actions: tick === 5 ? [buyAction(UpgradeTrack.Power), thrust(1, 0)] : [thrust(1, 0), fire()],
      },
      { id: 1, actions: tick === 9 ? [buyAction(UpgradeTrack.Hull)] : [thrust(-1, 0.5)] },
    ];

    const run = () => {
      const world = createWorld(config);
      for (let t = 0; t < 240; t++) step(world, script(t));
      return world;
    };

    expect(run()).toEqual(run());
  });
});

// ---------------------------------------------------------------------------
// 6. Upgrades persist through respawn (GDD §2.5, §2.7)
// ---------------------------------------------------------------------------

describe('upgrades persist through respawn (GDD §2.5, §2.7)', () => {
  it('brings back every tier, with the ceilings re-derived from them', () => {
    const { world, ship } = dockedWorld(ShipClass.Excavator, 100);
    // Buy one of everything, then note what the hull became.
    for (const track of TRACK_ORDER) {
      expect(buyUpgrade(world, ship, track)).toBe('ok');
    }
    const tiers = { ...ship.tiers };
    const maxHull = ship.maxHull;
    const cargoCap = ship.cargoCap;
    const banked = ship.banked;
    expect(maxHull).toBeGreaterThan(SHIP_STATS[ShipClass.Excavator].hull);

    // Die out in the field with a part-full hold.
    ship.pos = at(600, 0);
    ship.cargo = 2;
    ship.hull = 1;
    world.ships.push(makeShip({ id: 1, pos: at(600, 40), shipClass: ShipClass.Vanguard, angle: -Math.PI / 2 }));
    for (let t = 0; t < 60 && ship.alive; t++) {
      step(world, [{ id: 1, actions: [{ type: 'aim', dir: { x: 0, y: -1 } }, fire()] }]);
    }
    expect(ship.alive).toBe(false);

    // …and come back five seconds later, exactly as well equipped.
    for (let t = 0; t < Math.ceil(5 / TICK_DT) + 2 && !ship.alive; t++) step(world, []);
    expect(ship.alive).toBe(true);
    expect(ship.tiers).toEqual(tiers);
    expect(ship.maxHull).toBeCloseTo(maxHull, 9);
    expect(ship.hull).toBeCloseTo(maxHull, 9);
    expect(ship.cargoCap).toBe(cargoCap);
    expect(ship.banked).toBeCloseTo(banked, 9);
    expect(shipTopSpeed(ship)).toBeCloseTo(shipTopSpeed({ shipClass: ShipClass.Excavator, tiers }), 9);
    expect(shipMiningRate(ship)).toBeCloseTo(shipMiningRate({ shipClass: ShipClass.Excavator, tiers }), 9);
  });

  it('survives repeated deaths — tiers are match state, not ship state', () => {
    const { world, ship } = dockedWorld(ShipClass.Vanguard, 100);
    step(world, buy(0, UpgradeTrack.Hull));
    step(world, buy(0, UpgradeTrack.Cargo));
    const tiers = { ...ship.tiers };
    const maxHull = ship.maxHull;

    for (let life = 0; life < 3; life++) {
      ship.hull = 1;
      ship.alive = false;
      ship.respawnTimer = 5;
      for (let t = 0; t < Math.ceil(5 / TICK_DT) + 2 && !ship.alive; t++) step(world, []);
      expect(ship.alive).toBe(true);
      expect(ship.tiers).toEqual(tiers);
      expect(ship.maxHull).toBeCloseTo(maxHull, 9);
      expect(ship.hull).toBeCloseTo(maxHull, 9);
    }
  });

  it('starts every hull in a fresh match stock', () => {
    const world = createWorld({
      seed: 1,
      players: ALL_CLASSES.map((shipClass, id) => ({ id, shipClass })),
      asteroidCount: 0,
    });
    for (const ship of world.ships) {
      expect(ship.tiers).toEqual(stockTiers());
      expect(oreSpentOnUpgrades(ship)).toBe(0);
      expect(ship.maxHull).toBe(SHIP_STATS[ship.shipClass].hull);
      expect(ship.hull).toBe(ship.maxHull);
      expect(ship.cargoCap).toBe(SHIP_STATS[ship.shipClass].cargo);
    }
  });
});
