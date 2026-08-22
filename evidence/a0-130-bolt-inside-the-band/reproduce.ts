/**
 * evidence/a0-130-bolt-inside-the-band/reproduce.ts — every column in this
 * report is the same draw. OWNER: Bot Engineer (brief a0-130).
 *
 *   npx vite-node evidence/.../reproduce.ts
 *
 * The brief's measurement standard is a0-126's, and a0-126's first rule is that
 * a before/after pair is **the same seeds** or it is not a pair. This brief has
 * three ways to get that wrong that a0-126 did not, so it has three checks:
 *
 *  1. **The Easy-pool runner is the `tier` section.** `./section.ts` runs a
 *     *subset* of `harness/mirrors` `tierSection`'s lineups, so every claim that
 *     compares an arm to a0-126's published Easy-pool number is comparing two
 *     different scripts. It is the same experiment because
 *     `runBotMatch(seed, slots)` reads nothing but its own two arguments — and
 *     that is checked here, row for row, against a0-126's committed artifact.
 *  2. **Every screening arm is inside its own deep arm.** The screens ran seeds
 *     1…256 and the deep arms 1…4096, so a screen is a strict restriction of a
 *     deep run and can be lifted back out of it (a0-126 §4.1's own trick,
 *     `restrict()` reused rather than rewritten).
 *  3. **This branch ships main's tree**, so the other two targets — Warden's
 *     cast contest and the excavator's ship-class contest — must come back
 *     byte-identical to a0-126's, and the `verify-*` artifacts are that claim
 *     stated as a measurement instead of as an argument.
 *
 * A mismatch is a failed measurement and exits non-zero. It is not something to
 * explain in prose.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MatchRow, SectionRun } from '../../harness/mirrors';
import { assertSameSeeds } from '../../harness/tuning';

const ROOT = resolve(import.meta.dirname, '../..');
const read = (p: string): SectionRun | null => {
  const full = resolve(ROOT, p);
  return existsSync(full) ? (JSON.parse(readFileSync(full, 'utf8')) as SectionRun) : null;
};

/**
 * A run cut down to another run's draw, with the row order normalised the way
 * `mergeSections` normalises it so a comparison is row against row.
 *
 * This is a0-126's `reproduce.ts` `restrict()`, restated rather than imported:
 * that module reads its artifacts and calls `process.exit` at module scope, so
 * importing the one function runs a0-126's whole CLI — and, on a tree where its
 * artifacts have moved, exits this script non-zero for a reason that has
 * nothing to do with this report.
 */
function restrict(run: SectionRun, seeds: readonly number[]): SectionRun {
  const keep = new Set(seeds);
  const matches = run.matches
    .filter((m) => keep.has(m.seed))
    .sort((a, b) => (a.lineup === b.lineup ? a.seed - b.seed : a.lineup < b.lineup ? -1 : 1));
  return { ...run, seeds: [...seeds], matches };
}

const key = (m: MatchRow): string =>
  JSON.stringify([m.seed, m.lineup, m.ok, m.failure, m.seconds, m.winner, m.winnerClass, m.winnerTier, m.seats, m.deaths]);

const sortRows = (rows: readonly MatchRow[]): MatchRow[] =>
  [...rows].sort((a, b) => (a.lineup === b.lineup ? a.seed - b.seed : a.lineup < b.lineup ? -1 : 1));

let failures = 0;
let skipped = 0;

/**
 * `a` restricted to `b`'s seeds and lineups must be `b`, row for row.
 *
 * The lineup filter is what makes this usable on a section that was cut down:
 * a0-126's `tier.json` carries the Medium and Hard pools as well, and an
 * Easy-only artifact is not missing rows, it is a different question asked of
 * the same generator.
 */
function compare(name: string, a: SectionRun | null, b: SectionRun | null, lineupPrefix = ''): void {
  if (!a || !b) {
    // A skipped check must never read as a passed one: the whole point of this
    // file is that a claim is not allowed to rest on an artifact nobody looked at.
    console.log(`--- ${name} ---\n  SKIPPED — artifact not present`);
    skipped++;
    return;
  }
  const keep = (rows: readonly MatchRow[]): MatchRow[] =>
    rows.filter((r) => r.lineup.startsWith(lineupPrefix));
  const cut = restrict({ ...a, matches: keep(a.matches) }, b.seeds);
  assertSameSeeds({ before: { ...b, matches: keep(b.matches) }, after: cut });

  const left = sortRows(keep(b.matches));
  const right = sortRows(cut.matches);
  let diffs = 0;
  if (left.length !== right.length) {
    console.log(`  ROW COUNT DIFFERS: ${left.length} vs ${right.length}`);
    diffs++;
  } else {
    for (let i = 0; i < left.length; i++) {
      if (key(left[i]!) !== key(right[i]!)) {
        if (diffs < 5) console.log(`  row ${i} differs:\n    ${key(left[i]!)}\n    ${key(right[i]!)}`);
        diffs++;
      }
    }
  }
  console.log(`--- ${name} ---`);
  console.log(`  same seeds (a0-117 assertSameSeeds): PASS`);
  console.log(`  rows compared: ${left.length}`);
  console.log(`  rows differing: ${diffs}`);
  console.log(diffs === 0 ? '  IDENTICAL.' : '  FAILED — the same seed under the same tree did not give the same match.');
  if (diffs !== 0) failures++;
}

const DEEP = 'tests/reports/a0-130-data';
const A0126 = 'tests/reports/a0-126-data/deep-shipped';

// 1 — the Easy-pool runner reproduces a0-126's tier section, on a0-126's seeds.
compare(
  "the Easy pool: a0-126's 512 matches, re-run by this brief's own runner",
  read(`${DEEP}/deep-shipped/tier.json`),
  read(`${A0126}/tier.json`),
  'easy:',
);

// 2 — every screening arm is a strict restriction of its deep arm.
compare(
  'the caution arm: its screen (1…256) lifted back out of its deep run (1…4096)',
  read(`${DEEP}/deep-bolt-caution/tier.json`),
  read(`${DEEP}/d-bolt-caution/tier.json`),
  'easy:',
);
compare(
  'the endgame arm: its screen (1…256) lifted back out of its deep run (1…2048)',
  read(`${DEEP}/deep-endgame/tier.json`),
  read(`${DEEP}/c-endgame/tier.json`),
  'easy:',
);

// 3 — this branch ships main's tree, so the other two targets are untouched.
compare(
  "Warden's cast contest: a0-126's roster rows, re-run on this branch",
  read(`${A0126}/roster.json`),
  read(`${DEEP}/verify-roster/roster.json`),
);
compare(
  "the excavator's ship-class contest: a0-126's class rows, re-run on this branch",
  read(`${A0126}/class.json`),
  read(`${DEEP}/verify-class/class.json`),
);

if (failures > 0 || skipped > 0) {
  console.log(`\n${failures} comparison(s) FAILED, ${skipped} SKIPPED for a missing artifact.`);
  process.exit(1);
}
console.log('\nEvery comparison in this report is the same draw.');
