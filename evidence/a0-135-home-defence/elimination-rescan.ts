/**
 * evidence/a0-135-home-defence/elimination-rescan.ts — **a wider sweep of
 * a0-81's elimination probe, because its own 24-seed range no longer holds a
 * seed that clears on both builds.**
 * OWNER: Bot Engineer (a0-135; p1-08, GDD §2.11).
 *
 * `tests/harness/p1-08-pay.test.ts`'s case "doubling the placement rung cannot
 * pay the first player out" needs a match that CONTAINS a knocked-out player
 * inside its 120 s probe window — `MatchAccrual.placement` only reaches `slots`
 * once `world.match.eliminated` is non-empty. a0-81 moved that fixture 9 -> 8
 * for the same reason and set the standard this file follows: *the replacement
 * seed must clear on BOTH builds*, so it is not a seed picked for passing on the
 * new code.
 *
 * a0-135 makes every bot hold its own doorstep, so the first core takes longer
 * to fall on this board: over a0-81's seeds 1–24 the window is cleared 7/24
 * before and 3/24 after — and the two sets are DISJOINT. There is no seed under
 * 25 that satisfies a0-81's standard any more, so the range has to widen rather
 * than the standard relax.
 *
 * Two differences from `evidence/a0-81-fleeing-fire/elimination-probe.ts`, and
 * nothing else: it sweeps `A0135_SEEDS` (default 96) instead of 24, and it runs
 * each seed ONCE to the watch horizon instead of twice — the first elimination
 * time answers "inside 120 s?" and "by how much?" together, so the second run
 * was always redundant and at 96 seeds it is not affordable. The match loop, the
 * setup, and the read off `world.match.eliminated` are a0-81's verbatim.
 *
 * Run on both builds:
 *   npx vite-node evidence/a0-135-home-defence/elimination-rescan.ts
 * Prints: one row per seed and the cleared list, to stdout (pasted into
 *         ./elimination-{before,after}.txt).
 */
import { TICK_DT, isOver, step } from '../../src/sim';
import { botInputs, createBots, fillEmptySlots } from '../../src/bots';
import { MIXED_ROSTER, buildPayWorld } from '../../harness/pay';
import type { PaySetup } from '../../harness/pay';

/** The window `p1-08-pay.test.ts` runs every fixture at. */
const PROBE_SECONDS = 120;
/** Far enough past it that a seed which misses reports BY HOW MUCH. */
const WATCH_SECONDS = 360;
const SEEDS = Number(process.env.A0135_SEEDS ?? 96);

const setup = (seed: number): PaySetup => ({
  seed,
  slots: 8,
  roster: MIXED_ROSTER,
  abundance: 'scarce',
});

/** Sim seconds at the first elimination, or null if nobody was out by
 *  `WATCH_SECONDS`. a0-81's read, and its reasoning for reading the elimination
 *  list rather than the accrual's `seconds`: an eliminated seat's station leaves
 *  `world.stations`, so the accrual falls back to the cap, not the death. */
function firstOutAt(seed: number): number | null {
  const s = setup(seed);
  const seats = fillEmptySlots([], s.slots, s.roster);
  const world = buildPayWorld(s);
  const bots = createBots(seats, { seed: s.seed });
  while (!isOver(world) && world.time < WATCH_SECONDS) {
    step(world, botInputs(world, bots, TICK_DT), TICK_DT);
    if (world.match.eliminated.length > 0) return world.time;
  }
  return null;
}

console.log('| seed | first elimination (s) | inside 120s? |');
console.log('|---|---|---|');
const inside: { seed: number; at: number }[] = [];
for (let seed = 1; seed <= SEEDS; seed++) {
  const at = firstOutAt(seed);
  if (at !== null && at <= PROBE_SECONDS) inside.push({ seed, at });
  console.log(`| ${seed} | ${at === null ? '— (none by 360s)' : at.toFixed(1)} | ${at !== null && at <= PROBE_SECONDS ? 'YES' : 'no'} |`);
}

console.log(`\nseeds with a first-out inside the ${PROBE_SECONDS}s window: ${inside.length}/${SEEDS}`);
for (const { seed, at } of [...inside].sort((a, b) => a.at - b.at)) {
  console.log(`  seed ${seed}: ${at.toFixed(1)}s — ${(PROBE_SECONDS - at).toFixed(1)}s of margin`);
}
