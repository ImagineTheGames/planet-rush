/**
 * evidence/a0-126-the-last-two-points/interval.ts — is 57.0% over the line?
 * OWNER: QA Agent (brief a0-126).
 *
 * Reads a0-121's committed roster artifacts and prints the interval on every
 * contestant, the exact one-sided test against the 55% ceiling, the clustering
 * correction, and the sample size the question would need. Prints markdown; the
 * report quotes it.
 *
 *   npx vite-node evidence/a0-126-the-last-two-points/interval.ts [dataDir]
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WIN_RATE_CEILING, nameOf, seatsByCharacter, winSE, winsBy } from '../../harness/mirrors';
import type { MatchRow, SectionRun } from '../../harness/mirrors';
import { binomTailGE, clopper, designEffect, pctOf, pts, sampleFor, wilson } from './stats';

const ROOT = resolve(import.meta.dirname, '../..');
const read = (p: string): SectionRun => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8')) as SectionRun;

const dir = process.argv[2] ?? 'tests/reports/a0-121-data/after';
const run = read(`${dir}/roster.json`);
const rows = run.matches;
const decided = rows.filter((r) => r.ok && r.winner !== null);

console.log(`# Warden's 57.0%, with an interval on it\n`);
console.log(`Artifact: \`${dir}/roster.json\` — ${run.seeds.length} seeds × ${run.rotations} rotations = ${rows.length} matches, ${decided.length} decided.`);
console.log(`Ceiling: **${pctOf(WIN_RATE_CEILING, 0)}** (GDD §2.11 / §3.8).\n`);

// ---------------------------------------------------------------------------
// 1 · The interval on every character
// ---------------------------------------------------------------------------
const wins = winsBy(rows, (r) => r.winner, seatsByCharacter, nameOf);
console.log(`## 1 · Every contestant, with a 95% interval\n`);
console.log('| contestant | wins / decided | rate | ±1 SE (prior reports) | Wilson 95% | exact 95% | one-sided P(≥ this \\| p = 55%) | over 55%? |');
console.log('|---|---|---|---|---|---|---|---|');
for (const w of wins) {
  const wi = wilson(w.wins, w.decided);
  const cp = clopper(w.wins, w.decided);
  const p1 = binomTailGE(w.wins, w.decided, WIN_RATE_CEILING);
  const sep = wi.lo > WIN_RATE_CEILING;
  console.log(
    `| ${w.name} | ${w.wins} / ${w.decided} | **${pctOf(w.rate)}** | ${pts(winSE(w.rate, w.decided))} pts | ` +
      `${pctOf(wi.lo)} – ${pctOf(wi.hi)} | ${pctOf(cp.lo)} – ${pctOf(cp.hi)} | ${p1.toFixed(3)} | ` +
      `${sep ? '**YES**' : 'not separable'} |`,
  );
}

// ---------------------------------------------------------------------------
// 2 · Warden, in full
// ---------------------------------------------------------------------------
const warden = wins.find((w) => w.key === 'warden')!;
const wi = wilson(warden.wins, warden.decided);
const cp = clopper(warden.wins, warden.decided);
const p1 = binomTailGE(warden.wins, warden.decided, WIN_RATE_CEILING);
console.log(`\n## 2 · Warden\n`);
console.log(`- ${warden.wins} / ${warden.decided} = **${pctOf(warden.rate)}**, against a ${pctOf(WIN_RATE_CEILING, 0)} ceiling.`);
const overMatches = warden.wins - WIN_RATE_CEILING * warden.decided;
console.log(`- The overage is **${pts(warden.rate - WIN_RATE_CEILING)} points = ${overMatches.toFixed(1)} matches** of ${warden.decided}.`);
console.log(`- Wilson 95%: **${pctOf(wi.lo)} – ${pctOf(wi.hi)}**. The ceiling ${wi.lo > WIN_RATE_CEILING ? 'is below' : 'is **inside**'} that interval.`);
console.log(`- Exact (Clopper–Pearson) 95%: **${pctOf(cp.lo)} – ${pctOf(cp.hi)}**.`);
console.log(`- Exact one-sided test, H₀ p = 55%: P(≥ ${warden.wins} of ${warden.decided}) = **${p1.toFixed(3)}**.`);
console.log(`- Coin-flip framing: **${(warden.decided * 0.5).toFixed(0)}** wins is an even split; **${(WIN_RATE_CEILING * warden.decided).toFixed(1)}** is the ceiling; Warden has **${warden.wins}**.`);

// ---------------------------------------------------------------------------
// 3 · Clustering — 32 map draws, not 223 free matches
// ---------------------------------------------------------------------------
const bySeed = new Map<number, { n: number; w: number }>();
for (const r of decided) {
  const e = bySeed.get(r.seed) ?? { n: 0, w: 0 };
  e.n += 1;
  if (r.winner === 'warden') e.w += 1;
  bySeed.set(r.seed, e);
}
const seeds = [...bySeed.keys()].sort((a, b) => a - b);
const cl = designEffect(seeds.map((s) => bySeed.get(s)!.w), seeds.map((s) => bySeed.get(s)!.n));
const wiC = wilson(warden.wins, warden.decided, 0.95, cl.deff);
console.log(`\n## 3 · The clustering correction — a seed is one map, played ${run.rotations} times\n`);
console.log(`- ${cl.clusters} seeds, mean ${cl.meanSize.toFixed(2)} decided matches each.`);
console.log(`- Warden's per-seed win counts: ${seeds.map((s) => bySeed.get(s)!.w).join(' ')}`);
console.log(`- ICC (raw) = **${cl.iccRaw.toFixed(4)}**, applied as ${cl.icc.toFixed(4)}. Design effect = **${cl.deff.toFixed(3)}**.`);
console.log(`- Effective sample: **${cl.effectiveN.toFixed(0)}** independent matches, not ${warden.decided}.`);
console.log(`- Cluster-corrected Wilson 95%: **${pctOf(wiC.lo)} – ${pctOf(wiC.hi)}**.`);

// ---------------------------------------------------------------------------
// 4 · The rotation cut — Warden holds the double seat once in seven
// ---------------------------------------------------------------------------
console.log(`\n## 4 · By rotation — where Warden holds one chair and where it holds two\n`);
const byRot = new Map<string, MatchRow[]>();
for (const r of rows) {
  const k = r.lineup;
  byRot.set(k, [...(byRot.get(k) ?? []), r]);
}
console.log('| rotation | Warden seats | decided | Warden wins | rate | Wilson 95% |');
console.log('|---|---|---|---|---|---|');
for (const k of [...byRot.keys()].sort()) {
  const rs = byRot.get(k)!;
  const d = rs.filter((r) => r.ok && r.winner !== null);
  const w = d.filter((r) => r.winner === 'warden').length;
  const seats = rs[0]!.seats['warden'] ?? 0;
  const iv = wilson(w, d.length);
  console.log(`| \`${k}\` | ${seats} | ${d.length} | ${w} | ${pctOf(d.length ? w / d.length : 0)} | ${pctOf(iv.lo)} – ${pctOf(iv.hi)} |`);
}
const single = decided.filter((r) => (r.seats['warden'] ?? 0) === 1);
const dbl = decided.filter((r) => (r.seats['warden'] ?? 0) > 1);
const sw = single.filter((r) => r.winner === 'warden').length;
const dw = dbl.filter((r) => r.winner === 'warden').length;
const si = wilson(sw, single.length);
const di = wilson(dw, dbl.length);
console.log(`\n- One chair: **${sw} / ${single.length} = ${pctOf(single.length ? sw / single.length : 0)}** (Wilson ${pctOf(si.lo)} – ${pctOf(si.hi)}).`);
console.log(`- Two chairs: **${dw} / ${dbl.length} = ${pctOf(dbl.length ? dw / dbl.length : 0)}** (Wilson ${pctOf(di.lo)} – ${pctOf(di.hi)}).`);

// ---------------------------------------------------------------------------
// 5 · What it would take to know
// ---------------------------------------------------------------------------
console.log(`\n## 5 · The sample size the question actually needs\n`);
console.log('| if the true rate is | separable from 55% at n = | ×  the run a0-121 filed | with clustering (deff ' + cl.deff.toFixed(2) + ') |');
console.log('|---|---|---|---|');
for (const p of [0.57, 0.58, 0.6, 0.62, 0.65, 0.7]) {
  const n = sampleFor(p, WIN_RATE_CEILING);
  const nc = sampleFor(p, WIN_RATE_CEILING, 0.95, cl.deff);
  console.log(`| ${pctOf(p, 0)} | **${Number.isFinite(n) ? n : '—'}** | ${Number.isFinite(n) ? (n / warden.decided).toFixed(1) + '×' : '—'} | ${Number.isFinite(nc) ? nc : '—'} |`);
}
console.log(`\nAt the observed ${pctOf(warden.rate)}, the run would have to be **${(sampleFor(warden.rate, WIN_RATE_CEILING) / warden.decided).toFixed(1)}×** its present size before the lower bound cleared the ceiling.`);
