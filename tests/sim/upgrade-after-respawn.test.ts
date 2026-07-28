/**
 * tests/sim/upgrade-after-respawn.test.ts — the v0.2.2 (CLARIFIED) field report,
 * nailed to the floor. OWNER: Gameplay Engineer (GDD §2.5, §2.7).
 *
 * The developer, verbatim: *"the upgrades reset, and then there's no way to
 * upgrade after you respawn — not even a brand new upgrade you hadn't done
 * before... none of them work."* Two distinct defects, and the report is right
 * to insist they are tested apart — restoring the tiers without reviving the
 * purchase pipeline (or vice versa) would leave the developer exactly as broken:
 *
 *   DEFECT 1 — STATE LOSS: purchased tiers vanish on respawn (as if the tiers
 *     lived on the *hull* and died with it).
 *   DEFECT 2 — DEAD PIPELINE: after respawn NO purchase of ANY track lands —
 *     not even an untouched one (as if the order path still pointed at the dead
 *     instance).
 *
 * Both suspects share one root — *entity-keyed where it must be player-keyed* —
 * and the sim's answer to both is the same structural fact: it mutates **one
 * ship in place** across a life (`killShip` → `respawn`, `./damage`, `./step`),
 * never swapping instances, and every purchase keys off `ship.id` (a stable
 * {@link PlayerId}) and reads `ship.tiers` (match-lifetime state the respawn path
 * never clears). So there is no "previous hull" to leave a tier on or bind an
 * order to. These pins prove that holds through the **real match** — a
 * `createWorld` ring, a real death (`killShip`), a real revival on the respawn
 * clock (`step`) — down BOTH purchase paths the report names:
 *
 *   • the WHEEL path: an `upgradeOrder` action through `step()`, exactly what
 *     `@platform/wheel-input` → `@platform/actions` → `wire` funnels; and
 *   • the DIRECT path: `buyUpgrade`, the one sim verb both funnels call.
 *
 * The ratified RULE (report §2): **upgrades are the player's, not the hull's** —
 * tiers persist through death and respawn, and a purchase works identically at
 * any point in a life or between lives, save the one life-state gate below.
 *
 * The dead-order decision (report §3d), documented and pinned here: a purchase
 * is an action a *live* hull takes at its station, so an order issued while dead
 * is **cleanly refused, never queued** — `buyUpgrade` answers `'dead'` (loud, not
 * a misleading `not-docked`), and the wheel path's `step()` drops it on the same
 * `!alive` gate every wheel action shares. It is not banked for later: the ship
 * reaches its station again on respawn and buys for real.
 *
 * Cargo is *not* our concern here — it stays on the death-drop rules (p4-14);
 * these pins keep hold/bank incidental and assert only the upgrade contract.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass, UpgradeTrack } from '@shared/types';
import type { Action } from '@shared/types';
import {
  RESPAWN_S,
  SHIP_STATS,
  TICK_DT,
  TRACK_ORDER,
  buyUpgrade,
  createWorld,
  isDocked,
  killShip,
  nextUpgradeCost,
  oreSpentOnUpgrades,
  stationOf,
  shipMaxHull,
  shipOf,
  shipTopSpeed,
  step,
  stockTiers,
  tierOf,
  type Inputs,
  type MiningStation,
  type Ship,
  type World,
} from '../../src/sim';

// --- fixtures --------------------------------------------------------------

const LOCAL = 0;
const ENEMY = 1;
const players = [
  { id: LOCAL, shipClass: ShipClass.Excavator },
  { id: ENEMY, shipClass: ShipClass.Vanguard },
];

/** One `upgradeOrder` action for the local player — the exact verb the wheel
 *  funnels into the sim (`@platform/actions.mapActions`). */
const buyOrder = (track: UpgradeTrack): Inputs => [
  { id: LOCAL, actions: [{ type: 'upgradeOrder', track } as Action] },
];

/**
 * A real match, mid-flight: the local ship parked and docked at its own live
 * station, spawn protection cleared so it can be killed like any other moment,
 * and a fat bank so the wallet is never the thing under test. The enemy is idle
 * half the ring away and never touches the local core; no rocks drift in.
 */
function freshMatch(banked = 9999): { world: World; ship: Ship; station: MiningStation } {
  const world = createWorld({ seed: 11, players, asteroidCount: 0 });
  world.asteroids = []; // drop the home fields too — an inert, isolated fixture
  const ship = shipOf(world, LOCAL)!;
  const station = stationOf(world, LOCAL)!;

  ship.spawnProtect = 0; // mid-match: killable now
  station.spawnProtect = 0;
  ship.cargo = 0;
  ship.banked = banked;

  // The fixture's whole premise: the ship spawns orbiting its station, docked and
  // at rest. If the ring geometry ever drifts, fail here rather than downstream.
  expect(isDocked(ship, station)).toBe(true);
  return { world, ship, station };
}

/** Kill the local ship through the real death path (`killShip` — the one both
 *  projectile paths funnel through, `./damage`), then run the sim on empty input
 *  until the respawn clock brings it back. Returns having asserted the arc. */
function killAndRespawn(world: World, ship: Ship): void {
  killShip(world, ship);
  expect(ship.alive).toBe(false);
  const cap = Math.ceil(RESPAWN_S / TICK_DT) + 5;
  for (let t = 0; t < cap && !ship.alive; t++) step(world, []);
  expect(ship.alive).toBe(true);
}

// ---------------------------------------------------------------------------
// DEFECT 1 — state loss: purchased tiers must survive a respawn
// ---------------------------------------------------------------------------

describe('DEFECT 1 — tiers survive respawn (upgrades are the player’s, not the hull’s)', () => {
  it('keeps every purchased tier through a death, with ceilings re-derived from them', () => {
    const { world, ship } = freshMatch();

    // Buy one step on each of the four §2.5 tracks the wheel exposes.
    for (const track of TRACK_ORDER) step(world, buyOrder(track));
    const tiers = { ...ship.tiers };
    const maxHull = ship.maxHull;
    const cargoCap = ship.cargoCap;
    const banked = ship.banked;
    // A real climb happened — not a no-op we would then "preserve" trivially.
    expect(oreSpentOnUpgrades(ship)).toBeGreaterThan(0);
    expect(maxHull).toBeGreaterThan(SHIP_STATS[ShipClass.Excavator].hull);

    killAndRespawn(world, ship);

    // Every tier is back, the stored ceilings are re-derived from the tiers the
    // player still owns, and the fresh hull is refilled to that ceiling.
    expect(ship.tiers).toEqual(tiers);
    expect(ship.maxHull).toBeCloseTo(maxHull, 9);
    expect(ship.cargoCap).toBe(cargoCap);
    expect(ship.hull).toBeCloseTo(maxHull, 9);
    expect(ship.banked).toBeCloseTo(banked, 9); // bank is never lost to death
    expect(shipTopSpeed(ship)).toBeCloseTo(
      shipTopSpeed({ shipClass: ShipClass.Excavator, tiers }),
      9,
    );
  });

  it('holds the same through the DIRECT purchase path (buyUpgrade)', () => {
    const { world, ship } = freshMatch();
    expect(buyUpgrade(world, ship, UpgradeTrack.Hull)).toBe('ok');
    expect(buyUpgrade(world, ship, UpgradeTrack.Hull)).toBe('ok');
    const tier = tierOf(ship, UpgradeTrack.Hull);
    expect(tier).toBe(2);

    killAndRespawn(world, ship);
    expect(tierOf(ship, UpgradeTrack.Hull)).toBe(2);
    expect(ship.maxHull).toBeCloseTo(shipMaxHull(ship), 9);
  });
});

// ---------------------------------------------------------------------------
// DEFECT 2 — dead pipeline: purchases must land AFTER a respawn
// ---------------------------------------------------------------------------

describe('DEFECT 2 — the purchase pipeline is live after respawn (no dead-instance binding)', () => {
  it('buys a BRAND-NEW, never-touched track after respawn — wheel path', () => {
    const { world, ship } = freshMatch();
    // No purchase before death: the pipeline must work from a stock hull too.
    killAndRespawn(world, ship);

    expect(tierOf(ship, UpgradeTrack.Hull)).toBe(0);
    const before = ship.maxHull;
    step(world, buyOrder(UpgradeTrack.Hull)); // the wheel's verb
    expect(tierOf(ship, UpgradeTrack.Hull)).toBe(1);
    expect(ship.maxHull).toBeGreaterThan(before); // the tier actually applied
  });

  it('buys a BRAND-NEW, never-touched track after respawn — direct path', () => {
    const { world, ship } = freshMatch();
    killAndRespawn(world, ship);

    expect(tierOf(ship, UpgradeTrack.Engine)).toBe(0);
    const before = shipTopSpeed(ship);
    expect(buyUpgrade(world, ship, UpgradeTrack.Engine)).toBe('ok');
    expect(tierOf(ship, UpgradeTrack.Engine)).toBe(1);
    expect(shipTopSpeed(ship)).toBeGreaterThan(before);
  });

  it('buys the NEXT tier of a pre-death track after respawn, at the unchanged cost', () => {
    const { world, ship } = freshMatch();
    step(world, buyOrder(UpgradeTrack.Power)); // tier 1, while alive
    expect(tierOf(ship, UpgradeTrack.Power)).toBe(1);
    const costOfTier2 = nextUpgradeCost(ship, UpgradeTrack.Power);
    expect(costOfTier2).not.toBeNull();

    killAndRespawn(world, ship);

    // Same ladder, same price: nothing about the respawn moved the next step.
    expect(tierOf(ship, UpgradeTrack.Power)).toBe(1);
    expect(nextUpgradeCost(ship, UpgradeTrack.Power)).toBe(costOfTier2);
    expect(buyUpgrade(world, ship, UpgradeTrack.Power)).toBe('ok');
    expect(tierOf(ship, UpgradeTrack.Power)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The dead-order decision (report §3d) — cleanly refused, never queued
// ---------------------------------------------------------------------------

describe('an order issued while DEAD is cleanly refused, never queued', () => {
  it('answers `dead` from buyUpgrade — the true reason, ahead of the docking check', () => {
    const { world, ship } = freshMatch();
    killShip(world, ship); // a wreck sitting on its own docked spawn point
    expect(ship.alive).toBe(false);

    // Loud and precise: `dead`, not a misleading `not-docked` (the wreck is
    // physically at its station — the reason it cannot buy is that it is dead).
    expect(buyUpgrade(world, ship, UpgradeTrack.Hull)).toBe('dead');
    expect(tierOf(ship, UpgradeTrack.Hull)).toBe(0); // no state moved
  });

  it('drops a dead wheel order rather than banking it — nothing fires on revival', () => {
    const { world, ship } = freshMatch();
    killShip(world, ship);

    // Mash the upgrade order for a stretch of the respawn wait, comfortably short
    // of revival (300 ticks at 60Hz), so every one of these presses lands on a
    // ship that is still dead. Not one takes.
    const deadTicks = Math.floor(RESPAWN_S / TICK_DT) - 30;
    for (let t = 0; t < deadTicks; t++) step(world, buyOrder(UpgradeTrack.Cargo));
    expect(ship.alive).toBe(false);
    expect(tierOf(ship, UpgradeTrack.Cargo)).toBe(0); // dead presses do nothing

    // Let it come back on empty input — no order rides the revival tick. If a
    // dead press had been *queued*, the tier would jump here; it does not.
    const cap = Math.ceil(RESPAWN_S / TICK_DT) + 5;
    for (let t = 0; t < cap && !ship.alive; t++) step(world, []);
    expect(ship.alive).toBe(true);
    expect(tierOf(ship, UpgradeTrack.Cargo)).toBe(0); // nothing banked from the dead ticks

    // A fresh order, now that it is alive, is what actually buys the tier.
    step(world, buyOrder(UpgradeTrack.Cargo));
    expect(tierOf(ship, UpgradeTrack.Cargo)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Durability — the fix must not decay across more than one life
// ---------------------------------------------------------------------------

describe('the pipeline survives repeated respawns in one match', () => {
  it('buys across three lives — tiers accumulate and every purchase still lands', () => {
    const { world, ship } = freshMatch();

    // Life 1: a fresh track.
    expect(buyUpgrade(world, ship, UpgradeTrack.Hull)).toBe('ok');
    killAndRespawn(world, ship);

    // Life 2: a different fresh track, plus the next tier of life 1's track.
    expect(buyUpgrade(world, ship, UpgradeTrack.Power)).toBe('ok');
    expect(buyUpgrade(world, ship, UpgradeTrack.Hull)).toBe('ok');
    killAndRespawn(world, ship);

    // Life 3: still live, still climbing.
    expect(buyUpgrade(world, ship, UpgradeTrack.Power)).toBe('ok');

    expect(tierOf(ship, UpgradeTrack.Hull)).toBe(2);
    expect(tierOf(ship, UpgradeTrack.Power)).toBe(2);
    // The stored ceiling still agrees with the tiers after two deaths.
    expect(ship.maxHull).toBeCloseTo(shipMaxHull(ship), 9);
  });

  it('a stock hull that never bought anything still starts fresh (baseline sanity)', () => {
    const { ship } = freshMatch();
    expect(ship.tiers).toEqual(stockTiers());
    expect(oreSpentOnUpgrades(ship)).toBe(0);
  });
});
