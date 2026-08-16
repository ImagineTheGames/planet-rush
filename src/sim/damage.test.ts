/**
 * src/sim/damage.test.ts — what a death drop is allowed to mint.
 * OWNER: Gameplay Engineer.
 *
 * The developer, 2026-08-16: *"its super easy to reproduce this ore bug, its
 * usually from blown up ships, their ore's don't always count when picked up"*.
 * That detail is the diagnosis. `killShip` sheds half the hold, and half of an odd
 * hold is a half: a ship dying on 3 ore dropped one chunk of 1 and one of **0.5**.
 * The split was exact and the ledger balanced on it — but every ore readout in the
 * game floors, so collecting that 0.5 moved a hold from 1 to 1.5 and showed 1. The
 * ore was genuinely there and the player was genuinely told nothing; collect a
 * second half and it jumps by a whole, which is why it *"doesn't always"* count.
 *
 * Ore is a countable thing. A hold shows pips, a cost is a whole number, a wheel
 * prints integers, and no amount of UI can honestly render half a pip — so the fix
 * is at the mint: a death drop emits whole `CHUNK.ore` units and nothing else, and
 * the sub-chunk remainder burns with the ship in `deathLoss`, the sink half this
 * hold was already going to by design (GDD §2.3). `DEATH_ORE_DROP_FRACTION` is
 * untouched; it is ratified.
 *
 * The ledger half of this — that the rounding MOVES ore into the sink rather than
 * destroying or minting it — is `./ore-ledger.test.ts`. The whole-ore invariant
 * across every other mint and the collection path is there too.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '../shared/types';
import { CHUNK, DEATH_ORE_DROP_FRACTION } from './constants';
import { damageShip, killShip } from './damage';
import { createWorld } from './state';
import type { PlayerSpec, Ship, World } from './state';

const PLAYERS: readonly PlayerSpec[] = [
  { id: 0, shipClass: ShipClass.Vanguard },
  { id: 1, shipClass: ShipClass.Vanguard },
];

/** A ship parked mid-arena with `hold` ore aboard and nothing else on the map to
 *  confuse the chunk list — the cockpit moment the report describes, minus the
 *  cockpit. `cargo` is written directly and deliberately above `cargoCap` in the
 *  larger cases: the hold ceiling is 8 today (GDD §2.8) and this is a statement
 *  about the SPLIT, which must hold for any hold a future cargo tier allows. */
function staged(hold: number): { world: World; victim: Ship } {
  const world = createWorld({ seed: 5, players: PLAYERS });
  const victim = world.ships[0]!;
  victim.pos = { x: world.bounds.width / 2, y: world.bounds.height / 2 };
  victim.vel = { x: 0, y: 0 };
  victim.spawnProtect = 0;
  victim.cargo = hold;
  world.chunks.length = 0; // any derelict debris the map laid out is not this test's
  return { world, victim };
}

/** How many whole `CHUNK.ore` pieces a hold of `hold` should shed. */
function expectedPieces(hold: number): number {
  return Math.floor((hold * DEATH_ORE_DROP_FRACTION) / CHUNK.ore);
}

/** The holds under test: 1 through 9 chunks. In `CHUNK.ore` units rather than the
 *  literal 1 — the chunk size is TUNABLE (GDD §2.8), and a test written against
 *  the literal passes for the wrong reason the day it moves. The odd holds are the
 *  point: those are the ones whose half does not divide. */
const HOLDS = Array.from({ length: 9 }, (_, i) => (i + 1) * CHUNK.ore);

describe('a death drop mints countable ore (a0-58)', () => {
  it('a death drop never mints a fraction', () => {
    for (const hold of HOLDS) {
      const { world, victim } = staged(hold);
      killShip(world, victim);

      for (const chunk of world.chunks) {
        const units = chunk.amount / CHUNK.ore;
        expect(units, `hold ${hold}: chunk of ${chunk.amount} is not whole CHUNK.ore`).toBeCloseTo(
          Math.round(units),
          9,
        );
        expect(units, `hold ${hold}: a chunk carrying nothing`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('sheds every whole chunk half the hold can pay for, and no more', () => {
    for (const hold of HOLDS) {
      const { world, victim } = staged(hold);
      killShip(world, victim);

      expect(world.chunks.length, `hold ${hold}`).toBe(expectedPieces(hold));
      const dropped = world.chunks.reduce((sum, c) => sum + c.amount, 0);
      // Never more than the ratified half — the rounding only ever goes down.
      expect(dropped, `hold ${hold}`).toBeLessThanOrEqual(hold * DEATH_ORE_DROP_FRACTION + 1e-9);
      expect(dropped, `hold ${hold}`).toBeCloseTo(expectedPieces(hold) * CHUNK.ore, 9);
    }
  });

  it('a hold too small to shed one whole chunk drops nothing and goes down with the hull', () => {
    // Half of one chunk is half a chunk: there is nothing whole to leave behind,
    // so the wreck is bare rather than sprinkled with ore nobody can collect.
    const { world, victim } = staged(CHUNK.ore);
    killShip(world, victim);
    expect(world.chunks).toHaveLength(0);
    expect(victim.cargo).toBe(0);
  });

  it('the half-drop itself is unchanged — an even hold still sheds exactly half', () => {
    // The ratified rule (GDD §2.3, §2.7) is what it always was. a0-58 rounds the
    // pieces; it does not touch DEATH_ORE_DROP_FRACTION.
    const hold = 4 * CHUNK.ore;
    const { world, victim } = staged(hold);
    killShip(world, victim);
    const dropped = world.chunks.reduce((sum, c) => sum + c.amount, 0);
    expect(dropped).toBeCloseTo(hold * DEATH_ORE_DROP_FRACTION, 9);
  });

  it('holds the same line when the kill comes through damage, not a direct call', () => {
    // `damageShip` is the path every real death takes — a ship weapon shot and a
    // turret's pooled shot both land here (`./projectiles`, `./buildings`), so the
    // rounding cannot come back through a second door.
    const { world, victim } = staged(3 * CHUNK.ore);
    damageShip(world, victim, victim.hull + 999, 1);
    expect(victim.alive).toBe(false);
    for (const chunk of world.chunks) {
      expect(chunk.amount).toBeCloseTo(CHUNK.ore, 9);
    }
    expect(world.chunks.length).toBe(expectedPieces(3 * CHUNK.ore));
  });

  it('scatters its ring deterministically — the same kill twice, chunk for chunk', () => {
    const run = () => {
      const { world, victim } = staged(5 * CHUNK.ore);
      killShip(world, victim);
      return world.chunks.map((c) => `${c.amount}@${c.pos.x.toFixed(6)},${c.pos.y.toFixed(6)}`);
    };
    expect(run()).toEqual(run());
  });
});
