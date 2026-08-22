/**
 * evidence/a0-135-home-defence/siege.ts — **what the `fleeing` latch does under
 * QA's own antagonists.** OWNER: Bot Engineer (a0-135).
 *
 * The brief asks for `fleeing` under `siege-home` before and after, and for
 * a0-105's and a0-107's cells re-run. All four are the same measurement on
 * four boards, so they are one script — and deliberately **QA's instrument, not
 * a second one**: the stagings, the antagonists and the hold reader all come
 * from `tests/adversarial/`, so these numbers and the ones the standing latch
 * gate asserts on are produced by the same code (a0-107 set that precedent).
 *
 * The four subjects, and what each one is here to say:
 *
 *  - **`siege-home`** — the subject's own core held under attack at 0.2. Below
 *    `CORE_FINAL_ASSAULT` (0.3), so `last-stand` is already live: this is the
 *    board where the ruling this brief writes was *already* true, and the
 *    before/after on it is the no-regression claim rather than the fix.
 *  - **`park@200`** — a hostile parked 200u off the doorstep. Inside
 *    `HOME_ALARM_RANGE` (520), so `ownHomeThreatened` reads TRUE here, which is
 *    what makes this a0-135's board and no longer a0-105's. It is the same
 *    staging `src/bots/behaviors.test.ts`'s a0-105 cells used, and the reason
 *    those cells had to move (see `tests/reports/a0-135-home-defence.md` §4).
 *  - **`park@580`** — a0-107's cell. Outside the alarm ring, so the home reads
 *    quiet and nothing this brief does may touch it.
 *  - **`park@840`** — outside `RETREAT_CLEAR_RANGE` too: the control where the
 *    retreat can read *escaped* and must.
 *
 * WHAT IS COUNTED: the longest unbroken run of the `fleeing` latch (the bot's
 * own `committed()` bit, read through `tests/adversarial/latches.ts`), and the
 * leaf the bot turned to when it let go. `†` means the run was still open at the
 * ceiling.
 *
 * Run:    npx vite-node evidence/a0-135-home-defence/siege.ts
 * Prints: the table to stdout (pasted into ./siege-before.txt, ./siege-after.txt
 *         and tests/reports/a0-135-home-defence.md).
 */

import { TICK_DT } from '../../src/sim';
import { PERSONALITIES } from '../../src/bots';
import type { PersonalityId } from '../../src/bots';
import { ANTAGONISTS, hold, run } from '../../tests/adversarial/antagonist';
import { LATCHES } from '../../tests/adversarial/latches';

/** Ceiling, seconds. a0-106 ran `siege-home` for 40 and that is the number its
 *  `last-stand` reading is quoted at, so this matches it. */
const CEILING_S = Number(process.env.A0135_SECONDS ?? 40);

const SUBJECTS = (process.env.A0135_ANTAGONISTS ?? 'siege-home,park@200,park@580,park@840').split(',');

const CAST = Object.keys(PERSONALITIES) as PersonalityId[];
/** `fleeing` is the brief's question; `defend` and `last-stand` are what the bot
 *  is doing instead when it is not, and printing them beside it is what turns a
 *  zero into a finding rather than an absence. */
const WATCHED = ['fleeing', 'defend', 'last-stand', 'standoff'];
const WATCHES = WATCHED.map((id) => LATCHES.find((l) => l.id === id)!);

console.log(`a0-135 — latch holds under QA's antagonists, longest unbroken run in ticks (${TICK_DT}s per tick)`);
console.log(`ceiling ${CEILING_S}s = ${Math.round(CEILING_S / TICK_DT)} ticks   † = still open at the ceiling`);

for (const id of SUBJECTS) {
  const antagonist = ANTAGONISTS.find((a) => a.id === id);
  if (!antagonist) {
    console.log(`\n(no antagonist ${id})`);
    continue;
  }
  console.log('');
  console.log(`${antagonist.id} — ${antagonist.what}`);
  console.log('character  tier     fleeing  turned to     defend  last-stand  standoff');
  console.log('---------- ------- -------- ------------ -------- ----------- ---------');
  for (const personality of CAST) {
    const trace = run(antagonist, personality, { seconds: CEILING_S, watches: WATCHES });
    const cells = WATCHED.map((w) => hold(trace, w));
    const flee = cells[0]!;
    const mark = (h: (typeof cells)[number]) => `${h.ticks}${h.openAtCeiling ? '†' : ''}`;
    console.log(
      `${personality.padEnd(10)} ${String(PERSONALITIES[personality].difficulty).padEnd(7)} ` +
        `${mark(flee).padStart(8)} ${flee.turnedTo.padEnd(12)} ` +
        `${mark(cells[1]!).padStart(8)} ${mark(cells[2]!).padStart(11)} ${mark(cells[3]!).padStart(9)}`,
    );
  }
}
