/**
 * evidence/a0-107-dead-band/decision-mix.ts — **what do bots actually spend
 * their decisions on?** OWNER: Bot Engineer (a0-107).
 *
 * The re-baseline note in `src/bots/ffa-parity.test.ts` claims a size for this
 * change: the retreat is still the retreat, and the turn is still rare. A claim
 * with a number in it should have been measured, so this is the measurement —
 * every bot's winning leaf, every tick, over whole FFA matches on the shipped
 * cast, on both builds.
 *
 * The run shape is `ffa-parity.test.ts`'s own (`fillEmptySlots` over `ROSTER`,
 * `botLobby`, no teams) so the mix is the mix of the matches the goldens hash,
 * not of a bespoke board.
 *
 * It also prints the **retreat episode** distribution, which is the number that
 * actually settles the a0-105 scope question. A share alone cannot tell "the
 * retreat was deleted" from "the retreat stopped running forever": both make the
 * share fall. The lengths can — a build whose retreats are unbounded carries a
 * long tail of 10-second-plus episodes, and cutting that tail is the whole
 * point, while cutting the *median* would be the balance change a0-105 was
 * warned off.
 *
 * Run:    npx vite-node evidence/a0-107-dead-band/decision-mix.ts
 *         A0107_MATCHES=8 npx vite-node evidence/a0-107-dead-band/decision-mix.ts
 * Prints: the leaf census (pasted into ./decision-mix-{before,after}.txt).
 */

import { TICK_DT, createWorld, isOver, step } from '../../src/sim';
import { MATCH_SLOTS, botInputs, botLobby, createBots, fillEmptySlots } from '../../src/bots/harness';
import { ROSTER } from '../../src/bots/personalities';

/** Seeds, and the per-match ceiling — `ffa-parity`'s own 180 s, long enough that
 *  every subsystem a bot touches has run many times over. */
const SEEDS = (process.env.A0107_SEEDS ?? '20260806,7,991,11,12').split(',').map(Number);
const SECONDS = Number(process.env.A0107_MATCH_S ?? 180);

const census = new Map<string, number>();
let total = 0;
/** Every unbroken run of the `retreat` leaf, per bot, in ticks. */
const episodes: number[] = [];

for (const seed of SEEDS) {
  const seats = fillEmptySlots([], MATCH_SLOTS, ROSTER);
  const world = createWorld({ seed, players: botLobby(seats) });
  const bots = createBots(seats, { seed });
  const running = new Map<number, number>();
  while (world.time < SECONDS && !isOver(world)) {
    step(world, botInputs(world, bots, TICK_DT), TICK_DT);
    for (const bot of bots) {
      const leaf = bot.brain.lastBehavior;
      census.set(leaf, (census.get(leaf) ?? 0) + 1);
      total++;
      if (leaf === 'retreat') {
        running.set(bot.seat.id, (running.get(bot.seat.id) ?? 0) + 1);
      } else {
        const run = running.get(bot.seat.id) ?? 0;
        if (run > 0) episodes.push(run);
        running.set(bot.seat.id, 0);
      }
    }
  }
  for (const run of running.values()) if (run > 0) episodes.push(run);
}

const rows = [...census.entries()].sort((a, b) => b[1] - a[1]);
console.log(`a0-107 — decision mix, ${SEEDS.length} FFA matches × ${SECONDS}s, ${MATCH_SLOTS} bots`);
console.log(`seeds: ${SEEDS.join(', ')}   ${total} decisions`);
console.log('');
console.log('| leaf | decisions | share |');
console.log('|---|---|---|');
for (const [leaf, n] of rows) {
  console.log(`| ${leaf} | ${n} | ${((n / total) * 100).toFixed(2)}% |`);
}

// ---------------------------------------------------------------------------
// The retreat, episode by episode
// ---------------------------------------------------------------------------

episodes.sort((a, b) => a - b);
const at = (q: number): number => episodes[Math.min(episodes.length - 1, Math.floor(episodes.length * q))] ?? 0;
const secs = (ticks: number): string => (ticks * TICK_DT).toFixed(2);
const long = episodes.filter((e) => e * TICK_DT > 10);
const longTicks = long.reduce((a, b) => a + b, 0);
const allTicks = episodes.reduce((a, b) => a + b, 0);
console.log('');
console.log('| retreat episodes | count | mean | p50 | p90 | max | >10s | ticks in >10s |');
console.log('|---|---|---|---|---|---|---|---|');
console.log(
  `| all | ${episodes.length} | ${secs(allTicks / episodes.length)}s | ${secs(at(0.5))}s | ` +
    `${secs(at(0.9))}s | ${secs(episodes[episodes.length - 1] ?? 0)}s | ${long.length} | ` +
    `${longTicks} (${((longTicks / allTicks) * 100).toFixed(1)}% of retreat) |`,
);
