/**
 * src/sim/upgrades.ts — where a hull choice and a spent ore become a number.
 * OWNER: Gameplay Engineer.
 *
 * This module is the single place the simulation answers "how fast, how tough,
 * how hard does *this* ship hit?" It resolves the two layers GDD §2.11 and §2.5
 * stack on each other:
 *
 *  1. **The class base** (GDD §2.11) — the lobby choice, locked for the match,
 *     setting top speed, acceleration, turn rate, hull HP, power and cargo.
 *  2. **The upgrade tiers** (GDD §2.5) — bought with ore, one step at a time, at
 *     an escalating cost, and *multiplying* the class base.
 *
 * That multiplication is load-bearing, not incidental:
 *
 * > Upgrades *multiply* the class base stats (2.11), so a maxed Interceptor is
 * > still the fastest thing on the map and a maxed Hauler still the toughest.
 * > (GDD §2.5)
 *
 * Because all four hulls climb the same multiplier ladder, that property is
 * structural — no tier ordering can reorder the classes, so QA's "no class
 * exceeds a 55% win rate" target (GDD §2.11) is a balance question about the
 * *bases*, never an accident of the ladder.
 *
 * Everything here is a **pure function of a loadout** — `{ shipClass, tiers }`,
 * which a `Ship` satisfies structurally. No world, no dt, no mutation (except
 * the two explicitly-named appliers at the bottom), so the derived-stat table is
 * testable without building a match, and the sim can call it in a hot loop.
 *
 * The purchase itself lives in `./buildings` next to the rest of the Build &
 * Upgrade wheel's spending, because it needs the same validation every wheel
 * order gets: own station, docked, alive, affordable (GDD §2.5).
 */

import { UpgradeTrack, type ShipClass } from '@shared/types';
import {
  BASE_ACCEL,
  BASE_SPEED,
  BASE_TURN_RATE,
  WEAPON_DPS_CORE,
  WEAPON_DPS_SHIP,
  CARGO_BASE,
  MINING_RATE,
  SHIP_STATS,
  SHIP_WEAPON,
  TRACK_ORDER,
  UPGRADES,
  VANGUARD_POWER,
  type UpgradeTrackSpec,
} from './constants';

// ---------------------------------------------------------------------------
// Tiers — the state a purchase writes
// ---------------------------------------------------------------------------

/**
 * A player's tier on each track; 0 is the stock hull. Plain mutable data, keyed
 * by the ratified {@link UpgradeTrack} names, so it lives in the world tree,
 * serializes into a snapshot, and hashes under the determinism replay like
 * everything else (GDD §4.1, §4.8).
 *
 * This is **match-lifetime** state, not ship-lifetime: upgrades persist through
 * respawn (GDD §2.5, §2.7), which in practice means nothing on the respawn path
 * touches it — see `respawn` in `./step`.
 */
export type UpgradeTiers = Record<UpgradeTrack, number>;

/** A fresh, un-upgraded ship — every track at tier 0. */
export function stockTiers(): UpgradeTiers {
  return {
    [UpgradeTrack.Power]: 0,
    [UpgradeTrack.Speed]: 0,
    [UpgradeTrack.Engine]: 0,
    [UpgradeTrack.Cargo]: 0,
    [UpgradeTrack.Hull]: 0,
  };
}

/** The minimum a derived stat needs: the hull you chose and the tiers you own.
 *  A `Ship` satisfies this structurally, so the sim passes ships straight in and
 *  tests can pass a bare loadout. */
export interface ShipLoadout {
  readonly shipClass: ShipClass;
  readonly tiers: UpgradeTiers;
}

// ---------------------------------------------------------------------------
// Reading the ladder
// ---------------------------------------------------------------------------

/** The ladder for one track (GDD §2.5, TUNABLE — `./constants`). */
export function trackSpec(track: UpgradeTrack): UpgradeTrackSpec {
  return UPGRADES[track];
}

/** Highest tier a track offers. Tier 0 is stock, so this is `steps.length - 1`. */
export function maxTier(track: UpgradeTrack): number {
  return UPGRADES[track].steps.length - 1;
}

/** A loadout's tier on a track, clamped into the ladder — the sim never trusts a
 *  tier it did not write, and a retune that shortens a ladder must not produce a
 *  `NaN` stat on a ship that had already climbed past the new top. */
export function tierOf(loadout: ShipLoadout, track: UpgradeTrack): number {
  const raw = loadout.tiers[track];
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(Math.floor(raw), maxTier(track)));
}

/**
 * Ore price of the *next* tier on a track, or `null` when the ladder is finished
 * — which is also how the purchase path spells "maxed" (GDD §2.5: escalating
 * cost, bought one step at a time).
 */
export function nextUpgradeCost(loadout: ShipLoadout, track: UpgradeTrack): number | null {
  const tier = tierOf(loadout, track);
  if (tier >= maxTier(track)) return null;
  return UPGRADES[track].costs[tier] ?? null;
}

/** Total ore a loadout has sunk into its hull so far — every step already
 *  climbed, on every track. The bill for a maxed ship, and the number a balance
 *  pass measures the ladder against the field's finite yield (GDD §2.8). */
export function oreSpentOnUpgrades(loadout: ShipLoadout): number {
  let total = 0;
  for (const track of TRACK_ORDER) {
    const tier = tierOf(loadout, track);
    const costs = UPGRADES[track].costs;
    for (let i = 0; i < tier; i++) total += costs[i] ?? 0;
  }
  return total;
}

/** Apply a track's tier to a class base, honouring the spec's mode and ceiling.
 *  The one arithmetic path every derived stat below goes through, so `multiply`
 *  vs `add` and the cargo cap are decided in exactly one place. */
function applyTier(base: number, spec: UpgradeTrackSpec, tier: number): number {
  const step = spec.steps[tier] ?? (spec.mode === 'multiply' ? 1 : 0);
  const raw = spec.mode === 'multiply' ? base * step : base + step;
  return spec.max === null ? raw : Math.min(raw, spec.max);
}

/** The multiplier (or flat step) a loadout's tier contributes on a track. */
export function tierStep(loadout: ShipLoadout, track: UpgradeTrack): number {
  const spec = UPGRADES[track];
  return spec.steps[tierOf(loadout, track)] ?? (spec.mode === 'multiply' ? 1 : 0);
}

// ---------------------------------------------------------------------------
// The derived stats — GDD §2.11 base × GDD §2.5 ladder
// ---------------------------------------------------------------------------

/** Top speed (world units/s): the class multiplier over `BASE_SPEED`, scaled by
 *  the engine ladder (GDD §2.11 "top speed", §2.5 "engine speed"). */
export function shipTopSpeed(loadout: ShipLoadout): number {
  const base = BASE_SPEED * SHIP_STATS[loadout.shipClass].speedMul;
  return applyTier(base, UPGRADES[UpgradeTrack.Engine], tierOf(loadout, UpgradeTrack.Engine));
}

/** Acceleration (units/s²) at full thrust — class multiplier over `BASE_ACCEL`,
 *  scaled by the *same* engine tier as top speed: one engine, both numbers. */
export function shipAccel(loadout: ShipLoadout): number {
  const base = BASE_ACCEL * SHIP_STATS[loadout.shipClass].accelMul;
  return applyTier(base, UPGRADES[UpgradeTrack.Engine], tierOf(loadout, UpgradeTrack.Engine));
}

/** Turn rate (rad/s) — class only. No ladder touches it: turning is the
 *  airframe, so the Interceptor's 140% is agility nobody can buy their way to. */
export function shipTurnRate(loadout: ShipLoadout): number {
  return BASE_TURN_RATE * SHIP_STATS[loadout.shipClass].turnMul;
}

/** Max hull HP — the class's absolute armor, scaled by the hull ladder. */
export function shipMaxHull(loadout: ShipLoadout): number {
  const base = SHIP_STATS[loadout.shipClass].hull;
  return applyTier(base, UPGRADES[UpgradeTrack.Hull], tierOf(loadout, UpgradeTrack.Hull));
}

/** Cargo slots — the class's base hold plus `+2` per tier, hard-capped at 8
 *  (GDD §2.8). `CARGO_BASE` floors it so a retuned class table can never hand a
 *  hull a smaller hold than the design's stated minimum. */
export function shipCargoCap(loadout: ShipLoadout): number {
  const base = Math.max(CARGO_BASE, SHIP_STATS[loadout.shipClass].cargo);
  return applyTier(base, UPGRADES[UpgradeTrack.Cargo], tierOf(loadout, UpgradeTrack.Cargo));
}

/** The power stat — one number for mining speed *and* weapon damage (GDD §2.5).
 *  Every power-derived rate below is a function of this and nothing else, so the
 *  "one weapon, one stat" rule cannot drift apart in two places. */
export function shipPower(loadout: ShipLoadout): number {
  const base = SHIP_STATS[loadout.shipClass].power;
  return applyTier(base, UPGRADES[UpgradeTrack.Power], tierOf(loadout, UpgradeTrack.Power));
}

/** DPS this ship deals to hulls and turrets: the power stat, directly
 *  (Vanguard stock = `WEAPON_DPS_SHIP` = 10). */
export function shipWeaponDps(loadout: ShipLoadout): number {
  return shipPower(loadout);
}

/** DPS this ship deals to shields and cores — the power stat at the Vanguard's
 *  core:ship ratio (5:10), so a stock Vanguard hits a core for `WEAPON_DPS_CORE`. */
export function shipCoreDps(loadout: ShipLoadout): number {
  return shipPower(loadout) * (WEAPON_DPS_CORE / WEAPON_DPS_SHIP);
}

/** Ore per second at the mining face — `MINING_RATE` scaled by this ship's power
 *  against the Vanguard baseline, so a stock Vanguard mines exactly 0.5/s. Since
 *  mining is a projectile now (amendment v0.3), this is the *target* steady-state
 *  rate the per-hit chip (`shipMineYield`) is sized to hit, not a per-tick draw. */
export function shipMiningRate(loadout: ShipLoadout): number {
  return MINING_RATE * (shipPower(loadout) / VANGUARD_POWER);
}

/**
 * Ore chipped by one of this ship's weapon projectiles when it strikes an
 * asteroid — mining is shooting now (ratified amendment v0.3). It is the ship's
 * continuous mining rate spread over one fire interval, so a ship holding fire at
 * the mining face extracts ore at exactly `shipMiningRate` (shots land one
 * `SHIP_WEAPON.fireInterval` apart), and the chip still rides the one power stat —
 * mining speed and weapon damage move together (GDD §2.5). `MINING_YIELD_PER_HIT`
 * is the Vanguard baseline this scales from.
 */
export function shipMineYield(loadout: ShipLoadout): number {
  return shipMiningRate(loadout) * SHIP_WEAPON.fireInterval;
}

// ---------------------------------------------------------------------------
// Weapon projectile stats (design amendments v0.2 / v0.3 — everything is a shot)
// ---------------------------------------------------------------------------
//
// Ship-vs-ship, ship-vs-structure, and (since v0.3) mining all fire a pooled
// projectile (`./projectiles`) instead of a hitscan ray. "Make them faster,
// stronger" (the developer's own words) is now TWO upgrade tracks, not one
// (v0.2.2 field report):
//
//  - DAMAGE (`UpgradeTrack.Power`) — how hard a shot bites. Rides the class power
//    stat, so mining speed and weapon damage still move together, one stat
//    (GDD §2.5). This is `shotDamage`.
//  - SPEED (`UpgradeTrack.Speed`) — muzzle velocity, and nothing else. A faster
//    shot is harder to dodge, so it lands the damage you already have more often.
//    This is `shotSpeed`, and it is deliberately independent of the class power
//    stat: every hull's stock shot shares one dodgeable base velocity, and only
//    the SPEED track buys "faster".
//
// A stock ship's shot is dodgeable at combat range (the whole point of the switch
// to projectiles); a player buys DAMAGE to punish the hits that land and SPEED to
// make more of them land — separate decisions, separate wedges.

/** Per-shot weapon damage vs a ship or turret — this ship's power DPS over one
 *  fire interval, so the delivered DPS *if every shot lands* is exactly the power
 *  stat the old hitscan weapon dealt (GDD §2.8). Missing is the new skill floor.
 *  Rides the DAMAGE track (`UpgradeTrack.Power`); see {@link shotDamage}. */
export function shipWeaponDamage(loadout: ShipLoadout): number {
  return shipWeaponDps(loadout) * SHIP_WEAPON.fireInterval;
}

/** Muzzle speed (world units/s) of this ship's weapon projectile — the base speed
 *  scaled by the SPEED upgrade tier's multiplier (tier 0 = base). Only the SPEED
 *  *upgrade* multiplier, not the class power stat, so every hull's stock shot has
 *  the same dodgeable base velocity and the SPEED track alone buys "faster". */
export function shipProjectileSpeed(loadout: ShipLoadout): number {
  return SHIP_WEAPON.projectileSpeed * speedTierMul(loadout);
}

/** Flight lifetime (seconds) of this ship's weapon projectile — `range / speed`,
 *  so a faster (upgraded) shot still reaches the same weapon range rather than
 *  out-ranging it. */
export function shipProjectileLife(loadout: ShipLoadout): number {
  return SHIP_WEAPON.range / shipProjectileSpeed(loadout);
}

/** The SPEED track's *multiplier* for this loadout (1 at tier 0). Distinct from
 *  {@link shipPower}, which folds in the class base — muzzle speed wants only the
 *  upgrade multiplier so class identity stays in DAMAGE, not velocity. */
function speedTierMul(loadout: ShipLoadout): number {
  const spec = UPGRADES[UpgradeTrack.Speed];
  // Speed is a 'multiply' track, so its step is the multiplier itself.
  return spec.steps[tierOf(loadout, UpgradeTrack.Speed)] ?? 1;
}

// ---------------------------------------------------------------------------
// The two WEAPON-group accessors (v0.2.2 field report — DAMAGE and SPEED)
// ---------------------------------------------------------------------------
//
// Canonical, symmetrically-named readers for the split projectile tracks, so a
// caller reads the weapon's two dimensions the same way — `shotDamage(ship)` and
// `shotSpeed(ship)` — and a projectile honours each track's tier state through
// one of these (`./projectiles`). They alias the ship* functions above; the names
// are the projectile-tracks vocabulary the field report and its tests speak.

/** Per-shot weapon DAMAGE (HP per hit) — the DAMAGE track's payoff at this
 *  loadout's tier. The `SHOT_DAMAGE` half of the WEAPON group. */
export function shotDamage(loadout: ShipLoadout): number {
  return shipWeaponDamage(loadout);
}

/** Muzzle SPEED (world units/s) — the SPEED track's payoff at this loadout's
 *  tier. The `SHOT_SPEED` half of the WEAPON group. */
export function shotSpeed(loadout: ShipLoadout): number {
  return shipProjectileSpeed(loadout);
}

// ---------------------------------------------------------------------------
// Writing the derived stats back onto a ship
// ---------------------------------------------------------------------------
//
// `maxHull` and `cargoCap` are *stored* on `Ship` rather than derived per read:
// the renderer draws a hull bar off them, the netcode encodes them, and the
// tractor checks the hold every tick for every chunk. These two functions are
// the only places they are written, so stored and derived can never disagree.

/** The mutable slice of a ship these appliers touch. Keeps them usable from
 *  `./state`'s constructor, which has no full `Ship` yet. */
export interface DerivedStatsTarget extends ShipLoadout {
  hull: number;
  maxHull: number;
  cargo: number;
  cargoCap: number;
}

/**
 * Recompute the stored derived stats from the tiers, without granting anything:
 * `maxHull` and `cargoCap` are set, and current `hull`/`cargo` are clamped down
 * if a retune (or a shortened ladder) lowered a ceiling under them.
 *
 * Used on the respawn path, where hull is refilled anyway — so this is what makes
 * "upgrades persist through respawn" (GDD §2.5) structural rather than a promise
 * that respawn merely doesn't break: the ceilings are re-derived from the tiers
 * the player still owns.
 */
export function refreshDerivedStats(ship: DerivedStatsTarget): void {
  ship.maxHull = shipMaxHull(ship);
  ship.cargoCap = shipCargoCap(ship);
  if (ship.hull > ship.maxHull) ship.hull = ship.maxHull;
  if (ship.cargo > ship.cargoCap) ship.cargo = ship.cargoCap;
}

/**
 * Recompute the stored derived stats *after a purchase*, granting the hull tier's
 * added plate immediately.
 *
 * The subtlety is GDD §2.5's "Ship hull is not repairable at all." Raising the
 * ceiling hands over the **difference only**, so a ship at 10/50 that buys the
 * first hull tier becomes 20/60 — still 50 HP of damage carried, exactly as
 * before. New armor, never a heal: no amount of ore un-does a hit, so hull
 * remains a thing you buy before the fight, like every other defense in §2.5.
 */
export function applyPurchasedStats(ship: DerivedStatsTarget): void {
  const before = ship.maxHull;
  ship.maxHull = shipMaxHull(ship);
  const gained = ship.maxHull - before;
  if (gained > 0) ship.hull += gained;
  if (ship.hull > ship.maxHull) ship.hull = ship.maxHull;

  ship.cargoCap = shipCargoCap(ship);
  if (ship.cargo > ship.cargoCap) ship.cargo = ship.cargoCap;
}
