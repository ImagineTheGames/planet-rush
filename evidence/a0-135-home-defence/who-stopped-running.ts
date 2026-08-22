/**
 * evidence/a0-135-home-defence/who-stopped-running.ts — **which character this
 * branch takes the most retreat away from.**
 * OWNER: Bot Engineer (a0-135; GDD §2.9, §3.8).
 *
 * The strategy contest's ordering reshuffles across this branch (§7 of the
 * report): Sable 24.0% -> 39.6%, Vulture 39.6% -> 27.1%, both inside the 55%
 * band but larger than one standard error. The three Hard characters are
 * *equally skilled by construction* — they differ only in their tuning table
 * (`src/bots/personalities.ts`) — so a reshuffle has to be attributable to a
 * tuning field or it is noise, and saying which is not something the win column
 * can do.
 *
 * This probe runs the strategy contest with a0-112 telemetry on and pools the
 * behaviour-tree leaf ticks BY CHARACTER rather than by seat, so the question
 * "who was doing the retreating that a0-135 deletes?" gets a number. Same
 * `runBotMatch`, same `strategyLineup`, same seeds and rotations as
 * `win-rates.ts` — only the seed count is smaller (8, so 24 matches per build),
 * because attribution needs a ratio and not a win rate.
 *
 * Run on both builds:
 *   npx vite-node evidence/a0-135-home-defence/who-stopped-running.ts
 */
import { HARD_POOL, runBotMatch, strategyLineup } from '../../harness/soak';
import { ShipClass } from '../../src/shared/types';

const SEEDS = Number(process.env.A0135_SEEDS ?? 8);
const WATCHED = ['retreat', 'fleeing', 'last-stand', 'defend', 'attack', 'mine'] as const;

/** character -> leaf -> ticks, and character -> ticks observed. */
const byChar = new Map<string, Record<string, number>>();
const seen = new Map<string, number>();

for (let seed = 1; seed <= SEEDS; seed++) {
  for (let rot = 0; rot < HARD_POOL.length; rot++) {
    const r = runBotMatch(seed * 1000 + rot, strategyLineup(HARD_POOL, ShipClass.Vanguard, rot), { telemetry: true });
    for (const s of r.telemetry!.seats) {
      const acc = byChar.get(s.personality) ?? {};
      for (const [leaf, n] of Object.entries(s.leafTicks)) acc[leaf] = (acc[leaf] ?? 0) + n;
      byChar.set(s.personality, acc);
      seen.set(s.personality, (seen.get(s.personality) ?? 0) + s.decisions);
    }
  }
}

console.log('');
console.log(`strategy contest — ${SEEDS * HARD_POOL.length} matches, leaf ticks pooled by CHARACTER`);
console.log(`| character | ticks | ${WATCHED.map((w) => `${w} (share)`).join(' | ')} |`);
console.log(`|---|---|${WATCHED.map(() => '---').join('|')}|`);
for (const ch of HARD_POOL) {
  const acc = byChar.get(ch) ?? {};
  const total = seen.get(ch) ?? 1;
  const cells = WATCHED.map((w) => `${acc[w] ?? 0} (${(((acc[w] ?? 0) / total) * 100).toFixed(2)}%)`);
  console.log(`| ${ch} | ${total} | ${cells.join(' | ')} |`);
}
