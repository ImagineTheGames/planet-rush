/**
 * src/sim/ore-ledger.test.ts — ore is a countable thing, and the books say so.
 * OWNER: Gameplay Engineer.
 *
 * Two laws, and they are not the same law.
 *
 *  1. **Conservation.** Every unit of ore that moves is accounted for, so
 *     `oreResidual` reads zero at every tick. That law is older than this file and
 *     is soaked over full natural matches in
 *     `tests/harness/ore-conservation.test.ts`; a0-08 proved it HELD while the
 *     developer was still losing ore, which is exactly why the second law exists.
 *
 *  2. **Countability (a0-58).** Ore that conserves can still be unreadable. A
 *     death drop used to split its share of the hold into whole chunks *plus a
 *     remainder* — under the half-drop then in force, 3 ore shed one chunk of 1
 *     and one of 0.5 (a0-59 has since taken the fraction to 1, which removes that
 *     particular half but not the rule) — and the ledger balanced on it
 *     perfectly. But `Math.floor` guards every readout the player has (the hold
 *     pips, the build wheel's hub, the upgrade wheel), so a 0.5 in a hold is ore
 *     you own, can spend toward, and are told nothing about: *"their ore's don't
 *     always count when picked up"* (developer, 2026-08-16). It "doesn't always"
 *     because it depends on whether a matching half happens to arrive.
 *
 * So every mint in the sim emits whole `CHUNK.ore` units and the sub-chunk
 * remainder goes to a **named sink** — `deathLoss` for a ship, `capLoss` for a
 * wreck, `dust` for the tail of a mined-out rock — and the collection path takes
 * whole ore or none. The two laws are tested together on purpose: rounding that
 * balances but cannot be read is the bug, and rounding that reads but does not
 * balance is the older, worse one.
 *
 * The three mints and the one collection path:
 *   `damage.ts` killShip · `match.ts` scatterWreckDebris · `projectiles.ts`
 *   chipAsteroid · `step.ts` updateChunks.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '../shared/types';
import { CHUNK, DEATH_ORE_DROP_FRACTION, TICK_DT, WRECK } from './constants';
import { killShip } from './damage';
import { destroyCore } from './match';
import { fireShipProjectile } from './projectiles';
import { liveOre, makeLedger, oreResidual } from './ore-ledger';
import type { OreLedger } from './ore-ledger';
import { stationOf } from './buildings';
import { createWorld } from './state';
import type { Asteroid, PlayerSpec, Ship, World } from './state';
import { step } from './step';
import { refreshDerivedStats } from './upgrades';
import { normalize } from './vec';

const PLAYERS: readonly PlayerSpec[] = [
  { id: 0, shipClass: ShipClass.Vanguard },
  { id: 1, shipClass: ShipClass.Vanguard },
];

/** A fresh match with both ships parked mid-arena, clear of any station's
 *  atmosphere, spawn protection spent. */
function staged(): { world: World; victim: Ship; looter: Ship } {
  const world = createWorld({ seed: 5, players: PLAYERS });
  const victim = world.ships[0]!;
  const looter = world.ships[1]!;
  victim.pos = { x: world.bounds.width / 2, y: world.bounds.height / 2 };
  looter.pos = { x: victim.pos.x + 20, y: victim.pos.y };
  victim.vel = { x: 0, y: 0 };
  looter.vel = { x: 0, y: 0 };
  victim.spawnProtect = 0;
  looter.spawnProtect = 0;
  return { world, victim, looter };
}

/** Move `n` ore out of the rock field and into `ship`'s hold. Staging through the
 *  rock rather than out of thin air keeps `liveOre` untouched, so every residual
 *  assertion below is honest about the world it is measuring. */
function fillFromRock(world: World, ship: Ship, n: number): void {
  let left = n;
  for (const a of world.asteroids) {
    if (left <= 1e-9) break;
    const take = Math.min(a.ore, left);
    a.ore -= take;
    ship.cargo += take;
    left -= take;
  }
  expect(left, 'the rock field should have had enough ore to stage this hold').toBeLessThan(1e-9);
}

/** Move `n` ore out of the rock field and into `ship`'s BANK, on the same honest
 *  terms as {@link fillFromRock} — a bank is filled by the drain in play, and a
 *  bank with a fraction in it is what a wreck has to ring. */
function bankFromRock(world: World, ship: Ship, n: number): void {
  fillFromRock(world, ship, n);
  ship.banked += ship.cargo;
  ship.cargo = 0;
}

/** Ore loose on the map — real chunks only, never the cosmetic couriers. */
function looseOre(world: World): number {
  return world.chunks.reduce((sum, c) => sum + (c.deposit ? 0 : c.amount), 0);
}

/** A copy of the ledger, for before/after arithmetic. */
function snapshot(world: World): OreLedger {
  return { ...(world.ledger ?? makeLedger()) };
}

/** Whole units of `CHUNK.ore` in `amount`, or `null` if it is not a whole number
 *  of them — the one predicate this whole file is about. */
function unitsOf(amount: number): number | null {
  const units = amount / CHUNK.ore;
  return Math.abs(units - Math.round(units)) <= 1e-9 ? Math.round(units) : null;
}

/** Assert every hold in the world holds countable ore, and hand back the tick's
 *  cargo readings so a caller can prove ore actually moved. */
function expectHoldsCountable(world: World, where: string): number[] {
  return world.ships.map((s) => {
    expect(unitsOf(s.cargo), `${where}: hold of ${s.cargo} is not whole CHUNK.ore`).not.toBeNull();
    return s.cargo;
  });
}

/** Assert every loose chunk on the map carries countable ore. Deposit couriers are
 *  skipped: they are sprites for ore that already reached the bank, never
 *  collectable, and `liveOre` does not count them (`step.ts` `spawnDepositFlight`). */
function expectChunksCountable(world: World, where: string): void {
  for (const c of world.chunks) {
    if (c.deposit) continue;
    expect(unitsOf(c.amount), `${where}: chunk of ${c.amount} is not whole CHUNK.ore`).not.toBeNull();
  }
}

/** The holds under test — 1 through 9 chunks, in `CHUNK.ore` units rather than the
 *  literal 1, which is TUNABLE (GDD §2.8). The odd ones are the point. */
const HOLDS = Array.from({ length: 9 }, (_, i) => (i + 1) * CHUNK.ore);

describe('the death drop pays the sink what it cannot mint (a0-58)', () => {
  it('conserved across a death drop', () => {
    for (const hold of HOLDS) {
      const { world, victim } = staged();
      fillFromRock(world, victim, hold);
      const before = snapshot(world);
      const onTheMapBefore = looseOre(world);

      killShip(world, victim);

      const dropped = world.ledger!.dropped - before.dropped;
      const burnt = world.ledger!.deathLoss - before.deathLoss;
      // The whole hold left the ship, and every unit of it is on the books: what
      // the ring could mint as chunks, plus what the ship took down with it. The
      // rounding MOVES ore into the sink — it never destroys it off-ledger and it
      // never mints a unit that was not in the hold.
      expect(dropped + burnt, `hold ${hold}: dropped + deathLoss`).toBeCloseTo(hold, 12);
      expect(victim.cargo).toBe(0);

      // …and the sink is the only place anything undropped can be. Since a0-59 the
      // whole hold is owed to the field, so for a hold that divides this bound is
      // tight and `burnt` is 0. Written against the constant rather than the value:
      // it is the same line that held the old half-drop honest, and it is TUNABLE.
      const owed = hold * DEATH_ORE_DROP_FRACTION;
      expect(dropped, `hold ${hold}: never more than the drop is owed`).toBeLessThanOrEqual(owed + 1e-9);
      expect(burnt, `hold ${hold}`).toBeCloseTo(hold - dropped, 12);

      // The books still balance against the world itself, not just against
      // themselves: the ore this kill put on the map is exactly what it booked.
      expect(looseOre(world) - onTheMapBefore, `hold ${hold}: on the map`).toBeCloseTo(dropped, 9);
      expect(Math.abs(oreResidual(world)), `hold ${hold}: residual`).toBeLessThan(1e-9);
    }
  });

  it('every piece it lays down is a whole chunk', () => {
    for (const hold of HOLDS) {
      const { world, victim } = staged();
      fillFromRock(world, victim, hold);
      const beforeChunks = world.chunks.length;
      killShip(world, victim);
      expectChunksCountable(world, `hold ${hold}`);
      expect(world.chunks.length - beforeChunks).toBe(Math.floor((hold * DEATH_ORE_DROP_FRACTION) / CHUNK.ore));
    }
  });
});

describe('a wreck rings whole chunks too (a0-58)', () => {
  it('scatters countable debris from a fortune that is not a whole number', () => {
    const { world } = staged();
    const station = stationOf(world, 0)!;
    const owner = world.ships[0]!;
    // A bank with a fraction in it is the normal case, not a contrived one: the
    // atmosphere drain is what fills a bank, and before a0-58 a hold that left
    // mid-unit put the fraction there. Staged through the rock field, so `liveOre`
    // is honest about every unit this wreck is handed.
    bankFromRock(world, owner, 4.4 * CHUNK.ore);
    const fortune = owner.banked;
    expect(unitsOf(fortune), 'the fortune under test must not divide').toBeNull();
    const before = snapshot(world);

    destroyCore(world, station);

    expectChunksCountable(world, 'wreck ring');
    const dropped = world.ledger!.dropped - before.dropped;
    const capped = world.ledger!.capLoss - before.capLoss;
    const floor = world.ledger!.debrisFloor - before.debrisFloor;
    expect(floor).toBeCloseTo(WRECK.baseDebrisOre, 12);
    // Everything the wreck was handed is either loose on the ring in whole chunks
    // or named in a sink — the fortune plus the minted floor, to the unit.
    expect(dropped + capped).toBeCloseTo(fortune + WRECK.baseDebrisOre, 9);
    // …and what the sink took is only the sub-chunk remainder, never a whole ore.
    expect(capped).toBeGreaterThan(0);
    expect(capped).toBeLessThan(CHUNK.ore);
    expect(Math.abs(oreResidual(world))).toBeLessThan(1e-9);
  });

  it('a fortune that divides exactly loses nothing at all to the rounding', () => {
    // The control for the test above: `capLoss` is a remainder sink here, not a
    // tax. A wreck whose ore is a whole number of chunks rings all of it.
    const { world } = staged();
    const station = stationOf(world, 1)!;
    const owner = world.ships[1]!;
    bankFromRock(world, owner, 5 * CHUNK.ore);
    const fortune = owner.banked;
    expect(unitsOf(fortune), 'and this one must divide').not.toBeNull();
    const before = snapshot(world);

    destroyCore(world, station);

    const dropped = world.ledger!.dropped - before.dropped;
    const capped = world.ledger!.capLoss - before.capLoss;
    expect(capped).toBe(0);
    expect(dropped).toBeCloseTo(fortune + WRECK.baseDebrisOre, 9);
    expectChunksCountable(world, 'whole wreck');
    expect(Math.abs(oreResidual(world))).toBeLessThan(1e-9);
  });
});

describe('a mined-out rock leaves dust, not a fractional chunk (a0-58)', () => {
  /** The smallest rock in the field, so mining it out is a short loop. */
  function smallestRock(world: World): Asteroid {
    return world.asteroids.reduce((best, a) => (a.ore < best.ore ? a : best));
  }

  it('the field really does hold rocks that are not a whole number of ore', () => {
    // The premise of this whole section, asserted rather than assumed: a rock's ore
    // is SCALED at world build to hit an exact field yield (`./waves` drawCanon), so
    // "mined ore is always whole" was never true. If this ever fails, the tail below
    // stopped existing and `dust` can be retired.
    const { world } = staged();
    expect(world.asteroids.some((a) => unitsOf(a.ore) === null)).toBe(true);
  });

  it('mines one out and every chunk it produced is whole, with the tail on the books', () => {
    const { world, looter } = staged();
    const rock = smallestRock(world);
    const startingOre = rock.ore;
    expect(unitsOf(startingOre), 'pick a rock whose ore does not divide').toBeNull();

    // Park the miner clear of the rock and shoot it out. A big enough hold that the
    // chunks it collects are part of the test rather than a full-hold refusal.
    looter.tiers.cargo = 3;
    refreshDerivedStats(looter);
    looter.pos = { x: rock.pos.x - (rock.radius + 60), y: rock.pos.y };
    looter.vel = { x: 0, y: 0 };
    const before = snapshot(world);

    for (let i = 0; i < 4000 && rock.ore > 1e-9; i++) {
      fireShipProjectile(world, looter, normalize({ x: 1, y: 0 }));
      step(world, []);
      expectChunksCountable(world, `mining tick ${i}`);
      expectHoldsCountable(world, `mining tick ${i}`);
    }
    expect(rock.ore, 'the rock should have been mined out').toBe(0);

    const mined = world.ledger!.mined - before.mined;
    const dust = world.ledger!.dust - before.dust;
    // Every unit that left the rock became a whole chunk or was named as dust —
    // nothing vanished, and nothing was minted to round a chunk up.
    expect(mined + dust).toBeCloseTo(startingOre, 9);
    expect(dust, 'the tail is under one chunk, by construction').toBeLessThan(CHUNK.ore);
    expect(dust).toBeGreaterThan(0);
    expect(Math.abs(oreResidual(world))).toBeLessThan(1e-9);
  });
});

describe('a hold can never contain ore it cannot show (a0-58)', () => {
  it('cargo is never a non-multiple of CHUNK.ore after any collection', () => {
    // Every path that puts ore in a hold, in one stepped world: a death drop, a
    // wreck's ring, mined chunks, and the atmosphere drain that empties it again.
    // The assertion runs EVERY tick, on every ship, because "sometimes" was the
    // whole of the original report.
    const { world, victim, looter } = staged();
    looter.tiers.cargo = 3;
    refreshDerivedStats(looter);
    expect(looter.cargoCap).toBe(8);

    // 1. A death drop on an odd hold — the reported case.
    fillFromRock(world, victim, 3 * CHUNK.ore);
    killShip(world, victim);
    expect(world.chunks.length).toBeGreaterThan(0);
    let collected = 0;
    for (let i = 0; i < 240; i++) {
      step(world, []);
      expectChunksCountable(world, `death drop tick ${i}`);
      collected = expectHoldsCountable(world, `death drop tick ${i}`)[1]!;
    }
    expect(collected, 'the looter should have picked the drop up').toBeGreaterThan(0);

    // 2. A wreck's ring, funded by a bank that does not divide.
    const station = stationOf(world, 0)!;
    bankFromRock(world, victim, 4.5 * CHUNK.ore);
    destroyCore(world, station);
    looter.pos = { x: station.pos.x + station.radius + WRECK.debrisRingOffset, y: station.pos.y };
    looter.vel = { x: 0, y: 0 };
    for (let i = 0; i < 240; i++) {
      step(world, []);
      expectChunksCountable(world, `wreck tick ${i}`);
      expectHoldsCountable(world, `wreck tick ${i}`);
    }

    // 3. The atmosphere drain — the one path that moves ore OUT of a hold, and the
    //    last place a sub-chunk sliver could be left behind. Fly the looter into
    //    its own atmosphere mid-unit and back out again.
    const home = stationOf(world, 1)!;
    // Clear the hold by BANKING it, not by writing a zero: `liveOre` has to stay
    // honest through the staging or the residual below measures the fixture.
    looter.banked += looter.cargo;
    looter.cargo = 0;
    fillFromRock(world, looter, 4 * CHUNK.ore);
    looter.pos = { x: home.pos.x + 90, y: home.pos.y };
    looter.vel = { x: 0, y: 0 };
    const ticksPerOre = Math.ceil(CHUNK.ore / (2 * TICK_DT) - 1e-9);
    for (let i = 0; i < Math.floor(ticksPerOre * 1.5); i++) {
      step(world, []);
      expectHoldsCountable(world, `drain tick ${i}`);
    }
    expect(looter.cargo, 'the drain should have banked whole ore').toBeLessThan(4 * CHUNK.ore);
    // …and out again, mid-unit: the hold that leaves is still countable.
    looter.pos = { x: world.bounds.width / 2, y: world.bounds.height / 2 };
    for (let i = 0; i < 60; i++) {
      step(world, []);
      expectHoldsCountable(world, `left the atmosphere, tick ${i}`);
    }
    expect(Math.abs(oreResidual(world)), 'and the books still balance').toBeLessThan(1e-6);
  });

  it('a hold with less than one chunk of room takes nothing, and says so', () => {
    // The invariant seen from the other side. A sub-chunk sliver in a hold can only
    // arrive from a foreign world now, but if one does, the tractor must not slice a
    // chunk to fit it — that would put the fraction back on the map for the next
    // ship. It refuses, and the refusal is the a0-08 tell the HUD already draws.
    const { world, victim, looter } = staged();
    // The other ship is parked out of tractor reach: this is a test about ONE
    // hold refusing a chunk, and a hold with room would simply take it.
    victim.pos = { x: looter.pos.x + 4000, y: looter.pos.y };
    fillFromRock(world, looter, looter.cargoCap - 0.4 * CHUNK.ore);
    world.chunks.push({
      id: world.nextEntityId++,
      pos: { x: looter.pos.x + 4, y: looter.pos.y },
      vel: { x: 0, y: 0 },
      amount: CHUNK.ore,
      radius: CHUNK.radius,
    });
    const held = looter.cargo;
    const live = liveOre(world);

    for (let i = 0; i < 30; i++) step(world, []);

    expect(looter.cargo).toBe(held); // not one sliver of it moved
    expect(looter.lootBlocked, 'the hold should be telling the player it is full').toBe(true);
    expectChunksCountable(world, 'refused chunk');
    expect(liveOre(world)).toBeCloseTo(live, 9);
  });
});
