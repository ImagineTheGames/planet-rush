/**
 * evidence/a0-81-fleeing-fire/elimination-probe.ts — whether an 8-slot scarce
 * match CONTAINS a knocked-out player inside the 120s probe window, per seed,
 * and when the first elimination lands.
 *
 * It exists because a0-81 made `tests/harness/p1-08-pay.test.ts`'s case
 * "doubling the placement rung cannot pay the first player out — by
 * construction" go red at its fixture seed 9. That test pins no pay number — the
 * file is explicit that it must not, because "a test that pinned them would have
 * to be edited by every bot-tree change". It needs a match that contains a
 * first-out player *at all*: `MatchAccrual.placement` only reaches `slots` once
 * `world.match.eliminated` is non-empty (`src/progression/accrual.ts`,
 * `placement: alive || rank < 0 ? 1 : n - rank`). A less lethal match is one
 * where the first elimination lands later, which is the same second-order effect
 * `contention-probe.ts` measured as ship deaths/match 9.0 -> 5.0. This probe says
 * whether that is what happened, and which seeds clear the window with margin.
 *
 * It runs the fixture through `runPayMatch` — the test's own instrument, same
 * setup — rather than re-deriving the loop, so what it reports is what the test
 * would see.
 *
 * Run on both builds:
 *   npx vite-node evidence/a0-81-fleeing-fire/elimination-probe.ts
 */
import { TICK_DT, isOver, step } from '../../src/sim';
import { botInputs, createBots, fillEmptySlots } from '../../src/bots';
import { MIXED_ROSTER, buildPayWorld } from '../../harness/pay';
import type { PaySetup } from '../../harness/pay';

/** The window `p1-08-pay.test.ts` runs every fixture at. */
const PROBE_SECONDS = 120;
/** Far enough past it that a seed which misses reports BY HOW MUCH. */
const WATCH_SECONDS = 360;

const setup = (seed: number): PaySetup => ({
  seed,
  slots: 8,
  roster: MIXED_ROSTER,
  abundance: 'scarce',
});

/**
 * Sim seconds at the first elimination, or null if nobody was out by
 * `maxSeconds`. Read off `world.match.eliminated` rather than off the accrual's
 * `seconds`: an eliminated seat's station leaves `world.stations`, so
 * `stationOf` returns undefined and the accrual falls back to `live.time` — the
 * cap, not the death. The elimination list is the thing `placement` is derived
 * from, so it is also the thing the test's premise actually rests on.
 */
function firstOutAt(seed: number, maxSeconds: number): number | null {
  const s = setup(seed);
  const seats = fillEmptySlots([], s.slots, s.roster);
  const world = buildPayWorld(s);
  const bots = createBots(seats, { seed: s.seed });
  while (!isOver(world) && world.time < maxSeconds) {
    step(world, botInputs(world, bots, TICK_DT), TICK_DT);
    if (world.match.eliminated.length > 0) return world.time;
  }
  return null;
}

console.log('| seed | first-out inside 120s? | first elimination by 360s (s) |');
console.log('|---|---|---|');
const inside: { seed: number; at: number }[] = [];
for (let seed = 1; seed <= 24; seed++) {
  const at120 = firstOutAt(seed, PROBE_SECONDS);
  const at360 = firstOutAt(seed, WATCH_SECONDS);
  if (at120 !== null) inside.push({ seed, at: at120 });
  console.log(
    `| ${seed} | ${at120 === null ? 'no' : `yes, ${at120.toFixed(1)}s`} | ${at360 === null ? '—' : at360.toFixed(1)} |`,
  );
}

console.log(`\nseeds with a first-out inside the ${PROBE_SECONDS}s window: ${inside.length}/24`);
for (const { seed, at } of [...inside].sort((a, b) => a.at - b.at)) {
  console.log(`  seed ${seed}: ${at.toFixed(1)}s — ${(PROBE_SECONDS - at).toFixed(1)}s of margin`);
}
