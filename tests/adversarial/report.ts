/**
 * tests/adversarial/report.ts — **the table that goes in the report.** OWNER: QA
 * Agent (a0-106).
 *
 * The findings in `tests/reports/a0-106-adversarial.md` are this script's stdout,
 * pasted. It runs the same {@link sweep} the standing gate runs, off the same
 * census and the same antagonists, so the numbers in the report and the numbers
 * the gate asserts on can never drift apart — there is one implementation and
 * two readers of it.
 *
 * Run:    npx vite-node tests/adversarial/report.ts
 *         A0106_SECONDS=600 npx vite-node tests/adversarial/report.ts   (the deep look)
 */

import { ANTAGONISTS } from './antagonist';
import { LATCHES } from './latches';
import { CAST, inert, overBound, seconds, sweep, tierOf } from './sweep';

const cells = sweep();

console.log(`a0-106 — every latch × every antagonist × every character`);
console.log(`${ANTAGONISTS.length} antagonists × ${CAST.length} characters × ${LATCHES.length} latches`);
console.log('');

for (const latch of LATCHES) {
  const bound = latch.boundS === null ? 'unbounded by design' : `bound ${latch.boundS}s`;
  console.log(`## ${latch.id}  (${bound})`);
  console.log(`   ${latch.where}`);
  console.log('');
  console.log('   antagonist        character  tier    held (ticks / s)   turned to        fire%  moved  flag');
  for (const cell of cells) {
    const h = cell.holds.get(latch.id)!;
    if (h.ticks === 0) continue;
    const flags: string[] = [];
    if (overBound(latch, h)) flags.push('OVER-BOUND');
    if (inert(h)) flags.push('INERT');
    if (h.openAtCeiling) flags.push('AT-CEILING');
    if (h.endedByDeath) flags.push('ended-by-death');
    console.log(
      `   ${cell.antagonist.id.padEnd(16)}  ${cell.personality.padEnd(9)}  ${cell.tier.padEnd(6)}  ` +
        `${String(h.ticks).padStart(5)} / ${seconds(h.ticks).toFixed(2).padStart(6)}s   ` +
        `${h.turnedTo.padEnd(15)}  ${(h.firedFrac * 100).toFixed(0).padStart(3)}%  ` +
        `${h.travelled.toFixed(0).padStart(5)}  ${flags.join(' ')}`,
    );
  }
  const never = cells.filter((c) => c.holds.get(latch.id)!.ticks === 0);
  if (never.length === cells.length) console.log('   (never engaged in any cell)');
  else if (never.length > 0) {
    const by = new Map<string, number>();
    for (const c of never) by.set(c.antagonist.id, (by.get(c.antagonist.id) ?? 0) + 1);
    console.log(
      `   not engaged: ${[...by].map(([a, n]) => `${a}×${n}`).join(', ')}`,
    );
  }
  console.log('');
}

// The per-tier roll-up the brief asks for: worst hold of each latch at each tier.
console.log('## worst hold per latch × tier (seconds)');
console.log('');
const tiers = [...new Set(CAST.map(tierOf))];
console.log(`latch              ${tiers.map((t) => t.padStart(9)).join('')}`);
for (const latch of LATCHES) {
  const cols = tiers.map((tier) => {
    const worst = Math.max(
      0,
      ...cells.filter((c) => c.tier === tier).map((c) => c.holds.get(latch.id)!.ticks),
    );
    return (worst === 0 ? '—' : seconds(worst).toFixed(2)).padStart(9);
  });
  console.log(`${latch.id.padEnd(18)} ${cols.join('')}`);
}
console.log('');

const breaches = cells.flatMap((c) =>
  LATCHES.filter((l) => overBound(l, c.holds.get(l.id)!) || inert(c.holds.get(l.id)!)).map((l) => ({
    latch: l.id,
    antagonist: c.antagonist.id,
    personality: c.personality,
    h: c.holds.get(l.id)!,
  })),
);
console.log(`## defects: ${breaches.length}`);
for (const b of breaches) {
  console.log(
    `   ${b.latch} × ${b.antagonist} × ${b.personality}: ${b.h.ticks} ticks ` +
      `(${seconds(b.h.ticks).toFixed(2)}s), fire ${(b.h.firedFrac * 100).toFixed(0)}%, moved ${b.h.travelled.toFixed(0)}u`,
  );
}
