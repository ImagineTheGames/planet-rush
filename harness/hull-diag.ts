/**
 * harness/hull-diag.ts — a0-117 diagnostic: **why** does one hull win?
 *
 * The class contest (`./mirrors`, section `class`) says the `excavator` takes
 * 77.3% of it. A win rate names the winner and nothing else; a tuning pass needs
 * the mechanism, because the lever that closes an economy lead is not the lever
 * that closes a combat lead. So this runs the same lineup and reads, per hull:
 * ore mined, ore banked, ore spent, core HP at the moment collapse opens, and
 * kills scored on cores — the four numbers that separate "out-earns everyone"
 * from "out-shoots everyone".
 *
 * Observation only, exactly like `SoakRunOptions.telemetry`: it reads the world
 * after the tick has been taken and writes nothing back, so a diagnosed match
 * and a plain one step identically.
 *
 * Run: npx vite-node harness/hull-diag.ts [seeds]
 */

import { ShipClass } from '@shared/types';
import { PERSONALITIES } from '../src/bots';
import type { Bot } from '../src/bots';
import { createBot } from '../src/bots';
import { TICK_DT, createWorld, isOver, step } from '../src/sim';
import type { World } from '../src/sim';
import { botInputs } from '../src/bots';
import { CLASSES, classLineup } from './soak';

const SEEDS = Number(process.argv[2] ?? 8);

interface Row {
  banked: number;
  income: number;
  coreAtCollapse: number;
  coreAtEnd: number;
  wins: number;
  matches: number;
  deaths: number;
  tiers: number;
  defences: number;
  coreLowWater: number;
}

const rows = new Map<ShipClass, Row>(
  CLASSES.map((c) => [
    c,
    { banked: 0, income: 0, coreAtCollapse: 0, coreAtEnd: 0, wins: 0, matches: 0, deaths: 0, tiers: 0, defences: 0, coreLowWater: 0 },
  ]),
);

function tierSum(t: Record<string, number>): number {
  return Object.values(t).reduce((a, b) => a + b, 0);
}

for (let rot = 0; rot < CLASSES.length; rot++) {
  for (let s = 1; s <= SEEDS; s++) {
    const slots = classLineup('sable', rot);
    const world: World = createWorld({ seed: s, players: slots.map((x) => ({ id: x.id, shipClass: x.shipClass })) });
    const bots: Bot[] = slots.map((x) => createBot({ id: x.id, personality: x.personality }, { seed: s }));
    const hullOf = new Map(slots.map((x) => [x.id, x.shipClass]));
    const coreAtCollapse = new Map<number, number>();
    const wasAlive = slots.map(() => true);
    const deaths = slots.map(() => 0);
    // Ore *acquired*: every positive step in a hold, plus every positive step in
    // the bank that a hold did not fund (a bank only ever grows from a hold, so
    // holds alone are the income; the bank is where it survives to).
    const income = slots.map(() => 0);
    const lastCargo = slots.map(() => 0);
    let ticks = 0;
    while (!isOver(world) && world.time < 1200 && ticks < 120_000) {
      step(world, botInputs(world, bots, TICK_DT), TICK_DT);
      ticks++;
      if (world.match.collapseTime >= 0 && coreAtCollapse.size === 0) {
        for (const st of world.stations) coreAtCollapse.set(st.owner, st.alive ? st.coreHp : 0);
      }
      for (let i = 0; i < slots.length; i++) {
        const sh = world.ships.find((x) => x.id === slots[i]!.id);
        if (!sh) continue;
        if (wasAlive[i] && !sh.alive) deaths[i]!++;
        wasAlive[i] = sh.alive;
        if (sh.cargo > lastCargo[i]!) income[i]! += sh.cargo - lastCargo[i]!;
        lastCargo[i] = sh.cargo;
      }
    }
    for (let i = 0; i < slots.length; i++) {
      const hull = hullOf.get(slots[i]!.id)!;
      const row = rows.get(hull)!;
      const sh = world.ships.find((x) => x.id === slots[i]!.id);
      const st = world.stations.find((x) => x.owner === slots[i]!.id);
      row.matches++;
      row.banked += sh?.banked ?? 0;
      row.tiers += sh ? tierSum(sh.tiers as unknown as Record<string, number>) : 0;
      row.coreAtCollapse += coreAtCollapse.get(slots[i]!.id) ?? 0;
      row.coreAtEnd += st?.alive ? st.coreHp : 0;
      row.deaths += deaths[i]!;
      row.income += income[i]!;
      row.defences += (st?.turrets.length ?? 0) + (st?.shields.length ?? 0);
      if (world.match.winner === slots[i]!.id) row.wins++;
    }
  }
}

const pad = (s: string, n: number): string => s.padEnd(n);
console.log(`hull-diag: ${SEEDS} seeds × ${CLASSES.length} rotations, behaviour=sable (${PERSONALITIES.sable.difficulty})`);
console.log(
  `${pad('hull', 13)}${pad('win%', 8)}${pad('ore in', 9)}${pad('tiers', 8)}${pad('defences', 10)}${pad('core@collapse', 15)}${pad('core@end', 10)}${pad('deaths', 8)}`,
);
for (const cls of CLASSES) {
  const r = rows.get(cls)!;
  const per = (n: number): string => (n / r.matches).toFixed(1);
  console.log(
    `${pad(cls, 13)}${pad(`${((100 * r.wins) / (r.matches / 2)).toFixed(1)}`, 8)}${pad(per(r.income), 9)}${pad(per(r.tiers), 8)}${pad(per(r.defences), 10)}${pad(per(r.coreAtCollapse), 15)}${pad(per(r.coreAtEnd), 10)}${pad(per(r.deaths), 8)}`,
  );
}
