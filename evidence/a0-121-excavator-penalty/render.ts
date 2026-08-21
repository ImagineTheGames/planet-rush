/**
 * evidence/a0-121-excavator-penalty/render.ts — the tables in
 * `tests/reports/a0-121-excavator.md`. OWNER: Gameplay Engineer (brief a0-121).
 *
 * It computes nothing of its own: every rate, fair share, standard error and
 * match length comes from `harness/mirrors`' helpers, so a table here and the
 * same table in `a0-112-balance.md` are read the same way — and **the seed
 * assertion is a0-117's own** (`harness/tuning.ts` `assertSameSeeds`), applied to
 * the after column against the before column. A pair that is not the same draw
 * is a failed measurement and throws here rather than being printed, because
 * "re-measured on the same seeds" is the whole evidentiary value of an
 * after-number.
 *
 * The static half — the design column beside the simulation column, and §2.11's
 * rock-paper-scissors priced as a time-to-kill matrix — is arithmetic over
 * `SHIP_STATS` and is generated here too, so the report cannot drift from the
 * class table it is about.
 *
 *   npx vite-node evidence/a0-121-excavator-penalty/render.ts
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ShipClass } from '@shared/types';
import {
  BASE_ACCEL,
  BASE_SPEED,
  BASE_TURN_RATE,
  DRAG,
  SHIP_STATS,
  SHIP_WEAPON,
  miningRate,
  classWeaponDps,
} from '../../src/sim/constants';
import { classSeats, lengthOf, mmss, pct, seatsByCharacter, winSE, winsBy } from '../../harness/mirrors';
import type { MatchRow, SectionRun, Win } from '../../harness/mirrors';
import { assertSameSeeds, castHullWins } from '../../harness/tuning';

const ROOT = resolve(import.meta.dirname, '../..');
const read = (p: string): SectionRun => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8')) as SectionRun;
const has = (p: string): boolean => existsSync(resolve(ROOT, p));

const ORDER: readonly ShipClass[] = [
  ShipClass.Interceptor,
  ShipClass.Vanguard,
  ShipClass.Excavator,
  ShipClass.Hauler,
];

/** GDD §2.11's table, transcribed by hand from the document. */
const GDD: Readonly<Record<ShipClass, readonly [number, number, number, number, number, number]>> = {
  [ShipClass.Interceptor]: [130, 120, 140, 35, 8, 2],
  [ShipClass.Vanguard]: [100, 100, 100, 50, 10, 2],
  [ShipClass.Excavator]: [90, 100, 80, 55, 13, 2],
  [ShipClass.Hauler]: [85, 80, 85, 70, 9, 3],
};

/**
 * The one cell this branch moves. The rest of §2.11 is untouched, and the report
 * says so cell by cell — a table that only prints what changed cannot show that
 * the other three hulls were left alone, which is the brief's own condition.
 */
const SHIPPED_EXCAVATOR_TURN = 0.8;

function table(head: readonly string[], rows: readonly (readonly string[])[]): string {
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

const f = (n: number, d = 2): string => n.toFixed(d);
const band = (r: number): string => (r > 0.55 ? '**OVER**' : 'under');
const display = (k: string): string => k.charAt(0).toUpperCase() + k.slice(1);

// ---------------------------------------------------------------------------
// The static half — arithmetic over the class table, no match run
// ---------------------------------------------------------------------------

const flip180 = (turnMul: number): number => Math.PI / (BASE_TURN_RATE * turnMul);

/** Seconds to `frac` of top speed under `v' = a − v·DRAG`, which is all
 *  `accelMul` buys: top speed is clamped, so accel is only the approach. */
function timeToFraction(cls: ShipClass, frac: number): number {
  const a = BASE_ACCEL * SHIP_STATS[cls].accelMul;
  const target = frac * BASE_SPEED * SHIP_STATS[cls].speedMul;
  const vTerm = a / DRAG;
  return target >= vTerm ? Number.POSITIVE_INFINITY : -Math.log(1 - target / vTerm) / DRAG;
}

/**
 * The design column beside the simulation column, in the units a ship moves in.
 *
 * `turnOf` is passed in rather than read, because this table is printed twice —
 * once for the tree a0-121 was handed and once for the tree it ships — and a
 * "before" column rendered from the branch's own constants would be a lie.
 */
function columnsTable(turnOf: (c: ShipClass) => number): string {
  return table(
    ['hull', 'GDD §2.11 · speed / accel / turn', 'sim top speed', 'sim accel', 'sim turn rate', '180° flip', '0 → 90% top speed'],
    ORDER.map((c) => {
      const s = { ...SHIP_STATS[c], turnMul: turnOf(c) };
      const g = GDD[c];
      return [
        `\`${c}\``,
        `${g[0]}% / ${g[1]}% / ${g[2]}%`,
        `${f(BASE_SPEED * s.speedMul, 1)} u/s`,
        `${f(BASE_ACCEL * s.accelMul, 0)} u/s²`,
        `${f(BASE_TURN_RATE * s.turnMul)} rad/s`,
        `**${f(flip180(s.turnMul), 3)} s**`,
        `${f(timeToFraction(c, 0.9), 3)} s`,
      ];
    }),
  );
}

/** Cell-by-cell: does the simulation read back GDD §2.11, and where does it not? */
function transcriptionTable(): { md: string; drift: string[] } {
  const drift: string[] = [];
  const md = table(
    ['hull', 'speed', 'accel', 'turn', 'hull HP', 'power', 'cargo'],
    ORDER.map((c) => {
      const s = SHIP_STATS[c];
      const g = GDD[c];
      const got = [s.speedMul * 100, s.accelMul * 100, s.turnMul * 100, s.hull, s.power, s.cargo];
      return [
        `\`${c}\``,
        ...got.map((v, i) => {
          if (Math.abs(v - g[i]!) < 1e-9) return `${g[i]} ✓`;
          drift.push(`\`${c}\` ${['speed', 'accel', 'turn', 'hull', 'power', 'cargo'][i]}: §2.11 says ${g[i]}, the sim now reads **${v}**`);
          return `${g[i]} → **${v}**`;
        }),
      ];
    }),
  );
  return { md, drift };
}

/** §2.11's stated rock-paper-scissors, priced: who wins a head-on duel. */
function duelTable(): string {
  const rows: string[][] = [];
  for (let i = 0; i < ORDER.length; i++) {
    for (let j = i + 1; j < ORDER.length; j++) {
      const a = ORDER[i]!;
      const b = ORDER[j]!;
      const ta = SHIP_STATS[b].hull / classWeaponDps(a);
      const tb = SHIP_STATS[a].hull / classWeaponDps(b);
      rows.push([
        `\`${a}\` vs \`${b}\``,
        `${f(ta)} s`,
        `${f(tb)} s`,
        `**\`${ta < tb ? a : b}\`**`,
        `${f(Math.max(ta, tb) / Math.min(ta, tb))}×`,
      ]);
    }
  }
  return table(['pairing', 'A kills B in', 'B kills A in', 'winner', 'margin'], rows);
}

/** The two columns that actually decide a fight, ranked. */
function scoreTable(): string {
  return table(
    ['hull', 'mining (ore/s)', 'weapon dps', 'hull hp', 'top speed', '`dps × hp` — the duel score'],
    [...ORDER]
      .sort((x, y) => classWeaponDps(y) * SHIP_STATS[y].hull - classWeaponDps(x) * SHIP_STATS[x].hull)
      .map((c) => [
        `\`${c}\``,
        f(miningRate(c), 3),
        String(classWeaponDps(c)),
        String(SHIP_STATS[c].hull),
        `${f(BASE_SPEED * SHIP_STATS[c].speedMul, 0)} u/s`,
        `**${classWeaponDps(c) * SHIP_STATS[c].hull}**`,
      ]),
  );
}

// ---------------------------------------------------------------------------
// The measured half
// ---------------------------------------------------------------------------

const classWins = (run: SectionRun): Win[] =>
  winsBy(run.matches, (r: MatchRow) => (r.winnerClass === null ? null : String(r.winnerClass)), classSeats, display);
const characterWins = (run: SectionRun): Win[] =>
  winsBy(run.matches, (r: MatchRow) => r.winner, seatsByCharacter, display);

const rateOf = (wins: readonly Win[], key: string): Win | undefined => wins.find((w) => w.key === key);

/** One ladder row: a candidate's whole board, so "what moves for the others" is
 *  never a claim the reader has to take on trust. */
function ladder(rows: readonly { label: string; dir: string; note?: string }[]): string {
  const cells = rows
    .filter((r) => has(`${r.dir}/class.json`))
    .map((r) => {
      const run = read(`${r.dir}/class.json`);
      const w = classWins(run);
      const exc = rateOf(w, 'excavator');
      const L = lengthOf(run.matches);
      return [
        r.label,
        String(run.matches.length),
        exc === undefined ? '—' : `${exc.wins} / ${exc.decided} (**${pct(exc.rate)}**)`,
        ...['interceptor', 'vanguard', 'hauler'].map((k) => {
          const x = rateOf(w, k);
          return x === undefined ? '—' : pct(x.rate);
        }),
        exc === undefined ? '—' : band(exc.rate),
        mmss(L.median),
      ];
    });
  return table(
    ['candidate', 'matches', '`excavator`', '`interceptor`', '`vanguard`', '`hauler`', 'vs 55%', 'median length'],
    cells,
  );
}

/** Before beside after, on the same draw — the assertion is a0-117's own. */
function compare(beforeDir: string, afterDir: string, section: 'class' | 'roster', cut: 'class' | 'hull' | 'character'): string {
  const before = read(`${beforeDir}/${section}.json`);
  const after = read(`${afterDir}/${section}.json`);
  assertSameSeeds({ before, after }); // throws rather than print a different draw
  const pick = cut === 'class' ? classWins : cut === 'hull' ? castHullWins : characterWins;
  const b = pick(before);
  const a = new Map(pick(after).map((w) => [w.key, w]));
  return table(
    ['contestant', 'shipped tree', 'candidate', 'move', 'fair share', '±1 SE (candidate)', 'vs 55%'],
    [...b]
      .sort((x, y) => y.rate - x.rate)
      .map((w) => {
        const x = a.get(w.key);
        if (x === undefined || x.decided === 0) {
          return [w.name, `${w.wins} / ${w.decided} (**${pct(w.rate)}**)`, '—', '—', pct(w.fairShare), '—', '—'];
        }
        const d = (x.rate - w.rate) * 100;
        return [
          w.name,
          `${w.wins} / ${w.decided} (**${pct(w.rate)}**)`,
          `${x.wins} / ${x.decided} (**${pct(x.rate)}**)`,
          `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} pts`,
          pct(w.fairShare),
          `${(winSE(x.rate, x.decided) * 100).toFixed(1)} pts`,
          band(x.rate),
        ];
      }),
  );
}

/** Match length, before beside after — the target a hull nerf can trade away. */
function lengths(pairs: readonly (readonly [string, string, string, 'class' | 'roster'])[]): string {
  return table(
    ['run', 'matches', 'decided', 'median shipped', 'median candidate', 'min', 'max', 'inside 10–15 shipped', 'inside 10–15 candidate'],
    pairs
      .filter(([, bd, ad, sec]) => has(`${bd}/${sec}.json`) && has(`${ad}/${sec}.json`))
      .map(([label, bd, ad, sec]) => {
        const before = read(`${bd}/${sec}.json`);
        const after = read(`${ad}/${sec}.json`);
        assertSameSeeds({ before, after });
        const b = lengthOf(before.matches);
        const a = lengthOf(after.matches);
        return [
          label,
          String(after.matches.length),
          String(after.matches.filter((m) => m.winner !== null).length),
          mmss(b.median),
          `**${mmss(a.median)}**`,
          mmss(a.min),
          mmss(a.max),
          pct(b.insideFraction),
          `**${pct(a.insideFraction)}**`,
        ];
      }),
  );
}

/**
 * The third target — Bolt, inside the Easy pool at a fixed hull. It is cut out
 * separately because `winsBy`'s denominator is the whole section, and this
 * contest's denominator is one pool of it.
 */
function easyPoolTable(): string {
  const rows: string[][] = [];
  for (const [label, dir] of [
    ['shipped tree', 'tests/reports/a0-121-data/before'],
    ['this branch', 'tests/reports/a0-121-data/after'],
  ] as const) {
    if (!has(`${dir}/tier.json`)) continue;
    const run = read(`${dir}/tier.json`);
    const easy = run.matches.filter((m) => String((m as unknown as { lineup?: string }).lineup ?? '').startsWith('easy'));
    const dec = easy.filter((m) => m.winner !== null);
    const bolt = dec.filter((m) => m.winner === 'bolt').length;
    const rate = dec.length === 0 ? 0 : bolt / dec.length;
    rows.push([
      label,
      String(easy.length),
      `**${easy.length - dec.length}**`,
      String(dec.length),
      `${bolt} / ${dec.length} (**${pct(rate)}**)`,
      `${(winSE(rate, dec.length) * 100).toFixed(1)} pts`,
      band(rate),
    ]);
  }
  return table(['tree', 'easy-pool matches', 'draws', 'decided', 'Bolt', '±1 SE', 'vs 55%'], rows);
}

/** The headline line the brief asks for at the top: which targets are inside. */
function verdictTable(): string {
  const bc = read('tests/reports/a0-121-data/before/class.json');
  const ac = read('tests/reports/a0-121-data/after/class.json');
  const br = read('tests/reports/a0-121-data/before/roster.json');
  const ar = read('tests/reports/a0-121-data/after/roster.json');
  assertSameSeeds({ before: bc, after: ac });
  assertSameSeeds({ before: br, after: ar });
  const row = (name: string, src: string, b: Win | undefined, a: Win | undefined): string[] => [
    name,
    src,
    b === undefined ? '—' : `${b.wins}/${b.decided} (**${pct(b.rate)}**)`,
    a === undefined ? '—' : `${a.wins}/${a.decided} (**${pct(a.rate)}**)`,
    a === undefined ? '—' : a.rate > 0.55 ? '**OVER**' : '**INSIDE**',
  ];
  const topChar = (r: SectionRun): Win | undefined => [...characterWins(r)].sort((x, y) => y.rate - x.rate)[0];
  const beforeTop = topChar(br);
  return table(
    ['target', 'source', 'shipped tree', 'this branch', 'verdict'],
    [
      row('`excavator` — ship-class contest', 'GDD §2.11', rateOf(classWins(bc), 'excavator'), rateOf(classWins(ac), 'excavator')),
      row(
        `${beforeTop?.name ?? '—'} — cast contest (top of the shipped cast)`,
        'GDD §3.8',
        beforeTop,
        beforeTop === undefined ? undefined : rateOf(characterWins(ar), beforeTop.key),
      ),
      row('top of the cast, whoever it now is', 'GDD §3.8', topChar(br), topChar(ar)),
    ],
  );
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

const { md: transcription, drift } = transcriptionTable();
const exc = SHIP_STATS[ShipClass.Excavator];

const LADDER_BASE = [
  { label: '`BASE_TURN_RATE` **6.5** (shipped)', dir: 'tests/reports/a0-121-data/base16' },
  { label: '`BASE_TURN_RATE` 3.25', dir: 'tests/reports/a0-121-data/turn-3.25' },
  { label: '`BASE_TURN_RATE` 2.6', dir: 'tests/reports/a0-121-data/turn-2.6' },
  { label: '`BASE_TURN_RATE` 2.2', dir: 'tests/reports/a0-121-data/turn-2.2' },
  { label: '`BASE_TURN_RATE` 1.8', dir: 'tests/reports/a0-121-data/turn-1.8' },
  { label: '`BASE_TURN_RATE` 1.6', dir: 'tests/reports/a0-121-data/turn-1.6' },
  { label: '`BASE_TURN_RATE` 1.4', dir: 'tests/reports/a0-121-data/turn-1.4' },
  { label: '`BASE_TURN_RATE` 1.3', dir: 'tests/reports/a0-121-data/turn-1.30' },
  { label: '`BASE_TURN_RATE` 0.65', dir: 'tests/reports/a0-121-data/turn-0.65' },
];

const LADDER_HULL = [
  { label: '`turnMul` 1.0 — penalty **deleted**', dir: 'tests/reports/a0-121-data/ex-turn-off16' },
  { label: '`turnMul` **0.8** — GDD §2.11, shipped', dir: 'tests/reports/a0-121-data/base16' },
  { label: '`turnMul` 0.40', dir: 'tests/reports/a0-121-data/ex-turnmul-0.4' },
  { label: '`turnMul` 0.35', dir: 'tests/reports/a0-121-data/ex-turnmul-0.35' },
  { label: '`turnMul` 0.30', dir: 'tests/reports/a0-121-data/ex-turnmul-0.30' },
  { label: '`turnMul` **0.25** — this branch', dir: 'tests/reports/a0-121-data/ex-turnmul-0.25' },
  { label: '`turnMul` 0.20', dir: 'tests/reports/a0-121-data/ex-turnmul-0.2' },
  { label: '`turnMul` 0.10', dir: 'tests/reports/a0-121-data/ex-turnmul-0.1' },
];

const ABLATION = [
  { label: 'shipped tree', dir: 'tests/reports/a0-121-data/base16' },
  { label: 'excavator `turnMul` 0.8 → **1.0** (turn penalty deleted)', dir: 'tests/reports/a0-121-data/ex-turn-off16' },
  { label: 'excavator `speedMul` 0.9 → **1.0** (speed penalty deleted)', dir: 'tests/reports/a0-121-data/ex-speed-off16' },
  { label: 'excavator `power` 13 → 11', dir: 'tests/reports/a0-121-data/ex-power-11' },
  { label: 'excavator `power` 13 → 10', dir: 'tests/reports/a0-121-data/ex-power-10' },
  { label: 'excavator `speedMul` 0.80 **and** `turnMul` 0.40', dir: 'tests/reports/a0-121-data/ex-both-0.80-0.40' },
];

const REPLACEMENTS: Record<string, string> = {
  VERDICT: verdictTable(),
  COLUMNS: columnsTable((c) => (c === ShipClass.Excavator ? SHIPPED_EXCAVATOR_TURN : SHIP_STATS[c].turnMul)),
  COLUMNS_AFTER: columnsTable((c) => SHIP_STATS[c].turnMul),
  MOVED: table(
    ['hull', '`turnMul` before', '`turnMul` after', 'turn rate before', 'turn rate after', '180° flip before', '180° flip after'],
    ORDER.map((c) => {
      const before = c === ShipClass.Excavator ? SHIPPED_EXCAVATOR_TURN : SHIP_STATS[c].turnMul;
      const after = SHIP_STATS[c].turnMul;
      const same = before === after;
      return [
        `\`${c}\``,
        f(before),
        same ? `${f(after)} — **unchanged**` : `**${f(after)}**`,
        `${f(BASE_TURN_RATE * before)} rad/s`,
        same ? `${f(BASE_TURN_RATE * after)} rad/s` : `**${f(BASE_TURN_RATE * after)} rad/s**`,
        `${f(flip180(before), 3)} s`,
        same ? `${f(flip180(after), 3)} s` : `**${f(flip180(after), 3)} s**`,
      ];
    }),
  ),
  TRANSCRIPTION: transcription,
  DRIFT: drift.length === 0 ? '_No cell of §2.11 is diverged from on this branch._' : drift.map((d) => `- ${d}`).join('\n'),
  DUEL: duelTable(),
  SCORE: scoreTable(),
  ABLATION: ladder(ABLATION),
  LADDER_BASE: ladder(LADDER_BASE),
  LADDER_HULL: ladder(LADDER_HULL),
  CLASS_COMPARE: compare('tests/reports/a0-121-data/before', 'tests/reports/a0-121-data/after', 'class', 'class'),
  ROSTER_CLASS_COMPARE: compare('tests/reports/a0-121-data/before', 'tests/reports/a0-121-data/after', 'roster', 'hull'),
  CHARACTER_COMPARE: compare('tests/reports/a0-121-data/before', 'tests/reports/a0-121-data/after', 'roster', 'character'),
  EASY_POOL: easyPoolTable(),
  LENGTHS: lengths([
    ['ship-class contest (64 seeds × 4 rotations)', 'tests/reports/a0-121-data/before', 'tests/reports/a0-121-data/after', 'class'],
    ['cast contest (32 seeds × 7 rotations)', 'tests/reports/a0-121-data/before', 'tests/reports/a0-121-data/after', 'roster'],
  ]),
  EXC_FLIP_BEFORE: f(flip180(SHIPPED_EXCAVATOR_TURN), 2),
  EXC_FLIP_AFTER: f(flip180(exc.turnMul), 2),
  EXC_TURN_BEFORE: f(BASE_TURN_RATE * SHIPPED_EXCAVATOR_TURN),
  EXC_TURN_AFTER: f(BASE_TURN_RATE * exc.turnMul),
  EXC_TURNMUL: String(exc.turnMul),
  VAN_FLIP: f(flip180(1.0), 2),
  FIRE_INTERVAL: String(SHIP_WEAPON.fireInterval),
  BASE_TURN_RATE: String(BASE_TURN_RATE),
};

const tmpl = readFileSync(resolve(import.meta.dirname, 'report.md.tmpl'), 'utf8');
const out = tmpl.replace(/\{\{(\w+)\}\}/g, (m, k: string) => {
  if (!(k in REPLACEMENTS)) throw new Error(`render: template asks for {{${k}}} and nothing computes it`);
  return REPLACEMENTS[k]!;
});
const dest = resolve(ROOT, 'tests/reports/a0-121-excavator.md');
writeFileSync(dest, out);
console.log(`wrote ${dest}`);
