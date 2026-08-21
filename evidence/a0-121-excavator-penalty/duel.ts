/**
 * evidence/a0-121-excavator-penalty/duel.ts — the §2.11 rock-paper-scissors,
 * priced.
 *
 * GDD §2.11 states an intended triangle: *"the Interceptor catches miners in the
 * open but melts against turrets; the Excavator out-earns everyone but can't
 * run."* Catching a miner is only worth something if catching it kills it, so
 * this prints the time-to-kill matrix the class table implies — power against
 * hull, at stock tier, with no upgrades — beside the mining rate each hull earns.
 *
 * Pure arithmetic over `SHIP_STATS`: no match is run, so nothing here can drift
 * from the class table it reads.
 *
 * Run: npx vite-node evidence/a0-121-excavator-penalty/duel.ts
 */

import { ShipClass } from '@shared/types';
import { BASE_SPEED, SHIP_STATS, miningRate, classWeaponDps } from '../../src/sim/constants';

const ORDER: readonly ShipClass[] = [
  ShipClass.Interceptor,
  ShipClass.Vanguard,
  ShipClass.Excavator,
  ShipClass.Hauler,
];

const short = (c: ShipClass): string => String(c).slice(0, 4);

console.log('## Time to kill, stock hulls, no upgrades (seconds)\n');
console.log('Rows shoot, columns die. `∞` never happens — nothing here is ever a stalemate.\n');
console.log(`| shooter (dps) | ${ORDER.map((c) => `vs \`${c}\` (${SHIP_STATS[c].hull} hp)`).join(' | ')} |`);
console.log(`|---|${ORDER.map(() => '---').join('|')}|`);
for (const a of ORDER) {
  const dps = classWeaponDps(a);
  const cells = ORDER.map((d) => (a === d ? '—' : (SHIP_STATS[d].hull / dps).toFixed(2)));
  console.log(`| \`${a}\` (${dps}) | ${cells.join(' | ')} |`);
}

console.log('\n## Who wins a head-on duel, and by how much margin\n');
console.log('| pairing | A kills B in | B kills A in | winner | margin |');
console.log('|---|---|---|---|---|');
for (let i = 0; i < ORDER.length; i++) {
  for (let j = i + 1; j < ORDER.length; j++) {
    const a = ORDER[i]!;
    const b = ORDER[j]!;
    const ta = SHIP_STATS[b].hull / classWeaponDps(a);
    const tb = SHIP_STATS[a].hull / classWeaponDps(b);
    const win = ta < tb ? a : b;
    console.log(
      `| \`${short(a)}\` vs \`${short(b)}\` | ${ta.toFixed(2)} s | ${tb.toFixed(2)} s | **\`${win}\`** | ${(Math.max(ta, tb) / Math.min(ta, tb)).toFixed(2)}× |`,
    );
  }
}

console.log('\n## The two columns that decide it, ranked\n');
console.log('| hull | mining (ore/s) | weapon dps | hull hp | top speed (u/s) | dps × hp (duel score) |');
console.log('|---|---|---|---|---|---|');
for (const c of [...ORDER].sort((x, y) => classWeaponDps(y) * SHIP_STATS[y].hull - classWeaponDps(x) * SHIP_STATS[x].hull)) {
  console.log(
    `| \`${c}\` | ${miningRate(c).toFixed(3)} | ${classWeaponDps(c)} | ${SHIP_STATS[c].hull} | ` +
      `${(BASE_SPEED * SHIP_STATS[c].speedMul).toFixed(0)} | **${classWeaponDps(c) * SHIP_STATS[c].hull}** |`,
  );
}
