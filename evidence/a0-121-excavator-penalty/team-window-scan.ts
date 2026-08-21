/**
 * evidence/a0-121-excavator-penalty/team-window-scan.ts — the seed re-scan that
 * `src/bots/team-winning.test.ts` prescribes for itself.
 *
 * That fixture asserts a *profile* of the window in which one side has lost a
 * member and plays on — its length, distance travelled, trigger ticks and orders
 * placed. Its own module note records four previous re-seedings (a0-59, a0-65,
 * a0-81 …) and states the remedy in terms: **"the prescribed answer is a re-scan
 * rather than the next number."** a0-121 moves one cell of the class table, so
 * two Excavator-flying bots are somewhere else when a core goes, and seed 4's
 * window loses the orders it was asserted on.
 *
 * This measures every quantity the fixture asserts, for seeds 1–16, on whatever
 * tree it is run against — so the replacement is chosen on the largest margin
 * rather than on the next number that happens to pass.
 *
 * Run: npx vite-node evidence/a0-121-excavator-penalty/team-window-scan.ts
 */

import type { PlayerId, Vec2 } from '@shared/types';
import { TICK_DT, createWorld, isOver, step } from '../../src/sim';
import { botInputs, botLobby, createBots, fillEmptySlots } from '../../src/bots/harness';
import { ROSTER } from '../../src/bots/personalities';

interface Profile {
  seed: number;
  ticks: number;
  acted: number;
  fired: number;
  ordered: number;
  travelled: number;
  ghostTicks: number;
  teamResult: boolean;
  losers: number;
}

function scan(seed: number): Profile {
  const seats = fillEmptySlots([], 4, [...ROSTER.slice(2), ...ROSTER.slice(0, 2)], [0, 0, 1, 1]);
  const world = createWorld({ seed, players: botLobby(seats) });
  const bots = createBots(seats, { seed });

  let downSlot: PlayerId | null = null;
  let survivor: PlayerId | null = null;
  let ghostTicks = 0;
  let ticks = 0;
  let acted = 0;
  let fired = 0;
  let ordered = 0;
  let travelled = 0;
  let last: Vec2 = { x: 0, y: 0 };

  while (!isOver(world) && world.time < 20 * 60) {
    const inputs = botInputs(world, bots, TICK_DT);
    step(world, inputs, TICK_DT);

    if (downSlot === null) {
      for (const home of world.stations) {
        if (home.alive) continue;
        const mate = world.stations.find((p) => p.team === home.team && p.owner !== home.owner);
        if (mate?.alive) {
          downSlot = home.owner;
          survivor = mate.owner;
          last = { ...world.ships.find((s) => s.id === mate.owner)!.pos };
          break;
        }
      }
      continue;
    }

    if (!world.stations.find((p) => p.owner === survivor)!.alive) break;

    if (inputs.find((i) => i.id === downSlot)!.actions.length > 0) ghostTicks++;
    const stream = inputs.find((i) => i.id === survivor)!.actions;
    ticks++;
    if (stream.length > 0) acted++;
    if (stream.some((a) => a.type === 'fire' && a.active)) fired++;
    if (stream.some((a) => a.type === 'buildOrder' || a.type === 'upgradeOrder')) ordered++;
    const now = world.ships.find((s) => s.id === survivor)!.pos;
    travelled += Math.sqrt((now.x - last.x) ** 2 + (now.y - last.y) ** 2);
    last = { ...now };
  }

  const losers = world.stations.filter((p) => p.team !== world.match.winningTeam);
  return {
    seed,
    ticks,
    acted,
    fired,
    ordered,
    travelled,
    ghostTicks,
    teamResult: isOver(world) && world.match.winningTeam !== null,
    losers: losers.length,
  };
}

const rows: Profile[] = [];
for (let seed = 1; seed <= 16; seed++) rows.push(scan(seed));

// The fixture's own thresholds, restated so a candidate is judged on all of them.
const passes = (p: Profile): boolean =>
  p.ghostTicks === 0 &&
  p.acted === p.ticks &&
  p.ticks > 600 &&
  p.travelled > 1000 &&
  p.fired > 0 &&
  p.ordered > 0 &&
  p.teamResult &&
  p.losers > 1;

console.log('| seed | window (ticks) | acted | travelled | trigger ticks | orders | ghost | team result | losers | passes |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const p of rows) {
  console.log(
    `| ${p.seed} | ${p.ticks} | ${p.acted} | ${Math.round(p.travelled)} | ${p.fired} | ${p.ordered} | ${p.ghostTicks} | ` +
      `${p.teamResult ? 'yes' : 'NO'} | ${p.losers} | ${passes(p) ? '**yes**' : 'no'} |`,
  );
}

const ok = rows.filter(passes);
console.log(`\n${ok.length} of 16 seeds satisfy every assertion the fixture makes.`);
if (ok.length > 0) {
  // Largest margin: the fixture's tightest assertion has always been `ordered`,
  // so rank on orders first and window length second.
  const best = [...ok].sort((a, b) => b.ordered - a.ordered || b.ticks - a.ticks)[0]!;
  console.log(
    `Largest-margin replacement: **seed ${best.seed}** — ${best.ticks} ticks ` +
      `(${(best.ticks * TICK_DT / 60).toFixed(1)} min), ${Math.round(best.travelled)} units, ` +
      `${best.fired} trigger ticks, ${best.ordered} orders.`,
  );
}
