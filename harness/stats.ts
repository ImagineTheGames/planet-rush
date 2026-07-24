/**
 * harness/stats.ts — pure aggregation over match outcomes. OWNER: QA Agent.
 *
 * No sim, no bots, no I/O: this module turns a list of {@link MatchOutcome}s into
 * the two numbers the balance targets are stated in (GDD §1, §2.11, §3.8) —
 * **match length** (must land 10–15 min) and **win rate by strategy and by
 * class** (no one over 55%). It is pure so it is unit-testable without running a
 * single match, and so the report generator and the CI assertions read the same
 * arithmetic.
 *
 * "Win rate" here is **win share**: the fraction of matches a class/strategy won.
 * With 8 slots a perfectly fair share is 12.5%, so the 55% ceiling is a
 * "nothing dominates" guard, not a fine tolerance — a class over it is winning a
 * majority of an eight-way field, which is exactly the Warden/Excavator finding
 * (docs/bot-balance-day4.md) the day-6 pass exists to close.
 */

import type { PlayerId, ShipClass } from '@shared/types';

/** The 10–15 minute match-length target (GDD §1), in sim seconds. */
export const TARGET_MIN_S = 10 * 60;
export const TARGET_MAX_S = 15 * 60;

/** The win-rate ceiling: no strategy and no class over 55% (GDD §2.11, §3.8). */
export const WIN_RATE_CEILING = 0.55;

/** One finished (or timed-out) headless match, reduced to what balance cares
 *  about. `winner*` are null when the match timed out with no result. */
export interface MatchOutcome {
  readonly seed: number;
  /** True when the match reached a result before the timeout. */
  readonly ended: boolean;
  /** True when the enforced timeout stopped the loop — a failed match, never a
   *  passed one (GDD §3.8). */
  readonly timedOut: boolean;
  /** Sim seconds elapsed at the end of the run. */
  readonly seconds: number;
  /** Ticks stepped. */
  readonly ticks: number;
  readonly winner: PlayerId | null;
  /** The winning ship's class, or null on a timeout. */
  readonly winnerClass: ShipClass | null;
  /** The winning slot's strategy label (bot personality id), or null. */
  readonly winnerStrategy: string | null;
}

/** Distribution of a set of match lengths (sim seconds). */
export interface LengthStats {
  readonly count: number;
  readonly min: number;
  readonly p10: number;
  readonly median: number;
  readonly mean: number;
  readonly p90: number;
  readonly max: number;
  /** Fraction of these matches whose length is inside [10, 15] min. */
  readonly fractionInTarget: number;
}

/** A win tally for one key (a class or a strategy), with its share of matches. */
export interface WinShare {
  readonly key: string;
  readonly wins: number;
  /** wins / total matches — the "win rate" the 55% ceiling is stated against. */
  readonly share: number;
}

/** Everything the balance targets are read off of, for one batch of matches. */
export interface BalanceSummary {
  readonly matches: number;
  readonly ended: number;
  readonly timedOut: number;
  /** Length distribution over the matches that actually ended. */
  readonly length: LengthStats;
  /** Win share by ship class, descending by wins. */
  readonly byClass: readonly WinShare[];
  /** Win share by strategy (bot personality), descending by wins. */
  readonly byStrategy: readonly WinShare[];
  // --- the two pass/fail verdicts, pre-computed so the report and CI agree ----
  /** Every ended match's length is inside [10,15] min AND nothing timed out. */
  readonly lengthTargetMet: boolean;
  /** Median length is inside the target band (the softer, distribution-level
   *  reading of the same target — reported alongside the strict one). */
  readonly medianInTarget: boolean;
  /** No class and no strategy exceeds the 55% ceiling. */
  readonly winRateTargetMet: boolean;
  /** The single highest win share across both class and strategy. */
  readonly topShare: WinShare | null;
}

/**
 * Nearest-rank-with-interpolation percentile over a copy-sorted sample.
 * `q` in [0,1]. Returns 0 for an empty sample (callers guard on count first).
 */
export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const idx = q * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const frac = idx - lo;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Length distribution over a set of match lengths (sim seconds). */
export function lengthStats(seconds: readonly number[]): LengthStats {
  const inTarget = seconds.filter((s) => s >= TARGET_MIN_S && s <= TARGET_MAX_S).length;
  return {
    count: seconds.length,
    min: seconds.length ? Math.min(...seconds) : 0,
    p10: percentile(seconds, 0.1),
    median: percentile(seconds, 0.5),
    mean: mean(seconds),
    p90: percentile(seconds, 0.9),
    max: seconds.length ? Math.max(...seconds) : 0,
    fractionInTarget: seconds.length ? inTarget / seconds.length : 0,
  };
}

/** Tally wins for a key extracted from each outcome, as descending win shares. */
function winShares(
  outcomes: readonly MatchOutcome[],
  key: (o: MatchOutcome) => string | null,
): WinShare[] {
  const wins = new Map<string, number>();
  for (const o of outcomes) {
    const k = key(o);
    if (k == null) continue;
    wins.set(k, (wins.get(k) ?? 0) + 1);
  }
  const total = outcomes.length;
  return [...wins.entries()]
    .map(([k, w]) => ({ key: k, wins: w, share: total ? w / total : 0 }))
    .sort((a, b) => b.wins - a.wins || a.key.localeCompare(b.key));
}

/** Reduce a batch of outcomes to the balance summary the targets are read off. */
export function summarize(outcomes: readonly MatchOutcome[]): BalanceSummary {
  const ended = outcomes.filter((o) => o.ended);
  const timedOut = outcomes.filter((o) => o.timedOut);
  const length = lengthStats(ended.map((o) => o.seconds));

  const byClass = winShares(outcomes, (o) => o.winnerClass);
  const byStrategy = winShares(outcomes, (o) => o.winnerStrategy);

  const shares = [...byClass, ...byStrategy];
  const topShare = shares.length
    ? shares.reduce((a, b) => (b.share > a.share ? b : a))
    : null;

  const lengthTargetMet =
    timedOut.length === 0 &&
    ended.length === outcomes.length &&
    ended.every((o) => o.seconds >= TARGET_MIN_S && o.seconds <= TARGET_MAX_S);

  const medianInTarget =
    timedOut.length === 0 &&
    length.count > 0 &&
    length.median >= TARGET_MIN_S &&
    length.median <= TARGET_MAX_S;

  const winRateTargetMet =
    outcomes.length > 0 && shares.every((s) => s.share <= WIN_RATE_CEILING);

  return {
    matches: outcomes.length,
    ended: ended.length,
    timedOut: timedOut.length,
    length,
    byClass,
    byStrategy,
    lengthTargetMet,
    medianInTarget,
    winRateTargetMet,
    topShare,
  };
}

/** Seconds → `m:ss`, for reports and console lines. */
export function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
