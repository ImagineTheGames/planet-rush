/**
 * evidence/a0-126-the-last-two-points/targets.ts — the three targets, each with
 * an interval and a THREE-state verdict. OWNER: QA Agent (brief a0-126).
 *
 *   npx vite-node evidence/.../targets.ts <dataDir> [label]
 *
 * Every prior report in this series printed a two-state verdict — `OVER` or
 * `under` — decided by whether a point estimate sat above 55%. That is the
 * wrong shape for the question. A point estimate of 48.6% on 255 matches and a
 * point estimate of 57.0% on 223 matches are *the same finding* if both
 * intervals contain the ceiling, and a0-121 printed one as INSIDE and the other
 * as OVER. So this file reports:
 *
 *   INSIDE      — the whole 95% interval is below the ceiling. Provably inside.
 *   OVER        — the whole 95% interval is above it. Provably over.
 *   UNRESOLVED  — the interval contains the ceiling. The run does not know, and
 *                 neither does anybody reading it.
 *
 * `UNRESOLVED` is not a hedge. It is the only verdict that tells the Director
 * what to do next, because the answer to it is a number of matches (`sampleFor`)
 * rather than a change to a constant.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { WIN_RATE_CEILING, pct, winSE } from '../../harness/mirrors';
import type { SectionRun, Win } from '../../harness/mirrors';
import { castCharacterWins, classWins, draws, hangs, poolWins, simTimeouts } from '../../harness/tuning';
import { binomTailGE, clopper, designEffect, sampleForExact, wilson } from './stats';

const ROOT = resolve(import.meta.dirname, '../..');

export type Verdict = 'INSIDE' | 'OVER' | 'UNRESOLVED';

/**
 * The verdict is read off the **exact** (Clopper–Pearson) interval, not the
 * Wilson one, and both are printed so the reader can see when they disagree.
 *
 * They disagree exactly at the knife edge, and the knife edge is where a wrong
 * verdict does damage. a0-121 §7.5's Bolt is the live example: 10 of 12 decided
 * Easy-pool matches is Wilson 55.2 – 95.3%, whose lower bound clears 55% by two
 * tenths of a point and would print **OVER**; the exact interval is 51.6 –
 * 97.9% and prints **UNRESOLVED**, which is the truth about ten coin flips.
 * Declaring a ceiling violation is what sends a lane to nerf something, so the
 * conservative interval is the one that gets to declare it — and, symmetrically,
 * the one that gets to declare a target safely INSIDE.
 */
export function verdictOf(lo: number, hi: number, ceiling = WIN_RATE_CEILING): Verdict {
  if (hi <= ceiling) return 'INSIDE';
  if (lo > ceiling) return 'OVER';
  return 'UNRESOLVED';
}

export interface TargetReading {
  readonly target: string;
  readonly section: string;
  readonly contestant: string;
  readonly wins: number;
  readonly decided: number;
  readonly rate: number;
  readonly lo: number;
  readonly hi: number;
  readonly exactLo: number;
  readonly exactHi: number;
  readonly p1: number;
  readonly verdict: Verdict;
  readonly needed: number;
}

export function readTarget(target: string, section: string, contestant: string, wins: Win[]): TargetReading {
  const w = wins.find((x) => x.key === contestant) ?? {
    key: contestant,
    name: contestant,
    seatMatches: 0,
    decided: 0,
    wins: 0,
    rate: 0,
    fairShare: 0,
  };
  const iv = wilson(w.wins, w.decided);
  const cp = clopper(w.wins, w.decided);
  return {
    target,
    section,
    contestant,
    wins: w.wins,
    decided: w.decided,
    rate: w.rate,
    lo: iv.lo,
    hi: iv.hi,
    exactLo: cp.lo,
    exactHi: cp.hi,
    p1: binomTailGE(w.wins, w.decided, WIN_RATE_CEILING),
    verdict: verdictOf(cp.lo, cp.hi),
    // Only asked when the point estimate is actually above the line. "How many
    // matches would separate a rate that is UNDER the ceiling from above it" has
    // no answer, and searching for one walks to the cap.
    needed: w.rate > WIN_RATE_CEILING ? sampleForExact(w.rate, WIN_RATE_CEILING) : Infinity,
  };
}

/** The **top** of a contest, whoever it is — a0-121's third target is phrased
 *  that way, and pinning it to a name would miss a new leader. */
export function topOf(wins: readonly Win[]): Win {
  return [...wins].sort((a, b) => b.rate - a.rate)[0]!;
}

export function verdictTable(rows: readonly TargetReading[]): string {
  const head = ['target', 'contestant', 'wins / decided', 'rate', 'Wilson 95%', 'exact 95% — the verdict', 'P(≥ this \\| p = 55%)', 'verdict'];
  const body = rows.map((r) => [
    r.target,
    r.contestant,
    `${r.wins} / ${r.decided}`,
    `**${pct(r.rate)}**`,
    `${pct(r.lo)} – ${pct(r.hi)}`,
    `${pct(r.exactLo)} – ${pct(r.exactHi)}`,
    r.p1.toFixed(3),
    r.verdict === 'OVER' ? '**OVER**' : r.verdict === 'INSIDE' ? '**INSIDE**' : '**UNRESOLVED**',
  ]);
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...body.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

// ---------------------------------------------------------------------------

function main(): void {
  const dir = process.argv[2] ?? 'tests/reports/a0-126-data/deep-shipped';
  const label = process.argv[3] ?? dir;
  const load = (s: string): SectionRun | null => {
    const p = resolve(ROOT, dir, `${s}.json`);
    return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as SectionRun) : null;
  };

  const rows: TargetReading[] = [];
  const notes: string[] = [];
  /** Easy-pool matches mostly draw, so "N more decided" is not "N more matches". */
  let easyDecidedFraction = 1;

  const cls = load('class');
  if (cls) {
    rows.push(readTarget('`excavator` — ship-class contest (GDD §2.11)', 'class', 'excavator', classWins(cls)));
    const t = topOf(classWins(cls));
    if (t.key !== 'excavator') {
      rows.push(readTarget('top of the ship-class contest, whoever it now is', 'class', t.key, classWins(cls)));
    }
    notes.push(`class: ${cls.seeds.length} seeds × ${cls.rotations} rotations = ${cls.matches.length} matches, ${draws(cls)} draws, ${hangs(cls)} hangs, ${simTimeouts(cls)} sim-timeouts`);
  }

  const roster = load('roster');
  if (roster) {
    const w = castCharacterWins(roster);
    rows.push(readTarget('Warden — cast contest (GDD §3.8)', 'roster', 'warden', w));
    const t = topOf(w);
    if (t.key !== 'warden') rows.push(readTarget('top of the cast, whoever it now is', 'roster', t.key, w));
    notes.push(`roster: ${roster.seeds.length} seeds × ${roster.rotations} rotations = ${roster.matches.length} matches, ${draws(roster)} draws, ${hangs(roster)} hangs, ${simTimeouts(roster)} sim-timeouts`);
  }

  const tier = load('tier');
  if (tier) {
    const easy = poolWins(tier, 'easy');
    rows.push(readTarget("Bolt — Easy pool at a fixed hull (a0-121 §7.5)", 'tier', 'bolt', easy));
    const t = topOf(easy);
    if (t.key !== 'bolt') rows.push(readTarget('top of the Easy pool, whoever it is', 'tier', t.key, easy));
    const easyRows = tier.matches.filter((r) => r.lineup.startsWith('easy:'));
    const easyDraws = easyRows.filter((r) => r.ok && r.winner === null).length;
    easyDecidedFraction = easyRows.length ? (easyRows.length - easyDraws) / easyRows.length : 1;
    notes.push(
      `tier: ${tier.seeds.length} seeds × ${tier.rotations} rotations = ${tier.matches.length} matches; ` +
        `Easy pool ${easyRows.length} matches of which **${easyDraws} draws** (${pct(easyRows.length ? easyDraws / easyRows.length : 0)}), ` +
        `${easyRows.length - easyDraws} decided`,
    );
  }

  console.log(`## Targets at a glance — \`${label}\`\n`);
  console.log(verdictTable(rows));
  console.log('');
  for (const n of notes) console.log(`- ${n}`);
  console.log('');
  for (const r of rows) {
    if (r.verdict !== 'UNRESOLVED') continue;
    if (!Number.isFinite(r.needed)) {
      console.log(`- **${r.contestant}** is UNRESOLVED at ${r.decided} decided matches, and its estimate (${pct(r.rate)}) is at or below the ceiling — no sample size separates it from above.`);
      continue;
    }
    const frac = r.section === 'tier' ? easyDecidedFraction : 1;
    const toRun = Math.ceil(r.needed / Math.max(frac, 1e-9));
    const drawNote = frac < 0.999 ? ` — which, at a ${pct(1 - frac)} draw rate, is **${toRun} matches to run**` : '';
    console.log(
      `- **${r.contestant}** is UNRESOLVED at ${r.decided} decided matches. Separating ${pct(r.rate)} from ` +
        `${pct(WIN_RATE_CEILING, 0)} needs **${r.needed} decided** (${(r.needed / Math.max(r.decided, 1)).toFixed(1)}× this run)${drawNote}.`,
    );
  }

  // Clustering, on the roster section, so the intervals above can be defended.
  if (roster) {
    const decided = roster.matches.filter((r) => r.ok && r.winner !== null);
    const bySeed = new Map<number, { n: number; w: number }>();
    for (const r of decided) {
      const e = bySeed.get(r.seed) ?? { n: 0, w: 0 };
      e.n += 1;
      if (r.winner === 'warden') e.w += 1;
      bySeed.set(r.seed, e);
    }
    const seeds = [...bySeed.keys()];
    const cl = designEffect(seeds.map((s) => bySeed.get(s)!.w), seeds.map((s) => bySeed.get(s)!.n));
    const w = castCharacterWins(roster).find((x) => x.key === 'warden')!;
    const wc = wilson(w.wins, w.decided, 0.95, cl.deff);
    const cc = clopper(w.wins, w.decided);
    console.log(
      `\n- Clustering (roster, by seed): ${cl.clusters} seeds, ICC ${cl.iccRaw.toFixed(4)}, design effect ${cl.deff.toFixed(3)}, ` +
        `effective n ${cl.effectiveN.toFixed(0)}. Cluster-corrected Wilson on Warden: ${pct(wc.lo)} – ${pct(wc.hi)}; ` +
        `exact ${pct(cc.lo)} – ${pct(cc.hi)} → **${verdictOf(cc.lo, cc.hi)}**.`,
    );
    console.log(`- ±1 SE, the bar prior reports quoted: ${(100 * winSE(w.rate, w.decided)).toFixed(1)} points.`);
  }
}

main();
