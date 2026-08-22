/**
 * evidence/a0-135-home-defence/length-distribution.ts — **where the short
 * matches are.**
 * OWNER: Bot Engineer (a0-135; GDD §2.11).
 *
 * `win-rates.ts` prints mean/min/max per contest, and after this branch the
 * class contest's *min* drops to 374 s while its mean stays at 806 s. A min is
 * one match; a mean is 128. This probe answers the only question that gap
 * raises — how many matches actually fall outside the 10–15 minute band, and
 * are they the same matches on both builds?
 *
 * It is `win-rates.ts`'s class contest verbatim — same seeds, same rotations,
 * same shipped `runBotMatch` — printing one line per match instead of a summary,
 * plus the count outside the band. Run it on this branch and on the merge-base
 * worktree and diff the two; nothing here reads a clock or a random source.
 *
 * Run:    npx vite-node evidence/a0-135-home-defence/length-distribution.ts
 * Prints: the out-of-band matches and a per-bucket census, to stdout (pasted
 *         into ./length-before.txt and ./length-after.txt).
 */

import {
  CLASSES,
  HARD_POOL,
  classLineup,
  runBotMatch,
} from '../../harness/soak';
import type { BotMatchResult } from '../../harness/soak';

const SEEDS = Number(process.env.A0135_SEEDS ?? 32);
const CLASS_BEHAVIOUR = HARD_POOL[0]!;

/** The band the brief names, in seconds. */
const BAND_LOW = 600;
const BAND_HIGH = 900;

const rows: Array<{ seed: number; rot: number; result: BotMatchResult }> = [];
for (let seed = 1; seed <= SEEDS; seed++) {
  for (let rot = 0; rot < CLASSES.length; rot++) {
    rows.push({ seed: seed * 1000 + rot, rot, result: runBotMatch(seed * 1000 + rot, classLineup(CLASS_BEHAVIOUR, rot)) });
  }
}

const seconds = (r: BotMatchResult): number => r.seconds;

console.log('');
console.log(`class contest (${CLASS_BEHAVIOUR}, four hulls) — ${rows.length} matches`);

const short = rows.filter((row) => seconds(row.result) < BAND_LOW);
const long = rows.filter((row) => seconds(row.result) > BAND_HIGH);
console.log(`  outside 10–15 min: ${short.length} short, ${long.length} long`);
for (const row of [...short, ...long]) {
  const r = row.result;
  console.log(
    `    seed ${String(row.seed).padStart(6)}  ${Math.round(seconds(r)).toString().padStart(4)}s  ` +
    `winner ${String(r.winnerClass ?? 'draw').padEnd(12)} finished ${r.ok ? 'yes' : 'NO — timeout'}`,
  );
}

const buckets = [0, 300, 600, 700, 800, 900, 1000];
console.log('  census:');
for (let i = 0; i < buckets.length; i++) {
  const lo = buckets[i]!;
  const hi = buckets[i + 1] ?? Infinity;
  const n = rows.filter((row) => seconds(row.result) >= lo && seconds(row.result) < hi).length;
  if (n) console.log(`    ${String(lo).padStart(4)}–${hi === Infinity ? ' inf' : String(hi).padStart(4)}s  ${String(n).padStart(3)}  ${'#'.repeat(n)}`);
}
