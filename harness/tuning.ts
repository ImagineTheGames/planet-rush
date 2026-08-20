/**
 * harness/tuning.ts — the a0-117 **before/after** renderer. OWNER: QA Agent.
 *
 * `./mirrors` measures one tree; a tuning pass measures two, and the only claim
 * worth making about a moved constant is what it did **on the same seeds**. So
 * this module reads two directories of `./mirrors` section artifacts — one filed
 * before a constant moved, one filed after, both produced by the same
 * `mirrors <section> --seeds n --data DIR` commands — and prints every contest
 * as a pair of columns with the movement between them.
 *
 * It computes nothing new: every rate, fair share and standard error comes from
 * `./mirrors`' own helpers, so a table here and the same table in
 * `a0-112-balance.md` are read the same way. What this file adds is the second
 * column and the arithmetic between the two.
 *
 * The seeds are asserted, not assumed: {@link sameSeeds} refuses a pair whose
 * seed lists differ, because "re-measured on the same seeds" is the whole
 * evidentiary value of an after-number and a renderer that would quietly print a
 * different draw beside a published one is worse than no renderer.
 */

import { ShipClass } from '@shared/types';
import type { PersonalityId } from '../src/bots';
import { PERSONALITIES } from '../src/bots';
import { CLASSES, HARD_POOL, WIN_RATE_CEILING } from './soak';
import type { Length, MatchRow, SectionRun, Win } from './mirrors';
import {
  classSeats,
  mmss,
  ownHullOf,
  pct,
  seatsByCharacter,
  seatsByOwnHull,
  seatsByTier,
  winSE,
  winsBy,
} from './mirrors';

/** The two artifact sets a comparison is cut from. */
export interface Pair {
  readonly before: SectionRun;
  readonly after: SectionRun;
}

/** True when both runs were drawn from the identical seed list — the property
 *  every "after" number in this report rests on. */
export function sameSeeds(pair: Pair): boolean {
  const a = pair.before.seeds;
  const b = pair.after.seeds;
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

/** Refuse a pair that is not the same draw, naming the section (a `throw` here
 *  is a failed measurement, never a mis-rendered table). */
export function assertSameSeeds(pair: Pair): void {
  if (!sameSeeds(pair)) {
    throw new Error(
      `tuning: section ${pair.before.section} was not re-measured on the same seeds ` +
        `(before ${pair.before.seeds.length}, after ${pair.after.seeds.length})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function table(head: readonly string[], rows: readonly (readonly string[])[]): string {
  return [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

/** Signed points, the movement column. `+` is a rate that went up. */
export function movePts(before: number, after: number): string {
  const d = (after - before) * 100;
  return `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} pts`;
}

const band = (rate: number): string => (rate > WIN_RATE_CEILING ? '**OVER**' : 'under');

/**
 * One contest, before beside after. Rows are ordered by the **before** rate, so
 * the contestant the brief is about stays at the top of its table whatever the
 * tuning did to it — a table that re-sorts itself hides the movement it exists
 * to show.
 */
export function compareWins(before: readonly Win[], after: readonly Win[]): string {
  const byKey = new Map(after.map((w) => [w.key, w]));
  return table(
    ['contestant', 'before', 'after', 'move', 'fair share', '±1 SE (after)', 'vs 55%'],
    before.map((b) => {
      const a = byKey.get(b.key);
      const rate = a?.rate ?? 0;
      return [
        b.name,
        `${b.wins} / ${b.decided} (**${pct(b.rate)}**)`,
        a ? `${a.wins} / ${a.decided} (**${pct(a.rate)}**)` : '—',
        movePts(b.rate, rate),
        pct(b.fairShare),
        `${(winSE(rate, a?.decided ?? 0) * 100).toFixed(1)} pts`,
        band(rate),
      ];
    }),
  );
}

/** Match length, before beside after — the target a hull nerf can trade away. */
export function compareLength(rows: readonly (readonly [string, Length, Length])[]): string {
  return table(
    ['run', 'decided', 'median before', 'median after', 'mean after', 'min', 'max', 'inside 10–15 before', 'inside 10–15 after'],
    rows.map(([label, b, a]) => [
      label,
      String(a.n),
      mmss(b.median),
      `**${mmss(a.median)}**`,
      mmss(a.mean),
      mmss(a.min),
      mmss(a.max),
      pct(b.insideFraction),
      `**${pct(a.insideFraction)}**`,
    ]),
  );
}

// ---------------------------------------------------------------------------
// The cuts each section supports
// ---------------------------------------------------------------------------

const display = (k: string): string => k.charAt(0).toUpperCase() + k.slice(1);

/** The GDD §2.11 target: one behaviour, four hulls, rotated. */
export const classWins = (run: SectionRun): Win[] =>
  winsBy(run.matches, (r) => (r.winnerClass === null ? null : String(r.winnerClass)), classSeats, display);

/** The cast contest cut by silhouette rather than by name (a0-112 §2.5). */
export const castHullWins = (run: SectionRun): Win[] =>
  winsBy(run.matches, ownHullOf, seatsByOwnHull, display);

/** The cast contest by character (a0-112 §2.1). */
export const castCharacterWins = (run: SectionRun): Win[] =>
  winsBy(run.matches, (r) => r.winner, seatsByCharacter, display);

/** The cast contest by tier (a0-112 §2.2). */
export const castTierWins = (run: SectionRun): Win[] =>
  winsBy(run.matches, (r) => (r.winnerTier === null ? null : String(r.winnerTier)), seatsByTier, display);

/** The equal-skill pools (a0-112 §2.3) — one hull, one tier's pool, rotated. */
export function poolWins(run: SectionRun, pool: string): Win[] {
  const rows = run.matches.filter((r) => r.lineup.startsWith(`${pool}:`));
  return winsBy(rows, (r) => r.winner, seatsByCharacter, display);
}

/** Length of one section's decided matches — re-exported from `./mirrors` so a
 *  caller assembling this report needs one import, not two. */
export { lengthOf } from './mirrors';

/** Every tier pool present in a `tier` section, in ladder order. */
export const POOLS: readonly string[] = ['easy', 'medium', 'hard'];

/** How many of a section's matches ended without a winner — a0-113's draw, which
 *  is a legitimate ending and not a failure, but which shrinks a denominator and
 *  must therefore be printed beside every rate cut from it. */
export function draws(run: SectionRun): number {
  return run.matches.filter((r) => r.ok && r.winner === null).length;
}

/** Hangs — the one column whose non-zero value is an instrument failure. */
export function hangs(run: SectionRun): number {
  return run.matches.filter((r) => r.failure === 'wall-clock' || r.failure === 'stalled').length;
}

/** Sim-timeouts: a match that never reached an ending inside its ceiling. */
export function simTimeouts(run: SectionRun): number {
  return run.matches.filter((r) => r.failure === 'sim-timeout').length;
}

// ---------------------------------------------------------------------------
// One moved constant
// ---------------------------------------------------------------------------

/** A constant this pass moved, in the terms the brief asks the report to carry. */
export interface Change {
  readonly name: string;
  readonly before: string;
  readonly after: string;
  readonly why: string;
}

export function changeTable(changes: readonly Change[]): string {
  return table(
    ['constant', 'before', 'after', 'why'],
    changes.map((c) => [`\`${c.name}\``, `\`${c.before}\``, `\`${c.after}\``, c.why]),
  );
}

/** Section header line: what ran, on which seeds, and whether it hung. */
export function runLine(pair: Pair): string {
  const { before, after } = pair;
  return (
    `${after.matches.length} matches · ${after.seeds.length} seeds ` +
    `(\`${after.seeds.join(', ')}\`) · ${after.rotations} rotations · ` +
    `${simTimeouts(after)} sim-timeout · **${hangs(after)} hangs** · ` +
    `${draws(before)} → ${draws(after)} draws`
  );
}

/** The four hulls and the cast, for a reader who wants the lineup without the
 *  source. Re-exported so the report module needs one import. */
export { CLASSES, HARD_POOL, PERSONALITIES, ShipClass };
export type { Length, MatchRow, PersonalityId, SectionRun, Win };
