/**
 * evidence/a0-130-bolt-inside-the-band/arms.ts — every arm, read through
 * a0-126's interval. OWNER: Bot Engineer (brief a0-130).
 *
 *   npx vite-node evidence/.../arms-run.ts <label>[=dir] …
 *
 * Library plus a `main` the CLI calls; the CLI is `./arms-run.ts`, because
 * `./render.ts` imports this module and a module that prints a table at import
 * time prints it into the middle of the report.
 *
 * The brief's standing instruction is *"do not tune anything whose interval you
 * have not computed"*, so no arm in this report is ever printed as a point
 * estimate. The arithmetic is a0-126's, imported rather than re-derived — Wilson
 * and Clopper–Pearson intervals, the exact one-sided tail against the 55%
 * ceiling, and the three-state INSIDE / OVER / **UNRESOLVED** verdict, which is
 * the verdict a screening arm almost always earns and should therefore be
 * allowed to say.
 *
 * Two columns exist here that a0-126 did not need, because this pool is not the
 * cast contest:
 *
 *  - **decided** — the Easy pool draws four matches in five (a0-126 §4.5), so a
 *    rate over it is a rate over a fifth of what ran, and an arm that changes
 *    the *draw* rate has changed the experiment as well as the answer. The
 *    column is printed beside every rate for that reason.
 *  - **length** — GDD §1's 10–15 minute target, which any arm can trade away
 *    without meaning to.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WIN_RATE_CEILING, lengthOf, pct } from '../../harness/mirrors';
import type { MatchRow, SectionRun } from '../../harness/mirrors';
import { poolWins } from '../../harness/tuning';
import { binomTailGE, clopper, designEffect, wilson } from '../a0-126-the-last-two-points/stats';

/**
 * a0-126's three-state verdict, restated here rather than imported.
 *
 * The rule is theirs and is not being changed: read the verdict off the
 * **exact** (Clopper–Pearson) interval, because declaring a ceiling violation is
 * what sends a lane to nerf something, so the conservative interval is the one
 * that gets to declare it — and, symmetrically, the one that gets to declare a
 * target safely INSIDE. `UNRESOLVED` is not a hedge; it is the verdict a
 * screening arm honestly earns, and the answer to it is a number of matches
 * rather than a change to a weight.
 *
 * It is restated because `targets.ts` runs a CLI `main()` at module scope, so
 * importing the function prints a0-126's own report into the middle of this
 * one. `tests/harness/a0-130-verdict.test.ts` pins this copy against a0-126's
 * so the two cannot drift.
 */
export type Verdict = 'INSIDE' | 'OVER' | 'UNRESOLVED';

export function verdictOf(lo: number, hi: number, ceiling = WIN_RATE_CEILING): Verdict {
  if (hi <= ceiling) return 'INSIDE';
  if (lo > ceiling) return 'OVER';
  return 'UNRESOLVED';
}

const ROOT = resolve(import.meta.dirname, '../..');

export interface ArmReading {
  readonly label: string;
  readonly matches: number;
  readonly decided: number;
  readonly drawRate: number;
  readonly contestant: string;
  readonly wins: number;
  readonly rate: number;
  readonly lo: number;
  readonly hi: number;
  readonly exactLo: number;
  readonly exactHi: number;
  readonly p1: number;
  readonly verdict: Verdict;
  readonly medianSeconds: number;
  readonly minSeconds: number;
  readonly maxSeconds: number;
  readonly inTarget: number;
  readonly seeds: readonly number[];
  readonly rows: readonly MatchRow[];
}

export const load = (dir: string, section = 'tier'): SectionRun | null => {
  const p = resolve(ROOT, dir, `${section}.json`);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as SectionRun) : null;
};

/** One arm's reading of one pool, for one contestant. `contestant` defaults to
 *  the **top** of the pool, whoever it is: a ceiling target that names a
 *  character stops being a ceiling target the moment a nerf hands the lead to
 *  somebody else, and a two-horse pool is exactly where that happens. */
export function readArm(
  label: string,
  run: SectionRun,
  pool: string,
  contestant?: string,
): ArmReading {
  const rows = run.matches.filter((r) => r.lineup.startsWith(`${pool}:`));
  const decided = rows.filter((r) => r.ok && r.winner !== null);
  const wins = poolWins({ ...run, matches: [...rows] }, pool);
  const who = contestant ?? [...wins].sort((a, b) => b.rate - a.rate)[0]?.key ?? 'bolt';
  const w = wins.find((x) => x.key === who) ?? { wins: 0, decided: 0, rate: 0 };
  const iv = wilson(w.wins, w.decided);
  const cp = clopper(w.wins, w.decided);
  const len = lengthOf(rows);
  return {
    label,
    matches: rows.length,
    decided: decided.length,
    drawRate: rows.length ? 1 - decided.length / rows.length : 0,
    contestant: who,
    wins: w.wins,
    rate: w.rate,
    lo: iv.lo,
    hi: iv.hi,
    exactLo: cp.lo,
    exactHi: cp.hi,
    p1: binomTailGE(w.wins, w.decided, WIN_RATE_CEILING),
    verdict: verdictOf(cp.lo, cp.hi),
    medianSeconds: len.median,
    minSeconds: len.min,
    maxSeconds: len.max,
    inTarget: len.insideFraction,
    seeds: run.seeds,
    rows,
  };
}

const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export function armTable(rows: readonly ArmReading[]): string {
  const head = [
    'arm', 'decided / matches', 'draws', 'top of the pool', 'wins / decided', 'rate',
    'Wilson 95%', 'exact 95% — the verdict', 'P(≥ this \\| p = 55%)', 'verdict', 'median length', 'inside 10–15',
  ];
  const body = rows.map((r) => [
    r.label,
    `${r.decided} / ${r.matches}`,
    pct(r.drawRate),
    r.decided === 0 ? '— *no contest*' : `\`${r.contestant}\``,
    r.decided === 0 ? '—' : `${r.wins} / ${r.decided}`,
    r.decided === 0 ? '—' : `**${pct(r.rate)}**`,
    r.decided === 0 ? '—' : `${pct(r.lo)} – ${pct(r.hi)}`,
    r.decided === 0 ? '—' : `${pct(r.exactLo)} – ${pct(r.exactHi)}`,
    r.decided === 0 ? '—' : r.p1.toFixed(3),
    r.decided === 0 ? '**NO CONTEST**' : `**${r.verdict}**`,
    mmss(r.medianSeconds),
    pct(r.inTarget),
  ]);
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...body.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

/** Clustering by seed, so an interval over a pool can be defended. A seed is one
 *  map draw played in every rotation; if a map suits a character, its matches
 *  lean together and the plain binomial interval is too narrow. */
export function clusteringOf(r: ArmReading): string {
  const decided = r.rows.filter((x) => x.ok && x.winner !== null);
  const bySeed = new Map<number, { n: number; w: number }>();
  for (const x of decided) {
    const e = bySeed.get(x.seed) ?? { n: 0, w: 0 };
    e.n += 1;
    if (x.winner === r.contestant) e.w += 1;
    bySeed.set(x.seed, e);
  }
  const seeds = [...bySeed.keys()];
  const cl = designEffect(seeds.map((s) => bySeed.get(s)!.w), seeds.map((s) => bySeed.get(s)!.n));
  const wc = wilson(r.wins, r.decided, 0.95, cl.deff);
  return (
    `| clusters (seeds with a decided match) | ${cl.clusters} |\n` +
    `| decided matches per seed | ${(r.decided / Math.max(cl.clusters, 1)).toFixed(2)} |\n` +
    `| intra-cluster correlation (raw) | **${cl.iccRaw.toFixed(4)}** |\n` +
    `| ICC applied (floored at 0) | ${cl.icc.toFixed(4)} |\n` +
    `| design effect | **${cl.deff.toFixed(3)}** |\n` +
    `| effective independent matches | **${cl.effectiveN.toFixed(0)}** of ${r.decided} |\n` +
    `| exact 95% (no correction) | ${pct(r.exactLo)} – ${pct(r.exactHi)} |\n` +
    `| Wilson 95% (clustered) | ${pct(wc.lo)} – ${pct(wc.hi)} |`
  );
}

// ---------------------------------------------------------------------------

export function main(argv: readonly string[]): void {
  const args = [...argv];
  const rows: ArmReading[] = [];
  for (const a of args) {
    const [label, dir] = a.includes('=') ? a.split('=') : [a, `tests/reports/a0-130-data/${a}`];
    const run = load(dir!);
    if (!run) {
      console.error(`missing artifact: ${dir}/tier.json`);
      continue;
    }
    rows.push(readArm(label!, run, 'easy'));
  }
  console.log(armTable(rows));
}
