/**
 * evidence/a0-107-dead-band/deadband.ts — **does the retreat end now, and at
 * what range?** OWNER: Bot Engineer (a0-107; QA defect `a0-106-01`).
 *
 * QA's adversarial sweep found that a0-105's turn-and-fight exit was gated
 * behind two preconditions an opponent controls, and that a read failing either
 * one *reset* the patience clock. The cheapest demonstration is a hostile that
 * parks 580 units away and does nothing at all: too far for the old
 * `THREAT_RANGE` gate to let the fold run, too near for the flee latch to read
 * *escaped*, so the clock never started and the retreat never ended —
 * 17 860 held ticks of 18 000 (`tests/reports/a0-106-adversarial.md` §5).
 *
 * This script is the before/after measurement for that fix. It is deliberately
 * **QA's instrument, not a second one**: the stagings, the antagonists and the
 * hold reader all come from `tests/adversarial/`, so the numbers here and the
 * numbers the standing gate asserts on are produced by the same code. All this
 * file adds is the third axis the gate does not have — the **ceiling** — because
 * the shape of an unbounded hold is that it tracks whatever ceiling you give it.
 *
 * WHAT IS COUNTED: the longest unbroken run of the `fleeing` latch (the bot's
 * own `committed()` bit, read through `tests/adversarial/latches.ts`), per
 * antagonist × character × ceiling, plus what the bot turned to when it let go.
 * A number equal to the ceiling means the hold was still open when the run
 * stopped, and is printed with a `†`.
 *
 * Run:    npx vite-node evidence/a0-107-dead-band/deadband.ts
 *         A0107_CEILINGS=40 npx vite-node evidence/a0-107-dead-band/deadband.ts
 * Prints: the tables to stdout (pasted into ./deadband-before.txt and
 *         ./deadband-after.txt, and into tests/reports/a0-107-dead-band.md).
 */

import { TICK_DT } from '../../src/sim';
import { PERSONALITIES } from '../../src/bots';
import type { PersonalityId } from '../../src/bots';
import { ANTAGONISTS, hold, run } from '../../tests/adversarial/antagonist';
import { LATCHES } from '../../tests/adversarial/latches';

/**
 * The ceilings, seconds. Three of them, because one number cannot tell a long
 * hold from an unbounded one: a bounded latch reads the same at 40 s and at
 * 300 s, and an unbounded one reads 40 s and 300 s.
 */
const CEILINGS = (process.env.A0107_CEILINGS ?? '40,120,300').split(',').map(Number);

/**
 * The antagonists that reproduced the defect — every one of the six named in
 * a0-106's reproduction list, and no others, because the other six were already
 * releasing and the before/after on them is the *no-regression* claim rather
 * than the fix. `park@580` is first: it is the cheapest opponent there is.
 */
const SUBJECTS = (process.env.A0107_ANTAGONISTS ??
  'park@580,block-ore,block-home,never-die,park-squad,never-die-squad').split(',');

const CAST = Object.keys(PERSONALITIES) as PersonalityId[];
const FLEEING = LATCHES.find((l) => l.id === 'fleeing')!;

console.log(`a0-107 — the \`fleeing\` latch, longest unbroken hold, ticks (${TICK_DT}s per tick)`);
console.log(`ceilings: ${CEILINGS.map((c) => `${c}s`).join(', ')}   † = still open at the ceiling`);

for (const id of SUBJECTS) {
  const antagonist = ANTAGONISTS.find((a) => a.id === id);
  if (!antagonist) throw new Error(`no such antagonist: ${id}`);
  console.log('');
  console.log(`## ${antagonist.id} — ${antagonist.what}`);
  console.log('');
  console.log(
    `| character | tier | ${CEILINGS.map((c) => `${c}s (${Math.round(c / TICK_DT)})`).join(' | ')} | turned to |`,
  );
  console.log(`|---|---|${CEILINGS.map(() => '---|').join('')}---|`);
  for (const personality of CAST) {
    const cells = CEILINGS.map((seconds) => {
      const trace = run(antagonist, personality, { seconds, watches: [FLEEING] });
      return { h: hold(trace, 'fleeing'), ticks: trace.frames.length };
    });
    const printed = cells.map(
      (c) => `${c.h.ticks}${c.h.openAtCeiling ? ' †' : ''}`,
    );
    const last = cells[cells.length - 1]!.h;
    console.log(
      `| ${personality} | ${PERSONALITIES[personality].difficulty} | ${printed.join(' | ')} | ` +
        `${last.turnedTo}${last.endedByDeath ? ' (died)' : ''} |`,
    );
  }
}
