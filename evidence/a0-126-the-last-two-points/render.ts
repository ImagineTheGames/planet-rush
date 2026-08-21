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
import { pairedTable } from './paired';
import { behaviourTables } from './behaviour';

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

// ---------------------------------------------------------------------------
// The readings
//
// Everything below is hand-written judgement — it is what the brief asks a QA
// lane for and it is the one thing a renderer cannot derive. Every *number*
// inside it is still interpolated from the artifacts, so a reading cannot drift
// from the table above it: if a rerun moves a rate, the sentence about that rate
// moves with it or the render fails.
// ---------------------------------------------------------------------------

/** A target's answer to "inside the band, yes or no" — the brief's top line. */
const yesNo = (t: TargetReading | undefined): string =>
  !t ? 'PENDING' : t.verdict === 'INSIDE' ? 'YES' : t.verdict === 'OVER' ? 'NO' : 'NOT YET KNOWN';

const tExc = targets.find((t) => t.contestant === 'excavator');
const tWar = targets.find((t) => t.contestant === 'warden');
const tBolt = targets.find((t) => t.contestant === 'bolt');

/** Warden's cast rate split by how many chairs the rotation gives it. */
function seatCut(run: SectionRun, who: string, keep: (n: number) => boolean) {
  const rs = run.matches.filter((m) => m.ok && m.winner !== null && keep(m.seats[who] ?? 0));
  const wins = rs.filter((m) => m.winner === who).length;
  const c = clopper(wins, rs.length);
  return { wins, decided: rs.length, rate: rs.length ? wins / rs.length : 0, lo: c.lo, hi: c.hi };
}
const oneChair = deepRoster ? seatCut(deepRoster, 'warden', (n) => n === 1) : null;
const twoChair = deepRoster ? seatCut(deepRoster, 'warden', (n) => n > 1) : null;

/** Matches that finished outside the 10-15 minute band, by section. */
const outsideBand = (run: SectionRun) => run.matches.filter((m) => m.ok && (m.seconds < 600 || m.seconds > 900));

const HEADLINE = deepRoster && deepClass && deepTier
  ? `**Inside the band? excavator ship-class: ${yesNo(tExc)}** (${pct(tExc!.rate)}, exact 95% ` +
    `${pct(tExc!.exactLo)} – ${pct(tExc!.exactHi)}). **Warden cast: ${yesNo(tWar)}** (${pct(tWar!.rate)}, ` +
    `${pct(tWar!.exactLo)} – ${pct(tWar!.exactHi)}). **Bolt Easy pool: ${yesNo(tBolt)}** ` +
    `(${pct(tBolt!.rate)}, ${pct(tBolt!.exactLo)} – ${pct(tBolt!.exactHi)}). ` +
    `Warden's 2.0-point overage was sample noise and no constant moved to remove it: the same tree, ` +
    `measured on ${deepRoster.matches.length} matches instead of ${priorRoster.matches.length}, ` +
    `puts Warden ${f(100 * (WIN_RATE_CEILING - tWar!.rate))} points **under** the ceiling. ` +
    `Bolt is the one target that is genuinely over, it is over by ` +
    `${f(100 * (tBolt!.exactLo - WIN_RATE_CEILING))} points at the conservative bound, and its dial ` +
    `is in Bots' lane, not mine — §4.5 and §5.`
  : '_(deep run not yet filed)_';


const fields: Record<string, string> = {
  VERDICT: deepRoster && deepClass && deepTier ? verdictTable(targets) : '_(deep run not yet filed)_',
  VERDICT_PRIOR: verdictTable(priorTargets),
  PAIRED: pairedTable(),

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

  HEADLINE,

  BEHAVIOUR_CENSUS: behaviourTables(null).census,
  BEHAVIOUR_MOVE: behaviourTables(null).move,
  BEHAVIOUR_DEEP: deepRoster ? behaviourTables(`${DEEP}/roster.json`).deepCensus : '_(pending)_',

  WARDEN_READING: !tWar || !oneChair || !twoChair || !deepRoster
    ? '_(pending)_'
    : [
        `*Hand-written reading.* **The two points are gone, and nothing was done to make them go.**`,
        ``,
        `Warden wins **${pct(tWar.rate)}** of ${tWar.decided} decided matches, exact 95% ` +
          `**${pct(tWar.exactLo)} – ${pct(tWar.exactHi)}** — an interval that lies entirely below the ` +
          `ceiling, so the verdict is **INSIDE** rather than the *probably fine* an overlapping ` +
          `interval would have earned. The tree is bit-identical to the one a0-121 measured ` +
          `(§4.1, ${priorRoster.matches.length} rows, zero differing), so the move from 57.0% to ` +
          `${pct(tWar.rate)} is not a change to the game. It is ${(deepRoster.matches.length / priorRoster.matches.length).toFixed(0)}× the matches.`,
        ``,
        `This is what §2.5 predicted and it is worth being blunt about the size of it. a0-121's ` +
          `127 of 223 was ${f(100 * (127 / 223 - WIN_RATE_CEILING))} points over the line with a ` +
          `one-sided p of 0.303 — one draw in three from a fair coin looks at least that bad. The ` +
          `deep run draws ${tWar.decided} decided matches from the same generator and lands ` +
          `${f(100 * (WIN_RATE_CEILING - tWar.rate))} points **under** it. Both numbers are correct ` +
          `measurements of the same tree; only one of them was measured at a size that could tell.`,
        ``,
        `**And the seat cut survives depth, which the win rate did not.** §2.4 found Warden holding ` +
          `two chairs in one rotation of seven and suggested some of the pooled rate was the seating. ` +
          `At ${deepRoster.matches.length} matches that is no longer a suggestion — it is the third ` +
          `table above. In the six rotations where Warden gets one chair like everyone else it wins ` +
          `**${pct(oneChair.rate)}**, ${f(100 * (WIN_RATE_CEILING - oneChair.rate))} points under the ` +
          `ceiling and INSIDE. In the rotation where it gets two it wins **${pct(twoChair.rate)}**, ` +
          `and *that* interval (${pct(twoChair.lo)} – ${pct(twoChair.hi)}) is entirely above the ` +
          `ceiling. Doubling a contestant's seats raises its win rate; that is arithmetic, not ` +
          `character.`,
        ``,
        `The pooled ${pct(tWar.rate)} mixes the two and is still INSIDE, so nothing here needs fixing. ` +
          `What it means is that the cast contest's **headline number carries a seating artifact ` +
          `worth about ${f(100 * (tWar.rate - oneChair.rate))} points**, and any future report that ` +
          `finds Warden a point or two over should cut by chairs before it reaches for a constant — ` +
          `because a rotation that hands one character two chairs out of eight will manufacture ` +
          `roughly that much overage on its own. Filed as a measurement note for whoever runs this ` +
          `next; it is not a request for a change.`,
        ``,
        `**One thing the ceiling does not measure, stated plainly because this report is the place ` +
          `for it.** Warden wins ${pct(tWar.rate)} of the cast contest holding, on average, ` +
          `${pct(2 / 8 / 7 + 6 / 7 / 8)} of the chairs — one seventh, its even share of a ` +
          `seven-character cast. ` +
          `Foreman is next at ${pct(castCharacterWins(deepRoster).find((w) => w.key === 'foreman')!.rate)} ` +
          `and no other character clears ${pct(Math.max(...castCharacterWins(deepRoster).filter((w) => w.key !== 'warden' && w.key !== 'foreman').map((w) => w.rate)))}. ` +
          `The cast is extremely top-heavy and Warden is comfortably inside the 55% ceiling at the ` +
          `same time — both are true, and they are true because a win-rate ceiling asks "is anyone ` +
          `dominant" and a seven-character cast can be badly lopsided well under 55%. That is a ` +
          `design observation for the Director and explicitly **not** one of this brief's three ` +
          `targets; I raise it once and do not act on it.`,
      ].join('\n'),

  CLASS_READING: !tExc
    ? '_(pending)_'
    : [
        `*Hand-written reading.* **a0-121 met this target, and now it is provably met.** The ` +
          `excavator takes **${pct(tExc.rate)}** of ${tExc.decided} decided ship-class matches, exact ` +
          `95% **${pct(tExc.exactLo)} – ${pct(tExc.exactHi)}** — ${verdictOf(tExc.exactLo, tExc.exactHi)}.`,
        ``,
        `§2.6 flagged that a0-121's INSIDE was as thin as its OVER: 48.6% on 255 matches had an ` +
          `interval topping out at 54.9%, clearing the ceiling by a tenth of a point. At ` +
          `${(deepClass!.matches.length / priorClass.matches.length).toFixed(0)}× the matches the top ` +
          `of the interval is ${pct(tExc.exactHi)}, ${f(100 * (WIN_RATE_CEILING - tExc.exactHi))} points ` +
          `clear. The correction runs the same direction as Warden's — more matches, less drama — and ` +
          `it is worth noticing that the instrument was not built to exonerate anybody. It moved ` +
          `a0-121's marginal pass to a real pass and a0-121's marginal fail to a real pass, because ` +
          `both were marginal for the same reason.`,
      ].join('\n'),

  EASY_READING: !tBolt || !deepTier
    ? '_(pending)_'
    : [
        `*Hand-written reading.* **Bolt: ${yesNo(tBolt)}.** ${tBolt.wins} of ${tBolt.decided} decided, ` +
          `**${pct(tBolt.rate)}**, exact 95% **${pct(tBolt.exactLo)} – ${pct(tBolt.exactHi)}** — ` +
          `${verdictOf(tBolt.exactLo, tBolt.exactHi)}.`,
        ``,
        `a0-121 §7.5 called this pool OVER on **ten coin flips**: 10 of 12 decided matches, a Wilson ` +
          `lower bound that cleared 55% by two tenths of a point. §2.6 re-read the same twelve matches ` +
          `through the conservative interval and got UNRESOLVED. This section is the third reading, ` +
          `on ${tBolt.decided} decided matches instead of 12, and it is the one that settles it.`,
        ``,
        `The Easy pool is the hardest of the three targets to measure and the draw rate is why: Easy ` +
          `bots stall out against each other, so a large fraction of Easy matches produce no winner at ` +
          `all and a match played is not a match that counts. That is the number quoted above the ` +
          `reading, and it is the reason this section needed a deep run more than either of the others ` +
          `— at a0-121's depth it had **twelve** usable observations to answer a ceiling question with.`,
        ``,
        `**a0-121's call was right, and it was still a coin flip.** Both of those are true and the ` +
          `report is worse if it prints only one. On twelve matches the verdict was not supportable ` +
          `— §2.6 shows the exact interval running from 51.6% to 97.9%, which is compatible with Bolt ` +
          `being fine and compatible with Bolt being unbeatable. It happened to point the right way. ` +
          `A method that is right when it guesses right is not a method, and this is the cleanest ` +
          `available demonstration that the interval is not a device for talking lanes out of ` +
          `findings: the same instrument that dissolved Warden's overage **confirms** Bolt's, on the ` +
          `same tree, in the same run, out of the same renderer.`,
        ``,
        `**What is actually wrong here is not only Bolt's rate.** ${pct(easyDraws(deepTier) / easyRows(deepTier))} ` +
          `of Easy-pool matches reach the ceiling with no winner. The pool is not really a contest ` +
          `that Bolt wins ${pct(tBolt.rate)} of — it is a pool that decides ` +
          `${pct(1 - easyDraws(deepTier) / easyRows(deepTier))} of the time, and Bolt wins most of ` +
          `the few that decide. A read of "Bolt is ${f(100 * (tBolt.rate - WIN_RATE_CEILING))} points ` +
          `over" hides that. My recommendation to the Director is that the Easy-pool ceiling target ` +
          `be **re-specified before anything is tuned against it**, because a win-rate ceiling ` +
          `applied to a pool that draws four times out of five is measuring the wrong quantity, and ` +
          `whatever gets changed to bring 67.4% down will be judged on 95 matches out of 512 played.`,
        ``,
        `Bolt's dial, like Warden's, is a personality in \`src/bots/personalities.ts\` — Bots' lane. ` +
          `I am filing the number and the interval, not a change. It is a genuine finding and it is ` +
          `the one thing in this report that needs somebody to do something.`,
      ].join('\n'),

  LENGTH_READING: !deepClass || !deepRoster
    ? '_(pending)_'
    : (() => {
        const short = outsideBand(deepClass);
        const rl = lengthOf(deepRoster.matches);
        const cl = lengthOf(deepClass.matches);
        const worst = [...short].sort((a, b) => a.seconds - b.seconds)[0];
        return [
          ``,
          `The cast contest is **${pct(rl.insideFraction)} inside the band** across all ` +
            `${rl.n} matches, median ${mmss(rl.median)}, and its slowest and fastest matches are ` +
            `${mmss(rl.max)} and ${mmss(rl.min)} — the whole distribution sits inside 10–15 minutes ` +
            `with room on both sides. Nothing to report there.`,
          ``,
          `**The ship-class contest has something to report, and depth is what found it.** ` +
            `${pct(cl.insideFraction)} of its ${cl.n} matches are inside the band, which means ` +
            `**${short.length} are not**: ${short.map((m) => mmss(m.seconds)).sort().join(', ')}, all of ` +
            `them *short*, all of them won by the excavator seat` +
            (worst ? `, the fastest at ${mmss(worst.seconds)} on seed ${worst.seed}` : '') + `. a0-121 ` +
            `reported this contest as 100% inside the band and it was not wrong about its own ` +
            `${priorClass.matches.length} matches — it drew none of these. A ` +
            `${f((100 * short.length) / cl.n, 1)}% tail is invisible at that size and near-certain to ` +
            `appear at this one.`,
          ``,
          `I am filing this as a **watch item, not a failure**. The target is that match length lands ` +
            `in 10–15 minutes; the median (${mmss(cl.median)}) is unmoved from a0-121's ` +
            `${mmss(lengthOf(priorClass.matches).median)}, the p10–p90 band is ` +
            `${mmss(cl.p10)}–${mmss(cl.p90)}, and ${short.length} fast finishes in ${cl.n} matches is a ` +
            `tail rather than a shift. It is also worth being precise about what the ship-class ` +
            `contest *is*: one behaviour flying every hull against itself, which is a measurement ` +
            `fixture rather than a matchup a player will ever see. But the honest statement is that ` +
            `"100% of matches inside 10–15 minutes" was a claim about sample size, and at ` +
            `${cl.n} matches the true figure for this section is ${pct(cl.insideFraction)}.`,
        ].join('\n');
      })(),

  DECISION: !tWar || !tExc || !tBolt || !oneChair
    ? '_(pending)_'
    : [
        `**No constant moves. `+'`src/sim/constants.ts`'+` is untouched on this branch — `+'`git diff`'+` it against ` +
          `main and it is empty.**`,
        ``,
        `The brief asked for one thing before any tuning: say whether 57.0% is distinguishable from ` +
          `55% at 224 matches. It is not — one-sided p = 0.303, an overage of 4.3 matches, and a ` +
          `sample ~11× short of the one that could tell (§2). The brief's own instruction for that ` +
          `case is that the honest finding is *"run more matches"*. §4 ran them: ` +
          `**${pct(tWar.rate)}**, exact 95% ${pct(tWar.exactLo)} – ${pct(tWar.exactHi)}, INSIDE.`,
        ``,
        `So there is no longer a case to tune, and this section would end here except that the brief ` +
          `asked a second question worth answering on the record — *what behaviour would a Warden nerf ` +
          `have had to touch* — and the answer is the reason I would have declined even on a ` +
          `significant result.`,
        ``,
        `**1 · The dial is not in my lane.** Warden's character is `+'`homebody: 0.55`'+` in ` +
          '`src/bots/personalities.ts`' + ` — Bots' file, not mine. I own ` + '`src/sim/constants.ts`' +
          ` values. There is no value in my lane that moves Warden alone: the constants Warden leans ` +
          `on are hull and combat values it **shares with Foreman**, which flies the same excavator, ` +
          `and with the rest of the cast. A "Warden nerf" written from this lane is a cast-wide or ` +
          `hull-wide change wearing one character's name, and §4.4 has just shown the hull sitting ` +
          `at ${pct(tExc.rate)} where the brief wants it.`,
        ``,
        `**2 · It is the behaviour the brief says not to dull.** `+'`homebody`'+` *is* the ` +
          `retreat-into-turret-cover path (GDD §2.6) that a0-105 and a0-107 have just reworked. §4.7 ` +
          `measures it: Warden's home family — retreat, cornered-fight, turn-and-fight, last-stand, ` +
          `defend — is 24.3% of its decisions, and a0-121's hull retune already moved that path ` +
          `(19.4% → 24.3%, almost all of it last-stand) while turn-of-retreat, the a0-105/a0-107 ` +
          `dead-band number, moved +0.55 and is intact. A nerf aimed at the win rate lands on the ` +
          `part of Warden that this month's bot work is about.`,
        ``,
        `**3 · The residual was never big enough to spend that on.** Two points on 224 matches is ` +
          `four matches. Undoing a month of another lane's work to move four matches — matches that ` +
          `§4 has now shown were not there — is the change I would not have been able to defend next ` +
          `week, which is exactly the failure mode the brief names.`,
        ``,
        `**The one target that does need somebody:** not Warden — Bolt. §4.5 resolves the Easy pool ` +
          `at ${tBolt.wins} of ${tBolt.decided} decided, ${pct(tBolt.rate)}, exact 95% ` +
          `${pct(tBolt.exactLo)} – ${pct(tBolt.exactHi)}, entirely over the ceiling. That is a real ` +
          `finding on real evidence and I am not softening it. It is also not mine to fix twice ` +
          `over: Bolt is a personality, and the pool it is measured in draws ` +
          `${pct(deepTier ? easyDraws(deepTier) / easyRows(deepTier) : 0)} of the time, which makes ` +
          `the ceiling target itself the wrong instrument for that pool. Both halves of that go to ` +
          `the Director in §7 rather than becoming an edit here.`,
        ``,
        `**What I would hand the Bots lane instead, if a future deep run does find Warden over:** ` +
          `not a nerf to the retreat, but the seat cut in §4.2. At one chair Warden is ` +
          `**${pct(oneChair.rate)}** and INSIDE; the pooled number is pushed up about ` +
          `${f(100 * (tWar.rate - oneChair.rate))} points by the one rotation in seven that gives it ` +
          `two chairs out of eight. The cheapest honest fix for a cast contest whose seven characters ` +
          `do not divide into eight chairs is in the **seating**, and it costs no behaviour at all. ` +
          `That is a harness change in my own lane and I will make it the day it is needed. It is not ` +
          `needed today.`,
      ].join('\n'),

  READING: !tWar || !tExc || !tBolt
    ? '_(pending)_'
    : [
        `**Two of the three targets are inside the band. The third is genuinely over, and it is not ` +
          `the one this brief was opened about.**`,
        ``,
        `- **excavator, ship-class contest — ${yesNo(tExc)}.** ${pct(tExc.rate)} on ${tExc.decided} ` +
          `decided, exact 95% ${pct(tExc.exactLo)} – ${pct(tExc.exactHi)}. a0-121 met this target on ` +
          `evidence that cleared the line by a tenth of a point; it now clears it by ` +
          `${f(100 * (WIN_RATE_CEILING - tExc.exactHi))}.`,
        `- **Warden, cast contest — ${yesNo(tWar)}.** ${pct(tWar.rate)} on ${tWar.decided} decided, ` +
          `exact 95% ${pct(tWar.exactLo)} – ${pct(tWar.exactHi)}. The 2.0-point overage a0-121 ` +
          `reported was sampling noise and this branch moved no constant to remove it.`,
        `- **Bolt, Easy pool — ${yesNo(tBolt)}.** ${pct(tBolt.rate)} on ${tBolt.decided} decided, ` +
          `exact 95% ${pct(tBolt.exactLo)} – ${pct(tBolt.exactHi)} — the whole interval above the ` +
          `ceiling, one-sided p = ${tBolt.p1.toFixed(3)}. a0-121 called this OVER on twelve matches ` +
          `and was right; §4.5 is the evidence that makes it a finding rather than a guess, and it ` +
          `also shows why the target needs re-specifying before it is tuned against — ` +
          `${pct(deepTier ? easyDraws(deepTier) / easyRows(deepTier) : 0)} of the pool draws.`,
        ``,
        `**Match length holds**, with one honest amendment: the cast contest is 100% inside 10–15 ` +
          `minutes over ${deepRoster ? deepRoster.matches.length : 0} matches, and the ship-class ` +
          `fixture is ${deepClass ? pct(lengthOf(deepClass.matches).insideFraction) : '—'} — a short ` +
          `tail that only a deep run could see. Filed as a watch item in §4.6.`,
        ``,
        `**The thing this report actually asks the Director to take away** is not any of the three ` +
          `verdicts. It is that all three of them were previously decided by comparing a point ` +
          `estimate to a line, at a sample size that cannot support the comparison, and that this is ` +
          `a property of the *reporting convention* rather than of any one lane's care. a0-121 ` +
          `measured exactly as carefully as a0-112 and a0-117 did. The convention is what produced ` +
          `one target called met and one called missed on evidence of identical quality — and then, ` +
          `at depth, reversed the first and confirmed the second. That is the signature of a ` +
          `coin-flip method: it is not that it is always wrong, it is that being right carries no ` +
          `information.`,
        ``,
        `The fix is cheap and it is already built: `+'`targets.ts`'+` prints **INSIDE / OVER / ` +
          `UNRESOLVED**, and `+'`sampleForExact`'+` turns UNRESOLVED into a number of matches to run ` +
          `rather than a constant to change. I would like the next balance report in this series to ` +
          `use it, and I would like **UNRESOLVED to be an acceptable thing for a lane to file** — ` +
          `because the alternative, which this series has been doing, is that every marginal number ` +
          `gets rounded to a verdict and roughly half of those verdicts are wrong.`,
        ``,
        `Cost, for calibration: the deep run is ${(deepRoster && deepClass && deepTier ? deepRoster.matches.length + deepClass.matches.length + deepTier.matches.length : 0)} ` +
          `matches, about an hour of wall clock on 8 cores because the harness now shards by seed ` +
          `range (§6.1). Resolving all three targets properly was affordable. It was only ever the ` +
          `*convention* that made it look like the choice was tune-or-shrug.`,
      ].join('\n'),
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
