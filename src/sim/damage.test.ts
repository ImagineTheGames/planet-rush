/**
 * src/sim/damage.test.ts — what a death drop is allowed to mint, and how much.
 * OWNER: Gameplay Engineer.
 *
 * TWO RULES MEET IN `killShip`, AND THIS FILE GATES BOTH.
 *
 * **How much (a0-59, 2026-08-16).** The developer: *"destroyed ships should drop
 * all their ore, no more 1/2 the ore stuff"*. `DEATH_ORE_DROP_FRACTION` is `1`, so
 * a destroyed ship leaves its entire hold on the field. This overturns GDD §2.3's
 * half-burn — a ratified ore sink — deliberately and by the person it belongs to;
 * the GDD is amended to match (`docs/design-amendments.md`) so the doc and the
 * constant cannot disagree.
 *
 * **In what units (a0-58, 2026-08-16).** The developer, on the same day: *"its
 * super easy to reproduce this ore bug, its usually from blown up ships, their
 * ore's don't always count when picked up"*. A drop that minted a 0.5 handed the
 * player ore no readout could show — the hold is pips, a cost is a whole number,
 * the wheel prints integers, so all three floor it away. So a drop mints whole
 * `CHUNK.ore` units and nothing else, and any sub-chunk remainder burns with the
 * ship in `deathLoss`.
 *
 * At today's values the second rule subtracts nothing: a whole hold times `1` is a
 * whole number of chunks. **It is gated anyway.** `DEATH_ORE_DROP_FRACTION` is
 * TUNABLE and moving it off `1` re-creates the remainder in a single edit — the
 * invariant is what makes that safe, which is the "assert the relationship, not
 * today's value" rule four star-bloom rounds paid for (LESSONS §26). (`CHUNK.ore`
 * is TUNABLE too but does NOT arm the remainder — holds are whole chunks by
 * a0-58's construction, so the drop divides exactly at every chunk size. Measured;
 * see 'the sink is armed by the fraction alone' below.) Every
 * assertion below is therefore written against `CHUNK.ore` and
 * `DEATH_ORE_DROP_FRACTION`, never against the literal 1 — except
 * `drops the whole hold`, which is the one place the ruling's *value* is the
 * point and is asserted as such.
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
 *  about the DROP, which must hold for any hold a future cargo tier allows. */
function staged(hold: number): { world: World; victim: Ship } {
  const world = createWorld({ seed: 5, players: PLAYERS });
  const victim = world.ships[0]!;
  victim.pos = { x: world.bounds.width / 2, y: world.bounds.height / 2 };
  victim.vel = { x: 0, y: 0 };
  victim.spawnProtect = 0;
  victim.cargo = hold;
  world.chunks.length = 0; // any derelict debris the map laid out is not this test's
  world.ledger!.dropped = 0;
  world.ledger!.deathLoss = 0;
  return { world, victim };
}

/** Ore actually lying on the field after the kill. */
function onField(world: World): number {
  return world.chunks.reduce((sum, c) => sum + c.amount, 0);
}

/** How many whole `CHUNK.ore` pieces a hold of `hold` should shed. */
function expectedPieces(hold: number): number {
  return Math.floor((hold * DEATH_ORE_DROP_FRACTION) / CHUNK.ore);
}

/** The holds under test: 1 through 9 chunks. In `CHUNK.ore` units rather than the
 *  literal 1 — the chunk size is TUNABLE (GDD §2.8), and a test written against
 *  the literal passes for the wrong reason the day it moves. */
const HOLDS = Array.from({ length: 9 }, (_, i) => (i + 1) * CHUNK.ore);

describe('a destroyed ship drops everything (a0-59)', () => {
  it('drops the whole hold', () => {
    // THE RULING, stated as the developer stated it: a ship dying with N ore
    // leaves chunks summing to exactly N, for N = 1 through 9. Nothing is held
    // back, nothing burns with the hull, and the arithmetic is `toBe`-exact
    // rather than approximate — a whole hold of whole chunks has no rounding to
    // forgive, and a test that tolerated 1e-9 here would tolerate a fraction
    // creeping back in.
    for (let n = 1; n <= 9; n++) {
      const { world, victim } = staged(n);
      killShip(world, victim);

      expect(onField(world), `hold ${n}: the field total`).toBe(n);
      expect(victim.cargo, `hold ${n}: the hold is emptied, not halved`).toBe(0);
      expect(world.ledger!.dropped, `hold ${n}: ledger 'dropped'`).toBe(n);
      // The half-burn is gone: an ordinary death sinks NOTHING (GDD §2.3, amended).
      expect(world.ledger!.deathLoss, `hold ${n}: nothing burns with the hull`).toBe(0);
    }
  });

  it('the ledger still balances: dropped + deathLoss is the hold that died', () => {
    // `deathLoss` survives the ruling at 0. It is NOT deleted: it remains the sink
    // for whatever a drop cannot lay down — today only the sub-chunk quantisation
    // leftover — and a ledger with no sink cannot stay conserved the day one
    // reappears. This is the relationship the constant is allowed to move under.
    //
    // This comment used to add "ore lost out of bounds" as a second flow, carried
    // over from the a0-59 brief. THERE IS NO SUCH FLOW (checked 2026-08-16): the
    // sim has no world bound that destroys ore. Chunks drift under `CHUNK.drag`
    // and are removed on one condition only — being emptied by a tractor
    // (`./step`) — asteroids only once `chipAsteroid` has drained the tail into
    // `dust`, and nothing anywhere culls ore by position. Named here because a
    // sink advertising a flow the sim does not have invites the next agent to go
    // looking for the leak, or to trust a guard for a reason that is not real.
    for (const hold of HOLDS) {
      const { world, victim } = staged(hold);
      killShip(world, victim);

      const { dropped, deathLoss } = world.ledger!;
      expect(dropped + deathLoss, `hold ${hold}`).toBeCloseTo(hold, 9);
      expect(dropped, `hold ${hold}`).toBeCloseTo(onField(world), 9);
      expect(deathLoss, `hold ${hold}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('banked ore is untouched — the cost of dying is time and position', () => {
    // GDD §2.7 is NOT amended here. a0-59 moved the held-ore fraction only; the
    // bank was never at risk and still is not.
    const { world, victim } = staged(4 * CHUNK.ore);
    victim.banked = 7;
    killShip(world, victim);
    expect(victim.banked).toBe(7);
  });
});

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

  it('sheds every whole chunk the drop can pay for, and no more', () => {
    for (const hold of HOLDS) {
      const { world, victim } = staged(hold);
      killShip(world, victim);

      expect(world.chunks.length, `hold ${hold}`).toBe(expectedPieces(hold));
      // Never more than the ratified drop — the rounding only ever goes down.
      expect(onField(world), `hold ${hold}`).toBeLessThanOrEqual(hold * DEATH_ORE_DROP_FRACTION + 1e-9);
      expect(onField(world), `hold ${hold}`).toBeCloseTo(expectedPieces(hold) * CHUNK.ore, 9);
    }
  });

  it('a hold too small to shed one whole chunk drops nothing and goes down with the hull', () => {
    // UNREACHABLE IN PLAY TODAY, AND GATED ANYWAY. At `DEATH_ORE_DROP_FRACTION = 1`
    // with whole-ore holds (a0-58) no drop lands under a chunk, so this hold is
    // written by hand. The branch is the floor under the FRACTION: the day it
    // leaves 1, this is the case that decides whether the leftover becomes a chunk
    // nobody can read or a recorded sink. (It is not `CHUNK.ore` that arms it —
    // see 'the sink is armed by the fraction alone' below, which measures that.)
    const scrap = CHUNK.ore / 2;
    const { world, victim } = staged(scrap);
    killShip(world, victim);
    expect(world.chunks).toHaveLength(0);
    expect(victim.cargo).toBe(0);
    // Sunk, not vanished — the ledger is the difference between the two.
    expect(world.ledger!.deathLoss).toBeCloseTo(scrap, 9);
    expect(world.ledger!.dropped).toBe(0);
  });

  it('the sink is armed by the fraction alone — CHUNK.ore cannot re-arm it', () => {
    // MEASURED 2026-08-16 (a0-59), and it corrects what this file, `./damage.ts`
    // and `./constants.ts` all used to say: that the remainder returns "the day
    // the fraction leaves `1`, OR `CHUNK.ore` leaves `1`". Only the first half is
    // true, and which knob is the dangerous one is exactly what a tuner needs.
    //
    // a0-58 quantised every boundary a hold has — the tractor takes `room`
    // floored to whole `CHUNK.ore` (`./step.ts`), the drain hands back
    // `k * CHUNK.ore` (`dueThisTick`), and all four mint sites emit exactly
    // `CHUNK.ore` — so `cargo` is an exact multiple of `CHUNK.ore` at all times
    // (pinned across all three hold paths by `./ore-ledger.test.ts`, "cargo is
    // never a non-multiple of CHUNK.ore"). Write a hold of `n` chunks and the
    // arithmetic falls out: `deathLoss / held` is `(n − floor(n·f)) / n`, in which
    // the chunk size cancels. The sink's share is a function of the FRACTION and
    // the hold's size in chunks, and of nothing else.
    //
    // Confirmed in play as well as on paper, six full natural matches per arm:
    // `CHUNK.ore` at 1, 2 and 3 burned 0.00 ore across 2358 deaths at the shipped
    // fraction, while the same seeds at a fraction of 0.5 burned 283 of the 396
    // ore that died. Table and method in `docs/design-amendments.md`.
    const original = CHUNK.ore;
    try {
      // The baseline the other chunk sizes must reproduce, keyed by hold-in-chunks.
      const baseline = new Map<number, { pieces: number; sunkShare: number }>();
      for (const chunkOre of [1, 2, 3, 4]) {
        (CHUNK as { ore: number }).ore = chunkOre;
        for (let n = 1; n <= 9; n++) {
          // A hold is always a whole number of chunks — that is a0-58's invariant,
          // not an assumption this test is making for convenience.
          const held = n * chunkOre;
          const { world, victim } = staged(held);
          killShip(world, victim);

          const { dropped, deathLoss } = world.ledger!;
          const where = `CHUNK.ore ${chunkOre}, ${n} chunks`;
          // The books still close, at every chunk size.
          expect(dropped + deathLoss, `${where}: ledger`).toBeCloseTo(held, 9);
          expect(dropped, `${where}: on the field`).toBeCloseTo(onField(world), 9);

          const observed = { pieces: world.chunks.length, sunkShare: deathLoss / held };
          const first = baseline.get(n);
          if (!first) {
            baseline.set(n, observed);
          } else {
            // THE RELATIONSHIP: same hold measured in chunks, same outcome — the
            // chunk size cancels out of both the piece count and the sink's share.
            expect(observed.pieces, `${where}: pieces vs CHUNK.ore 1`).toBe(first.pieces);
            expect(observed.sunkShare, `${where}: sunk share vs CHUNK.ore 1`).toBeCloseTo(first.sunkShare, 9);
          }
        }
      }
      // …and THE VALUE, stated separately because today's fraction is a ruling and
      // not a relationship: at `1` that share is zero at every chunk size, so a
      // whole hold reaches the field however big a chunk is made.
      if (DEATH_ORE_DROP_FRACTION === 1) {
        for (const [n, { pieces, sunkShare }] of baseline) {
          expect(sunkShare, `${n} chunks: nothing burns at the shipped fraction`).toBe(0);
          expect(pieces, `${n} chunks: every chunk of the hold reaches the field`).toBe(n);
        }
      }
    } finally {
      (CHUNK as { ore: number }).ore = original;
    }
  });

  it('holds the same line when the kill comes through damage, not a direct call', () => {
    // `damageShip` is the path every real death takes — a ship weapon shot and a
    // turret's pooled shot both land here (`./projectiles`, `./buildings`), so
    // neither rule can come back through a second door.
    const hold = 3 * CHUNK.ore;
    const { world, victim } = staged(hold);
    damageShip(world, victim, victim.hull + 999, 1);
    expect(victim.alive).toBe(false);
    for (const chunk of world.chunks) {
      expect(chunk.amount).toBeCloseTo(CHUNK.ore, 9);
    }
    expect(world.chunks.length).toBe(expectedPieces(hold));
    expect(onField(world)).toBeCloseTo(hold * DEATH_ORE_DROP_FRACTION, 9);
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
