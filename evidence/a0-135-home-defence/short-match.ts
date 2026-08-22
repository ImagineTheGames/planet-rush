/**
 * evidence/a0-135-home-defence/short-match.ts — **the two short matches, named
 * and accounted for.**
 * OWNER: Bot Engineer (a0-135; GDD §2.11).
 *
 * `length-distribution.ts` says two of the class contest's 128 matches fall
 * below the 10-minute band after this branch (seeds 20001 and 32003) and none
 * before. A min is one match, so the summary line in `win-rates.ts` cannot
 * settle whether that is a shape change or two outliers. This probe re-runs
 * exactly those two seeds on whichever build it is invoked in and prints
 *
 *   - how each ended: collapse time, waves delivered, winner, ore left; and
 *   - the telemetry (a0-112) behind it: pooled leaf ticks, and per seat the
 *     deaths, the elimination and the three leaves it spent most of its match in.
 *
 * The point of the second block is the `retreat` column. Nothing here is a
 * second implementation of anything — same `runBotMatch`, same lineup
 * constructor, same seeds as `win-rates.ts`.
 *
 * Run:    npx vite-node evidence/a0-135-home-defence/short-match.ts
 * Prints: to stdout (pasted into ./short-match-{before,after}.txt).
 */

import { CLASSES, HARD_POOL, classLineup, runBotMatch } from '../../harness/soak';

const CLASS_BEHAVIOUR = HARD_POOL[0]!;

/** The two the census flagged, plus one in-band neighbour as a control. */
const CASES: ReadonlyArray<readonly [seed: number, rot: number]> = [
  [20001, 1],
  [32003, 3],
  [20000, 0],
];

/** The leaves this brief moves, in the order the tree tries them. */
const WATCHED = [
  'fleeing', 'retreat', 'last-stand', 'turn-and-fight', 'cornered-fight',
  'defend', 'attack', 'mine',
] as const;

for (const [seed, rot] of CASES) {
  if (rot >= CLASSES.length) continue;
  const r = runBotMatch(seed, classLineup(CLASS_BEHAVIOUR, rot), { telemetry: true });
  console.log('');
  console.log(
    `seed ${String(seed).padStart(6)}  ${Math.round(r.seconds).toString().padStart(4)}s  ` +
    `collapse ${r.collapseTime < 0 ? '  never' : `${Math.round(r.collapseTime)}s`.padStart(7)}  ` +
    `waves ${r.wavesSpawned}  winner ${String(r.winnerClass ?? 'draw').padEnd(12)} ` +
    `oreLeft ${Math.round(r.fieldOreLeft)}  finished ${r.ok ? 'yes' : 'NO — timeout'}`,
  );
  const pool = r.telemetry!.leafTicks;
  console.log('  pooled: ' + WATCHED.map((k) => `${k}=${pool[k] ?? 0}`).join(' '));
  for (const s of r.telemetry!.seats) {
    const top = Object.entries(s.leafTicks)
      .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}:${v}`).join(' ');
    console.log(
      `    seat ${s.id} ${String(s.shipClass).padEnd(11)} deaths ${String(s.deaths).padStart(3)} ` +
      `${s.eliminated ? 'ELIMINATED' : 'survived  '}  ${top}`,
    );
  }
}
