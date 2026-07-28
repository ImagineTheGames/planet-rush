/**
 * tests/sim/repair-channel.test.ts — REPAIR CORE moves sim state, end to end.
 * OWNER: Gameplay Engineer (field report v0.2; GDD §2.5, §2.6, §2.8).
 *
 * The bug, verbatim: *"repair core isn't working — does nothing, doesn't
 * subtract ore."* The field report names three dark-matter suspects: the wheel
 * wedge fires but its order never reaches the sim; the order reaches a `repair`
 * verb that no-ops; or repair silently no-ops in some core state and never says
 * why. These pins nail all three to the floor.
 *
 * Repair is now a **DISCRETE purchase** (developer, 2026-07-26; supersedes the
 * GDD §2.5 channel — see docs/design-amendments.md): one wheel press = one
 * purchase, spending `REPAIR_ORE_COST` ore to restore `REPAIR_HP_PER_ORE` core
 * HP, clamped at max. No channel, no continuous drain, no stacking. This file was
 * the channel-era end-to-end suite, updated deliberately to the ratified model.
 *
 * Faithful reproduction: everything here runs through the **real** match — a
 * `createWorld` ring, the ship spawned docked at its own station, and the repair
 * order delivered as a `buildOrder` **action through `step()`**, exactly the
 * verb the wheel funnels (`@platform/wheel-input` → `@platform/actions` →
 * `wire` → the sim). Nothing calls the sim directly except the pins that assert
 * the *reason* an order was refused — because "no-ops loudly" is a contract about
 * the reason, not just the effect.
 *
 * The pins, one field-report clause each:
 *   §1 the order REACHES the sim — a `buildOrder: 'repair'` action heals the
 *      core (`station.coreHp` rises, the one-tick tell `station.repairing` flips
 *      true); this is the "never reaches the sim / wrong verb" suspect, killed;
 *   §2 damaged core + funded bank → HP rises by REPAIR_HP_PER_ORE and the bank
 *      falls by REPAIR_ORE_COST, ON the order tick — one press, one purchase;
 *   §3 unfunded → NOTHING changes, and the order is refused with a REASON
 *      (`cannot-afford`) while the wheel model dims the wedge `unaffordable`;
 *   §4 full core → NOTHING changes, refused `core-full`, wedge `inactive`;
 *   §5 collapse → NOTHING changes, refused `collapsed`, wedge `inactive`
 *      (GDD §2.3: "no repair" for the rest of the match);
 *   plus determinism with repair orders in the stream (GDD §4.8).
 *
 * The wheel model (`src/ui/build-wheel`) is imported read-only to prove the
 * *loud* half of "no-ops loudly": the sim refuses with a reason, and the wheel
 * shows that same reason as a dimmed wedge rather than a live button that does
 * nothing. The module is pure (no Pixi) — it tests headless like the sim does.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import type { Action } from '@shared/types';
import {
  CORE_HP,
  REPAIR_HP_PER_ORE,
  REPAIR_ORE_COST,
  createWorld,
  isDocked,
  placeOrder,
  stationOf,
  shipOf,
  step,
  type Inputs,
  type MiningStation,
  type PlayerSpec,
  type Ship,
  type World,
} from '../../src/sim';
import { segmentState, type BuildWheelSignals } from '../../src/ui/build-wheel';

// --- fixtures --------------------------------------------------------------

const LOCAL = 0;
const players: PlayerSpec[] = [
  { id: LOCAL, shipClass: ShipClass.Vanguard },
  { id: 1, shipClass: ShipClass.Interceptor },
];

/** One `buildOrder` action for the local player — the exact verb the wheel
 *  funnels into the sim (`@platform/actions.mapActions`). */
const repairOrder = (): Inputs => [{ id: LOCAL, actions: [{ type: 'buildOrder', item: 'repair' } as Action] }];

/**
 * A real match a few seconds in: spawn protection has expired (so a core can be
 * damaged and repaired like any other mid-match moment), the field is empty of
 * commons so nothing drifts into the fixture, and the local ship sits parked and
 * docked at its own station with `coreHp`/`banked` set to the scenario. The enemy
 * is idle and half the ring away, so it never touches the local core.
 */
function setup(coreHp: number, banked: number, cargo = 0): { world: World; ship: Ship; station: MiningStation } {
  const world = createWorld({ seed: 7, players, asteroidCount: 0 });
  world.asteroids = []; // drop the home fields too: an inert, isolated core
  const ship = shipOf(world, LOCAL)!;
  const station = stationOf(world, LOCAL)!;

  // Mid-match: protection gone on both the hull and the home, so damage lands
  // and a repair is a normal purchase (not a tick-0 special case).
  ship.spawnProtect = 0;
  station.spawnProtect = 0;

  ship.banked = banked;
  ship.cargo = cargo;
  station.coreHp = coreHp;

  // The ship spawns orbiting its station — docked — and parked (zero velocity),
  // which is the state the wheel opens in. Assert it rather than assume it.
  expect(isDocked(ship, station)).toBe(true);
  return { world, ship, station };
}

/** The wheel model's read of a station+ship this frame, docked and asking. */
function signals(over: Partial<BuildWheelSignals>): BuildWheelSignals {
  return {
    requested: true,
    docked: true,
    shipAlive: true,
    stationAlive: true,
    cargo: 0,
    banked: 0,
    turrets: 0,
    shields: 0,
    coreHp: CORE_HP - 20,
    maxCoreHp: CORE_HP,
    collapsed: false,
    ...over,
  };
}

// ===========================================================================

describe('REPAIR CORE reaches the sim and heals (GDD §2.5, the field-report fix)', () => {
  // §1 — the "order never reaches the sim / fires the wrong verb" suspect.
  it('a buildOrder:repair action heals the core — the order reaches the sim', () => {
    const { world, station } = setup(CORE_HP - 20, 10);
    const hp0 = station.coreHp;
    expect(station.repairing).toBe(false);

    step(world, repairOrder());

    // The wheel press, funnelled as a `buildOrder` action, landed on the sim's
    // repair verb and moved state. Not a no-op, not the wrong verb.
    expect(station.coreHp).toBe(hp0 + REPAIR_HP_PER_ORE);
    expect(station.repairing).toBe(true); // the one-tick repair tell
  });

  // §2 — the core symptom, refuted: HP rises and ore is spent, at the ratified
  // amounts, ON the order tick — one press is one purchase.
  it('one press spends REPAIR_ORE_COST and restores REPAIR_HP_PER_ORE, on the order tick', () => {
    const { world, ship, station } = setup(CORE_HP - 20, 10);
    const hp0 = station.coreHp;
    const bank0 = ship.banked;

    step(world, repairOrder());

    // Discrete: the purchase resolves the tick the order lands — HP up by
    // REPAIR_HP_PER_ORE, bank down by REPAIR_ORE_COST, no waiting, no channel.
    expect(station.coreHp - hp0).toBeCloseTo(REPAIR_HP_PER_ORE, 9);
    expect(bank0 - ship.banked).toBeCloseTo(REPAIR_ORE_COST, 9);
  });

  it('N presses are N purchases; hold and bank fund them identically', () => {
    // Start 50 HP down so three whole purchases (+45) never clip the cap.
    const viaBank = setup(CORE_HP - 50, 10, 0);
    const viaHold = setup(CORE_HP - 50, 0, 10);
    for (let t = 0; t < 3; t++) {
      step(viaBank.world, repairOrder());
      step(viaHold.world, repairOrder());
    }

    const healedBank = viaBank.station.coreHp - (CORE_HP - 50);
    const healedHold = viaHold.station.coreHp - (CORE_HP - 50);
    expect(healedBank).toBeCloseTo(3 * REPAIR_HP_PER_ORE, 6);
    expect(healedHold).toBeCloseTo(3 * REPAIR_HP_PER_ORE, 6);
    // Three purchases cost exactly three ore, whichever wallet paid.
    expect(10 - (viaBank.ship.banked + viaBank.ship.cargo)).toBeCloseTo(3 * REPAIR_ORE_COST, 6);
    expect(10 - (viaHold.ship.banked + viaHold.ship.cargo)).toBeCloseTo(3 * REPAIR_ORE_COST, 6);
  });

  it('a single press heals ONCE — no held channel, no drain across idle ticks', () => {
    const { world, ship, station } = setup(CORE_HP - 30, 10);
    step(world, repairOrder()); // ONE order
    const hpAfter = station.coreHp;
    const bankAfter = ship.banked;
    expect(hpAfter).toBe(CORE_HP - 30 + REPAIR_HP_PER_ORE);

    for (let t = 0; t < 30; t++) step(world, []); // no further presses
    expect(station.coreHp).toBe(hpAfter); // not one more HP — no channel drains it up
    expect(ship.banked).toBe(bankAfter); // not one more ore — no continuous drain
    // The tell holds ("patched, not hit since") across the idle ticks; it just
    // signals — it never heals a point past the single purchase above.
    expect(station.repairing).toBe(true);
  });

  it('clamps at the core max — a near-full core costs a whole ore and heals to full', () => {
    // Missing 10 < REPAIR_HP_PER_ORE (15): the purchase still costs a whole ore
    // and clamps to max, never overshooting (developer p5-08).
    const { world, ship, station } = setup(CORE_HP - 10, 10);
    step(world, repairOrder());
    expect(station.coreHp).toBe(station.maxCoreHp);
    expect(ship.banked).toBeCloseTo(10 - REPAIR_ORE_COST, 6);
  });
});

describe('REPAIR CORE no-ops LOUDLY, never silently (GDD §2.5)', () => {
  // §3 — unfunded: nothing moves, AND the refusal has a reason the wheel shows.
  it('unfunded — nothing changes and the wedge is dimmed with a reason', () => {
    const { world, ship, station } = setup(CORE_HP - 20, 0, 0);

    // The sim refuses with a REASON, not a silent shrug.
    expect(placeOrder(world, ship, 'repair')).toBe('cannot-afford');

    // And driven through the action funnel: no heal, and after a stretch of ticks
    // the core and the (empty) bank are untouched.
    step(world, repairOrder());
    expect(station.repairing).toBe(false);
    const hp = station.coreHp;
    for (let t = 0; t < 60; t++) step(world, []);
    expect(station.coreHp).toBe(hp);
    expect(ship.banked).toBe(0);

    // The loud half: the wheel dims REPAIR CORE `unaffordable` — not a live
    // button that would do nothing when pressed.
    expect(segmentState('repair', signals({ cargo: 0, banked: 0 }))).toBe('unaffordable');
  });

  // §4 — full core: the press is a no-op, and both layers say so.
  it('full core — refused `core-full`, and the wedge reads inactive', () => {
    const { world, ship, station } = setup(CORE_HP, 10);

    expect(placeOrder(world, ship, 'repair')).toBe('core-full');

    step(world, repairOrder());
    expect(station.repairing).toBe(false);
    for (let t = 0; t < 30; t++) step(world, []);
    expect(station.coreHp).toBe(CORE_HP);
    expect(ship.banked).toBe(10); // a full core spends nothing

    expect(segmentState('repair', signals({ coreHp: CORE_HP, maxCoreHp: CORE_HP, banked: 10 }))).toBe('inactive');
  });

  // §5 — collapse (GDD §2.3): repair is off for the rest of the match.
  it('collapse — refused `collapsed`, no ore spent, and the wedge reads inactive', () => {
    const { world, ship, station } = setup(CORE_HP - 20, 10);
    // The field is spent: `isCollapsed` reads `collapseTime >= 0`.
    world.match.collapseTime = world.time;

    expect(placeOrder(world, ship, 'repair')).toBe('collapsed');

    step(world, repairOrder());
    expect(station.repairing).toBe(false);
    // Collapse decays the core on its own (GDD §2.3); what repair must never do
    // is spend the bank or heal it back up. The bank is untouched.
    expect(ship.banked).toBe(10);

    expect(segmentState('repair', signals({ collapsed: true, banked: 10 }))).toBe('inactive');
  });
});

describe('determinism with repair orders in the stream (GDD §4.8)', () => {
  it('two identical runs with a repair order deep-equal', () => {
    const run = (): World => {
      const { world } = setup(CORE_HP - 25, 10);
      step(world, repairOrder());
      for (let t = 0; t < 40; t++) step(world, []);
      return world;
    };
    expect(run()).toEqual(run());
  });
});
