/**
 * evidence/a0-105-standoff/standoff.ts — **how long does a cornered retreat
 * last?** OWNER: Bot Engineer (a0-105).
 *
 * The developer, 2026-08-19, from a live match, with a screenshot of Rusty
 * parked at its own station at 20/70 hull:
 *
 * > *"I was able to make rusty just stay stuck there by putting myself in
 * > between the ore and his base. he just stayed in that same spot scared of me.
 * > ship lives are cheap. enemies should not fear death..."*
 *
 * This is the measurement behind that sentence. It stages the photograph — a
 * wounded bot at its own station, a hostile parked inside `RETREAT_CLEAR_RANGE`,
 * no repair in the game to climb back out on — and counts the ticks the bot
 * spends in the `retreat` leaf before it does anything else.
 *
 * WHAT IS COUNTED, precisely:
 *
 *  - a **held tick** is a tick whose winning behavior-tree leaf was `retreat`
 *    (`Brain.lastBehavior`) — the bot's own account of what it was doing;
 *  - the **turn** is the first tick whose winning leaf is one of the fighting
 *    leaves (`turn-and-fight`, `cornered-fight`, `defend`, `last-stand`,
 *    `attack`, `potshot`, `suppress`). `—` means it never turned inside the
 *    ceiling below, which is the defect.
 *
 * The geometry is **pinned**: both hulls are put back where they started before
 * every step and the bot's hull is held at its staged fraction, so the threat
 * never falls off and the bot never heals its way out. That is the player
 * standing still, which is exactly what the report describes. Everything else is
 * the real sim and the real trees — the bot's own cadence, its own fog, its own
 * gun.
 *
 * Run:    npx vite-node evidence/a0-105-standoff/standoff.ts
 * Prints: a per-character table to stdout (pasted into ./standoff.txt and into
 *         tests/reports/a0-105-standoff.md, before and after).
 */

import { ShipClass } from '../../src/shared/types';
import { SPAWN_PROTECTION_S, TICK_DT, createWorld, step } from '../../src/sim';
import type { World } from '../../src/sim';
import { PERSONALITIES, botInputs, createBot } from '../../src/bots';
import type { PersonalityId } from '../../src/bots';

/** Ceiling on one staging, seconds of sim. Twenty seconds is far past any
 *  patience any tier could defensibly have, and comfortably past the point where
 *  a player watching would call the bot broken. Override with `A0105_SECONDS`
 *  to show that the hold is unbounded rather than merely long. */
const CEILING_S = Number(process.env.A0105_SECONDS ?? 20);

/** Hull fraction the bot is pinned at: below every tier's nerve floor (the clamp
 *  on `retreatThreshold` is 0.15), so the retreat branch is live for the whole
 *  cast rather than only for the timid half. Rusty's own photograph was 20/70 =
 *  0.286, which is under its 0.65 threshold; this is the same case, staged so
 *  one number covers Sable (0.18) too. */
const WOUNDED = 0.14;

/** Where the player parks: inside `RETREAT_CLEAR_RANGE` (676) so the retreat can
 *  never read *escaped*, and inside `GUARD_RADIUS * 2` (268) of the station so
 *  it is a siege on the doorstep rather than a blockade of the road home —
 *  `./cornered` owns that other case and it already terminates. */
const PARK = 200;

/** The leaves that mean the bot stopped running and did something about it. */
const FIGHTING = new Set(['turn-and-fight', 'cornered-fight', 'defend', 'last-stand', 'attack', 'potshot', 'suppress', 'siege']);

interface Reading {
  personality: PersonalityId;
  /** Ticks the `retreat` leaf won, total, inside the ceiling. */
  held: number;
  /** Tick of the first fighting leaf, or -1 for never. */
  turnedAt: number;
  /** The leaf it turned into. */
  turnedTo: string;
}

/** Stage the photograph for one character and run it to the ceiling. */
function measure(personality: PersonalityId): Reading {
  const world: World = createWorld({
    seed: 20260819,
    players: [0, 1].map((id) => ({ id, shipClass: ShipClass.Vanguard })),
    bounds: { width: 4000, height: 4000 },
    asteroidCount: 0,
  });
  world.time = SPAWN_PROTECTION_S + 10;
  for (const ship of world.ships) ship.spawnProtect = 0;
  for (const station of world.stations) {
    station.spawnProtect = 0;
    station.sinceDamage = 999;
  }

  const home = world.stations.find((s) => s.owner === 0)!;
  const me = world.ships[0]!;
  const player = world.ships[1]!;

  // Straight out from home toward the arena centre: the way to the ore, which is
  // the lane the developer says they stood in.
  const dx = world.bounds.width / 2 - home.pos.x;
  const dy = world.bounds.height / 2 - home.pos.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const out = { x: dx / d, y: dy / d };

  // The bot is already home — it ran, it arrived, and it is out of road.
  const mePos = { x: home.pos.x, y: home.pos.y };
  const playerPos = { x: home.pos.x + out.x * PARK, y: home.pos.y + out.y * PARK };

  const bot = createBot({ id: 0, personality }, { seed: 3 });
  const reading: Reading = { personality, held: 0, turnedAt: -1, turnedTo: '—' };

  for (let tick = 0; tick < Math.round(CEILING_S / TICK_DT); tick++) {
    me.pos = { ...mePos };
    me.vel = { x: 0, y: 0 };
    me.hull = me.maxHull * WOUNDED;
    player.pos = { ...playerPos };
    player.vel = { x: 0, y: 0 };
    player.hull = player.maxHull;
    step(world, botInputs(world, [bot], TICK_DT), TICK_DT);
    const leaf = bot.brain.lastBehavior;
    if (leaf === 'retreat') reading.held++;
    if (reading.turnedAt < 0 && FIGHTING.has(leaf)) {
      reading.turnedAt = tick;
      reading.turnedTo = leaf;
    }
  }
  return reading;
}

const ROSTER = Object.keys(PERSONALITIES) as PersonalityId[];
const rows = ROSTER.map(measure);

console.log(`a0-105 — a wounded bot at home, a hostile parked ${PARK}u away, ${CEILING_S}s ceiling`);
console.log(`hull pinned at ${WOUNDED} of max; geometry pinned; ${Math.round(CEILING_S / TICK_DT)} ticks`);
console.log('');
console.log('character  tier    retreat ticks   turned at   into');
for (const r of rows) {
  const tier = PERSONALITIES[r.personality].difficulty;
  const at = r.turnedAt < 0 ? 'never' : `t=${r.turnedAt} (${(r.turnedAt * TICK_DT).toFixed(2)}s)`;
  console.log(
    `${r.personality.padEnd(10)} ${String(tier).padEnd(7)} ${String(r.held).padStart(8)}   ${at.padEnd(14)} ${r.turnedTo}`,
  );
}
