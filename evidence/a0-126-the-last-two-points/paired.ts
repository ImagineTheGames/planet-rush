/**
 * evidence/a0-126-the-last-two-points/paired.ts — was a0-121's move real?
 * OWNER: QA Agent (brief a0-126).
 *
 *   npx vite-node evidence/.../paired.ts --print
 *
 * a0-121's before and after columns are **the same seeds**, so the comparison
 * between them is paired and the concordant matches — the ones both trees won,
 * and the ones neither did — carry no information about the change. Reading the
 * difference through two independent standard errors, as every table in this
 * series does, discards that.
 *
 * This prints the paired reading. It is here because a0-126's finding cuts both
 * ways and should be seen to: the same instrument that says Warden's residual
 * +2.0 is not a number says a0-121's −16.1 is one, decisively, and the hull's
 * −28.7 more decisively still.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pct } from '../../harness/mirrors';
import type { MatchRow, SectionRun } from '../../harness/mirrors';
import { assertSameSeeds } from '../../harness/tuning';
import { mcnemar } from './stats';

const ROOT = resolve(import.meta.dirname, '../..');
const read = (p: string): SectionRun => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8')) as SectionRun;

const order = (m: readonly MatchRow[]): MatchRow[] =>
  [...m].sort((a, b) => (a.lineup === b.lineup ? a.seed - b.seed : a.lineup < b.lineup ? -1 : 1));

interface Case {
  readonly what: string;
  readonly section: 'roster' | 'class';
  readonly won: (r: MatchRow) => boolean;
}

const CASES: readonly Case[] = [
  { what: 'Warden — cast contest', section: 'roster', won: (r) => r.winner === 'warden' },
  { what: 'Foreman — cast contest', section: 'roster', won: (r) => r.winner === 'foreman' },
  { what: '`excavator` — cast contest, by silhouette', section: 'roster', won: (r) => String(r.winnerClass) === 'excavator' },
  { what: '`excavator` — ship-class contest', section: 'class', won: (r) => String(r.winnerClass) === 'excavator' },
  { what: '`vanguard` — ship-class contest', section: 'class', won: (r) => String(r.winnerClass) === 'vanguard' },
];

/** The paired table, as markdown. Exported so `render.ts` prints the same rows
 *  the standalone run does rather than a second implementation of them. */
export function pairedTable(): string {
  const lines = [
    '| what | before | after | move | both won | before only | after only | neither | discordant | McNemar exact p |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const c of CASES) {
    const before = read(`tests/reports/a0-121-data/before/${c.section}.json`);
    const after = read(`tests/reports/a0-121-data/after/${c.section}.json`);
    assertSameSeeds({ before, after });
    const b = order(before.matches);
    const a = order(after.matches);
    if (b.length !== a.length) throw new Error(`${c.section}: ${b.length} vs ${a.length} rows`);
    for (let i = 0; i < b.length; i++) {
      if (b[i]!.seed !== a[i]!.seed || b[i]!.lineup !== a[i]!.lineup) {
        throw new Error(`${c.section} row ${i}: ${b[i]!.lineup}#${b[i]!.seed} vs ${a[i]!.lineup}#${a[i]!.seed}`);
      }
    }
    const m = mcnemar(b.map(c.won), a.map(c.won));
    const move = 100 * (m.afterRate - m.beforeRate);
    lines.push(
      `| ${c.what} | ${pct(m.beforeRate)} | ${pct(m.afterRate)} | ${move >= 0 ? '+' : ''}${move.toFixed(1)} pts | ` +
        `${m.both} | ${m.lostIt} | ${m.gained} | ${m.neither} | ${m.discordant} | ` +
        `${m.p < 1e-6 ? '< 0.000001' : m.p.toFixed(6)} |`,
    );
  }
  lines.push('');
  lines.push(
    "*Rates here are over **all** matches of the section, not over the decided ones, because a paired test needs the same denominator in both columns; a0-121's published rates are over decided matches and differ in the third digit.*",
  );
  return lines.join('\n');
}

// vite-node does not put the script path in `process.argv`, so "am I the entry
// point" cannot be asked the Node way. An explicit flag instead of a guess:
// `render.ts` imports `pairedTable` and prints nothing, the standalone run says
// `--print` and files `paired.txt`.
if (process.argv.includes('--print')) {
  console.log('## a0-121, read as the paired experiment it was\n');
  console.log(pairedTable());
}
