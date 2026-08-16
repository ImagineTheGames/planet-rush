/**
 * tests/sim/ore-deposit.test.ts — depositing ore at home. OWNER: Gameplay
 * Engineer (field report v0.1.2; GDD §2.3, §2.5).
 *
 * The bug: "there's no way to deposit ore … it should fly from my ship to the
 * station but it doesn't, it just stays on my ship." Mining filled the hold, but
 * the only thing that emptied it into the safe banked total — the ore the Build
 * wheel actually spends — was an explicit BANK press a first-time player never
 * finds. The fix is a sim rule: while a ship is inside its own living station's
 * **atmosphere** (`DEPOSIT_RANGE`), its hold auto-transfers into the bank at
 * `DEPOSIT.drainRate`, and ore-flight couriers fly ship→station to show it. Leave
 * the atmosphere and the drain stops.
 *
 * Ratified p4 (developer): "You shouldn't need to touch your station to deposit —
 * just be in that atmosphere." The old rule gated deposit on docking *and*
 * parking (near-rest inside the tight `dockRange`); the new rule is purely
 * geometric — inside `DEPOSIT_RANGE`, at your own living station, moving or not.
 *
 * These pins hold every half of that rule: the drain rate, that it starts the
 * tick the ship crosses into the atmosphere (moving, undocked, boundary exact)
 * and stops the tick it crosses out, that it empties the whole hold, that every
 * other gate (wrong station, dead station) still stops it, that the banked ore is
 * then spendable, that the couriers are cosmetic (they never add or steal ore,
 * and are never tractored back), and that the whole thing is deterministic.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import {
  CHUNK,
  DEPOSIT,
  DEPOSIT_RANGE,
  STATION,
  TICK_DT,
  TURRET,
  createWorld,
  inAtmosphere,
  isDocked,
  placeOrder,
  stationOf,
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
 *  station with a full hold — outside the station's collider so nothing nudges it,
 *  well inside `dockRange`, at rest. The exact opening the field report is about:
 *  home, full, and expecting the hold to empty. */
function stagedAtHome(cargo?: number): { world: World; ship: Ship } {
  const world = createWorld({ seed: 7, players: PLAYERS });
  const ship = world.ships[0]!;
  const station = stationOf(world, 0)!;
  // A clean docked spot: on the +x side of the station, clear of its collider.
  ship.pos = { x: station.pos.x + (STATION.radius + ship.radius + 30), y: station.pos.y };
  ship.vel = { x: 0, y: 0 };
  ship.cargo = cargo ?? ship.cargoCap;
  ship.banked = 0;
  expect(isDocked(ship, station)).toBe(true);
  return { world, ship };
}

/** Ore that physically exists on `ship`: hold + bank. Couriers are cosmetic, so
 *  this total is conserved while a docked ship deposits (ore only moves sides). */
function realOre(ship: Ship): number {
  return ship.cargo + ship.banked;
}

/**
 * Ticks the drain needs to earn one whole `CHUNK.ore` — the granularity a hold
 * moves at since a0-58, and the window every rate pin below is taken over.
 *
 * Derived from the tunables, never typed as 30: `DEPOSIT.drainRate` and
 * `CHUNK.ore` are both TUNABLE, and a test that hardcodes the tick count passes
 * for the wrong reason the day either moves. The epsilon matches the sim's own —
 * thirty accumulated thirtieths land a hair under 1, and both sides must agree
 * that the unit is due on the thirtieth tick rather than the thirty-first.
 */
const TICKS_PER_ORE = Math.ceil(CHUNK.ore / (DEPOSIT.drainRate * TICK_DT) - 1e-9);

/** Step `n` ticks with no input. */
function stepFor(world: World, n: number): void {
  for (let i = 0; i < n; i++) step(world, []);
}

// --- the drain -------------------------------------------------------------

describe('auto-deposit while docked at your own station', () => {
  it('drains the hold into the bank at the tunable rate', () => {
    const { world, ship } = stagedAtHome(2);
    const before = ship.cargo;

    // A WHOLE ORE AT A TIME (a0-58). The rate is unchanged and still the pin —
    // `drainRate` ore per second — but the hold hands over countable ore, so the
    // rate is read over the window that earns one unit rather than off a single
    // tick's 1/30th. A hold that can sit on 1.6 is a hold showing one pip while
    // holding ore no readout in the game can render.
    //
    // Two windows, so this reads the RATE and not one lucky boundary: exactly one
    // whole ore per window, and never a fraction in between.
    for (let unit = 1; unit <= 2; unit++) {
      const bankedBefore = ship.banked;
      let moves = 0;
      for (let i = 0; i < TICKS_PER_ORE; i++) {
        const cargoBefore = ship.cargo;
        step(world, []);
        if (ship.cargo !== cargoBefore) {
          moves++;
          expect(cargoBefore - ship.cargo, 'the hold moves a whole ore or not at all').toBeCloseTo(CHUNK.ore, 9);
        }
      }
      expect(moves, `window ${unit}: exactly one payout`).toBe(1);
      expect(ship.banked - bankedBefore).toBeCloseTo(CHUNK.ore, 9);
    }
    expect(ship.cargo).toBeCloseTo(before - 2 * CHUNK.ore, 9);
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

// --- the atmosphere rule: just be inside DEPOSIT_RANGE (ratified p4) --------

describe('the drain runs on atmosphere presence alone', () => {
  it('does nothing outside the atmosphere, then starts the tick the ship crosses in', () => {
    const { world, ship } = stagedAtHome(2);
    const station = stationOf(world, 0)!;
    const total = realOre(ship);

    // Park just OUTSIDE the atmosphere — a hair past DEPOSIT_RANGE.
    ship.pos = { x: station.pos.x + DEPOSIT_RANGE + 1, y: station.pos.y };
    expect(inAtmosphere(ship, station)).toBe(false);
    step(world, []);
    expect(ship.cargo).toBe(total); // untouched: not in the atmosphere yet
    expect(ship.banked).toBe(0);

    // Cross the boundary and the drain is running from that tick: the first whole
    // ore lands within one payout window (a0-58 — the hold moves in whole
    // `CHUNK.ore`, on the world clock's metronome), and it is exactly one.
    ship.pos = { x: station.pos.x + DEPOSIT_RANGE - 1, y: station.pos.y };
    expect(inAtmosphere(ship, station)).toBe(true);
    stepFor(world, TICKS_PER_ORE);
    expect(ship.cargo).toBeCloseTo(total - CHUNK.ore, 9);
    expect(ship.banked).toBeCloseTo(CHUNK.ore, 9);
    expect(realOre(ship)).toBeCloseTo(total, 9);
  });

  it('deposits while orbiting fast (no park gate) and past dock range (no dock gate)', () => {
    const { world, ship } = stagedAtHome(2);
    const station = stationOf(world, 0)!;
    const before = ship.cargo;

    // In the atmosphere but OUTSIDE dockRange, and moving well above the old
    // parkSpeed — the two gates the ratified rule retired.
    ship.pos = { x: station.pos.x + (STATION.dockRange + DEPOSIT_RANGE) / 2, y: station.pos.y };
    ship.vel = { x: 0, y: 200 };
    expect(isDocked(ship, station)).toBe(false);
    expect(inAtmosphere(ship, station)).toBe(true);

    stepFor(world, TICKS_PER_ORE);
    expect(ship.cargo).toBeLessThan(before); // drained despite undocked + moving
  });

  it('treats the exact boundary as inside (≤ DEPOSIT_RANGE)', () => {
    const { world, ship } = stagedAtHome(2);
    const station = stationOf(world, 0)!;
    const before = ship.cargo;

    ship.pos = { x: station.pos.x + DEPOSIT_RANGE, y: station.pos.y };
    expect(inAtmosphere(ship, station)).toBe(true);

    stepFor(world, TICKS_PER_ORE);
    expect(ship.cargo).toBeCloseTo(before - CHUNK.ore, 9);
  });
});

// --- the interrupt (leave the atmosphere, and the other gates) -------------

describe('the drain is interruptible', () => {
  it('stops the moment the ship leaves the atmosphere', () => {
    const { world, ship } = stagedAtHome(2);
    const station = stationOf(world, 0)!;

    stepFor(world, TICKS_PER_ORE); // drain one whole ore (a0-58: the hold's granularity)
    const banked = ship.banked;
    const cargo = ship.cargo;
    expect(cargo).toBeLessThan(2);

    // Fly the ship a full ring away — well outside the atmosphere.
    ship.pos = { x: station.pos.x + DEPOSIT_RANGE * 2, y: station.pos.y };
    expect(inAtmosphere(ship, station)).toBe(false);

    for (let i = 0; i < 60; i++) step(world, []);
    expect(ship.cargo).toBeCloseTo(cargo, 9); // hold frozen where it was
    expect(ship.banked).toBeCloseTo(banked, 9);
  });

  it('does not deposit at a station that is not your own', () => {
    const world = createWorld({ seed: 7, players: PLAYERS });
    const ship = world.ships[0]!;
    const rival = stationOf(world, 1)!;
    // Park slot 0 docked at slot 1's station, holding ore.
    ship.pos = { x: rival.pos.x + (STATION.radius + ship.radius + 30), y: rival.pos.y };
    ship.vel = { x: 0, y: 0 };
    ship.cargo = 2;
    ship.banked = 0;
    expect(isDocked(ship, rival)).toBe(true);

    for (let i = 0; i < 120; i++) step(world, []);
    // Not their station ⇒ nothing banks; the hold is untouched.
    expect(ship.cargo).toBe(2);
    expect(ship.banked).toBe(0);
  });

  it('does not deposit once the home station is dead', () => {
    const { world, ship } = stagedAtHome(2);
    const station = stationOf(world, 0)!;
    station.alive = false; // wreck — no bank behind it
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
  it('spawns exactly one courier per whole unit banked, each headed for the station (conserved)', () => {
    const { world, ship } = stagedAtHome(3);
    const station = stationOf(world, 0)!;
    const held = ship.cargo; // three whole ore to deposit

    // Couriers are absorbed mid-drain, so count DISTINCT spawns by id (the live
    // count is only ever ~1 at a time). Field report p8: the flight must total the
    // ore that actually moved — one sprite per whole unit banked, not the old
    // rate-based time cadence that spawned ~3 couriers per ore ("more ore flying
    // than you hold"). The spawner is now keyed to the hold's integer boundaries.
    const seen = new Set<number>();
    let firstHeadingTowardStation = 0;
    for (let i = 0; i < 300; i++) {
      step(world, []);
      for (const c of world.chunks) {
        if (!c.deposit || seen.has(c.id)) continue;
        seen.add(c.id);
        // Every courier is a straight line into this station's centre.
        expect(c.homeTo).toEqual({ x: station.pos.x, y: station.pos.y });
        if (seen.size === 1) {
          // A courier starts at the hull and heads inward toward the station centre.
          firstHeadingTowardStation =
            (station.pos.x - ship.pos.x) * c.vel.x + (station.pos.y - ship.pos.y) * c.vel.y;
        }
      }
    }

    expect(ship.cargo).toBe(0);
    // Exactly one courier per whole ore banked — off-by-anything is visible here.
    expect(seen.size).toBe(held);
    expect(firstHeadingTowardStation).toBeGreaterThan(0);
  });

  it('couriers are absorbed at the station and swept — none outlive the drain', () => {
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
      const station = stationOf(world, 0)!;
      ship.pos = { x: station.pos.x + (STATION.radius + ship.radius + 30), y: station.pos.y };
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
