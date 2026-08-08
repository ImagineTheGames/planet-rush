/**
 * src/sim/loot-tell.test.ts — the a0-08 reproduction, pinned.
 * OWNER: Gameplay Engineer.
 *
 * The developer, 2026-08-07: *"sometimes picked up ore from dead ships dont
 * count"*. "Sometimes" was the whole clue, and the ore ledger answered it: across
 * every scenario below the economy CONSERVES EXACTLY (residual 0) — not one unit
 * is lost. Nothing was ever stolen from the player. What differs between the runs
 * is only how much of a wreck a hold can accept, and none of it was ever said:
 *
 *   A. empty hold  → takes the whole drop.  Hold moves, banked total does not.
 *   B. full hold   → takes NOTHING. The tractor does not even pull; the chunk is
 *                    left where it is (GDD §2.3) and no branch runs at all.
 *   C. one slot    → takes 1 of the drop and leaves the rest floating.
 *
 * Same kill, same wreck, three different outcomes and no tell between them: that
 * is "sometimes". These tests pin the reproduction AND the two tells that now
 * make each case visible (`Ship.lootTake`, `Ship.lootBlocked`), so the silent
 * version cannot come back. The match-wide conservation law that proved no ore
 * leaks lives in `tests/harness/ore-conservation.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '../shared/types';
import { TICK_DT, createWorld, step } from './index';
import { damageShip } from './damage';
import { oreResidual } from './ore-ledger';
import { TRACTOR } from './constants';
import { refreshDerivedStats } from './upgrades';
import type { PlayerSpec, Ship, World } from './state';

/** A two-ship world with the pair parked mid-arena, clear of any atmosphere
 *  drain, spawn protection spent — the cockpit moment the report describes. */
function stagedKill(looterCargo: number): { world: World; victim: Ship; looter: Ship } {
  const players: PlayerSpec[] = [
    { id: 0, shipClass: ShipClass.Vanguard },
    { id: 1, shipClass: ShipClass.Vanguard },
  ];
  const world = createWorld({ seed: 5, players });
  const victim = world.ships[0]!;
  const looter = world.ships[1]!;

  victim.pos = { x: world.bounds.width / 2, y: world.bounds.height / 2 };
  looter.pos = { x: victim.pos.x + 20, y: victim.pos.y };
  victim.vel = { x: 0, y: 0 };
  looter.vel = { x: 0, y: 0 };
  victim.spawnProtect = 0;
  looter.spawnProtect = 0;

  // Give the VICTIM a bought cargo tier (GDD §2.5: +2 per tier), so its hold is 4
  // and the half-drop is 2 chunks rather than 1. A drop of one indivisible ore
  // cannot show a partial take, and a partial take is one of the four things the
  // report could have been. Tiers are match state, so this is a legitimate ship.
  victim.tiers.cargo = 1;
  refreshDerivedStats(victim);
  expect(victim.cargoCap).toBe(4);

  // Fill the holds from the rock field rather than out of thin air: ore moves
  // asteroid → cargo, which conserves `liveOre` exactly, so the ledger stays
  // balanced through the staging and every residual assertion below is honest.
  fillFromRock(world, victim, victim.cargoCap);
  fillFromRock(world, looter, looterCargo);

  return { world, victim, looter };
}

function fillFromRock(world: World, ship: Ship, n: number): void {
  let left = n;
  for (const a of world.asteroids) {
    if (left <= 1e-9) break;
    const take = Math.min(a.ore, left);
    a.ore -= take;
    ship.cargo += take;
    left -= take;
  }
  expect(left, 'the rock field should have had enough ore to stage the hold').toBeLessThan(1e-9);
}

/** Hold the looter still on the wreck for `ticks` and run the real step. */
function hover(world: World, looter: Ship, ticks: number): void {
  const park = { x: looter.pos.x, y: looter.pos.y };
  for (let i = 0; i < ticks; i++) {
    step(world, [], TICK_DT);
    looter.vel = { x: 0, y: 0 };
    looter.pos = { x: park.x, y: park.y };
  }
}

describe('a0-08 — looting a dead ship: what actually happens, and what says so', () => {
  it('A. an EMPTY hold takes the whole drop — the hold moves, the bank does not', () => {
    const { world, victim, looter } = stagedKill(0);
    const bankedBefore = looter.banked;
    damageShip(world, victim, 9999);
    const dropped = world.chunks.reduce((s, c) => s + c.amount, 0);
    expect(dropped).toBeGreaterThan(0);

    hover(world, looter, 120);

    expect(looter.cargo).toBeCloseTo(dropped, 9);
    // The number the developer was watching. It is CORRECT that it did not move:
    // looted ore is held, not banked, until the hold is drained in your own
    // atmosphere (GDD §2.3). Coordinated with a0-03, which renames this readout.
    expect(looter.banked).toBe(bankedBefore);
    expect(world.chunks.length, 'the wreck is cleaned up').toBe(0);
    expect(oreResidual(world)).toBeCloseTo(0, 9);
  });

  it('B. a FULL hold takes NOTHING and the drop stays on the field — the report', () => {
    const { world, victim, looter } = stagedKill(2);
    expect(looter.cargo).toBe(looter.cargoCap);
    damageShip(world, victim, 9999);
    const dropped = world.chunks.reduce((s, c) => s + c.amount, 0);

    hover(world, looter, 120);

    expect(looter.cargo).toBe(looter.cargoCap);
    // Not lost — still lying there for anyone with room (GDD §2.3).
    expect(world.chunks.reduce((s, c) => s + c.amount, 0)).toBeCloseTo(dropped, 9);
    expect(world.ledger?.looted).toBe(0);
    expect(oreResidual(world)).toBeCloseTo(0, 9);
  });

  it('C. ONE slot of room takes 1 and leaves the rest floating', () => {
    const { world, victim, looter } = stagedKill(1);
    damageShip(world, victim, 9999);
    const dropped = world.chunks.reduce((s, c) => s + c.amount, 0);
    expect(dropped).toBeGreaterThan(1);

    hover(world, looter, 120);

    expect(looter.cargo).toBe(looter.cargoCap);
    expect(world.ledger?.looted).toBeCloseTo(1, 9);
    expect(world.chunks.reduce((s, c) => s + c.amount, 0)).toBeCloseTo(dropped - 1, 9);
    expect(oreResidual(world)).toBeCloseTo(0, 9);
  });

  it('no ore is lost in ANY of the three — the ledger balances the same either way', () => {
    for (const looterCargo of [0, 1, 2]) {
      const { world, victim, looter } = stagedKill(looterCargo);
      damageShip(world, victim, 9999);
      hover(world, looter, 120);
      expect(oreResidual(world), `residual with a hold of ${looterCargo}`).toBeCloseTo(0, 9);
    }
  });
});

describe('a0-08 — the tells that make each outcome visible', () => {
  it('`lootTake` is the ore that ARRIVED, on the tick it arrived', () => {
    const { world, victim, looter } = stagedKill(0);
    damageShip(world, victim, 9999);

    let sumTake = 0;
    for (let i = 0; i < 120; i++) {
      step(world, [], TICK_DT);
      looter.vel = { x: 0, y: 0 };
      sumTake += looter.lootTake ?? 0;
      // The tell never claims more than the hold actually gained.
      expect(looter.lootTake ?? 0).toBeGreaterThanOrEqual(0);
    }
    expect(sumTake).toBeCloseTo(world.ledger!.looted, 9);
    expect(sumTake).toBeCloseTo(looter.cargo, 9);
  });

  it('a PARTIAL take reports the 1 it took, never the whole chunk', () => {
    const { world, victim, looter } = stagedKill(1);
    damageShip(world, victim, 9999);
    // Chunks are one ore each here, so make the leftover unambiguous: the hold has
    // room for exactly 1 and more than 1 is on offer.
    expect(world.chunks.reduce((s, c) => s + c.amount, 0)).toBeGreaterThan(1);

    let sumTake = 0;
    for (let i = 0; i < 120; i++) {
      step(world, [], TICK_DT);
      looter.vel = { x: 0, y: 0 };
      sumTake += looter.lootTake ?? 0;
    }
    expect(sumTake).toBeCloseTo(1, 9);
  });

  it('`lootBlocked` fires when a FULL hold sits on ore it cannot take', () => {
    const { world, victim, looter } = stagedKill(2);
    damageShip(world, victim, 9999);

    let blockedTicks = 0;
    for (let i = 0; i < 120; i++) {
      step(world, [], TICK_DT);
      looter.vel = { x: 0, y: 0 };
      looter.pos = { x: victim.pos.x + 20, y: victim.pos.y };
      if (looter.lootBlocked) blockedTicks++;
      expect(looter.lootTake ?? 0, 'a blocked hold takes nothing').toBe(0);
    }
    expect(blockedTicks, 'the frame the developer was looking at, now signposted').toBe(120);
  });

  it('`lootBlocked` is silent with ore out of tractor range, and clears on room', () => {
    const { world, victim, looter } = stagedKill(2);
    damageShip(world, victim, 9999);

    // Well beyond the tractor: a full hold across the map is not "refusing" ore.
    looter.pos = { x: victim.pos.x + TRACTOR.range * 3, y: victim.pos.y };
    step(world, [], TICK_DT);
    expect(looter.lootBlocked).toBe(false);

    // Back onto the wreck: blocked. Then make room, and it clears the same tick
    // the hold can accept again.
    looter.pos = { x: victim.pos.x + 20, y: victim.pos.y };
    step(world, [], TICK_DT);
    expect(looter.lootBlocked).toBe(true);
    looter.cargo = 0;
    step(world, [], TICK_DT);
    expect(looter.lootBlocked).toBe(false);
  });

  it('a deposit courier never reads as loot — it is ore already banked', () => {
    const { world, looter } = stagedKill(2);
    // A courier chunk (`deposit`) parked right on a full hold: it is this ship's
    // own ore in flight to its bank, so it is neither tractored nor "refused".
    world.chunks.push({
      id: world.nextEntityId++,
      pos: { x: looter.pos.x, y: looter.pos.y },
      vel: { x: 0, y: 0 },
      amount: 1,
      radius: 6,
      deposit: true,
      homeTo: { x: looter.pos.x + 500, y: looter.pos.y },
    });
    step(world, [], TICK_DT);
    expect(looter.lootBlocked).toBe(false);
    expect(looter.lootTake ?? 0).toBe(0);
  });

  it('the tells are cleared every tick, dead ships included', () => {
    const { world, victim, looter } = stagedKill(0);
    damageShip(world, victim, 9999);
    hover(world, looter, 120);
    // The wreck is gone, the hold is full and there is nothing left in range.
    expect(looter.lootTake).toBe(0);
    expect(looter.lootBlocked).toBe(false);
    expect(victim.lootTake).toBe(0);
    expect(victim.lootBlocked).toBe(false);
  });
});
