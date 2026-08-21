/**
 * evidence/a0-121-excavator-penalty/stats.ts — the two columns, side by side.
 *
 * GDD §2.11 states the class table as *ratios* relative to the Vanguard. The
 * simulation reads those ratios out of `SHIP_STATS` and multiplies them by
 * absolutes that live nowhere in §2.11 — `BASE_SPEED`, `BASE_ACCEL`,
 * `BASE_TURN_RATE`. This prints the design's column beside the simulation's, in
 * the units a ship actually moves in, so "what the sim charges" is a number
 * rather than an argument.
 *
 * Run: npx vite-node evidence/a0-121-excavator-penalty/stats.ts
 */

import { ShipClass } from '@shared/types';
import {
  BASE_ACCEL,
  BASE_SPEED,
  BASE_TURN_RATE,
  SHIP_STATS,
  DRAG,
  SHIP_WEAPON,
} from '../../src/sim/constants';

/** GDD §2.11's table, transcribed by hand from the document. */
const GDD: Readonly<Record<ShipClass, readonly [number, number, number, number, number, number]>> = {
  // speed% / accel% / turn% / hull / power / cargo
  [ShipClass.Interceptor]: [130, 120, 140, 35, 8, 2],
  [ShipClass.Vanguard]: [100, 100, 100, 50, 10, 2],
  [ShipClass.Excavator]: [90, 100, 80, 55, 13, 2],
  [ShipClass.Hauler]: [85, 80, 85, 70, 9, 3],
};

const ORDER: readonly ShipClass[] = [
  ShipClass.Interceptor,
  ShipClass.Vanguard,
  ShipClass.Excavator,
  ShipClass.Hauler,
];

const f = (n: number, d = 2): string => n.toFixed(d);

/** Seconds to swing the nose through π radians at a hull's own turn rate. */
const flip180 = (cls: ShipClass): number => Math.PI / (BASE_TURN_RATE * SHIP_STATS[cls].turnMul);

/** Seconds to reach `frac` of top speed from rest under `v' = a − v·DRAG`,
 *  which is the only thing `accelMul` buys: terminal speed is clamped, so accel
 *  is purely the approach time. */
function timeToFraction(cls: ShipClass, frac: number): number {
  const a = BASE_ACCEL * SHIP_STATS[cls].accelMul;
  const vTop = BASE_SPEED * SHIP_STATS[cls].speedMul;
  const vTerm = a / DRAG; // where drag alone would settle
  const target = frac * vTop;
  if (target >= vTerm) return Number.POSITIVE_INFINITY;
  return -Math.log(1 - target / vTerm) / DRAG;
}

console.log('## The design column and the simulation column\n');
console.log('| hull | GDD §2.11 speed / accel / turn | sim top speed (u/s) | sim accel (u/s²) | sim turn (rad/s) | 180° flip (s) | 0→90% top speed (s) |');
console.log('|---|---|---|---|---|---|---|');
for (const cls of ORDER) {
  const s = SHIP_STATS[cls];
  const g = GDD[cls];
  console.log(
    `| \`${cls}\` | ${g[0]}% / ${g[1]}% / ${g[2]}% | ${f(BASE_SPEED * s.speedMul, 1)} | ${f(BASE_ACCEL * s.accelMul, 0)} | ` +
      `${f(BASE_TURN_RATE * s.turnMul)} | ${f(flip180(cls), 3)} | ${f(timeToFraction(cls, 0.9), 3)} |`,
  );
}

console.log('\n## Does the sim transcribe §2.11? (ratio read back out of SHIP_STATS)\n');
console.log('| hull | speed | accel | turn | hull HP | power | cargo |');
console.log('|---|---|---|---|---|---|---|');
let allMatch = true;
for (const cls of ORDER) {
  const s = SHIP_STATS[cls];
  const g = GDD[cls];
  const got = [s.speedMul * 100, s.accelMul * 100, s.turnMul * 100, s.hull, s.power, s.cargo];
  const cells = got.map((v, i) => {
    const ok = Math.abs(v - g[i]!) < 1e-9;
    if (!ok) allMatch = false;
    return ok ? `${g[i]} ✓` : `${g[i]} → **${v}**`;
  });
  console.log(`| \`${cls}\` | ${cells.join(' | ')} |`);
}
console.log(`\n**Every cell of GDD §2.11 is transcribed exactly: ${allMatch ? 'YES' : 'NO'}.**`);

console.log('\n## What the excavator pays, against the Vanguard, in seconds\n');
const exFlip = flip180(ShipClass.Excavator);
const vanFlip = flip180(ShipClass.Vanguard);
console.log(`- 180° flip: **${f(exFlip, 3)} s** vs the Vanguard's ${f(vanFlip, 3)} s — a deficit of **${f(exFlip - vanFlip, 3)} s**.`);
console.log(`- That deficit is ${f((exFlip - vanFlip) / SHIP_WEAPON.fireInterval, 2)}× the weapon's \`fireInterval\` (${SHIP_WEAPON.fireInterval} s) — it costs at most one shot per full reversal.`);
const exSpeed = BASE_SPEED * SHIP_STATS[ShipClass.Excavator].speedMul;
console.log(`- Top speed: **${f(exSpeed, 1)} u/s** vs ${f(BASE_SPEED, 1)} — over a 1000-unit ore run that is **${f(1000 / exSpeed - 1000 / BASE_SPEED, 2)} s** on a round trip leg.`);
