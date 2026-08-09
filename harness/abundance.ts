/**
 * harness/abundance.ts — the abundance-spread instrument. OWNER: QA Agent
 * (GDD §2.8, §3.8).
 *
 * a0-17 asks one question the p11 report cannot answer from its own numbers:
 * **how far can the SCARCE↔RICH wave-interval spread be widened before a rail
 * breaks, and which rail breaks first?** So this file measures a *candidate*
 * `respawnInterval`, not just the shipped one.
 *
 * The trick that makes candidates cheap: `world.economy.waveInterval` is the one
 * number the spawner, the collapse deadline, the HUD clock and bot perception all
 * read (`waveIntervalOf`, pinned by a0-16), and wave 1 lands at t=0 where no
 * interval can matter. So forcing that field right after `createWorld`
 * (`waveIntervalOverride`, `./match` and `./soak`) reproduces exactly the world a
 * constants table with that multiplier would have built — no editing the table
 * between runs, and every candidate measured by the same instrument.
 *
 * What is measured, per level, is the shape p11 published so the two reports can
 * be read side by side:
 *
 *  - **A · all-miner mirror** — the economy throughput ceiling: ore/min.
 *  - **B · turtle mirror** — the p5-07b stall check, and the *worst-case* match
 *    length, which is where the 10–15 min rail actually binds.
 *  - **C · roster cast, real bot trees** — the honest match-length distribution.
 *  - **D · win-rate contests** — no character and no hull over 55%.
 *
 * Plus the two structural checks the brief names, which are arithmetic, not
 * statistics, and so are computed rather than sampled:
 *
 *  - **the last wave must still matter** — collapse cannot open before wave 5
 *    lands (`enterCollapseIfDue` gates on `allWavesSpawned`), so the failure mode
 *    is not "wave 5 is skipped" but "wave 5 drags the ending out". Measured as
 *    `wavesSpawned` on every run and as the deadline arithmetic below.
 *  - **the collapse deadline must stay re-anchored** — `collapseDeadlineFor`
 *    holds at the 750 s baseline only while `4 × interval + grace floor ≤ 750`;
 *    past that the deadline (and the match) grows with the interval.
 */

import { ShipClass } from '@shared/types';
import type { PersonalityId } from '../src/bots';
import { MATCH_SLOTS } from '../src/bots';
import type { Abundance } from '../src/sim';
import {
  ABUNDANCE,
  COLLAPSE_GRACE_FLOOR_S,
  COLLAPSE_GRACE_S,
  CORE_HP,
  COLLAPSE_CORE_DECAY,
  WAVE_COUNT,
  WAVE_INTERVAL_S,
  resolveEconomy,
} from '../src/sim';
import { mirrorLineup, runMatch, seedRange } from './match';
import type { MatchResult } from './match';
import {
  CLASSES,
  HARD_POOL,
  LENGTH_TARGET_MAX_S,
  LENGTH_TARGET_MIN_S,
  WIN_RATE_CEILING,
  classLineup,
  lengthStats,
  rosterCast,
  runBotMatch,
  strategyLineup,
  terminationStats,
  winRates,
} from './soak';
import type { BotMatchResult, LengthStats, WinRecord } from './soak';

/** The three levels, lean → rich. */
export const LEVELS: readonly Abundance[] = ['scarce', 'standard', 'rich'];

// ---------------------------------------------------------------------------
// The arithmetic rails (no sampling needed — these are closed forms)
// ---------------------------------------------------------------------------

/**
 * The collapse deadline a world running on `interval` resolves to — the same
 * expression `match.ts` `collapseDeadline` evaluates, restated here so a
 * candidate can be priced without building a world. Kept in sync by
 * `abundance-spread.test.ts`, which asserts the two agree on every level.
 */
export function deadlineFor(interval: number): number {
  const anchored = (WAVE_COUNT - 1) * WAVE_INTERVAL_S + COLLAPSE_GRACE_S;
  const floor = Math.min(COLLAPSE_GRACE_FLOOR_S, COLLAPSE_GRACE_S);
  return Math.max(anchored, (WAVE_COUNT - 1) * interval + floor);
}

/** Sim time the final wave lands on a given interval. */
export function lastWaveTime(interval: number): number {
  return (WAVE_COUNT - 1) * interval;
}

/**
 * The worst-case ending a given interval admits: collapse is forced at the
 * deadline, and entropy then needs `CORE_HP / COLLAPSE_CORE_DECAY` seconds to
 * finish an untouched core. Nothing can end later than this, so it is the honest
 * ceiling to check the 15-minute rail against — and the number the turtle mirror
 * (section B) should land on.
 */
export function worstCaseEnd(interval: number): number {
  const decay = COLLAPSE_CORE_DECAY > 0 ? CORE_HP / COLLAPSE_CORE_DECAY : Infinity;
  return deadlineFor(interval) + decay;
}

/** The longest wave interval whose worst-case ending still lands inside the
 *  15-minute rail — the number the SCARCE multiplier is capped by. */
export function maxIntervalInsideRail(): number {
  const decay = COLLAPSE_CORE_DECAY > 0 ? CORE_HP / COLLAPSE_CORE_DECAY : Infinity;
  const floor = Math.min(COLLAPSE_GRACE_FLOOR_S, COLLAPSE_GRACE_S);
  return (LENGTH_TARGET_MAX_S - decay - floor) / (WAVE_COUNT - 1);
}

/** The longest wave interval that leaves the collapse deadline sitting exactly on
 *  its pre-p11 anchor — past this, abundance starts moving match length. */
export function maxIntervalHoldingAnchor(): number {
  const anchored = (WAVE_COUNT - 1) * WAVE_INTERVAL_S + COLLAPSE_GRACE_S;
  const floor = Math.min(COLLAPSE_GRACE_FLOOR_S, COLLAPSE_GRACE_S);
  return (anchored - floor) / (WAVE_COUNT - 1);
}

/** The wave schedule an interval produces, as `m:ss` stamps. */
export function schedule(interval: number): string[] {
  return Array.from({ length: WAVE_COUNT }, (_, i) => mmss(i * interval));
}

/** `m:ss`, the report's clock format. */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// One candidate: one level at one interval
// ---------------------------------------------------------------------------

/** What to measure: a level, and the wave interval to run it at. `interval`
 *  omitted means "whatever the shipped table resolves to". */
export interface Candidate {
  readonly level: Abundance;
  /** Seconds between waves. Omit for the shipped table's own value. */
  readonly interval?: number;
}

/** The interval a candidate actually runs at. */
export function intervalOf(c: Candidate): number {
  return c.interval ?? resolveEconomy(c.level).waveInterval;
}

/** Everything one candidate produced. */
export interface CandidateReading {
  readonly level: Abundance;
  readonly interval: number;
  /** `interval / WAVE_INTERVAL_S` — the `respawnInterval` multiplier it prices. */
  readonly multiplier: number;
  readonly lastWave: number;
  readonly deadline: number;
  readonly worstCase: number;
  /** A · all-miner mirror. */
  readonly miner: EconomyReading;
  /** B · turtle mirror — the stall check and the worst-case length. */
  readonly turtle: EconomyReading;
  /** C · the real roster cast. */
  readonly roster: LengthStats & { readonly ended: number; readonly matches: number };
  /** The lowest `wavesSpawned` seen anywhere in this candidate's runs. Below
   *  `WAVE_COUNT` would mean a wave the match never received. */
  readonly minWavesSpawned: number;
}

/** The economy numbers one probe mirror produced. */
export interface EconomyReading {
  readonly matches: number;
  readonly ended: number;
  /** Ore chipped out of rock, summed over the runs, ÷ the minutes they took. */
  readonly orePerMinute: number;
  readonly minedTotal: number;
  readonly fieldLeft: number;
  readonly medianSeconds: number;
  readonly maxSeconds: number;
  readonly medianCollapse: number;
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.floor((s.length - 1) / 2);
  return s.length % 2 ? s[i]! : (s[i]! + s[i + 1]!) / 2;
}

/** Run one probe mirror (all eight seats playing the same strategy) and reduce
 *  it to the economy numbers the scarcity report quotes. */
function probeMirror(
  strategyId: 'miner' | 'turtle',
  c: Candidate,
  seeds: readonly number[],
): EconomyReading {
  const interval = intervalOf(c);
  const results: MatchResult[] = seeds.map((seed) =>
    runMatch({
      seed,
      lineup: mirrorLineup(strategyId, ShipClass.Vanguard, MATCH_SLOTS),
      abundance: c.level,
      waveIntervalOverride: interval,
    }),
  );
  const mined = results.map((r) => r.world.ledger?.mined ?? 0);
  const minutes = results.reduce((a, r) => a + r.seconds, 0) / 60;
  return {
    matches: results.length,
    ended: results.filter((r) => r.ok).length,
    orePerMinute: minutes > 0 ? mined.reduce((a, b) => a + b, 0) / minutes : 0,
    minedTotal: mined.reduce((a, b) => a + b, 0) / results.length,
    fieldLeft: results.reduce((a, r) => a + r.fieldOreLeft, 0) / results.length,
    medianSeconds: median(results.map((r) => r.seconds)),
    maxSeconds: Math.max(...results.map((r) => r.seconds)),
    medianCollapse: median(results.map((r) => r.collapseTime)),
  };
}

/** Read one candidate end to end. `seeds` sizes the probe mirrors; `rosterSeeds`
 *  the (slower) real-tree cast. */
export function readCandidate(
  c: Candidate,
  seeds: readonly number[] = seedRange(8),
  rosterSeeds: readonly number[] = seedRange(8),
): CandidateReading {
  const interval = intervalOf(c);
  const miner = probeMirror('miner', c, seeds);
  const turtle = probeMirror('turtle', c, seeds);
  const rosterRuns = rosterSeeds.map((seed) =>
    runBotMatch(seed, rosterCast(), { abundance: c.level, waveIntervalOverride: interval }),
  );
  const term = terminationStats(rosterRuns);
  return {
    level: c.level,
    interval,
    multiplier: interval / WAVE_INTERVAL_S,
    lastWave: lastWaveTime(interval),
    deadline: deadlineFor(interval),
    worstCase: worstCaseEnd(interval),
    miner,
    turtle,
    roster: { ...lengthStats(rosterRuns), ended: term.ended, matches: term.matches },
    minWavesSpawned: Math.min(...rosterRuns.map((r) => r.wavesSpawned)),
  };
}

// ---------------------------------------------------------------------------
// D · the win-rate contests, at one level
// ---------------------------------------------------------------------------

/** The two 55% contests, run at one level/interval against the real trees. */
export interface ContestReading {
  readonly level: Abundance;
  readonly interval: number;
  readonly byCharacter: readonly WinRecord[];
  readonly byClass: readonly WinRecord[];
  readonly ended: number;
  readonly matches: number;
}

export function readContests(
  c: Candidate,
  seeds: readonly number[] = seedRange(6),
): ContestReading {
  const interval = intervalOf(c);
  const opts = { abundance: c.level, waveIntervalOverride: interval } as const;

  const strategyRuns: BotMatchResult[] = [];
  for (const seed of seeds) {
    for (let rot = 0; rot < HARD_POOL.length; rot++) {
      strategyRuns.push(runBotMatch(seed * 1000 + rot, strategyLineup(HARD_POOL, ShipClass.Vanguard, rot), opts));
    }
  }
  const classRuns: BotMatchResult[] = [];
  const behaviour: PersonalityId = HARD_POOL[0]!;
  for (const seed of seeds) {
    for (let rot = 0; rot < CLASSES.length; rot++) {
      classRuns.push(runBotMatch(seed * 1000 + rot, classLineup(behaviour, rot), opts));
    }
  }

  const all = [...strategyRuns, ...classRuns];
  return {
    level: c.level,
    interval,
    byCharacter: winRates(strategyRuns, HARD_POOL, (r) => r.winnerPersonality),
    byClass: winRates(classRuns, CLASSES, (r) => r.winnerClass),
    ended: all.filter((r) => r.ok).length,
    matches: all.length,
  };
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

/** Whether a reading clears each rail, so a reader never compares two numbers
 *  themselves. */
export interface RailVerdict {
  /** Every run produced an ending. */
  readonly terminates: boolean;
  /** Worst observed ending, and the arithmetic ceiling, both inside 15 min. */
  readonly insideLengthRail: boolean;
  /** Every run received all five waves. */
  readonly allWavesLanded: boolean;
  /** The collapse deadline still sits on its pre-p11 anchor. */
  readonly anchorHeld: boolean;
}

export function railVerdict(r: CandidateReading): RailVerdict {
  const observedMax = Math.max(r.turtle.maxSeconds, r.miner.maxSeconds, r.roster.max);
  return {
    terminates:
      r.miner.ended === r.miner.matches &&
      r.turtle.ended === r.turtle.matches &&
      r.roster.ended === r.roster.matches,
    insideLengthRail: observedMax <= LENGTH_TARGET_MAX_S && r.worstCase <= LENGTH_TARGET_MAX_S,
    allWavesLanded: r.minWavesSpawned >= WAVE_COUNT,
    anchorHeld: r.deadline <= deadlineFor(WAVE_INTERVAL_S) + 1e-9,
  };
}

/** True when every contestant sits under the 55% ceiling. */
export function contestsPass(c: ContestReading): boolean {
  return [...c.byCharacter, ...c.byClass].every((r) => r.rate <= WIN_RATE_CEILING);
}

// ---------------------------------------------------------------------------
// The shipped table, for the report header
// ---------------------------------------------------------------------------

/** The spread the shipped table currently expresses, in seconds between rocks. */
export function shippedSpread(): { scarce: number; standard: number; rich: number; spread: number } {
  const scarce = WAVE_INTERVAL_S * ABUNDANCE.scarce.respawnInterval;
  const standard = WAVE_INTERVAL_S * ABUNDANCE.standard.respawnInterval;
  const rich = WAVE_INTERVAL_S * ABUNDANCE.rich.respawnInterval;
  return { scarce, standard, rich, spread: scarce - rich };
}

/** Bounds check on the length rail, exported so the report can quote it and the
 *  test can assert the shipped table sits inside it. */
export const LENGTH_RAIL = { min: LENGTH_TARGET_MIN_S, max: LENGTH_TARGET_MAX_S } as const;
