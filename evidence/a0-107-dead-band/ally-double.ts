/**
 * evidence/a0-107-dead-band/ally-double.ts — **the two-flying residual, over
 * more than one seed.** OWNER: Bot Engineer (a0-107).
 *
 * `src/bots/defender-role.test.ts`'s match-scale case asserts that the share of
 * alarm-ticks with two teammates flying at one alarm stays under 5 %. It was
 * measured on **one** seeded 4v4 (seed 11) and it lands at 4.8 % there, which
 * left it about a tenth of a point of headroom — so a0-107, which changes when a
 * wounded bot stops running, tipped it to 5.19 % on that one seed.
 *
 * A floor with a tenth of a point of headroom, read off a single match, is a
 * measurement of that match rather than of the behaviour. This script is the
 * wider read: the same metric, the same code path, over a set of seeds on both
 * builds, so the restated floor in that file is a number with a spread behind
 * it. Nothing here is bot-specific to a0-107 — it is the test's own inner loop,
 * lifted out and run more than once.
 *
 * Run:    npx vite-node evidence/a0-107-dead-band/ally-double.ts
 *         A0107_SEEDS=11,12,13 npx vite-node evidence/a0-107-dead-band/ally-double.ts
 * Prints: one line per seed, then the aggregate (pasted into ./ally-double.txt,
 *         before and after).
 */

import { TICK_DT, createWorld, isOver, step } from '../../src/sim';
import type { PlayerId } from '../../src/shared/types';
import { botInputs, botLobby, createBots, fillEmptySlots } from '../../src/bots/harness';
import { DEFAULT_PERCEPTION, perceive } from '../../src/bots/perception';
import { defenderFor } from '../../src/bots/roles';

/** The board the test uses: two sides of four. */
const SIDES = [0, 0, 0, 0, 1, 1, 1, 1] as const;

/** Seeds. The test's own seed 11 first, so its number is reproduced exactly. */
const SEEDS = (process.env.A0107_SEEDS ?? '11,12,13,14,15,16').split(',').map(Number);

/** Sim seconds per match — the test's own ceiling. */
const SECONDS = Number(process.env.A0107_MATCH_S ?? 240);

interface Row {
  seed: number;
  alarms: number;
  twoFlying: number;
  disagreements: number;
}

function measure(seed: number): Row {
  const seats = fillEmptySlots([], 8, undefined, [...SIDES]);
  const world = createWorld({ seed, players: botLobby(seats), mapId: 'octagon' });
  const brains = createBots(seats, { seed });
  const sideOf = new Map<PlayerId, number>();
  for (const s of world.stations) sideOf.set(s.owner, s.team ?? s.owner);
  const teamOf = (s: { owner: PlayerId; team?: number }): number => s.team ?? s.owner;

  const row: Row = { seed, alarms: 0, twoFlying: 0, disagreements: 0 };
  while (world.time < SECONDS && !isOver(world)) {
    step(world, botInputs(world, brains, TICK_DT), TICK_DT);
    for (const s of world.stations) {
      if (!s.alive || s.sinceDamage >= DEFAULT_PERCEPTION.alarmWindow) continue;
      const side = brains.filter((b) => sideOf.get(b.seat.id) === teamOf(s));
      const answers = side.map((b) => defenderFor(perceive(world, b.seat.id), s.owner));
      if (new Set(answers).size !== 1) row.disagreements++;
      row.alarms++;
      const flying = side.filter(
        (b) => b.brain.allyResponse.target === s.owner && b.brain.lastBehavior === 'defend-ally',
      );
      if (flying.length >= 2) row.twoFlying++;
    }
  }
  return row;
}

const rows = SEEDS.map(measure);
console.log(`a0-107 — two teammates flying at one alarm, 4v4 octagon, ${SECONDS}s per match`);
console.log('');
console.log('| seed | alarm-ticks | two flying | share | defender disagreements |');
console.log('|---|---|---|---|---|');
let alarms = 0;
let two = 0;
let disagreements = 0;
for (const r of rows) {
  alarms += r.alarms;
  two += r.twoFlying;
  disagreements += r.disagreements;
  console.log(
    `| ${r.seed} | ${r.alarms} | ${r.twoFlying} | ${((r.twoFlying / r.alarms) * 100).toFixed(2)}% | ${r.disagreements} |`,
  );
}
console.log(`| **all** | ${alarms} | ${two} | **${((two / alarms) * 100).toFixed(2)}%** | ${disagreements} |`);
const worst = rows.reduce((a, b) => (b.twoFlying / b.alarms > a.twoFlying / a.alarms ? b : a));
console.log('');
console.log(`worst seed: ${worst.seed} at ${((worst.twoFlying / worst.alarms) * 100).toFixed(2)}%`);
