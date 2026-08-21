/**
 * evidence/a0-126-the-last-two-points/reproduce.ts — the deep run contains
 * a0-121's run. OWNER: QA Agent (brief a0-126).
 *
 *   npx vite-node evidence/.../reproduce.ts <section>
 *
 * a0-126 measures on **the same seeds** as a0-112 and a0-121 and then keeps
 * going: seeds 1…512 are a strict superset of a0-112's 1…32, so the prior
 * column is not transcribed from a published table, it is *inside this run* and
 * can be lifted back out of it.
 *
 * This is the check that says so. It restricts the deep artifact to a0-121's
 * seeds, runs a0-117's own `assertSameSeeds` on the pair, and then compares the
 * match rows field for field. Three things are being proved at once and each of
 * them is load-bearing for the report:
 *
 *   1. the tree really is unchanged since a0-121 merged — the same seed under
 *      the same constants gives the same match, so a difference here is a moved
 *      constant somewhere and every before/after column in the report is void;
 *   2. the sharded runner reproduces a single-process run of another branch,
 *      which is `shard-identity.txt` again at 64x the scale and across a merge;
 *   3. the deep column and the a0-121 column are the same experiment, so the
 *      difference between them is sample size and nothing else.
 *
 * A mismatch is a failed measurement and exits non-zero. It is not something to
 * explain in prose.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MatchRow, SectionRun } from '../../harness/mirrors';
import { assertSameSeeds } from '../../harness/tuning';

const ROOT = resolve(import.meta.dirname, '../..');
const read = (p: string): SectionRun => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8')) as SectionRun;

/** The deep run, cut down to another run's draw. Order is normalised the way
 *  `mergeSections` normalises it, so a comparison is row against row. */
export function restrict(run: SectionRun, seeds: readonly number[]): SectionRun {
  const keep = new Set(seeds);
  const matches = run.matches
    .filter((m) => keep.has(m.seed))
    .sort((a, b) => (a.lineup === b.lineup ? a.seed - b.seed : a.lineup < b.lineup ? -1 : 1));
  return { ...run, seeds: [...seeds], matches };
}

const key = (m: MatchRow): string =>
  JSON.stringify([m.seed, m.lineup, m.ok, m.failure, m.seconds, m.winner, m.winnerClass, m.winnerTier, m.seats, m.deaths]);

const section = process.argv[2] ?? 'roster';
const prior = read(`tests/reports/a0-121-data/after/${section}.json`);
const deep = read(`tests/reports/a0-126-data/deep-shipped/${section}.json`);

const cut = restrict(deep, prior.seeds);
assertSameSeeds({ before: prior, after: cut });

const a = [...prior.matches].sort((x, y) => (x.lineup === y.lineup ? x.seed - y.seed : x.lineup < y.lineup ? -1 : 1));
const b = cut.matches;
let diffs = 0;
if (a.length !== b.length) {
  console.log(`ROW COUNT DIFFERS: a0-121 ${a.length}, deep-restricted ${b.length}`);
  diffs++;
} else {
  for (let i = 0; i < a.length; i++) {
    if (key(a[i]!) !== key(b[i]!)) {
      if (diffs < 5) console.log(`  row ${i} differs:\n    a0-121: ${key(a[i]!)}\n    deep  : ${key(b[i]!)}`);
      diffs++;
    }
  }
}

console.log(`--- ${section}: a0-121's ${prior.matches.length} matches, lifted back out of a0-126's ${deep.matches.length} ---`);
console.log(`  same seeds (a0-117 assertSameSeeds): PASS`);
console.log(`  rows compared: ${a.length}`);
console.log(`  rows differing: ${diffs}`);
if (diffs === 0) {
  console.log(`  IDENTICAL — the tree is unchanged since a0-121, and the deep run contains its run exactly.`);
} else {
  console.log(`  FAILED — the same seed under the same constants did not give the same match.`);
  process.exit(1);
}
