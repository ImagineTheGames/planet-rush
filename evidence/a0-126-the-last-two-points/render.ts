/**
 * evidence/a0-126-the-last-two-points/render.ts — the tables in
 * `tests/reports/a0-126-warden.md`. OWNER: QA Agent (brief a0-126).
 *
 * It computes no rate of its own: every win rate, fair share and match length
 * comes from `harness/mirrors`' helpers, so a table here and the same table in
 * `a0-112-balance.md` or `a0-121-excavator.md` are read the same way. What it
 * adds is the interval, from `./stats`, and a **three-state** verdict from
 * `./targets` — because the question this brief asks is not "did the number
 * move", which ±1 SE answers, but "is the number over a fixed line", which it
 * does not.
 *
 * **Every before/after pair is the same draw**, and here that is stronger than
 * a promise: a0-112's seeds 1…32 are a strict subset of this run's 1…512, so
 * the a0-121 column is not transcribed from a published table — it is lifted
 * back out of this run's own artifact with `restrict()`, checked against the
 * published artifact row for row by `./reproduce.ts`, and run through a0-117's
 * `assertSameSeeds` here as well. A pair that is not the same seeds throws
 * rather than being printed.
 *
 *   npx vite-node evidence/a0-126-the-last-two-points/render.ts
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  WIN_RATE_CEILING,
  lengthOf,
  mmss,
  pct,
  winSE,
} from '../../harness/mirrors';
import type { SectionRun, Win } from '../../harness/mirrors';
import { assertSameSeeds, castCharacterWins, classWins, draws, hangs, poolWins, simTimeouts } from '../../harness/tuning';
import { binomTailGE, clopper, designEffect, sampleForExact, wilson } from './stats';
import { readTarget, topOf, verdictOf, verdictTable } from './targets';
import type { TargetReading } from './targets';
import { restrict } from './reproduce';

const ROOT = resolve(import.meta.dirname, '../..');
const read = (p: string): SectionRun => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8')) as SectionRun;
const has = (p: string): boolean => existsSync(resolve(ROOT, p));

const PRIOR = 'tests/reports/a0-121-data/after';
const DEEP = 'tests/reports/a0-126-data/deep-shipped';

function table(head: readonly string[], rows: readonly (readonly string[])[]): string {
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}
const f = (n: number, d = 1): string => n.toFixed(d);
const iv = (w: Win): string => {
  const c = clopper(w.wins, w.decided);
  return `${pct(c.lo)} – ${pct(c.hi)}`;
};
const vd = (w: Win): string => {
  const c = clopper(w.wins, w.decided);
  const v = verdictOf(c.lo, c.hi);
  return v === 'UNRESOLVED' ? '**UNRESOLVED**' : v === 'OVER' ? '**OVER**' : 'INSIDE';
};

// ---------------------------------------------------------------------------
// The interval on a published number
// ---------------------------------------------------------------------------

/** Every contestant of a cut, with the bar prior reports quoted beside the one
 *  a ceiling question actually needs. */
function intervalTable(wins: readonly Win[]): string {
  return table(
    ['contestant', 'wins / decided', 'rate', '±1 SE — the bar prior reports quoted', 'Wilson 95%', 'exact 95%', 'P(≥ this \\| p = 55%)', 'vs 55%'],
    wins.map((w) => {
      const wi = wilson(w.wins, w.decided);
      return [
        w.name,
        `${w.wins} / ${w.decided}`,
        `**${pct(w.rate)}**`,
        `${f(100 * winSE(w.rate, w.decided))} pts`,
        `${pct(wi.lo)} – ${pct(wi.hi)}`,
        iv(w),
        binomTailGE(w.wins, w.decided, WIN_RATE_CEILING).toFixed(3),
        vd(w),
      ];
    }),
  );
}

/** The deep column beside the a0-121 column, on **the same seeds** for the
 *  overlap — the prior column is this run restricted, not a transcription. */
function deepVsPriorTable(deepWins: readonly Win[], priorWins: readonly Win[]): string {
  const byKey = new Map(priorWins.map((w) => [w.key, w]));
  return table(
    ['contestant', 'a0-121 · 32 seeds', 'a0-126 · 512 seeds', 'move', 'exact 95% (deep)', 'width before', 'width after', 'verdict (deep)'],
    [...deepWins].map((w) => {
      const p = byKey.get(w.key);
      const cw = clopper(w.wins, w.decided);
      const cp = p ? clopper(p.wins, p.decided) : null;
      const move = p ? 100 * (w.rate - p.rate) : NaN;
      return [
        w.name,
        p ? `${p.wins} / ${p.decided} (**${pct(p.rate)}**)` : '—',
        `${w.wins} / ${w.decided} (**${pct(w.rate)}**)`,
        p ? `${move >= 0 ? '+' : ''}${f(move)} pts` : '—',
        `${pct(cw.lo)} – ${pct(cw.hi)}`,
        cp ? `${f(100 * (cp.hi - cp.lo))} pts` : '—',
        `${f(100 * (cw.hi - cw.lo))} pts`,
        vd(w),
      ];
    }),
  );
}

function lengthTable(rows: readonly (readonly [string, SectionRun, SectionRun | null])[]): string {
  return table(
    ['run', 'matches', 'decided', 'median (a0-121, 32 seeds)', 'median (a0-126, 512 seeds)', 'min', 'max', 'inside 10–15 (a0-121)', 'inside 10–15 (a0-126)'],
    rows.map(([label, deep, prior]) => {
      const ld = lengthOf(deep.matches);
      const lp = prior ? lengthOf(prior.matches) : null;
      return [
        label,
        String(deep.matches.length),
        String(ld.n),
        lp ? mmss(lp.median) : '—',
        `**${mmss(ld.median)}**`,
        mmss(ld.min),
        mmss(ld.max),
        lp ? pct(lp.insideFraction) : '—',
        `**${pct(ld.insideFraction)}**`,
      ];
    }),
  );
}

function clusterBlock(run: SectionRun, who: string): string {
  const decided = run.matches.filter((r) => r.ok && r.winner !== null);
  const bySeed = new Map<number, { n: number; w: number }>();
  for (const r of decided) {
    const e = bySeed.get(r.seed) ?? { n: 0, w: 0 };
    e.n += 1;
    if (r.winner === who) e.w += 1;
    bySeed.set(r.seed, e);
  }
  const seeds = [...bySeed.keys()];
  const cl = designEffect(seeds.map((s) => bySeed.get(s)!.w), seeds.map((s) => bySeed.get(s)!.n));
  const w = castCharacterWins(run).find((x) => x.key === who)!;
  const plain = clopper(w.wins, w.decided);
  const clustered = wilson(w.wins, w.decided, 0.95, cl.deff);
  return [
    `| quantity | value |`,
    `|---|---|`,
    `| clusters (seeds) | ${cl.clusters} |`,
    `| decided matches per seed | ${f(cl.meanSize, 2)} |`,
    `| intra-cluster correlation (raw) | **${cl.iccRaw.toFixed(4)}** |`,
    `| ICC applied (floored at 0) | ${cl.icc.toFixed(4)} |`,
    `| design effect | **${cl.deff.toFixed(3)}** |`,
    `| effective independent matches | **${cl.effectiveN.toFixed(0)}** of ${w.decided} |`,
    `| exact 95% (no correction) | ${pct(plain.lo)} – ${pct(plain.hi)} |`,
    `| Wilson 95% (clustered) | ${pct(clustered.lo)} – ${pct(clustered.hi)} |`,
  ].join('\n');
}

function rotationTable(run: SectionRun, who: string): string {
  const byRot = new Map<string, typeof run.matches>();
  for (const r of run.matches) byRot.set(r.lineup, [...(byRot.get(r.lineup) ?? []), r] as typeof run.matches);
  const rows = [...byRot.keys()].sort().map((k) => {
    const rs = byRot.get(k)!;
    const d = rs.filter((r) => r.ok && r.winner !== null);
    const wn = d.filter((r) => r.winner === who).length;
    const c = clopper(wn, d.length);
    return [
      `\`${k}\``,
      String(rs[0]!.seats[who] ?? 0),
      String(d.length),
      String(wn),
      `**${pct(d.length ? wn / d.length : 0)}**`,
      `${pct(c.lo)} – ${pct(c.hi)}`,
    ];
  });
  return table(['rotation', `${who} seats`, 'decided', `${who} wins`, 'rate', 'exact 95%'], rows);
}

function seatCutTable(run: SectionRun, who: string): string {
  const decided = run.matches.filter((r) => r.ok && r.winner !== null);
  const rows: string[][] = [];
  for (const [label, keep] of [
    ['one chair (6 rotations of 7)', (n: number) => n === 1],
    ['two chairs (1 rotation of 7)', (n: number) => n > 1],
    ['pooled — the number a0-121 published', () => true],
  ] as const) {
    const rs = decided.filter((r) => keep(r.seats[who] ?? 0));
    const wn = rs.filter((r) => r.winner === who).length;
    const c = clopper(wn, rs.length);
    const share = rs.length ? rs.reduce((a, r) => a + (r.seats[who] ?? 0), 0) / rs.reduce((a, r) => a + Object.values(r.seats).reduce((x, y) => x + y, 0), 0) : 0;
    rows.push([
      label,
      `${wn} / ${rs.length}`,
      `**${pct(rs.length ? wn / rs.length : 0)}**`,
      pct(share),
      `${pct(c.lo)} – ${pct(c.hi)}`,
      verdictOf(c.lo, c.hi) === 'UNRESOLVED' ? '**UNRESOLVED**' : verdictOf(c.lo, c.hi) === 'OVER' ? '**OVER**' : 'INSIDE',
    ]);
  }
  return table(['cut', 'wins / decided', 'rate', 'seat share', 'exact 95%', 'vs 55%'], rows);
}

function sampleTable(observed: number, decided: number): string {
  const rows = [0.56, 0.57, 0.58, 0.6, 0.62, 0.65, 0.7].map((p) => {
    const n = sampleForExact(p, WIN_RATE_CEILING);
    return [
      pct(p, 0),
      Number.isFinite(n) ? `**${n}**` : `— (over ${200_000})`,
      Number.isFinite(n) ? `${f(n / decided, 1)}×` : '—',
      Number.isFinite(n) ? `${f((n / 7) * (1.6 / 3600) * 7, 1)} core-hours` : '—',
    ];
  });
  return table(['if the true rate is', 'decided matches needed to clear 55%', '× a0-121\'s run', 'roughly'], rows);
}

// ---------------------------------------------------------------------------

const priorRoster = read(`${PRIOR}/roster.json`);
const priorClass = read(`${PRIOR}/class.json`);
const priorTier = read(`${PRIOR}/tier.json`);

const deepRoster = has(`${DEEP}/roster.json`) ? read(`${DEEP}/roster.json`) : null;
const deepClass = has(`${DEEP}/class.json`) ? read(`${DEEP}/class.json`) : null;
const deepTier = has(`${DEEP}/tier.json`) ? read(`${DEEP}/tier.json`) : null;

// The a0-121 column is this run, restricted — and it must be the same draw.
if (deepRoster) assertSameSeeds({ before: priorRoster, after: restrict(deepRoster, priorRoster.seeds) });
if (deepClass) assertSameSeeds({ before: priorClass, after: restrict(deepClass, priorClass.seeds) });
if (deepTier) assertSameSeeds({ before: priorTier, after: restrict(deepTier, priorTier.seeds) });

const targets: TargetReading[] = [];
if (deepClass) targets.push(readTarget('`excavator` — ship-class contest (GDD §2.11)', 'class', 'excavator', classWins(deepClass)));
if (deepRoster) targets.push(readTarget('Warden — cast contest (GDD §3.8)', 'roster', 'warden', castCharacterWins(deepRoster)));
if (deepTier) targets.push(readTarget('Bolt — Easy pool, one hull (a0-121 §7.5)', 'tier', 'bolt', poolWins(deepTier, 'easy')));

const priorTargets: TargetReading[] = [
  readTarget('`excavator` — ship-class contest (GDD §2.11)', 'class', 'excavator', classWins(priorClass)),
  readTarget('Warden — cast contest (GDD §3.8)', 'roster', 'warden', castCharacterWins(priorRoster)),
  readTarget('Bolt — Easy pool, one hull (a0-121 §7.5)', 'tier', 'bolt', poolWins(priorTier, 'easy')),
];

const easyRows = (r: SectionRun): number => r.matches.filter((m) => m.lineup.startsWith('easy:')).length;
const easyDraws = (r: SectionRun): number => r.matches.filter((m) => m.lineup.startsWith('easy:') && m.ok && m.winner === null).length;

const warden = deepRoster ? castCharacterWins(deepRoster).find((w) => w.key === 'warden')! : null;

const fields: Record<string, string> = {
  VERDICT: deepRoster && deepClass && deepTier ? verdictTable(targets) : '_(deep run not yet filed)_',
  VERDICT_PRIOR: verdictTable(priorTargets),

  RUNS: table(
    ['section', 'lineup', 'seeds', 'rotations', 'matches', 'decided', 'draws', 'hangs', 'sim-timeouts'],
    ([
      ['`class`', priorClass, deepClass],
      ['`roster`', priorRoster, deepRoster],
      ['`tier`', priorTier, deepTier],
    ] as const)
      .flatMap(([name, p, d]) =>
        [
          [`${name} — a0-121`, p] as const,
          ...(d ? [[`${name} — **a0-126**`, d] as const] : []),
        ].map(([label, run]) => [
          label,
          run.label,
          `1…${run.seeds[run.seeds.length - 1]}`,
          String(run.rotations),
          String(run.matches.length),
          String(run.matches.filter((r) => r.ok && r.winner !== null).length),
          String(draws(run)),
          String(hangs(run)),
          String(simTimeouts(run)),
        ]),
      ),
  ),

  A0121_ROSTER_INTERVALS: intervalTable(castCharacterWins(priorRoster)),
  A0121_CLASS_INTERVALS: intervalTable(classWins(priorClass)),
  A0121_EASY_INTERVALS: intervalTable(poolWins(priorTier, 'easy')),
  A0121_CLUSTER: clusterBlock(priorRoster, 'warden'),
  A0121_ROTATION: rotationTable(priorRoster, 'warden'),
  A0121_SEATCUT: seatCutTable(priorRoster, 'warden'),
  SAMPLE: sampleTable(127 / 223, 223),

  DEEP_ROSTER: deepRoster ? deepVsPriorTable(castCharacterWins(deepRoster), castCharacterWins(priorRoster)) : '_(pending)_',
  DEEP_CLASS: deepClass ? deepVsPriorTable(classWins(deepClass), classWins(priorClass)) : '_(pending)_',
  DEEP_EASY: deepTier ? deepVsPriorTable(poolWins(deepTier, 'easy'), poolWins(priorTier, 'easy')) : '_(pending)_',
  DEEP_CLUSTER: deepRoster ? clusterBlock(deepRoster, 'warden') : '_(pending)_',
  DEEP_ROTATION: deepRoster ? rotationTable(deepRoster, 'warden') : '_(pending)_',
  DEEP_SEATCUT: deepRoster ? seatCutTable(deepRoster, 'warden') : '_(pending)_',

  LENGTH: lengthTable(
    ([
      ['ship-class contest', deepClass, priorClass],
      ['cast contest', deepRoster, priorRoster],
      ['equal-skill contests', deepTier, priorTier],
    ] as const)
      .filter(([, d]) => d !== null)
      .map(([label, d, p]) => [label, d as SectionRun, p] as const),
  ),

  EASY_DRAWS: deepTier
    ? `${easyDraws(deepTier)} of ${easyRows(deepTier)} (**${pct(easyDraws(deepTier) / easyRows(deepTier))}**), against a0-121's ${easyDraws(priorTier)} of ${easyRows(priorTier)} (${pct(easyDraws(priorTier) / easyRows(priorTier))})`
    : '_(pending)_',

  WARDEN_RATE: warden ? pct(warden.rate) : '—',
  WARDEN_WINS: warden ? `${warden.wins} / ${warden.decided}` : '—',
  WARDEN_IV: warden ? iv(warden) : '—',
  WARDEN_VERDICT: warden ? verdictOf(clopper(warden.wins, warden.decided).lo, clopper(warden.wins, warden.decided).hi) : '—',
  REPRO: has('evidence/a0-126-the-last-two-points/reproduce.txt')
    ? readFileSync(resolve(ROOT, 'evidence/a0-126-the-last-two-points/reproduce.txt'), 'utf8').trim()
    : '_(pending)_',
  SHARD_IDENTITY: has('evidence/a0-126-the-last-two-points/shard-identity.txt')
    ? readFileSync(resolve(ROOT, 'evidence/a0-126-the-last-two-points/shard-identity.txt'), 'utf8').trim()
    : '_(pending)_',
};

const tmpl = readFileSync(resolve(import.meta.dirname, 'report.md.tmpl'), 'utf8');
const missing: string[] = [];
const out = tmpl.replace(/\{\{(\w+)\}\}/g, (m, k: string) => {
  if (!(k in fields)) {
    missing.push(k);
    return m;
  }
  return fields[k]!;
});
if (missing.length) throw new Error(`render: template asks for fields this renderer does not compute: ${missing.join(', ')}`);
const dest = resolve(ROOT, 'tests/reports/a0-126-warden.md');
writeFileSync(dest, out);
console.log(`wrote ${dest} (${out.split('\n').length} lines)`);
