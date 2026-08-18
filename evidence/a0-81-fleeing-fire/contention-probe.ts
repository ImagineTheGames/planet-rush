/**
 * evidence/a0-81-fleeing-fire/contention-probe.ts — the allied-rock-contention
 * ratio `src/bots/field-division.test.ts` asserts, pooled at several sample
 * sizes, plus the combat totals of the same runs.
 *
 * It exists because a0-81 moved that ratio and the ratio alone cannot say why:
 * it is `ally / foe`, and the test's own note explains it is written as a ratio
 * so that a change to the board "moves both numbers together". A change that
 * makes *hostiles* stop sharing a rock moves only the denominator, and this
 * probe is how that is told apart from a regression in allied field division.
 *
 * Run: npx vite-node evidence/a0-81-fleeing-fire/contention-probe.ts
 */
import { TICK_DT, createWorld, isOver, step } from '../../src/sim';
import { botInputs, botLobby, createBots, fillEmptySlots } from '../../src/bots';

interface Run {
  ally: number;
  foe: number;
  /** Ship deaths in the match — the mechanism check: covering fire should end
   *  a hostile pair's shared rock by hurting one of them. */
  deaths: number;
  /** Hull HP landed on enemy ships, all four slots. */
  damage: number;
  /** The same pair rates, gated on both bots choosing `mine` this decision. */
  allyMining: number;
  foeMining: number;
}

function contention(seed: number, seconds: number): Run {
  const seats = fillEmptySlots([], 4, undefined, [0, 0, 1, 1]);
  const world = createWorld({ seed, players: botLobby(seats) });
  const bots = createBots(seats, { seed });
  const brainOf = new Map(bots.map((b) => [b.seat.id, b]));
  const team = new Map(seats.map((s) => [s.id, s.team!]));
  let ally = 0;
  let foe = 0;
  let allyTicks = 0;
  let foeTicks = 0;
  // The same two counts, but only over ticks where BOTH bots' winning leaf was
  // `mine` this decision. `Brain.mineSite` is not cleared when a tree stops
  // choosing `mine` — a retreating bot still carries the id of the last rock it
  // worked — so the ungated reading counts stale commitments, and any change to
  // how much time a pair spends NOT mining moves it for reasons that have
  // nothing to do with field division.
  let allyM = 0;
  let foeM = 0;
  let allyMTicks = 0;
  let foeMTicks = 0;
  let deaths = 0;
  const wasAlive = new Map(world.ships.map((s) => [s.id, s.alive]));
  while (world.time < seconds && !isOver(world)) {
    step(world, botInputs(world, bots, TICK_DT), TICK_DT);
    for (let i = 0; i < world.ships.length; i++) {
      const a = world.ships[i]!;
      if (wasAlive.get(a.id) && !a.alive) deaths++;
      wasAlive.set(a.id, a.alive);
      if (!a.alive || a.eliminated) continue;
      for (let j = i + 1; j < world.ships.length; j++) {
        const b = world.ships[j]!;
        if (!b.alive || b.eliminated) continue;
        const ba = brainOf.get(a.id)!.brain;
        const bb = brainOf.get(b.id)!.brain;
        const same = ba.mineSite >= 0 && ba.mineSite === bb.mineSite;
        const mining = ba.lastBehavior === 'mine' && bb.lastBehavior === 'mine';
        if (team.get(a.id) === team.get(b.id)) {
          allyTicks++;
          if (same) ally++;
          if (mining) {
            allyMTicks++;
            if (same) allyM++;
          }
        } else {
          foeTicks++;
          if (same) foe++;
          if (mining) {
            foeMTicks++;
            if (same) foeM++;
          }
        }
      }
    }
  }
  const damage = world.credit ? world.credit.dealtToShips.reduce((a, n) => a + n, 0) : 0;
  return {
    ally: ally / Math.max(1, allyTicks),
    foe: foe / Math.max(1, foeTicks),
    allyMining: allyM / Math.max(1, allyMTicks),
    foeMining: foeM / Math.max(1, foeMTicks),
    deaths,
    damage,
  };
}

const N = Number(process.env.N ?? 48);
const runs = Array.from({ length: N }, (_, i) => contention(i + 1, 300));
for (const n of [8, 16, 24, 32, 40, 48].filter((k) => k <= N)) {
  const s = runs.slice(0, n);
  const ally = s.reduce((a, r) => a + r.ally, 0) / n;
  const foe = s.reduce((a, r) => a + r.foe, 0) / n;
  const allyM = s.reduce((a, r) => a + r.allyMining, 0) / n;
  const foeM = s.reduce((a, r) => a + r.foeMining, 0) / n;
  const deaths = s.reduce((a, r) => a + r.deaths, 0) / n;
  const damage = s.reduce((a, r) => a + r.damage, 0) / n;
  console.log(
    `n=${String(n).padStart(2)}  ally=${(ally * 100).toFixed(2)}%  foe=${(foe * 100).toFixed(2)}%` +
      `  ratio=${(ally / foe).toFixed(2)}  |  MINING-GATED ally=${(allyM * 100).toFixed(2)}%` +
      `  foe=${(foeM * 100).toFixed(2)}%  ratio=${(allyM / foeM).toFixed(2)}` +
      `  |  deaths/match=${deaths.toFixed(1)}  dmg/match=${damage.toFixed(0)}`,
  );
}
