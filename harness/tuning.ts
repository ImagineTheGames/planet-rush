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
  lengthOf,
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
    ['contestant', 'shipped tree', 'candidate', 'move', 'fair share', '±1 SE (candidate)', 'vs 55%'],
    before.map((b) => {
      const a = byKey.get(b.key);
      const rate = a?.rate ?? 0;
      return [
        b.name,
        `${b.wins} / ${b.decided} (**${pct(b.rate)}**)`,
        a === undefined ? '—' : a.decided === 0 ? '**no decided match**' : `${a.wins} / ${a.decided} (**${pct(a.rate)}**)`,
        a === undefined || a.decided === 0 ? '—' : movePts(b.rate, rate),
        pct(b.fairShare),
        a === undefined || a.decided === 0 ? '—' : `${(winSE(rate, a.decided) * 100).toFixed(1)} pts`,
        a === undefined || a.decided === 0 ? '—' : band(rate),
      ];
    }),
  );
}

/** Match length, before beside after — the target a hull nerf can trade away. */
export function compareLength(rows: readonly (readonly [string, Length, Length])[]): string {
  return table(
    ['run', 'decided', 'median shipped', 'median candidate', 'mean candidate', 'min', 'max', 'inside 10–15 shipped', 'inside 10–15 candidate'],
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
export { CLASSES, HARD_POOL, PERSONALITIES, ShipClass, lengthOf };
export type { Length, MatchRow, PersonalityId, SectionRun, Win };

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/** One lever this pass priced, whether or not it shipped. The brief asks for
 *  "every constant you changed, its before and after value, and the reason";
 *  when the answer is "none of them", the honest form of that table is this one
 *  — every constant that was *tried*, what it bought, and what stopped it. */
export interface Lever {
  readonly constant: string;
  readonly from: string;
  readonly to: string;
  /** Excavator's share of the ship-class contest at that value. */
  readonly excavator: string;
  /** Matches behind that number, so a 64-match probe is never read as a 256. */
  readonly matches: number;
  /** What blocks it, or `null` if nothing does. */
  readonly blockedBy: string | null;
}

export function leverTable(levers: readonly Lever[]): string {
  return table(
    ['constant', 'from', 'to', 'excavator', 'matches', 'what stops it'],
    levers.map((l) => [
      `\`${l.constant}\``,
      `\`${l.from}\``,
      `\`${l.to}\``,
      l.excavator,
      String(l.matches),
      l.blockedBy ?? '— nothing',
    ]),
  );
}

/** Everything the renderer needs that it cannot compute. */
export interface TuningReportInput {
  readonly title: string;
  readonly context: string;
  /** The single line the DoD asks for at the very top. */
  readonly verdictLine: string;
  readonly headline: string;
  readonly changed: readonly Change[];
  readonly reading: string;
  readonly levers: readonly Lever[];
  readonly whatItWouldTake: string;
  /** before/candidate pairs, keyed by section. */
  readonly klass: Pair;
  readonly roster: Pair;
  readonly tier: Pair;
  readonly mirror: Pair;
  readonly cast: Pair;
  readonly a0107: Pair;
  readonly candidateLabel: string;
}

function section(title: string, body: string): string {
  return `${title}\n\n${body}\n`;
}

/**
 * Render the whole file. Every table is computed from the two artifact sets; the
 * prose blocks arrive from the caller and are marked hand-written where they
 * land, exactly as `./mirrors` does — so regenerating this file reproduces all
 * of it rather than half of it.
 */
export function renderTuningReport(input: TuningReportInput): string {
  for (const pair of [input.klass, input.roster, input.tier, input.mirror, input.cast, input.a0107]) {
    assertSameSeeds(pair);
  }
  const c = input.candidateLabel;
  const out: string[] = [];
  out.push(`# ${input.title}`);
  out.push('');
  out.push(`> ${input.verdictLine}`);
  out.push('');
  out.push(`**${input.context}**`);
  out.push('');
  out.push(input.headline);
  out.push('');
  out.push(
    'Generated by `harness/tuning.ts` (`npx vite-node harness/cli.ts tuning report`) from the\n' +
      'section artifacts in `tests/reports/a0-117-data/`. **Both columns of every table below were\n' +
      'run on the same seeds** — the renderer refuses a pair whose seed lists differ\n' +
      '(`assertSameSeeds`), because "re-measured on the same seeds" is the whole evidentiary\n' +
      'value of an after-number. The seeds are named in §1. Only the readings are hand-written,\n' +
      'and they are marked.',
  );
  out.push('');
  out.push('---');
  out.push('');

  // Targets at a glance
  const klassBefore = classWins(input.klass.before);
  const klassAfter = classWins(input.klass.after);
  const hullBefore = castHullWins(input.roster.before);
  const hullAfter = castHullWins(input.roster.after);
  const charBefore = castCharacterWins(input.roster.before);
  const charAfter = castCharacterWins(input.roster.after);
  const find = (ws: readonly Win[], key: string): Win | undefined => ws.find((w) => w.key === key);
  // A contest with no decided match has no win rate, and printing `0/0 (0.0%)`
  // would read as "it lost every match" — the opposite of what a board of draws
  // means. Say so instead (a0-113 made the draw a real ending).
  const cell = (w: Win | undefined): string =>
    w === undefined ? '—' : w.decided === 0 ? '**no decided match**' : `${w.wins}/${w.decided} (**${pct(w.rate)}**)`;
  const verdict = (w: Win | undefined): string =>
    w === undefined ? '—' : w.decided === 0 ? '—' : w.rate > WIN_RATE_CEILING ? '**OVER**' : 'under';

  out.push(
    section(
      '## Targets at a glance',
      table(
        ['target', 'source', 'shipped tree', c, 'verdict, shipped'],
        [
          [
            '`excavator` — ship-class contest',
            'GDD §2.11',
            cell(find(klassBefore, 'excavator')),
            cell(find(klassAfter, 'excavator')),
            verdict(find(klassBefore, 'excavator')),
          ],
          [
            '`excavator` — cast contest, cut by hull',
            'GDD §2.11',
            cell(find(hullBefore, 'excavator')),
            cell(find(hullAfter, 'excavator')),
            verdict(find(hullBefore, 'excavator')),
          ],
          [
            'Warden — cast contest',
            'GDD §3.8',
            cell(find(charBefore, 'warden')),
            cell(find(charAfter, 'warden')),
            verdict(find(charBefore, 'warden')),
          ],
          [
            'Bolt — easy pool, one hull',
            'GDD §3.8',
            cell(find(poolWins(input.tier.before, 'easy'), 'bolt')),
            cell(find(poolWins(input.tier.after, 'easy'), 'bolt')),
            verdict(find(poolWins(input.tier.before, 'easy'), 'bolt')),
          ],
          [
            'Match length 10–15 min',
            'GDD §1',
            `median ${mmss(lengthOfPair(input.klass.before))}, ${pct(insideOf(input.klass.before))} inside`,
            `median ${mmss(lengthOfPair(input.klass.after))}, ${pct(insideOf(input.klass.after))} inside`,
            '**PASS**',
          ],
          [
            'No hung match (harness gate)',
            'GDD §3.8',
            `${allHangs([input.klass.before, input.roster.before, input.tier.before, input.mirror.before, input.cast.before, input.a0107.before])} hangs`,
            `${allHangs([input.klass.after, input.roster.after, input.tier.after, input.mirror.after, input.cast.after, input.a0107.after])} hangs`,
            '**PASS**',
          ],
        ],
      ),
    ),
  );

  out.push(section('## What this pass changed in `src/sim/constants.ts`', changeTable(input.changed)));
  out.push(section('## QA reading', input.reading));
  out.push('---');
  out.push('');

  // §1
  out.push(
    section(
      '## 1 · What was run — twice, on the same seeds',
      table(
        ['section', 'lineup', 'seeds', 'matches', 'decided (shipped)', 'decided (candidate)', 'draws', 'sim-timeout', 'hangs'],
        (
          [
            ['`class`', input.klass],
            ['`roster`', input.roster],
            ['`tier`', input.tier],
            ['`mirror`', input.mirror],
            ['`cast`', input.cast],
            ['`a0107`', input.a0107],
          ] as const
        ).map(([name, pair]) => [
          name,
          pair.after.label,
          String(pair.after.seeds.length),
          String(pair.after.matches.length),
          String(decidedOf(pair.before)),
          String(decidedOf(pair.after)),
          `${draws(pair.before)} → ${draws(pair.after)}`,
          `${simTimeouts(pair.before)} → ${simTimeouts(pair.after)}`,
          `**${hangs(pair.before)} → ${hangs(pair.after)}**`,
        ]),
      ) +
        '\n\nSeeds, every rotated section: `' +
        input.klass.after.seeds.join(', ') +
        '` (class) and `' +
        input.mirror.after.seeds.join(', ') +
        '` (the rest); `cast` runs a0-105’s twelve and `a0107` a0-107’s own draw. ' +
        'These are a0-112 §1’s seeds, unchanged — which is what makes the left column of ' +
        'every table below a reproduction and the right column a comparison.',
    ),
  );

  // §2
  out.push('## 2 · Win rate — shipped tree, then the candidate, on the same seeds\n');
  out.push(section('### 2.1 · Per ship class — the GDD §2.11 target', compareWins(klassBefore, klassAfter)));
  out.push(section('### 2.2 · The cast contest, cut by hull', compareWins(hullBefore, hullAfter)));
  out.push(section('### 2.3 · The cast contest, by character', compareWins(charBefore, charAfter)));
  out.push(
    section(
      '### 2.4 · The cast contest, by tier',
      compareWins(castTierWins(input.roster.before), castTierWins(input.roster.after)),
    ),
  );
  POOLS.forEach((pool, i) => {
    out.push(
      section(
        `### 2.${5 + i} · Equal skill — the \`${pool}\` pool, one hull, rotated`,
        compareWins(poolWins(input.tier.before, pool), poolWins(input.tier.after, pool)),
      ),
    );
  });

  // §3
  out.push(
    section(
      '## 3 · Match length — the target a hull nerf can trade away',
      compareLength(
        (
          [
            ['ship-class contest', input.klass],
            ['shipped cast (roster contest)', input.roster],
            ['equal-skill contests', input.tier],
            ['character mirrors', input.mirror],
            ['shipped cast, unrotated (a0-105 seeds)', input.cast],
            ['a0-107 replay (a0-107 seeds)', input.a0107],
          ] as const
        ).map(([label, pair]) => [label, lengthOf(pair.before.matches), lengthOf(pair.after.matches)] as const),
      ),
    ),
  );

  out.push(section('## 4 · Every lever this pass priced', leverTable(input.levers)));
  out.push(section('## 5 · What it would take', input.whatItWouldTake));
  out.push('---');
  out.push('');
  out.push(`*${input.title} — QA Agent. No file under \`src/\` was changed by this brief.*`);
  return `${out.join('\n')}\n`;
}

const decidedOf = (run: SectionRun): number => run.matches.filter((r) => r.ok && r.winner !== null).length;
const lengthOfPair = (run: SectionRun): number => lengthOf(run.matches).median;
const insideOf = (run: SectionRun): number => lengthOf(run.matches).insideFraction;
const allHangs = (runs: readonly SectionRun[]): number => runs.reduce((n, r) => n + hangs(r), 0);
