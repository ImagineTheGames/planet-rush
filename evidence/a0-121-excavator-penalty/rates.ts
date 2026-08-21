/**
 * evidence/a0-121-excavator-penalty/rates.ts — read a class/roster artifact and
 * print its contest, using `harness/mirrors`' own helpers so a number here and
 * the same number in `a0-112-balance.md` are computed the same way.
 *
 * Run: npx vite-node evidence/a0-121-excavator-penalty/rates.ts <dir> [<dir>...]
 */
import { readFileSync } from 'node:fs';
import type { SectionRun } from '../../harness/mirrors';
import { pct, winSE } from '../../harness/mirrors';
import { classWins, castCharacterWins, castHullWins } from '../../harness/tuning';
import { lengthOf, mmss } from '../../harness/mirrors';

const load = (p: string): SectionRun => JSON.parse(readFileSync(p, 'utf8')) as SectionRun;

for (const arg of process.argv.slice(2)) {
  const run = load(arg);
  const wins = run.section === 'class' ? classWins(run) : castHullWins(run);
  const L = lengthOf(run.matches);
  const decided = run.matches.filter((m) => m.winner !== null).length;
  console.log(`\n### ${arg} — section \`${run.section}\`, ${run.seeds.length} seeds, ${run.matches.length} matches`);
  console.log(`length: median **${mmss(L.median)}**, min ${mmss(L.min)}, max ${mmss(L.max)}, inside 10–15 **${pct(L.insideFraction)}** · decided ${decided}/${run.matches.length}`);
  console.log('| contestant | wins / decided | rate | ±1 SE | vs 55% |');
  console.log('|---|---|---|---|---|');
  for (const w of [...wins].sort((a, b) => b.rate - a.rate)) {
    console.log(
      `| ${w.name} | ${w.wins} / ${w.decided} | **${pct(w.rate)}** | ${(winSE(w.rate, w.decided) * 100).toFixed(1)} pts | ${w.rate > 0.55 ? '**OVER**' : 'under'} |`,
    );
  }
  if (run.section !== 'class') {
    console.log('\n| character | wins / decided | rate | vs 55% |');
    console.log('|---|---|---|---|');
    for (const w of [...castCharacterWins(run)].sort((a, b) => b.rate - a.rate)) {
      console.log(`| ${w.name} | ${w.wins} / ${w.decided} | **${pct(w.rate)}** | ${w.rate > 0.55 ? '**OVER**' : 'under'} |`);
    }
  }
}
