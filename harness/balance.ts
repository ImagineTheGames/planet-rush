/**
 * harness/balance.ts — the balance sweep and its report. OWNER: QA Agent
 * (GDD §3.8, §2.11).
 *
 * QA files balance reports against measurable targets, and there are three:
 *
 *  1. **Match length lands in 10–15 minutes** (GDD §1, §2.3).
 *  2. **No strategy exceeds 55% win rate across bot mirrors** (GDD §3.8).
 *  3. **No ship class exceeds 55% win rate** in mirror-vs-field runs (GDD §2.11).
 *
 * Each of those is a claim about a *distribution*, so nothing here reports a
 * single match. A sweep is: one lineup, every seat rotation, a stated span of
 * seeds — and the pooled result. Rotation matters because the ring is
 * geometrically symmetric but the seeded wave scatter and the by-slot resolution
 * order are not; running each lineup in every rotation cancels seat advantage
 * instead of hoping it isn't there.
 *
 * **What "win rate" means here**, stated once so the number is never ambiguous:
 * every contestant holds an equal number of seats in every match, so with four
 * contestants in eight seats the *fair share* is 25%, not 50%. The 55% ceiling
 * is the GDD's, and the fair share is what a balanced result actually looks
 * like — a report prints both, because a strategy at 45% is nowhere near the
 * ceiling and still nearly twice as good as everything else.
 *
 * A timed-out match is **not** dropped from the denominator. A ruleset that
 * cannot end its own matches has failed target 1, and quietly excluding those
 * runs would hide exactly the failure QA exists to find.
 */

import { ShipClass } from '@shared/types';
import {
  WEAPON_DPS_CORE,
  WEAPON_DPS_SHIP,
  COLLAPSE_CORE_DECAY,
  COLLAPSE_GRACE_S,
  CORE_HP,
  FIELD_YIELD,
  MINING_RATE,
  RESPAWN_S,
  SHIELD,
  SPAWN_PROTECTION_S,
  STARTING_ORE,
  TURRET,
  WAVE_COUNT,
  WAVE_INTERVAL_S,
} from '../src/sim';
import type { MatchResult, MatchSetup, RunOptions, SlotSpec } from './match';
import { roundRobinLineup, runMatch, seedRange } from './match';
import type { StrategyId } from './strategies';
import { STRATEGIES } from './strategies';

// ---------------------------------------------------------------------------
// The targets (GDD §1, §2.11, §3.8)
// ---------------------------------------------------------------------------

/** Match-length target, seconds — GDD §1: "Matches last 10–15 minutes." */
export const TARGET_MATCH_MIN_S = 10 * 60;
export const TARGET_MATCH_MAX_S = 15 * 60;

/** The win-rate ceiling, for both strategies and ship classes (GDD §2.11, §3.8). */
export const WIN_RATE_CEILING = 0.55;

/** All four hulls, in GDD §2.11 table order. */
export const ALL_CLASSES: readonly ShipClass[] = [
  ShipClass.Interceptor,
  ShipClass.Vanguard,
  ShipClass.Excavator,
  ShipClass.Hauler,
];

// ---------------------------------------------------------------------------
// Sweeps
// ---------------------------------------------------------------------------

/** One sweep's inputs, recorded in the report so a run is reproducible from the
 *  report alone. */
export interface SweepSpec {
  /** What this sweep is measuring, in a sentence. */
  readonly label: string;
  /** The contestants, one entry per equal share of the eight seats. */
  readonly entries: readonly { strategy: StrategyId; shipClass: ShipClass }[];
  /** Seeds to run. Every seed is run in every rotation. */
  readonly seeds: readonly number[];
}

/** A finished sweep: its spec, and every match it produced. */
export interface Sweep {
  readonly spec: SweepSpec;
  readonly matches: readonly MatchResult[];
}

/**
 * Run a sweep: every seed × every rotation. `entries.length` rotations is what
 * gives each contestant every seat position exactly once per seed.
 */
export function runSweep(spec: SweepSpec, options: RunOptions = {}): Sweep {
  const matches: MatchResult[] = [];
  for (const seed of spec.seeds) {
    for (let rotation = 0; rotation < spec.entries.length; rotation++) {
      const lineup: SlotSpec[] = roundRobinLineup(spec.entries, rotation);
      // The seed folds in the rotation, so two rotations are two different
      // matches rather than the same field played by relabelled seats.
      const setup: MatchSetup = { seed: seed * 1000 + rotation, lineup };
      matches.push(runMatch(setup, options));
    }
  }
  return { spec, matches };
}

/** The strategy sweep: four probes, one hull, so strategy is the only variable. */
export function strategySweep(
  strategies: readonly StrategyId[],
  seeds: readonly number[] = seedRange(6),
  shipClass: ShipClass = ShipClass.Vanguard,
): SweepSpec {
  return {
    label: `Strategy — ${strategies.join(' / ')}, all ${shipClass}`,
    entries: strategies.map((strategy) => ({ strategy, shipClass })),
    seeds,
  };
}

/** The class sweep: four hulls, one probe, so the hull is the only variable
 *  (GDD §2.11 — "no class exceeds a 55% win rate in mirror-vs-field runs"). */
export function classSweep(
  strategy: StrategyId,
  seeds: readonly number[] = seedRange(6),
  classes: readonly ShipClass[] = ALL_CLASSES,
): SweepSpec {
  return {
    label: `Ship class — ${classes.join(' / ')}, all playing ${strategy}`,
    entries: classes.map((shipClass) => ({ strategy, shipClass })),
    seeds,
  };
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/** Match-length distribution, in sim seconds. */
export interface LengthStats {
  readonly n: number;
  readonly mean: number;
  readonly median: number;
  readonly min: number;
  readonly max: number;
  readonly p10: number;
  readonly p90: number;
  /** Fraction of matches landing inside the 10–15 minute target. */
  readonly inTarget: number;
}

/**
 * One contestant's record.
 *
 * Two rates, because a sweep can contain matches nobody won (a timeout is a
 * match with no winner, and it stays in the sample — see the module note):
 *
 *  - `rate` is **wins ÷ decided matches**. This is the one the 55% ceiling is
 *    checked against, because it answers "when this ruleset produces a winner,
 *    how often is it this contestant?" — the question the target is about.
 *  - `rateEntered` is wins ÷ matches entered. Lower whenever matches timed out,
 *    and reported alongside so the dilution is visible rather than silent.
 */
export interface WinRecord {
  readonly name: string;
  readonly matches: number;
  /** Matches this contestant entered that produced a winner. */
  readonly decided: number;
  readonly wins: number;
  readonly rate: number;
  readonly rateEntered: number;
  /** Mean sim seconds this contestant's seats survived. */
  readonly meanSurvival: number;
}

/** How a sweep terminated — target 1's other half. */
export interface TerminationStats {
  readonly matches: number;
  readonly ended: number;
  readonly simTimeout: number;
  readonly wallClock: number;
  readonly stalled: number;
  /** Fraction of matches that reached a real result. */
  readonly endedRate: number;
}

/** Percentile of a pre-sorted array, nearest-rank. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i]!;
}

/** Match-length distribution over a sweep. Timed-out matches count at their
 *  ceiling: they are the longest matches, not absent ones. */
export function lengthStats(matches: readonly MatchResult[]): LengthStats {
  const xs = matches.map((m) => m.seconds).sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) {
    return { n: 0, mean: 0, median: 0, min: 0, max: 0, p10: 0, p90: 0, inTarget: 0 };
  }
  const sum = xs.reduce((a, b) => a + b, 0);
  const inTarget = matches.filter(
    (m) => m.ok && m.seconds >= TARGET_MATCH_MIN_S && m.seconds <= TARGET_MATCH_MAX_S,
  ).length;
  return {
    n,
    mean: sum / n,
    median: percentile(xs, 0.5),
    min: xs[0]!,
    max: xs[n - 1]!,
    p10: percentile(xs, 0.1),
    p90: percentile(xs, 0.9),
    inTarget: inTarget / n,
  };
}

/** Termination breakdown over a sweep. */
export function terminationStats(matches: readonly MatchResult[]): TerminationStats {
  let ended = 0;
  let simTimeout = 0;
  let wallClock = 0;
  let stalled = 0;
  for (const m of matches) {
    if (m.ok) ended++;
    else if (m.failure === 'sim-timeout') simTimeout++;
    else if (m.failure === 'wall-clock') wallClock++;
    else if (m.failure === 'stalled') stalled++;
  }
  return {
    matches: matches.length,
    ended,
    simTimeout,
    wallClock,
    stalled,
    endedRate: matches.length > 0 ? ended / matches.length : 0,
  };
}

/**
 * Win records keyed by whatever `keyOf` names — the strategy for target 2, the
 * ship class for target 3. A match with no winner (a timeout) contributes to
 * every contestant's denominator and to nobody's numerator, which is the honest
 * accounting: nobody won it.
 */
export function winRecords(
  matches: readonly MatchResult[],
  keyOf: (slot: { strategy: StrategyId; shipClass: ShipClass }) => string,
): WinRecord[] {
  const played = new Map<string, number>();
  const decided = new Map<string, number>();
  const won = new Map<string, number>();
  const survival = new Map<string, { total: number; seats: number }>();

  for (const m of matches) {
    const seen = new Set<string>();
    for (const slot of m.slots) {
      const key = keyOf(slot);
      seen.add(key);
      const s = survival.get(key) ?? { total: 0, seats: 0 };
      s.total += slot.survivedSeconds;
      s.seats++;
      survival.set(key, s);
    }
    for (const key of seen) {
      played.set(key, (played.get(key) ?? 0) + 1);
      if (m.winner !== null) decided.set(key, (decided.get(key) ?? 0) + 1);
    }
    if (m.winner !== null) {
      const w = m.slots.find((s) => s.id === m.winner);
      if (w) {
        const key = keyOf(w);
        won.set(key, (won.get(key) ?? 0) + 1);
      }
    }
  }

  return [...played.entries()]
    .map(([name, count]) => {
      const s = survival.get(name);
      const wins = won.get(name) ?? 0;
      const dec = decided.get(name) ?? 0;
      return {
        name,
        matches: count,
        decided: dec,
        wins,
        rate: dec > 0 ? wins / dec : 0,
        rateEntered: count > 0 ? wins / count : 0,
        meanSurvival: s && s.seats > 0 ? s.total / s.seats : 0,
      };
    })
    .sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/** One line of the constants table, as the sweep saw it. The report carries
 *  this because a balance number without the constants it was measured against
 *  is not a measurement (GDD §2.8). */
function constantsSnapshot(): { name: string; value: string; gdd: string }[] {
  return [
    { name: 'CORE_HP', value: String(CORE_HP), gdd: '100' },
    { name: 'WEAPON_DPS_CORE', value: String(WEAPON_DPS_CORE), gdd: '5' },
    { name: 'WEAPON_DPS_SHIP', value: String(WEAPON_DPS_SHIP), gdd: '10' },
    { name: 'MINING_RATE', value: String(MINING_RATE), gdd: '0.5' },
    { name: 'STARTING_ORE', value: String(STARTING_ORE), gdd: '3' },
    { name: 'SPAWN_PROTECTION_S', value: String(SPAWN_PROTECTION_S), gdd: '10' },
    { name: 'TURRET.cost / hp / dps', value: `${TURRET.cost} / ${TURRET.hp} / ${TURRET.dps}`, gdd: '3 / 30 / 4' },
    { name: 'SHIELD.cost / hp / regen', value: `${SHIELD.cost} / ${SHIELD.hp} / ${SHIELD.regenPerSecond}`, gdd: '5 / 40 / 2' },
    { name: 'FIELD_YIELD', value: String(FIELD_YIELD), gdd: '~400' },
    { name: 'WAVE_COUNT × WAVE_INTERVAL_S', value: `${WAVE_COUNT} × ${WAVE_INTERVAL_S}`, gdd: '5 × ~150' },
    { name: 'COLLAPSE_GRACE_S', value: String(COLLAPSE_GRACE_S), gdd: '(derived)' },
    { name: 'COLLAPSE_CORE_DECAY', value: String(COLLAPSE_CORE_DECAY), gdd: '0 (baseline)' },
    { name: 'RESPAWN_S', value: String(RESPAWN_S), gdd: '5' },
  ];
}

/** mm:ss, the unit the match-length target is stated in. */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A percentage, one decimal. */
function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

/** PASS/FAIL, so a reader never has to compare two numbers themselves. */
function verdict(pass: boolean): string {
  return pass ? '**PASS**' : '**FAIL**';
}

/** A markdown table from a header row and body rows. */
function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const head = `| ${headers.join(' | ')} |`;
  const rule = `|${headers.map(() => '---').join('|')}|`;
  const body = rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
  return [head, rule, body].join('\n');
}

/** The three verdicts a report exists to deliver. */
export interface Verdicts {
  readonly length: boolean;
  readonly strategy: boolean;
  readonly shipClass: boolean;
  readonly termination: boolean;
}

/** Everything a report is written from. */
export interface ReportInput {
  /** Report title, e.g. "Balance report 01 — M5". */
  readonly title: string;
  /** The milestone / branch / context line under the title. */
  readonly context: string;
  readonly strategySweeps: readonly Sweep[];
  readonly classSweeps: readonly Sweep[];
  /** Mirror runs: one contestant in all eight seats — the degenerate cases that
   *  bound the ruleset from both ends. */
  readonly mirrors: readonly { label: string; matches: readonly MatchResult[] }[];
  /**
   * QA's reading of the numbers, as markdown, rendered under the scoreboard.
   * This is the **one hand-written part of a report** — a table of measurements
   * is not an interpretation, and a balance report that only prints numbers
   * makes the reader do QA's job. Everything else is generated.
   */
  readonly findings?: string;
  /** A note on what changed in the constants table for this run, if anything. */
  readonly tuning?: string;
}

/** The pass/fail line for every target, from a finished report input. */
export function verdicts(input: ReportInput): Verdicts {
  const all = [...input.strategySweeps, ...input.classSweeps].flatMap((s) => s.matches);
  const len = lengthStats(all);
  const term = terminationStats(all);
  const strat = input.strategySweeps.flatMap((s) => s.matches);
  const cls = input.classSweeps.flatMap((s) => s.matches);
  // A contestant with no decided match has no measured win rate, and a ceiling
  // cannot be checked against a rate that does not exist — that is a *coverage*
  // failure (target 1's timeouts), reported there rather than passed off here.
  const worstStrategy = winRecords(strat, (s) => s.strategy).filter((r) => r.decided > 0)[0];
  const worstClass = winRecords(cls, (s) => s.shipClass).filter((r) => r.decided > 0)[0];
  return {
    length: len.inTarget >= 0.5,
    termination: term.endedRate >= 1,
    strategy: !worstStrategy || worstStrategy.rate <= WIN_RATE_CEILING,
    shipClass: !worstClass || worstClass.rate <= WIN_RATE_CEILING,
  };
}

/**
 * Render the whole report as markdown, ready to be written into
 * `tests/reports/`. Every table is generated from the sweep it describes — no
 * number in a Planet Rush balance report is typed by hand.
 */
export function renderReport(input: ReportInput): string {
  const allSweeps = [...input.strategySweeps, ...input.classSweeps];
  const all = allSweeps.flatMap((s) => s.matches);
  const len = lengthStats(all);
  const term = terminationStats(all);
  const v = verdicts(input);

  const out: string[] = [];
  out.push(`# ${input.title}`, '', `**${input.context}**`, '');
  out.push(
    'Generated by `harness/balance.ts` (`npx vite-node harness/cli.ts balance`). Every',
    'number below is produced by the headless harness from the seeds and lineups named',
    'in each section — nothing here is typed by hand, and every run is reproducible',
    'from this file alone.',
    '',
    '---',
    '',
  );

  // --- The scoreboard ---
  out.push('## Targets at a glance', '');
  out.push(
    table(
      ['Target', 'Source', 'Measured', 'Verdict'],
      [
        [
          'Match length 10–15 min',
          'GDD §1',
          `median ${mmss(len.median)}, ${pct(len.inTarget)} inside target`,
          verdict(v.length),
        ],
        [
          'Every match reaches an ending',
          'GDD §2.3',
          `${term.ended}/${term.matches} ended (${pct(term.endedRate)})`,
          verdict(v.termination),
        ],
        [
          'No strategy > 55% win rate',
          'GDD §3.8',
          topLine(winRecords(input.strategySweeps.flatMap((s) => s.matches), (s) => s.strategy)),
          verdict(v.strategy),
        ],
        [
          'No ship class > 55% win rate',
          'GDD §2.11',
          topLine(winRecords(input.classSweeps.flatMap((s) => s.matches), (s) => s.shipClass)),
          verdict(v.shipClass),
        ],
      ],
    ),
    '',
  );

  if (input.tuning) {
    out.push('> **Tuning this run.** ' + input.tuning, '');
  }
  if (input.findings) {
    out.push('## QA reading', '', input.findings, '');
  }

  // --- Match length ---
  out.push('## 1 · Match length', '', `Sample: **${len.n} matches** across every sweep below.`, '');
  out.push(
    table(
      ['min', 'p10', 'median', 'mean', 'p90', 'max', 'inside 10–15 min'],
      [
        [
          mmss(len.min),
          mmss(len.p10),
          mmss(len.median),
          mmss(len.mean),
          mmss(len.p90),
          mmss(len.max),
          pct(len.inTarget),
        ],
      ],
    ),
    '',
  );

  out.push('### Termination', '');
  out.push(
    table(
      ['matches', 'ended', 'sim-timeout', 'wall-clock', 'stalled'],
      [[String(term.matches), String(term.ended), String(term.simTimeout), String(term.wallClock), String(term.stalled)]],
    ),
    '',
    'A `sim-timeout` is a match that ran past the harness ceiling without producing a',
    'winner — the ruleset failed to end it. It is counted, never dropped.',
    '',
  );

  // --- Strategy ---
  out.push('## 2 · Strategy win rates', '');
  for (const sweep of input.strategySweeps) {
    out.push(`### ${sweep.spec.label}`, '', sweepLine(sweep), '');
    out.push(recordsTable(winRecords(sweep.matches, (s) => s.strategy), sweep.spec.entries.length), '');
  }
  out.push(
    '**What the probes are.** Every difficulty tier on `main` still runs the do-nothing',
    'baseline (`src/bots/bot.ts`), so these are QA probes from `harness/strategies.ts`,',
    'not the shipped bots. Each is the smallest honest expression of one corner of the',
    'triangle (GDD §2.3):',
    '',
  );
  out.push(
    table(
      ['Probe', 'Hypothesis it tests'],
      Object.values(STRATEGIES).map((s) => [`\`${s.id}\``, s.hypothesis]),
    ),
    '',
  );

  // --- Class ---
  out.push('## 3 · Ship-class win rates', '');
  for (const sweep of input.classSweeps) {
    out.push(`### ${sweep.spec.label}`, '', sweepLine(sweep), '');
    out.push(recordsTable(winRecords(sweep.matches, (s) => s.shipClass), sweep.spec.entries.length), '');
  }

  // --- Mirrors ---
  if (input.mirrors.length > 0) {
    out.push('## 4 · Mirror runs (the bounds)', '');
    out.push(
      'One contestant in all eight seats. A mirror cannot answer "who wins" — everyone is',
      'the same — so it answers the other question: **does the ruleset end a match nobody',
      'is trying to end?**',
      '',
    );
    out.push(
      table(
        ['Mirror', 'matches', 'ended', 'median length', 'longest', 'field ore left'],
        input.mirrors.map((m) => {
          const l = lengthStats(m.matches);
          const t = terminationStats(m.matches);
          const ore = m.matches.reduce((a, x) => a + x.fieldOreLeft, 0) / Math.max(1, m.matches.length);
          return [
            `\`${m.label}\``,
            String(t.matches),
            `${t.ended}/${t.matches}`,
            mmss(l.median),
            mmss(l.max),
            ore.toFixed(0),
          ];
        }),
      ),
      '',
    );
  }

  // --- Constants ---
  out.push('## 5 · The constants this was measured against', '');
  out.push(
    'GDD §2.8: "These are starting values, not commitments … so QA has a hypothesis to',
    'falsify." This is the table as `src/sim/constants.ts` held it for this run.',
    '',
  );
  out.push(
    table(
      ['Constant', 'This run', 'GDD §2.8 baseline'],
      constantsSnapshot().map((c) => [`\`${c.name}\``, c.value, c.gdd]),
    ),
    '',
  );

  return out.join('\n');
}

/** "top: `rusher` 100.0% of 24 decided" — the scoreboard's one-line summary. */
function topLine(records: readonly WinRecord[]): string {
  const top = records.filter((r) => r.decided > 0)[0];
  if (!top) return 'no decided match — nothing to measure';
  return `top: \`${top.name}\` ${pct(top.rate)} of ${top.decided} decided`;
}

/** The seeds-and-rotations line under a sweep heading. */
function sweepLine(sweep: Sweep): string {
  const seeds = sweep.spec.seeds;
  const span = seeds.length > 0 ? `${seeds[0]}–${seeds[seeds.length - 1]}` : 'none';
  return `Seeds ${span} × ${sweep.spec.entries.length} rotations = **${sweep.matches.length} matches**, 8 seats each.`;
}

/** A win-record table, with the fair share spelled out next to the ceiling. */
function recordsTable(records: readonly WinRecord[], contestants: number): string {
  const fair = contestants > 0 ? 1 / contestants : 0;
  const undecided = records.some((r) => r.decided === 0);
  return [
    table(
      ['Contestant', 'entered', 'decided', 'wins', 'win rate (of decided)', 'vs fair share', 'mean survival'],
      records.map((r) => [
        `\`${r.name}\``,
        String(r.matches),
        String(r.decided),
        String(r.wins),
        r.decided === 0 ? '—' : `${pct(r.rate)}${r.rate > WIN_RATE_CEILING ? ' ⚠' : ''}`,
        r.decided === 0 ? '—' : `${(r.rate / (fair || 1)).toFixed(2)}×`,
        mmss(r.meanSurvival),
      ]),
    ),
    '',
    `Fair share with ${contestants} contestants is **${pct(fair)}**; the GDD ceiling is **${pct(WIN_RATE_CEILING)}**.` +
      (undecided
        ? ' A `—` means every match this contestant entered timed out: no win rate exists to compare, which is a target-1 failure, not a pass here.'
        : ''),
  ].join('\n');
}
