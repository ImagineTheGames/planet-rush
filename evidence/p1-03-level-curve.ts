/**
 * evidence/p1-03-level-curve.ts — **the brief's evidence line.**
 * OWNER: UI Engineer (p1-03; brief `docs/briefs/pr-03-level-curve.md`, plan
 * `docs/progression-plan.md` §1.4).
 *
 * The brief asks for "the generated L = 2…20 table printed in the PR body,
 * beside §1.4's, character for character". So it is *generated*: every number
 * below is read out of the shipped module by importing it, never typed out.
 * The nine rows §1.4 publishes are marked, so the comparison is a diff and not
 * a reading exercise.
 *
 * The table's shape is the plan's, which is offset by one: the row labelled
 * level L carries the cost of the step that ARRIVES at L (`xpToNext(L - 1)`),
 * and `cumTotal` is the lifetime total needed to stand at L (`xpToReach(L)`).
 * The last column samples that against a 600 XP match — §1.4's own yardstick,
 * kept so "level 10 at ~67 matches" stays checkable beside the row it came from.
 *
 * Re-run:  npx vite-node evidence/p1-03-level-curve.ts
 * Writes:  evidence/p1-03-level-curve.txt
 */

import { writeFileSync } from 'node:fs';
import { XP_CURVE_BASE, XP_CURVE_EXP, xpToNext, xpToReach } from '../src/progression/curve';

/** The levels §1.4 chose to print. Everything else is filled in for the tail. */
const PUBLISHED = new Set([2, 3, 4, 5, 6, 8, 10, 15, 20]);
/** §1.4's sample match pay, the denominator of its fourth column. */
const MATCH_XP = 600;

const lines: string[] = [
  `base = ${XP_CURVE_BASE}   exp = ${XP_CURVE_EXP}   (ratified 2026-08-07)`,
  '',
  'level   toNext   cumTotal   matches @600XP',
];

for (let level = 2; level <= 20; level++) {
  const toNext = xpToNext(level - 1);
  const cumTotal = xpToReach(level);
  const matches = (cumTotal / MATCH_XP).toFixed(1);
  const row =
    String(level).padStart(3) +
    String(toNext).padStart(9) +
    String(cumTotal).padStart(11) +
    String(matches).padStart(11);
  lines.push(PUBLISHED.has(level) ? `${row}   <- §1.4` : row);
}

const out = `${lines.join('\n')}\n`;
process.stdout.write(out);
writeFileSync(new URL('./p1-03-level-curve.txt', import.meta.url), out);
