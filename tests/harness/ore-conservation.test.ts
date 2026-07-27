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

  const snapshotLedger = (): Record<string, number> => ({ ...(world.ledger ?? {}) }) as Record<string, number>;

  // Sample t0 too: a world that fails to balance the instant it is built is a
  // seeded-baseline bug, not a play bug.
  maxResidual = Math.abs(oreResidual(world));

  while (!isOver(world) && world.time < maxSeconds && ticks < maxTicks) {
    step(world, botInputs(world, bots, TICK_DT), TICK_DT);
    ticks++;
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
