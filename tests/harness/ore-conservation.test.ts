/**
 * tests/harness/ore-conservation.test.ts — the ore black-hole class-killer.
 * OWNER: Gameplay Engineer.
 *
 * Three times a developer has reported the same bug: "when I pick up a dead
 * ship's ore it doesn't count for anything." Three times a unit test fixed one
 * path and stayed green while play kept leaking — because the leak hid on a code
 * path (a real-combat kill, a wreck's debris, the atmosphere drain) the unit test
 * never took. LOOT ore, specifically, is the ore that keeps vanishing.
 *
 * This is the invariant that ends the pattern. It runs FULL natural matches — the
 * real offline cast, real bots mining and fighting and dying and scavenging each
 * other's wrecks, ZERO seams anywhere in the causal chain — and samples the ore
 * ledger (`src/sim/ore-ledger.ts`) EVERY tick. The economy must balance exactly:
 *
 *     liveOre === seeded + injected + debrisFloor − spent − deathLoss − capLoss
 *
 * Any future edit that loses a unit of ore on ANY path — drop that spawns with no
 * value, a tractor that ingests but the hold never gains, a drain that skips
 * loot-typed chunks — drives the residual off zero and fails this soak, whatever
 * the path. Unit tests proved insufficient for this economy; a match-wide
 * conservation law does not.
 */

import { describe, it, expect } from 'vitest';
import { TICK_DT, createWorld, isOver, step, liveOre, expectedLiveOre, oreResidual } from '../../src/sim';
import type { PlayerSpec, World } from '../../src/sim';
import { MATCH_SLOTS, PERSONALITIES, botInputs, createBot, fillEmptySlots } from '../../src/bots';
import type { Bot } from '../../src/bots';

/** The real solo-player cast: `fillEmptySlots` seats the roster, each in its
 *  character's hull — the exact eight-slot match a player gets offline. */
function rosterCast() {
  return fillEmptySlots([], MATCH_SLOTS).map((s) => ({
    id: s.id,
    personality: s.personality,
    shipClass: PERSONALITIES[s.personality].shipClass,
  }));
}

/** Float slack for one match's worth of sub-`1e-9` clamps (the drain and the
 *  spend wallet each snap a tiny remainder to zero). Thousands of such events
 *  over a 15-minute match still sum to far less than a single ore. A real black
 *  hole loses whole ore — a chunk, a hold, a bank — so it clears this by orders
 *  of magnitude. */
const CONSERVATION_TOL = 1e-6;

interface ConservationRun {
  readonly seed: number;
  readonly ticks: number;
  readonly ended: boolean;
  /** Largest |liveOre − expected| seen at any sampled tick. */
  readonly maxResidual: number;
  /** The tick the residual first broke tolerance, or -1 if it never did. */
  readonly brokeAtTick: number;
  /** The ledger at the tick it broke (or the final ledger), for diagnosis. */
  readonly ledgerAtBreak: Record<string, number>;
  /** Proof the match actually exercised the loot economy, not a vacuous pass. */
  readonly totalDropped: number;
  readonly totalLooted: number;
  readonly totalMined: number;
  readonly totalDeposited: number;
  readonly totalSpent: number;
  /** a0-08: every ship's `lootTake` summed over every tick of the match — the
   *  render tell's own claim about how much ore it saw arrive in a hold. */
  readonly tellTakeTotal: number;
  /** a0-08: ticks on which SOME ship sat with a full hold inside tractor range of
   *  loose ore it could not accept (`lootBlocked`) — the reported frame. */
  readonly blockedTicks: number;
}

/**
 * Run one full natural match and sample the conservation residual every tick.
 * No staging, no seams: real `createWorld`, real bots, real `step`. Stops at the
 * first tick the residual breaks tolerance (so a failure points at exactly when
 * and what), else runs to the match's own ending.
 */
function runConservationMatch(seed: number, maxSeconds = 20 * 60): ConservationRun {
  const cast = rosterCast();
  const players: PlayerSpec[] = cast.map((s) => ({ id: s.id, shipClass: s.shipClass }));
  const world: World = createWorld({ seed, players });
  const bots: Bot[] = cast.map((s) => createBot({ id: s.id, personality: s.personality }, { seed }));

  const maxTicks = Math.ceil((maxSeconds / TICK_DT) * 1.5) + 1;
  let maxResidual = 0;
  let brokeAtTick = -1;
  let ticks = 0;
  // a0-08's tells, sampled on the same ticks and from the same matches — a second
  // run of an eight-slot match to its ending just to watch them is not affordable.
  let tellTakeTotal = 0;
  let blockedTicks = 0;

  const snapshotLedger = (): Record<string, number> => ({ ...(world.ledger ?? {}) }) as Record<string, number>;

  // Sample t0 too: a world that fails to balance the instant it is built is a
  // seeded-baseline bug, not a play bug.
  maxResidual = Math.abs(oreResidual(world));

  while (!isOver(world) && world.time < maxSeconds && ticks < maxTicks) {
    step(world, botInputs(world, bots, TICK_DT), TICK_DT);
    ticks++;
    for (const s of world.ships) tellTakeTotal += s.lootTake ?? 0;
    if (world.ships.some((s) => s.lootBlocked)) blockedTicks++;
    const r = Math.abs(oreResidual(world));
    if (r > maxResidual) maxResidual = r;
    if (r > CONSERVATION_TOL && brokeAtTick < 0) {
      brokeAtTick = ticks;
      return {
        seed,
        ticks,
        ended: isOver(world),
        maxResidual,
        brokeAtTick,
        ledgerAtBreak: snapshotLedger(),
        totalDropped: world.ledger?.dropped ?? 0,
        totalLooted: world.ledger?.looted ?? 0,
        totalMined: world.ledger?.mined ?? 0,
        totalDeposited: world.ledger?.deposited ?? 0,
        totalSpent: world.ledger?.spent ?? 0,
        tellTakeTotal,
        blockedTicks,
      };
    }
  }

  return {
    seed,
    ticks,
    ended: isOver(world),
    maxResidual,
    brokeAtTick,
    ledgerAtBreak: snapshotLedger(),
    totalDropped: world.ledger?.dropped ?? 0,
    totalLooted: world.ledger?.looted ?? 0,
    totalMined: world.ledger?.mined ?? 0,
    totalDeposited: world.ledger?.deposited ?? 0,
    totalSpent: world.ledger?.spent ?? 0,
    tellTakeTotal,
    blockedTicks,
  };
}

describe('ore conservation over a full natural match (the loot black-hole soak)', () => {
  // A spread of seeds: different opening fields, different fights, different
  // deaths and wrecks and scavenging — the leak that hides on one seed's play
  // shows on another's. Each is run ONCE and both properties below read the same
  // runs (a full eight-slot match to its ending is not cheap).
  const SEEDS = [1, 2, 3, 7, 11, 42];
  const RUNS = SEEDS.map((seed) => runConservationMatch(seed));

  it('balances the economy EXACTLY at every tick, every seed', () => {
    for (const run of RUNS) {
      if (run.brokeAtTick >= 0) {
        throw new Error(
          `ore leaked on seed ${run.seed} at tick ${run.brokeAtTick} ` +
            `(t=${(run.brokeAtTick * TICK_DT).toFixed(1)}s): residual ${run.maxResidual}\n` +
            `ledger = ${JSON.stringify(run.ledgerAtBreak, null, 2)}`,
        );
      }
      expect(run.maxResidual).toBeLessThan(CONSERVATION_TOL);
    }
  });

  it('actually exercises the loot economy it is guarding (not a vacuous pass)', () => {
    // A conservation law that passes because nothing ever moved is worthless.
    // Across the runs, matches must have dropped ore on death, mined rock, banked
    // a hold, AND — the step that keeps regressing — LOOTED loose ore into a hold.
    const sawMine = RUNS.some((r) => r.totalMined > 0);
    const sawBank = RUNS.some((r) => r.totalDeposited > 0);
    const sawDrop = RUNS.some((r) => r.totalDropped > 0);
    const sawLoot = RUNS.some((r) => r.totalLooted > 0);
    expect(sawMine, 'a match should mine rock').toBe(true);
    expect(sawBank, 'a match should bank a hold').toBe(true);
    expect(sawDrop, 'a match should drop ore on a death').toBe(true);
    expect(sawLoot, 'a match should loot loose ore into a hold').toBe(true);
  });

  // -------------------------------------------------------------------------
  // a0-08 — the loot TELLS, held to the same standard as the ore itself.
  //
  // The developer's fourth report of this shape ("sometimes picked up ore from
  // dead ships dont count") was NOT a leak: the residual above stays flat zero
  // through every kill and every wreck on every seed. It was a legibility bug —
  // looted ore lands in the hold while the prominent readout is the bank, and a
  // full hold refuses a chunk in total silence. `Ship.lootTake`/`lootBlocked` are
  // the tells that fix it, and a tell that lies is worse than no tell, so the
  // same full natural matches audit them.
  // -------------------------------------------------------------------------

  it('the loot tell reports EXACTLY the ore that moved, never a unit more (a0-08)', () => {
    // `lootTake` summed over every ship over every tick must equal the ledger's
    // `looted` — the authoritative chunk → cargo total. If the tell ever inflated
    // a partial take into the whole chunk it was offered (the exact way this bug
    // reads from the cockpit), this sum runs ahead of the ledger and fails here.
    for (const run of RUNS) {
      expect(run.tellTakeTotal, `seed ${run.seed}: tell vs ledger`).toBeCloseTo(run.totalLooted, 6);
    }
  });

  it('a full hold sitting on ore it cannot take is a NORMAL state, not an edge case (a0-08)', () => {
    // The base hold is 2 (GDD §2.8), so refusing a pickup is routine play — which
    // is why the silence about it was worth a report. If this ever stops firing
    // across six full matches, the tell has been wired to a state that no longer
    // occurs and the fix has quietly become dead code.
    const sawBlocked = RUNS.some((r) => r.blockedTicks > 0);
    expect(sawBlocked, 'some ship should hit a full hold over loose ore').toBe(true);
  });

  it('the blocked tell is TRANSIENT in real play — it clears, it does not latch (a0-08)', () => {
    // The check above is satisfied by a tell that fires once and sticks forever:
    // drop the `ship.lootBlocked = false` clear at the top of `updateChunks` and
    // `blockedTicks` climbs toward EVERY tick, so `sawBlocked` goes greener, not
    // red. That is the failure this file exists to catch — `loot-tell.test.ts`
    // does assert the clear, but on a staged path, and the whole premise of the
    // ledger (see its header: three leaks, three green unit suites) is that a
    // tell can be correct on the path a test takes and wrong on the path play
    // takes. So hold the LATCH to real matches too.
    //
    // Measured across these six seeds: 603–1260 blocked ticks out of ~50,000,
    // i.e. 1.2%–2.5% of the match. A full hold over ore is common but fleeting —
    // the ship banks, or drifts off, or the chunk is taken by someone else. The
    // bound below is half the match: ~20× the observed worst case, so it cannot
    // flake on a seed that fights differently, while a latched tell (~100%)
    // cannot slip past it.
    for (const run of RUNS) {
      expect(
        run.blockedTicks,
        `seed ${run.seed}: blocked on ${run.blockedTicks}/${run.ticks} ticks — ` +
          `a full hold over ore is a passing state, so this must stay far below the match length. ` +
          `Near-total means the tell latched and is no longer being cleared.`,
      ).toBeLessThan(run.ticks / 2);
    }
  });

  it('the seeded baseline balances at world-build (no ore minted or lost in setup)', () => {
    for (const seed of SEEDS) {
      const players: PlayerSpec[] = rosterCast().map((s) => ({ id: s.id, shipClass: s.shipClass }));
      const world = createWorld({ seed, players });
      // At t0, liveOre IS the seed and nothing has moved: residual is exactly 0.
      expect(liveOre(world)).toBeCloseTo(expectedLiveOre(world), 9);
      expect(world.ledger?.seeded).toBeGreaterThan(0);
    }
  });
});
