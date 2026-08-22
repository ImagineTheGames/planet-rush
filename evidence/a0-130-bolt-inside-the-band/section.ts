/**
 * evidence/a0-130-bolt-inside-the-band/section.ts — one tier pool, sharded.
 * OWNER: Bot Engineer (brief a0-130).
 *
 *   npx vite-node evidence/.../section.ts <pool…> --seeds n [--from s] --data DIR
 *
 * a0-126 measured Bolt inside the whole `tier` section: three pools, seven
 * rotations, and six sevenths of every match spent on Medium and Hard seats that
 * this brief's question does not ask about. The Easy pool decides **18.6%** of
 * the matches it plays (a0-126 §4.5), so the only way to a tight interval on it
 * is a lot of Easy matches, and a lot of Easy matches is only affordable if the
 * other two pools are not run alongside them. This file is that: the *same*
 * lineups `harness/mirrors` `tierSection` builds, restricted to the pools named
 * on the command line.
 *
 * It is the same experiment and not a similar one, and the reason is
 * `runBotMatch(seed, slots)` — it reads nothing but its own two arguments, so
 * `easy:rot0` at seed 5 is the same match whether or not `hard:rot2` was run in
 * the same process. `./reproduce.ts` proves it against a0-126's committed
 * artifact rather than asserting it, exactly the way a0-126 §4.1 proved its own
 * deep run contained a0-121's.
 *
 * The artifact it writes is a `SectionRun` of section `tier`, so every reader
 * downstream — `poolWins`, `mergeSections`, a0-126's `targets.ts` — takes it
 * without knowing it was cut down.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ShipClass } from '@shared/types';
import { Difficulty, rosterAt } from '../../src/bots';
import { strategyLineup } from '../../harness/soak';
import { classSection, rosterSection, runSection } from '../../harness/mirrors';
import type { LineupSpec, SectionRun } from '../../harness/mirrors';

/** The tiers this runner knows, by the pool name `poolWins` filters on. */
const TIER_OF: Readonly<Record<string, Difficulty>> = {
  easy: Difficulty.Easy,
  medium: Difficulty.Medium,
  hard: Difficulty.Hard,
};

/** The two whole sections it can also run, unchanged, so the DoD's other two
 *  targets are re-measured by the same script under the same sharding. */
const WHOLE = new Set(['roster', 'class']);

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const specs = argv.filter((a) => a in TIER_OF || WHOLE.has(a));
const seedCount = Number(flag('--seeds') ?? 32);
const from = Number(flag('--from') ?? 1);
const dataDir = flag('--data');

if (specs.length === 0 || !dataDir || !Number.isFinite(seedCount) || !Number.isFinite(from)) {
  console.error('usage: section.ts <easy|medium|hard|roster|class …> --seeds n [--from s] --data DIR');
  process.exit(2);
}
if (specs.some((s) => WHOLE.has(s)) && specs.length > 1) {
  console.error('section.ts: `roster` and `class` are whole sections and run alone');
  process.exit(2);
}

const seeds = Array.from({ length: seedCount }, (_, i) => from + i);
let last = 0;
const progress = (total: number) => (_row: unknown, index: number): void => {
  // A long section prints progress instead of looking hung — the harness's own
  // rule, applied to the harness (`harness/mirrors` `SectionOptions.onMatch`).
  if (index === total || index - last >= 64) {
    last = index;
    console.log(`  ${index}/${total}`);
  }
};

let run: SectionRun;
if (specs[0] === 'roster') {
  run = rosterSection({ seeds, onMatch: progress(seeds.length * 7) });
} else if (specs[0] === 'class') {
  run = classSection({ seeds, onMatch: progress(seeds.length * 4) });
} else {
  /**
   * Exactly `tierSection`'s lineups for the named pools, in the same order and
   * with the same names — `${tier}:rot${n}`, one hull (Vanguard), the pool
   * rotated through the eight seats. Rebuilt here rather than imported because
   * `tierSection` takes no pool filter, and adding one would be an edit to QA's
   * harness for one brief's convenience.
   */
  const lineups: LineupSpec[] = [];
  for (const pool of specs) {
    const roster = rosterAt(TIER_OF[pool]!);
    for (let rot = 0; rot < roster.length; rot++) {
      lineups.push({ lineup: `${pool}:rot${rot}`, slots: strategyLineup(roster, ShipClass.Vanguard, rot) });
    }
  }
  run = runSection('tier', `equal-skill contests — ${specs.join('/')} pool, one hull, rotated`, lineups, {
    seeds,
    onMatch: progress(lineups.length * seeds.length),
  });
}

const dir = resolve(dataDir);
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, `${run.section}.json`), `${JSON.stringify(run, null, 1)}\n`, 'utf8');
const decided = run.matches.filter((m) => m.ok && m.winner !== null).length;
console.log(
  `${dir}/${run.section}.json: ${run.matches.length} matches, ${decided} decided, ` +
    `seeds ${from}…${from + seedCount - 1}, ${run.rotations} lineups`,
);
