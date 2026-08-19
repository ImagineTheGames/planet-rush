/**
 * src/bots/repair-honesty.test.ts — a damaged bot core actually gets patched.
 * (Developer report p15-02: "bots don't repair or rebuild.")
 *
 * The regression lock for the repair half of that report, and it is stated over
 * an **unstaged match** on purpose. Repair had passed every staged test it had:
 * park a bot at its own wheel with a wounded core and an ore in the bank and it
 * files `order('repair')` at every tier, exactly as `./easy`, `./medium` and
 * `./hard` say it does. What a staged board cannot show is that in a real match
 * the bot is almost never standing there — so the numbers below are taken from
 * eight bots playing a whole match to its ending, with nothing placed by hand.
 *
 * ── What the harness measured, before the fix ────────────────────────────────
 *
 * Seed 1, eight bots, 791 seconds: **nine** repair orders in the entire match,
 * and six of the eight cores died with damage on them that was never patched. Of
 * every decision taken with a damaged core:
 *
 *   63.8%  the ration said no        — a scratched core; the ration working
 *   21.8%  the bot WANTED a patch and was somewhere else
 *    4.5%  under fire (GDD §2.6 — a siege cannot be out-repaired)
 *    5.2%  collapse (GDD §2.3 — repair is off for good)
 *    0.03% it actually bought one
 *
 * That 21.8% is the defect: the trees had no verb for *going home to spend*, so a
 * bot only ever repaired when it happened to be docked for some other reason.
 * `fix-base` (`./behaviors` `wantsHomeErrand`) is that verb, and the second seam
 * below is the one under it — the sim's 15-second repair cooldown, which no tree
 * read, so the back half of every cooldown was spent filing orders the sim
 * answered `'cooling-down'` and threw away.
 *
 * ── What this file pins ──────────────────────────────────────────────────────
 *
 *  1. Cores **recover HP** in a natural match, at a rate materially above the
 *     pre-fix baseline (measured both ways, seeds 1–5).
 *  2. Every repair order a bot files is one the sim **accepts** — no bot spends
 *     its decisions pressing a wedge that is cooling down.
 *  3. The ration is **untouched**: a patched core still settles below its
 *     ceiling, which is the invariant that keeps a field of turtles from reaching
 *     collapse in HP lockstep (`./trees.test.ts`, p5-repair-discrete).
 */

import { describe, it, expect } from 'vitest';
import {
  REPAIR_COOLDOWN_SECONDS,
  REPAIR_HP_PER_ORE,
  TICK_DT,
  createWorld,
  isOver,
  step,
  type World,
} from '../sim';
import { wantsCorePatch } from './behaviors';
import { botInputs, botLobby, createBots, fillEmptySlots } from './harness';
import { HARD_REPAIR_AT } from './hard';
import { perceive } from './perception';
import { PERSONALITIES } from './personalities';
import { context, createBrain } from './tree';

/**
 * Seeds the sweep runs. Whole matches of eight bots — the same loop
 * `runHeadlessMatch` runs, opened up only so the test can see the input stream
 * as well as the world (it needs both to tell a dropped order from a landed
 * one). Nothing about the match is staged.
 *
 * **Twelve rather than five, widened by a0-105.** Core patches are a
 * low-frequency event in a match nobody staged — the per-seed counts on the
 * build this note is written from run 5, 10, 4, 3, 3, 5, 10, 11, 2, 2, 8, 17 —
 * so a five-seed total is a number with a ±50% mood. The floors below are stated
 * over twelve for that reason, and the count is the thing to raise if this ever
 * reads as noisy again; it is not a number to lower.
 */
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** The enforced ceiling, in sim seconds — a hung match is a failed test, not a
 *  hung harness (GDD §3.8). */
const MATCH_CEILING_S = 20 * 60;

interface Sweep {
  /** Repair purchases the sim ACCEPTED (it re-arms `repairGate` on exactly those). */
  readonly landed: number;
  /** Core HP bought back across every station of every match. */
  readonly hpBought: number;
  /** Repair orders a bot filed that the sim refused — the seam that must stay 0. */
  readonly dropped: number;
  /** Stations that ever recovered HP at all. */
  readonly recovered: number;
  /** The longest match in the sweep, seconds. */
  readonly longest: number;
  /** Highest core HP any station held after a patch, as a fraction of its max. */
  readonly highestPatchedFraction: number;
}

/**
 * Play `SEEDS` matches out and tally what repair actually did.
 *
 * A repair is counted as **landed** when the station's `repairGate` comes out of
 * the tick freshly armed at `REPAIR_COOLDOWN_SECONDS`: `sim/buildings.ts` arms it
 * on the successful branch of `placeOrder` and nowhere else, and `updateStations`
 * only ever ticks it *down*, so a full gate after a step is an accepted purchase
 * and cannot be anything else. A repair order in the input stream that does not
 * produce one is a **dropped** order.
 */
function sweep(): Sweep {
  let landed = 0;
  let hpBought = 0;
  let dropped = 0;
  let longest = 0;
  let highestPatchedFraction = 0;
  const recovered = new Set<string>();

  for (const seed of SEEDS) {
    const seats = fillEmptySlots();
    const world: World = createWorld({ seed, players: botLobby(seats) });
    const bots = createBots(seats, { seed });

    while (!isOver(world) && world.time < MATCH_CEILING_S) {
      const inputs = botInputs(world, bots, TICK_DT);
      const ordered = new Set<number>();
      for (const input of inputs) {
        for (const action of input.actions) {
          if (action.type === 'buildOrder' && action.item === 'repair') ordered.add(input.id);
        }
      }
      const before = new Map(world.stations.map((s) => [s.owner, s.coreHp]));

      step(world, inputs, TICK_DT);

      for (const station of world.stations) {
        const armed = (station.repairGate ?? 0) >= REPAIR_COOLDOWN_SECONDS - 1e-9;
        const gain = station.coreHp - (before.get(station.owner) ?? 0);
        if (armed) {
          landed++;
          if (gain > 0) hpBought += gain;
          recovered.add(`${seed}:${station.owner}`);
          const fraction = station.coreHp / station.maxCoreHp;
          if (fraction > highestPatchedFraction) highestPatchedFraction = fraction;
        }
        if (ordered.has(station.owner) && !armed) dropped++;
      }
    }
    if (world.time > longest) longest = world.time;
  }

  return { landed, hpBought, dropped, recovered: recovered.size, longest, highestPatchedFraction };
}

/** One sweep, shared by the whole file — five whole matches is not a thing to
 *  run four times. */
const RESULT = sweep();

describe('a damaged bot core recovers HP in a natural match (p15-02)', () => {
  it('patches cores, at a rate the pre-fix trees never reached', () => {
    // Measured on the original five-seed sweep, before → after the p15-02 fix:
    // 21 → 51 accepted repairs and 315 → 765 core HP bought back. The floors sit
    // between the two, with headroom on both sides: they fail loudly if the home
    // errand or the cooldown-honest gate regresses, and they do not chase a
    // tuning pass.
    //
    // **Restated over twelve seeds by a0-105, and the drop is real.** Ending a
    // retreat that has run out of road (`./standoff`) is a trade the developer
    // ordered — *"ship lives are cheap. enemies should not fear death"* — and it
    // is paid in hulls: over these twelve matches bots die 25% more often (1754
    // → 2184), and a dead ship drops its whole hold (GDD §2.7), so there is less
    // ore at home to spend on a core. The same sweep reads:
    //
    // | | pre-p15-02 (scaled) | pre-a0-105 | a0-105 |
    // |---|---|---|---|
    // | accepted repairs | ~50 | 122 | 80 |
    // | core HP bought | ~750 | 1830 | 1200 |
    // | stations that ever patched (of 96) | — | 45 | 39 |
    //
    // The floors are set between the *pre-p15-02* column and this build, which
    // is what keeps this a lock on p15-02's mechanism rather than a thermometer
    // for whatever the bots did last: a build that lost the home errand would
    // read ~50 and fail, and this one reads 80 and passes. What it may not do is
    // absorb another silent third — if a later change puts this red, the answer
    // is to look at what it cost, not to lower the number again.
    expect(RESULT.landed).toBeGreaterThanOrEqual(60);
    expect(RESULT.hpBought).toBeGreaterThanOrEqual(900);
    // And it is not one lucky turtle doing all of it.
    expect(RESULT.recovered).toBeGreaterThanOrEqual(24);
  });

  it('never files a repair the sim will refuse', () => {
    // The `repairReadyIn` seam, and it is worth being exact about it: on the
    // pre-fix trees this sweep also dropped **zero** orders — not because the
    // trees read the cooldown (they did not) but because they so rarely got a bot
    // home to repair at all that the window never came up. It is the home errand
    // that exposes it. With `fix-base` in and the cooldown read backed out — the
    // trees pacing off the `repairing` TELL alone, which releases at
    // `REPAIR_TELL_HOLD`, half the sim's 15-second `repairGate` — the same five
    // matches drop **728** repair orders to `'cooling-down'`, and land fewer
    // (43 against 51), because a plan whose head keeps returning a refused press
    // never reaches the turret and shield buys queued behind it.
    expect(RESULT.dropped).toBe(0);
  });

  it('still ends every match well inside the harness timeout', () => {
    // Bots that patch are bots that live longer, and "the match cannot stalemate"
    // is a promise the ruleset makes (GDD §2.3). Cores healing must not turn a
    // 10–15 minute match into a war of attrition against the clock.
    expect(RESULT.longest).toBeLessThan(MATCH_CEILING_S);
  });

  it('leaves the ration alone — a patched core still settles below its ceiling', () => {
    // The reason the ration exists (p5-repair-discrete): a bot that topped its
    // core back to exactly `maxCoreHp` every dip put every funded defender on one
    // identical HP at collapse, and the field then died in lockstep with no
    // survivor to crown. `repairTargetFraction` caps the target below the ceiling
    // and this branch did not touch it — so no patch in five whole matches ever
    // lands a core on its maximum.
    expect(RESULT.highestPatchedFraction).toBeLessThan(1);
  });
});

describe('the repair gate a tree reads is the one the sim enforces (p15-02)', () => {
  /** A quiet board: one bot, its own home, nothing shooting at anything. */
  function board(): World {
    const world = createWorld({
      seed: 9,
      players: [{ id: 0, shipClass: PERSONALITIES.warden.shipClass }],
      bounds: { width: 4000, height: 4000 },
      asteroidCount: 0,
    });
    const station = world.stations[0]!;
    const ship = world.ships[0]!;
    station.spawnProtect = 0;
    station.sinceDamage = 999;
    ship.spawnProtect = 0;
    ship.banked = 20;
    ship.pos = { x: station.pos.x + 20, y: station.pos.y };
    // Deep enough under Warden's ration (0.75 × caution 1.0) to want a patch.
    station.coreHp = station.maxCoreHp * 0.5;
    return world;
  }

  const wants = (world: World): boolean =>
    wantsCorePatch(
      context(perceive(world, 0), createBrain(PERSONALITIES.warden, { next: () => 0.5 })),
      HARD_REPAIR_AT,
    );

  it('wants a patch on a wounded, quiet core', () => {
    expect(wants(board())).toBe(true);
  });

  it('refuses while the cooldown is live even though the TELL has released', () => {
    const world = board();
    const station = world.stations[0]!;
    // The exact window the old gate could not see: the tell is down (the sim
    // releases it after `REPAIR_TELL_HOLD`, half the lockout) and the cooldown is
    // still counting. A tree reading `repairing` alone reads "go"; the sim would
    // answer `'cooling-down'` and charge nothing.
    station.repairing = false;
    station.repairGate = REPAIR_COOLDOWN_SECONDS / 2;
    expect(wants(world)).toBe(false);

    // …and it is genuinely the cooldown doing it: run the gate to zero and the
    // same board wants the patch again.
    station.repairGate = 0;
    expect(wants(world)).toBe(true);
  });

  it('refuses under fire, and once the field is spent', () => {
    const underFire = board();
    underFire.stations[0]!.sinceDamage = 0; // GDD §2.6 — a siege cannot be out-repaired
    expect(wants(underFire)).toBe(false);

    const broke = board();
    broke.ships[0]!.banked = 0;
    broke.ships[0]!.cargo = 0;
    expect(wants(broke)).toBe(false);
  });

  it('refuses a core that has nothing left to heal', () => {
    const world = board();
    const station = world.stations[0]!;
    station.coreHp = station.maxCoreHp;
    expect(wants(world)).toBe(false);
    // One chunk of damage is still not under the ration — that is the ration, not
    // a bug, and it is the largest single reason a bot declines a patch.
    station.coreHp = station.maxCoreHp - REPAIR_HP_PER_ORE * 0.5;
    expect(wants(world)).toBe(false);
  });
});
