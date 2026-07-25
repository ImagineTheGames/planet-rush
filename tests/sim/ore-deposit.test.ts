/**
 * tests/sim/ore-deposit.test.ts — depositing ore at home. OWNER: Gameplay
 * Engineer (field report v0.1.2; GDD §2.3, §2.5).
 *
 * The bug: "there's no way to deposit ore … it should fly from my ship to the
 * planet but it doesn't, it just stays on my ship." Mining filled the hold, but
 * the only thing that emptied it into the safe banked total — the ore the Build
 * wheel actually spends — was an explicit BANK press a first-time player never
 * finds. The fix is a sim rule: while a ship is **docked at its own living
 * planet**, its hold auto-transfers into the bank at `DEPOSIT.drainRate`, and
 * ore-flight couriers fly ship→planet to show it. Undock and the drain stops.
 *
 * These pins hold every half of that rule: the drain rate, that it empties the
 * whole hold, that undocking (and every other gate) stops it, that the banked
 * ore is then spendable, that the couriers are cosmetic (they never add or steal
 * ore, and are never tractored back), and that the whole thing is deterministic.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import {
  DEPOSIT,
  PLANET,
  TICK_DT,
  TURRET,
  createWorld,
  isDocked,
  placeOrder,
  planetOf,
  step,
  type PlayerSpec,
  type Ship,
  type World,
} from '../../src/sim';

// --- fixtures --------------------------------------------------------------

const PLAYERS: readonly PlayerSpec[] = [
  { id: 0, shipClass: ShipClass.Vanguard },
  { id: 1, shipClass: ShipClass.Vanguard },
];

/** A fresh match with the local ship (slot 0) parked cleanly docked at its own
 *  planet with a full hold — outside the planet's collider so nothing nudges it,
 *  well inside `dockRange`, at rest. The exact opening the field report is about:
 *  home, full, and expecting the hold to empty. */
function stagedAtHome(cargo?: number): { world: World; ship: Ship } {
  const world = createWorld({ seed: 7, players: PLAYERS });
  const ship = world.ships[0]!;
  const planet = planetOf(world, 0)!;
  // A clean docked spot: on the +x side of the planet, clear of its collider.
  ship.pos = { x: planet.pos.x + (PLANET.radius + ship.radius + 30), y: planet.pos.y };
  ship.vel = { x: 0, y: 0 };
  ship.cargo = cargo ?? ship.cargoCap;
  ship.banked = 0;
  expect(isDocked(ship, planet)).toBe(true);
  return { world, ship };
}

/** Ore that physically exists on `ship`: hold + bank. Couriers are cosmetic, so
 *  this total is conserved while a docked ship deposits (ore only moves sides). */
function realOre(ship: Ship): number {
  return ship.cargo + ship.banked;
}

// --- the drain -------------------------------------------------------------

describe('auto-deposit while docked at your own planet', () => {
  it('drains the hold into the bank at the tunable rate', () => {
    const { world, ship } = stagedAtHome(2);
    const before = ship.cargo;

    step(world, []); // one tick, no input

    expect(ship.cargo).toBeCloseTo(before - DEPOSIT.drainRate * TICK_DT, 9);
    expect(ship.banked).toBeCloseTo(DEPOSIT.drainRate * TICK_DT, 9);
    // Ore is moved, never minted: hold + bank is exactly what the hold held.
    expect(realOre(ship)).toBeCloseTo(before, 9);
  });

  it('empties the whole hold into the bank and then stops', () => {
    const { world, ship } = stagedAtHome(2);
    const total = realOre(ship);

    // Long enough to drain 2 ore at 2/s (~1 s) with margin, then idle a while.
    for (let i = 0; i < 180; i++) step(world, []);

    expect(ship.cargo).toBe(0);
    expect(ship.banked).toBeCloseTo(total, 9);
  });

  it('never banks more than the hold held (couriers carry no ore)', () => {
    const { world, ship } = stagedAtHome(2);
    const total = realOre(ship);
    for (let i = 0; i < 300; i++) {
      step(world, []);
      expect(realOre(ship)).toBeLessThanOrEqual(total + 1e-9);
    }
    expect(ship.banked).toBeCloseTo(total, 9);
  });

  it('a docked ship never tractors its own couriers back into the hold', () => {
    const { world, ship } = stagedAtHome(2);
    let last = ship.cargo;
    for (let i = 0; i < 120; i++) {
      step(world, []);
      // The hold only ever falls: a courier passing the hull is never collected.
      expect(ship.cargo).toBeLessThanOrEqual(last + 1e-9);
      last = ship.cargo;
    }
  });
});

// --- the interrupt (undock, and the other gates) ---------------------------

describe('the drain is interruptible', () => {
  it('stops the moment the ship undocks', () => {
    const { world, ship } = stagedAtHome(2);
    const planet = planetOf(world, 0)!;

    step(world, []); // drain a little
    const banked = ship.banked;
    const cargo = ship.cargo;
    expect(cargo).toBeLessThan(2);

    // Fly the ship a full ring away — out of dock range.
    ship.pos = { x: planet.pos.x + PLANET.dockRange * 4, y: planet.pos.y };
    expect(isDocked(ship, planet)).toBe(false);

    for (let i = 0; i < 60; i++) step(world, []);
    expect(ship.cargo).toBeCloseTo(cargo, 9); // hold frozen where it was
    expect(ship.banked).toBeCloseTo(banked, 9);
  });

  it('does not deposit at a planet that is not your own', () => {
    const world = createWorld({ seed: 7, players: PLAYERS });
    const ship = world.ships[0]!;
    const rival = planetOf(world, 1)!;
    // Park slot 0 docked at slot 1's planet, holding ore.
    ship.pos = { x: rival.pos.x + (PLANET.radius + ship.radius + 30), y: rival.pos.y };
    ship.vel = { x: 0, y: 0 };
    ship.cargo = 2;
    ship.banked = 0;
    expect(isDocked(ship, rival)).toBe(true);

    for (let i = 0; i < 120; i++) step(world, []);
    // Not their planet ⇒ nothing banks; the hold is untouched.
    expect(ship.cargo).toBe(2);
    expect(ship.banked).toBe(0);
  });

  it('does not deposit once the home planet is dead', () => {
    const { world, ship } = stagedAtHome(2);
    const planet = planetOf(world, 0)!;
    planet.alive = false; // wreck — no bank behind it
    for (let i = 0; i < 120; i++) step(world, []);
    expect(ship.cargo).toBe(2);
    expect(ship.banked).toBe(0);
  });
});

// --- the banked ore is real, spendable ore ---------------------------------

describe('deposited ore funds the Build wheel', () => {
  it('banks a full hold and then spends it on a turret', () => {
    const { world, ship } = stagedAtHome(2);
    // A widened bay (an upgrade the player bought) so a full hold clears a
    // turret's cost — proving the deposited ore is what funds the build.
    ship.cargoCap = 4;
    ship.cargo = 4;
    for (let i = 0; i < 180; i++) step(world, []); // drain the hold

    expect(ship.cargo).toBe(0);
    expect(ship.banked).toBeGreaterThanOrEqual(TURRET.cost);
    const banked = ship.banked;

    const result = placeOrder(world, ship, 'turret');
    expect(result).toBe('ok');
    // Spent from the bank the deposit filled (hold is empty).
    expect(ship.banked).toBeCloseTo(banked - TURRET.cost, 9);
  });
});

// --- the ore-flight couriers ----------------------------------------------

describe('ore-flight couriers', () => {
  it('spawns deposit couriers headed for the planet while draining', () => {
    const { world, ship } = stagedAtHome(2);
    const planet = planetOf(world, 0)!;

    // One flight cadence's worth of ticks guarantees at least one courier.
    const cadence = Math.max(1, Math.round(DEPOSIT.flightInterval / TICK_DT));
    for (let i = 0; i <= cadence; i++) step(world, []);

    const couriers = world.chunks.filter((c) => c.deposit);
    expect(couriers.length).toBeGreaterThan(0);
    for (const c of couriers) {
      expect(c.homeTo).toEqual({ x: planet.pos.x, y: planet.pos.y });
    }
    // A courier starts at the hull and heads inward toward the planet centre.
    const c0 = couriers[0]!;
    const towardPlanet = (planet.pos.x - ship.pos.x) * c0.vel.x + (planet.pos.y - ship.pos.y) * c0.vel.y;
    expect(towardPlanet).toBeGreaterThan(0);
  });

  it('couriers are absorbed at the planet and swept — none outlive the drain', () => {
    const { world } = stagedAtHome(2);
    // Drain (~1 s) plus flight time (a short hop) plus generous idle.
    for (let i = 0; i < 300; i++) step(world, []);
    expect(world.chunks.filter((c) => c.deposit).length).toBe(0);
  });
});

// --- determinism -----------------------------------------------------------

describe('determinism', () => {
  it('same seed + same staged deposit ⇒ byte-identical world', () => {
    const build = (): World => {
      const world = createWorld({ seed: 42, players: PLAYERS });
      const ship = world.ships[0]!;
      const planet = planetOf(world, 0)!;
      ship.pos = { x: planet.pos.x + (PLANET.radius + ship.radius + 30), y: planet.pos.y };
      ship.vel = { x: 0, y: 0 };
      ship.cargo = ship.cargoCap;
      ship.banked = 0;
      return world;
    };

    const a = build();
    const b = build();
    for (let i = 0; i < 120; i++) {
      step(a, []);
      step(b, []);
    }
    expect(a).toEqual(b);
  });
});
