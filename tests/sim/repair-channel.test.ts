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
 * Faithful reproduction: everything here runs through the **real** match — a
 * `createWorld` ring, the ship spawned docked at its own planet, and the repair
 * order delivered as a `buildOrder` **action through `step()`**, exactly the
 * verb the wheel funnels (`@platform/wheel-input` → `@platform/actions` →
 * `wire` → the sim). Nothing calls the channel directly except the pins that
 * assert the *reason* an order was refused — because "no-ops loudly" is a
 * contract about the reason, not just the effect.
 *
 * The pins, one field-report clause each:
 *   §1 the order REACHES the sim — a `buildOrder: 'repair'` action opens the
 *      channel (`planet.repairing` flips true); this is the "never reaches the
 *      sim / wrong verb" suspect, killed;
 *   §2 damaged core + funded bank → HP RISES at the ratified rate and the bank
 *      FALLS by the ratified cost, per tick and integrated over seconds;
 *   §3 unfunded → NOTHING changes, and the order is refused with a REASON
 *      (`cannot-afford`) while the wheel model dims the wedge `unaffordable`;
 *   §4 full core → NOTHING changes, refused `core-full`, wedge `inactive`;
 *   §5 collapse → NOTHING changes, refused `collapsed`, wedge `inactive`
 *      (GDD §2.3: "no repair" for the rest of the match);
 *   plus determinism with the channel running (GDD §4.8).
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
  REPAIR,
  TICK_DT,
  createWorld,
  isDocked,
  placeOrder,
  planetOf,
  shipOf,
  step,
  type Inputs,
  type Planet,
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
 * docked at its own planet with `coreHp`/`banked` set to the scenario. The enemy
 * is idle and half the ring away, so it never touches the local core.
 */
function setup(coreHp: number, banked: number, cargo = 0): { world: World; ship: Ship; planet: Planet } {
  const world = createWorld({ seed: 7, players, asteroidCount: 0 });
  world.asteroids = []; // drop the home fields too: an inert, isolated core
  const ship = shipOf(world, LOCAL)!;
  const planet = planetOf(world, LOCAL)!;

  // Mid-match: protection gone on both the hull and the home, so damage lands
  // and the channel is a normal open (not a tick-0 special case).
  ship.spawnProtect = 0;
  planet.spawnProtect = 0;

  ship.banked = banked;
  ship.cargo = cargo;
  planet.coreHp = coreHp;

  // The ship spawns orbiting its planet — docked — and parked (zero velocity),
  // which is the state the wheel opens in. Assert it rather than assume it.
  expect(isDocked(ship, planet)).toBe(true);
  return { world, ship, planet };
}

/** The wheel model's read of a planet+ship this frame, docked and asking. */
function signals(over: Partial<BuildWheelSignals>): BuildWheelSignals {
  return {
    requested: true,
    docked: true,
    shipAlive: true,
    planetAlive: true,
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
  it('a buildOrder:repair action opens the channel — the order reaches the sim', () => {
    const { world, planet } = setup(CORE_HP - 20, 10);
    expect(planet.repairing).toBe(false);

    step(world, repairOrder());

    // The wheel press, funnelled as a `buildOrder` action, landed on the sim's
    // repair verb and opened the channel. Not a no-op, not the wrong verb.
    expect(planet.repairing).toBe(true);
  });

  // §2 — the core symptom, refuted: HP rises, ore is spent, at the ratified rate.
  it('heals at exactly REPAIR.hpPerSecond and charges REPAIR.orePerHp — per tick', () => {
    const { world, ship, planet } = setup(CORE_HP - 20, 10);

    // The ordering tick opens the channel but does not heal on the same tick:
    // planets update before orders are placed, so the first heal is next tick
    // (part of the fixed subsystem order, GDD §4.8). Nothing spent yet.
    step(world, repairOrder());
    expect(planet.repairing).toBe(true);
    const hp0 = planet.coreHp;
    const bank0 = ship.banked;
    expect(hp0).toBe(CORE_HP - 20);
    expect(bank0).toBe(10);

    // One held tick: HP up by rate·dt, bank down by that·orePerHp. Exact.
    step(world, []);
    const dHp = planet.coreHp - hp0;
    const dBank = bank0 - ship.banked;
    expect(dHp).toBeCloseTo(REPAIR.hpPerSecond * TICK_DT, 9);
    expect(dBank).toBeCloseTo(REPAIR.hpPerSecond * TICK_DT * REPAIR.orePerHp, 9);
  });

  it('integrates to the rate over seconds, hold or bank funding it the same', () => {
    const { world, ship, planet } = setup(CORE_HP - 40, 10);
    step(world, repairOrder());

    const seconds = 3;
    for (let t = 0; t < Math.round(seconds / TICK_DT); t++) step(world, []);

    const healed = planet.coreHp - (CORE_HP - 40);
    expect(healed).toBeCloseTo(REPAIR.hpPerSecond * seconds, 1);
    // Every point of HP cost its ratified ore, drawn from the bank.
    expect(10 - ship.banked).toBeCloseTo(healed * REPAIR.orePerHp, 6);
    expect(planet.repairing).toBe(true); // still damaged, still funded
  });

  it('a single press keeps healing across ticks — a held channel, not a one-shot', () => {
    const { world, planet } = setup(CORE_HP - 30, 10);
    step(world, repairOrder()); // ONE order
    const before = planet.coreHp;
    for (let t = 0; t < 30; t++) step(world, []); // no further presses
    expect(planet.coreHp).toBeGreaterThan(before);
  });
});

describe('REPAIR CORE no-ops LOUDLY, never silently (GDD §2.5)', () => {
  // §3 — unfunded: nothing moves, AND the refusal has a reason the wheel shows.
  it('unfunded — nothing changes and the wedge is dimmed with a reason', () => {
    const { world, ship, planet } = setup(CORE_HP - 20, 0, 0);

    // The sim refuses with a REASON, not a silent shrug.
    expect(placeOrder(world, ship, 'repair')).toBe('cannot-afford');

    // And driven through the action funnel: the channel never opens, and after
    // a stretch of ticks the core and the (empty) bank are untouched.
    step(world, repairOrder());
    expect(planet.repairing).toBe(false);
    const hp = planet.coreHp;
    for (let t = 0; t < 60; t++) step(world, []);
    expect(planet.coreHp).toBe(hp);
    expect(ship.banked).toBe(0);

    // The loud half: the wheel dims REPAIR CORE `unaffordable` — not a live
    // button that would do nothing when pressed.
    expect(segmentState('repair', signals({ cargo: 0, banked: 0 }))).toBe('unaffordable');
  });

  // §4 — full core: the press is a no-op, and both layers say so.
  it('full core — refused `core-full`, and the wedge reads inactive', () => {
    const { world, ship, planet } = setup(CORE_HP, 10);

    expect(placeOrder(world, ship, 'repair')).toBe('core-full');

    step(world, repairOrder());
    expect(planet.repairing).toBe(false);
    for (let t = 0; t < 30; t++) step(world, []);
    expect(planet.coreHp).toBe(CORE_HP);
    expect(ship.banked).toBe(10); // a full core spends nothing

    expect(segmentState('repair', signals({ coreHp: CORE_HP, maxCoreHp: CORE_HP, banked: 10 }))).toBe('inactive');
  });

  // §5 — collapse (GDD §2.3): repair is off for the rest of the match.
  it('collapse — refused `collapsed`, no ore spent, and the wedge reads inactive', () => {
    const { world, ship, planet } = setup(CORE_HP - 20, 10);
    // The field is spent: `isCollapsed` reads `collapseTime >= 0`.
    world.match.collapseTime = world.time;

    expect(placeOrder(world, ship, 'repair')).toBe('collapsed');

    step(world, repairOrder());
    expect(planet.repairing).toBe(false);
    // Collapse decays the core on its own (GDD §2.3); what repair must never do
    // is spend the bank or heal it back up. The bank is untouched.
    expect(ship.banked).toBe(10);

    expect(segmentState('repair', signals({ collapsed: true, banked: 10 }))).toBe('inactive');
  });
});

describe('determinism with the channel running (GDD §4.8)', () => {
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
