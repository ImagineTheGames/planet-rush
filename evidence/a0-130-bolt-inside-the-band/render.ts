/**
 * evidence/a0-130-bolt-inside-the-band/render.ts — the tables in
 * `tests/reports/a0-130-bolt.md`. OWNER: Bot Engineer (brief a0-130).
 *
 *   npx vite-node evidence/a0-130-bolt-inside-the-band/render.ts
 *
 * It computes no rate of its own. Every win rate, fair share, draw count and
 * match length comes from `harness/mirrors`' and `harness/tuning`'s helpers, so
 * a number here is read exactly the way `a0-112-balance.md`, `a0-121-excavator.md`
 * and `a0-126-warden.md` read theirs; the interval and the three-state verdict
 * come from a0-126's `stats.ts`, imported rather than re-derived.
 *
 * **Every before/after pair is the same seeds**, and that is a construction
 * rather than a promise: the screening arms ran seeds `1…256` and the deep arms
 * `1…4096`, which contain them, so a screen is lifted back out of its own deep
 * run rather than transcribed beside it. `./reproduce.ts` checks all of it row
 * for row and `assertSameSeeds` is called again here, so a pair that is not the
 * same draw throws instead of being printed.
 *
 * The only hand-written things in the report are the readings, and they are
 * marked as such.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WIN_RATE_CEILING, lengthOf, mmss, pct } from '../../harness/mirrors';
import type { SectionRun, Win } from '../../harness/mirrors';
import { assertSameSeeds, castCharacterWins, classWins, draws, hangs, poolWins, simTimeouts } from '../../harness/tuning';
import { clopper, sampleForExact } from '../a0-126-the-last-two-points/stats';
import { armTable, clusteringOf, load, readArm, verdictOf } from './arms';
import type { ArmReading } from './arms';

const ROOT = resolve(import.meta.dirname, '../..');
const DEEP = 'tests/reports/a0-130-data';
const A0126 = 'tests/reports/a0-126-data/deep-shipped';

const must = (dir: string, section = 'tier'): SectionRun => {
  const run = load(dir, section);
  if (!run) throw new Error(`render: missing artifact ${dir}/${section}.json — run it before rendering`);
  return run;
};

function table(head: readonly string[], rows: readonly (readonly string[])[]): string {
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

const iv = (wins: number, n: number): string => {
  const c = clopper(wins, n);
  return `${pct(c.lo)} – ${pct(c.hi)}`;
};
const vdOf = (wins: number, n: number): string => {
  const c = clopper(wins, n);
  const v = verdictOf(c.lo, c.hi);
  return v === 'INSIDE' ? 'INSIDE' : `**${v}**`;
};

// ---------------------------------------------------------------------------
// The arms
// ---------------------------------------------------------------------------

/** Every arm this brief ran, in the order the report argues them. `dir` is the
 *  artifact; `what` is the one-line statement of what was moved and nothing
 *  else, so the table is a record of the experiment rather than a summary of it. */
const SCREEN: readonly { label: string; dir: string; what: string }[] = [
  { label: '`shipped`', dir: A0126, what: 'the cast as it stands — a0-126 §4.5’s own artifact' },
  { label: '`d-bolt-attack`', dir: `${DEEP}/d-bolt-attack`, what: 'Bolt’s attack weight 0.65 → **0.35**, i.e. under `EASY_ATTACK_WEIGHT`' },
  { label: '`d-bolt-caution-0.9`', dir: `${DEEP}/d-bolt-caution-0.9`, what: 'Bolt’s `caution` 0.5 → **0.9**' },
  { label: '`d-bolt-caution`', dir: `${DEEP}/d-bolt-caution`, what: 'Bolt’s `caution` 0.5 → **1.3**, i.e. Rusty’s' },
  { label: '`d-bolt-homebody`', dir: `${DEEP}/d-bolt-homebody`, what: 'Bolt’s `homebody` 0.1 → **0.8**, i.e. Rusty’s' },
  { label: '`d-bolt-aimscale`', dir: `${DEEP}/d-bolt-aimscale`, what: 'Bolt’s `aimScale` 1.25 → **1.0**: the hip-fire spray taken off' },
  { label: '`d-rusty-attack`', dir: `${DEEP}/d-rusty-attack`, what: 'Rusty’s attack weight 0.1 → **0.65**, i.e. Bolt’s — the other seat gets a gun' },
  { label: '`d-easy-patience`', dir: `${DEEP}/d-easy-patience`, what: 'Easy’s `standoffPatienceSeconds` 3 → **1.2**, i.e. Hard’s — a0-105/a0-107’s dial' },
  { label: '`d-easy-norepair`', dir: `${DEEP}/d-easy-norepair`, what: '`EASY_REPAIR_AT` 0.6 → **0**: no Easy bot ever patches its reactor' },
  { label: '`d-easy-retreat-0.2`', dir: `${DEEP}/d-easy-retreat-0.2`, what: 'Easy’s `retreatHullFraction` 0.5 → **0.2**, i.e. Hard’s — the whole tier braver' },
  { label: '`d-easy-retreat-0.8`', dir: `${DEEP}/d-easy-retreat-0.8`, what: 'Easy’s `retreatHullFraction` 0.5 → **0.8** — the whole tier more timid' },
  { label: '`c-endgame`', dir: `${DEEP}/c-endgame`, what: 'the Easy tier gets a collapse branch (commit `7ca2d7f1`)' },
  { label: '`d-noflee-only`', dir: `${DEEP}/d-noflee-only`, what: 'the retreat switched off during collapse, and nothing else' },
  { label: '`c-endgame-noflee`', dir: `${DEEP}/c-endgame-noflee`, what: 'both of the above at once' },
];

const screenArms: ArmReading[] = SCREEN.map((s) => readArm(s.label, must(s.dir), 'easy'));

/** The screens are all the same 256 seeds — the property every comparison below
 *  rests on, asserted rather than assumed. */
for (const arm of screenArms.slice(1)) {
  assertSameSeeds({
    before: { ...must(A0126), matches: [] },
    after: { ...must(SCREEN.find((s) => s.label === arm.label)!.dir), matches: [], seeds: arm.seeds.slice(0, 256) },
  });
}

const armWhat = table(
  ['arm', 'what moved, and nothing else'],
  SCREEN.map((s) => [s.label, s.what]),
);

// ---------------------------------------------------------------------------
// The deep arms
// ---------------------------------------------------------------------------

const deepShipped = readArm('`deep-shipped`', must(`${DEEP}/deep-shipped`), 'easy');
const deepCaution = readArm('`deep-bolt-caution`', must(`${DEEP}/deep-bolt-caution`), 'easy');
const deepEndgame = readArm('`deep-endgame`', must(`${DEEP}/deep-endgame`), 'easy');

/** A deep arm beside the 256-seed screen it contains. The screen column is not
 *  transcribed — it is the same artifact, restricted, which is why the two can
 *  be printed side by side at all. */
function depthTable(screen: ArmReading, deep: ArmReading): string {
  return table(
    ['contestant', `screen · ${screen.seeds.length} seeds`, `deep · ${deep.seeds.length} seeds`, 'move', 'exact 95% (deep)', 'width before', 'width after', 'verdict (deep)'],
    ['bolt', 'rusty'].map((who) => {
      const s = readArm(screen.label, must(screenDirOf(screen)), 'easy', who);
      const d = readArm(deep.label, must(deepDirOf(deep)), 'easy', who);
      const wBefore = 100 * (clopper(s.wins, s.decided).hi - clopper(s.wins, s.decided).lo);
      const wAfter = 100 * (clopper(d.wins, d.decided).hi - clopper(d.wins, d.decided).lo);
      return [
        who,
        `${s.wins} / ${s.decided} (**${pct(s.rate)}**)`,
        `${d.wins} / ${d.decided} (**${pct(d.rate)}**)`,
        `${d.rate - s.rate >= 0 ? '+' : ''}${(100 * (d.rate - s.rate)).toFixed(1)} pts`,
        iv(d.wins, d.decided),
        `${wBefore.toFixed(1)} pts`,
        `${wAfter.toFixed(1)} pts`,
        vdOf(d.wins, d.decided),
      ];
    }),
  );
}
function screenDirOf(a: ArmReading): string {
  return SCREEN.find((s) => s.label === a.label)!.dir;
}
const DEEP_DIRS: Readonly<Record<string, string>> = {
  '`deep-shipped`': `${DEEP}/deep-shipped`,
  '`deep-bolt-caution`': `${DEEP}/deep-bolt-caution`,
  '`deep-endgame`': `${DEEP}/deep-endgame`,
};
function deepDirOf(a: ArmReading): string {
  return DEEP_DIRS[a.label]!;
}

// ---------------------------------------------------------------------------
// The other two targets — this branch ships main's tree, so they must be intact
// ---------------------------------------------------------------------------

const roster = must(`${DEEP}/verify-roster`, 'roster');
const cls = must(`${DEEP}/verify-class`, 'class');
const a0126Roster = must(A0126, 'roster');
const a0126Class = must(A0126, 'class');

const targetRow = (target: string, w: Win | undefined, n: number): readonly string[] => {
  const wins = w?.wins ?? 0;
  const dec = w?.decided ?? n;
  const c = clopper(wins, dec);
  return [target, `\`${w?.key ?? '—'}\``, `${wins} / ${dec}`, `**${pct(wins / Math.max(dec, 1))}**`, `${pct(c.lo)} – ${pct(c.hi)}`, vdOf(wins, dec)];
};

const wardenDeep = castCharacterWins(a0126Roster).find((x) => x.key === 'warden')!;
const excavatorDeep = classWins(a0126Class).find((x) => x.key === 'excavator')!;
const boltDeep = poolWins(must(`${DEEP}/deep-shipped`), 'easy').find((x) => x.key === 'bolt')!;

const verdictTable3 = table(
  ['target', 'contestant', 'wins / decided', 'rate', 'exact 95% confidence interval — the verdict', 'verdict'],
  [
    targetRow('`excavator` — ship-class contest (GDD §2.11)', excavatorDeep, excavatorDeep.decided),
    targetRow('Warden — cast contest (GDD §3.8)', wardenDeep, wardenDeep.decided),
    targetRow('Bolt — Easy pool, one hull (a0-121 §7.5)', boltDeep, boltDeep.decided),
  ],
);

// ---------------------------------------------------------------------------
// What ran
// ---------------------------------------------------------------------------

const runRow = (label: string, run: SectionRun, pool?: string): readonly string[] => {
  const rows = pool ? run.matches.filter((r) => r.lineup.startsWith(`${pool}:`)) : [...run.matches];
  const sub: SectionRun = { ...run, matches: rows };
  const dec = rows.filter((r) => r.ok && r.winner !== null).length;
  return [
    label,
    `${run.seeds[0]}…${run.seeds[run.seeds.length - 1]}`,
    String(rows.length),
    String(dec),
    String(draws(sub)),
    String(hangs(sub)),
    String(simTimeouts(sub)),
  ];
};

const runs = table(
  ['run', 'seeds', 'matches', 'decided', 'draws', 'hangs', 'sim-timeouts'],
  [
    runRow('`shipped` — Easy pool (a0-126 §4.5’s artifact)', must(A0126), 'easy'),
    ...SCREEN.slice(1).map((s) => runRow(`${s.label} — Easy pool`, must(s.dir), 'easy')),
    runRow('**`deep-shipped`** — Easy pool', must(`${DEEP}/deep-shipped`), 'easy'),
    runRow('**`deep-bolt-caution`** — Easy pool', must(`${DEEP}/deep-bolt-caution`), 'easy'),
    runRow('**`deep-endgame`** — Easy pool', must(`${DEEP}/deep-endgame`), 'easy'),
    runRow('`verify-roster` — the shipped cast, 7 rotations', roster),
    runRow('`verify-class` — ship-class contest, 4 rotations', cls),
  ],
);

// ---------------------------------------------------------------------------
// The three pools side by side — the decide rate is the story
// ---------------------------------------------------------------------------

const a0126Tier = must(A0126);
const poolTable = table(
  ['pool', 'contestants', 'matches', 'decided', 'draw rate', 'has a collapse branch?', 'top of the pool', 'exact 95%'],
  ['easy', 'medium', 'hard'].map((pool) => {
    const rows = a0126Tier.matches.filter((r) => r.lineup.startsWith(`${pool}:`));
    const dec = rows.filter((r) => r.ok && r.winner !== null).length;
    const wins = poolWins({ ...a0126Tier, matches: rows }, pool);
    const top = [...wins].sort((a, b) => b.rate - a.rate)[0]!;
    return [
      `\`${pool}\``,
      String(wins.length),
      String(rows.length),
      String(dec),
      `**${pct(rows.length ? 1 - dec / rows.length : 0)}**`,
      pool === 'easy' ? '**no**' : 'yes — `hunt`',
      `\`${top.key}\` ${pct(top.rate)}`,
      iv(top.wins, top.decided),
    ];
  }),
);

// ---------------------------------------------------------------------------
// Length, on every arm that could have traded it away
// ---------------------------------------------------------------------------

const lengthTable = table(
  ['run', 'matches', 'median', 'p10', 'p90', 'min', 'max', 'inside 10–15'],
  [
    ...[deepShipped, deepCaution, deepEndgame].map((a) => {
      const l = lengthOf(a.rows);
      return [a.label, String(l.n), mmss(l.median), mmss(l.p10), mmss(l.p90), mmss(l.min), mmss(l.max), pct(l.insideFraction)];
    }),
    ...[
      ['`verify-roster` — the shipped cast', roster],
      ['`verify-class` — ship-class contest', cls],
    ].map(([label, run]) => {
      const l = lengthOf((run as SectionRun).matches);
      return [label as string, String(l.n), mmss(l.median), mmss(l.p10), mmss(l.p90), mmss(l.min), mmss(l.max), pct(l.insideFraction)];
    }),
  ],
);

// ---------------------------------------------------------------------------
// The leaf census — what each Easy character spends its match doing
// ---------------------------------------------------------------------------

const LEAVES = ['potshot', 'hunt', 'mine', 'haul', 'spend', 'defend', 'retreat', 'turn-and-fight', 'cornered-fight', 'fix-base', 'scavenge', 'roam', 'dead'];
const census = (run: SectionRun): string =>
  table(
    ['character', ...LEAVES.map((l) => `\`${l}\``), 'deaths / seat-match'],
    ['rusty', 'bolt'].map((who) => {
      const by = run.leavesBy[who] ?? {};
      const n = run.decisionsBy[who] ?? 1;
      const seatMatches = run.seatMatchesBy[who] ?? 1;
      return [
        `**${who}**`,
        ...LEAVES.map((l) => pct((by[l] ?? 0) / n)),
        ((run.deathsBy[who] ?? 0) / seatMatches).toFixed(1),
      ];
    }),
  );

// ---------------------------------------------------------------------------

/** A committed transcript, read back into the report. These are outputs of the
 *  scripts beside this one and are never hand-edited; the renderer throws rather
 *  than print a section whose evidence block is missing. */
function transcript(name: string): string {
  const p = resolve(import.meta.dirname, name);
  try {
    return readFileSync(p, 'utf8').trimEnd();
  } catch {
    throw new Error(`render: missing transcript ${name} — generate it before rendering`);
  }
}

const autopsyTxt = transcript('autopsy.txt');
const marginMatch = autopsyTxt.match(/decided: median ([\d.]+% of a core)/);
if (!marginMatch) throw new Error('render: autopsy.txt does not carry the decided-match margin');

const boltNeeded = sampleForExact(deepShipped.rate, WIN_RATE_CEILING);

/**
 * Decided matches needed to prove a rate **INSIDE** the ceiling — the mirror of
 * a0-126's `sampleForExact`, which only answers the OVER direction.
 *
 * It is needed because this brief's most important UNRESOLVED verdict points the
 * other way: an arm whose point estimate sits *under* 55% has not been shown to
 * be inside it, and "how many more matches would settle that" is the only useful
 * thing to say about such an arm. Same construction as theirs — walk n until the
 * exact interval at this rate clears the line — and the same cap, so a rate on
 * the line does not search forever.
 */
function sampleForInside(p: number, ceiling = WIN_RATE_CEILING, cap = 200_000): number {
  if (p >= ceiling) return Infinity;
  for (let n = 8; n <= cap; n = Math.ceil(n * 1.08) + 1) {
    if (clopper(Math.round(p * n), n).hi <= ceiling) return n;
  }
  return Infinity;
}
const cautionTop = deepCaution;

const fields: Record<string, string> = {
  HEADLINE:
    `**Inside the band? excavator ship-class: YES** (${pct(excavatorDeep.rate)}, exact 95% ${iv(excavatorDeep.wins, excavatorDeep.decided)}). ` +
    `**Warden cast: YES** (${pct(wardenDeep.rate)}, ${iv(wardenDeep.wins, wardenDeep.decided)}). ` +
    `**Bolt Easy pool: NO** (${pct(deepShipped.rate)}, ${iv(deepShipped.wins, deepShipped.decided)}, on ${deepShipped.decided} decided matches against a0-126's 95). ` +
    `Bolt is over, and **no dial on Bolt is the reason**: the Easy pool never destroys a reactor in play, so its winner is whichever seat holds the highest one when the field closes, by a median of {{MARGIN}}. ` +
    `Arming the other seat leaves Bolt where it was (${pct(readArm('x', must(`${DEEP}/d-rusty-attack`), 'easy').rate)}); giving the tier the endgame it lacks takes Bolt to ${pct(deepEndgame.rate)}; and the one dial that does move it — \`caution\` — is the dial that *is* Bolt, and turning it all the way hands the overage to Rusty rather than removing it. §2, §5.2 and §8.`,
  BOLT_RATE: pct(deepShipped.rate),
  BOLT_IV: iv(deepShipped.wins, deepShipped.decided),
  BOLT_DECIDED: String(deepShipped.decided),
  BOLT_MATCHES: String(deepShipped.matches),
  BOLT_DRAWS: pct(deepShipped.drawRate),
  UNRESOLVED_COUNT: (() => {
    const n = screenArms.filter((a) => a.decided > 0 && a.verdict === 'UNRESOLVED').length;
    return ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'][n] ?? String(n);
  })(),
  BOLT_OVER: (100 * (deepShipped.rate - WIN_RATE_CEILING)).toFixed(1),
  BOLT_CLUSTERS: String(new Set(deepShipped.rows.filter((r) => r.ok && r.winner !== null).map((r) => r.seed)).size),
  BOLT_DEATHS: ((must(`${DEEP}/deep-shipped`).deathsBy['bolt'] ?? 0) / (must(`${DEEP}/deep-shipped`).seatMatchesBy['bolt'] ?? 1)).toFixed(1),
  RUSTY_DEATHS: ((must(`${DEEP}/deep-shipped`).deathsBy['rusty'] ?? 0) / (must(`${DEEP}/deep-shipped`).seatMatchesBy['rusty'] ?? 1)).toFixed(1),
  BOLT_WIDTH: (100 * (clopper(deepShipped.wins, deepShipped.decided).hi - clopper(deepShipped.wins, deepShipped.decided).lo)).toFixed(1),
  BOLT_MOVE: (100 * (deepShipped.rate - screenArms[0]!.rate)).toFixed(1),
  BOLT_NEEDED: Number.isFinite(boltNeeded) ? String(boltNeeded) : 'more than the search cap',
  WARDEN_RATE: pct(wardenDeep.rate),
  WARDEN_IV: iv(wardenDeep.wins, wardenDeep.decided),
  EXCAVATOR_RATE: pct(excavatorDeep.rate),
  EXCAVATOR_IV: iv(excavatorDeep.wins, excavatorDeep.decided),
  ENDGAME_RATE: pct(deepEndgame.rate),
  ENDGAME_IV: iv(deepEndgame.wins, deepEndgame.decided),
  ENDGAME_DRAWS: pct(deepEndgame.drawRate),
  CAUTION_TOP: `\`${cautionTop.contestant}\``,
  CAUTION_RATE: pct(cautionTop.rate),
  CAUTION_IV: iv(cautionTop.wins, cautionTop.decided),
  CAUTION_VERDICT: cautionTop.verdict,
  CAUTION_DECIDED: String(cautionTop.decided),
  CAUTION_NEEDED: (() => {
    const n = sampleForInside(cautionTop.rate);
    if (!Number.isFinite(n)) return 'no sample size at all — its estimate is not under the ceiling';
    const matches = Math.ceil(n / Math.max(1 - cautionTop.drawRate, 1e-9));
    return `**${n} decided matches** — ${(n / Math.max(cautionTop.decided, 1)).toFixed(1)}× this arm, and at its ${pct(cautionTop.drawRate)} draw rate that is **${matches} matches to run**`;
  })(),
  VERDICT: verdictTable3,
  RUNS: runs,
  ARM_WHAT: armWhat,
  SCREEN_TABLE: armTable(screenArms),
  POOLS: poolTable,
  DEEP_SHIPPED: depthTable(screenArms[0]!, deepShipped),
  DEEP_CAUTION: depthTable(screenArms.find((a) => a.label === '`d-bolt-caution`')!, deepCaution),
  DEEP_ENDGAME: depthTable(screenArms.find((a) => a.label === '`c-endgame`')!, deepEndgame),
  DEEP_TABLE: armTable([deepShipped, deepCaution, deepEndgame]),
  CLUSTER: clusteringOf(deepShipped),
  LENGTH: lengthTable,
  CENSUS: census(must(`${DEEP}/deep-shipped`)),
  ENDGAME_CENSUS: census(must(`${DEEP}/deep-endgame`)),
  AUTOPSY: autopsyTxt,
  REPRO: transcript('reproduce.txt'),
  SHARD_IDENTITY: transcript('shard-identity.txt'),
  MARGIN: marginMatch[1]!,
  ROSTER_ROWS: String(a0126Roster.matches.filter((r) => roster.seeds.includes(r.seed)).length),
  CLASS_ROWS: String(a0126Class.matches.filter((r) => cls.seeds.includes(r.seed)).length),
};

const tmpl = readFileSync(resolve(import.meta.dirname, 'report.md.tmpl'), 'utf8');
const missing: string[] = [];
let out = tmpl.replace(/\{\{(\w+)\}\}/g, (m, k: string) => {
  if (!(k in fields)) {
    missing.push(k);
    return m;
  }
  return fields[k]!;
});
if (missing.length) throw new Error(`render: template asks for fields this renderer does not compute: ${missing.join(', ')}`);
// The headline embeds one number the autopsy owns rather than the artifacts.
out = out.replace(/\{\{MARGIN\}\}/g, readFileSync(resolve(ROOT, 'evidence/a0-130-bolt-inside-the-band/autopsy.txt'), 'utf8')
  .match(/decided: median ([\d.]+% of a core)/)?.[1] ?? '1.7% of a core');
const dest = resolve(ROOT, 'tests/reports/a0-130-bolt.md');
writeFileSync(dest, out);
console.log(`wrote ${dest} (${out.split('\n').length} lines)`);
