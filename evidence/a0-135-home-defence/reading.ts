/**
 * evidence/a0-135-home-defence/reading.ts — **what does `ownHomeThreatened`
 * actually read, in each staging this brief must not break?** OWNER: Bot
 * Engineer (a0-135).
 *
 * The brief says the fix is one missing call to `ownHomeThreatened(ctx)` inside
 * `wantsRetreat`, and it also says a0-105's and a0-107's cells must come out
 * unchanged. Those two are only compatible if the stagings those briefs used are
 * stagings where the home reads *not threatened*. `ownHomeThreatened` is
 * `station.underAttack || homeIntruder(ctx) !== null`, and `homeIntruder` is
 * `intruderNear` at `HOME_ALARM_RANGE` (520) — so a hostile parked 200 units off
 * the doorstep IS an intruder and a hostile parked 580 units off is not.
 *
 * This script prints the reading rather than arguing about it.
 *
 * Run:    npx vite-node evidence/a0-135-home-defence/reading.ts
 */

import { ShipClass } from '@shared/types';
import type { Vec2 } from '@shared/types';
import { SPAWN_PROTECTION_S, createWorld } from '../../src/sim';
import type { World } from '../../src/sim';
import { ownHomeThreatened } from '../../src/bots/behaviors';
import { HOME_ALARM_RANGE, homeIntruder } from '../../src/bots/targeting';
import { createBot } from '../../src/bots/bot';
import { perceive } from '../../src/bots/perception';
import { context } from '../../src/bots/tree';

/** The a0-105/a0-107 `standoff()` staging out of `src/bots/behaviors.test.ts`,
 *  lifted verbatim: bot at its own station, one hostile parked `park` units out
 *  along the lane to the field. */
function standoff(park: number, hull: number) {
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
  const dx = world.bounds.width / 2 - home.pos.x;
  const dy = world.bounds.height / 2 - home.pos.y;
  const d = Math.hypot(dx, dy);
  const out: Vec2 = { x: dx / d, y: dy / d };
  me.pos = { x: home.pos.x, y: home.pos.y };
  me.vel = { x: 0, y: 0 };
  me.hull = me.maxHull * hull;
  player.pos = { x: home.pos.x + out.x * park, y: home.pos.y + out.y * park };
  player.vel = { x: 0, y: 0 };
  const bot = createBot({ id: 0, personality: 'rusty' }, { seed: 3 });
  return context(perceive(world, 0), bot.brain);
}

console.log(`HOME_ALARM_RANGE = ${HOME_ALARM_RANGE}`);
console.log('');
console.log('park    | station.underAttack | homeIntruder | ownHomeThreatened | which brief staged it here');
console.log('--------|---------------------|--------------|-------------------|---------------------------');
const cells: readonly [number, string][] = [
  [200, 'a0-105 PARK / adversarial park@200'],
  [580, 'a0-107 park@580'],
  [840, 'adversarial park@840'],
];
for (const [park, who] of cells) {
  const ctx = standoff(park, 20 / 70);
  const intruder = homeIntruder(ctx);
  console.log(
    `park@${String(park).padEnd(3)}| ${String(ctx.self.station?.underAttack).padEnd(20)}| ` +
      `${(intruder ? `#${intruder.id} @${Math.round(intruder.distance)}u` : 'null').padEnd(13)}| ` +
      `${String(ownHomeThreatened(ctx)).padEnd(18)}| ${who}`,
  );
}
