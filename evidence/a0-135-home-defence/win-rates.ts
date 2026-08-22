/**
 * evidence/a0-135-home-defence/win-rates.ts — **did a0-135 change who wins?**
 * OWNER: Bot Engineer (a0-135; GDD §2.11, §3.8).
 *
 * a0-135 changes how bots fight — a threatened home outranks self-preservation
 * at any hull fraction, so every bot in the cast now holds its own doorstep on
 * ticks it used to spend running from it — and the brief says out loud that
 * "this makes every bot defend harder and that will move numbers". This is the
 * measurement of how far. It is a copy of `evidence/a0-107-dead-band/win-rates.ts`
 * verbatim but for its own env prefix, so a0-105's, a0-107's and this branch's
 * numbers are comparable line for line. It is the
 * shipped instrument
 * rather than a bespoke one: `harness/soak.ts`'s own two 55% contests
 * (`strategyLineup`, `classLineup`), run over the same seeds on both builds.
 *
 *  - **Strategy contest** (GDD §3.8) — one hull, the three equally-skilled Hard
 *    characters rotated across the eight seats, so a win is attributable to the
 *    triangle strategy and not to a difficulty gap. Fair share is 1/3.
 *  - **Class contest** (GDD §2.11) — one behaviour, four hulls rotated, so a win
 *    is attributable to the silhouette. Fair share is 1/4.
 *
 * Both are capped at `WIN_RATE_CEILING` (0.55). The run shape is
 * `harness/abundance.ts`'s `readContests` verbatim — every seed plays every
 * rotation, so a seat-order advantage cancels inside each seed rather than
 * across the sweep — and the class contest holds `HARD_POOL[0]` fixed for the
 * same reason it does there. Nothing here reads a clock or a random source to
 * decide what to run: the run is its arguments.
 *
 * Run:    npx vite-node evidence/a0-135-home-defence/win-rates.ts
 *         A0135_SEEDS=8 A0135_CONTEST=strategy npx vite-node evidence/a0-135-home-defence/win-rates.ts
 * Prints: both tables to stdout (pasted into ./win-rates-before.txt and
 *         ./win-rates-after.txt, and into tests/reports/a0-135-home-defence.md).
 *
 * The default is 32 seeds — 96 strategy matches and 128 class matches — which is
 * the shape a0-107 recorded its own numbers at, so the two are the same sample.
 */

import { ShipClass } from '../../src/shared/types';
import {
  HARD_POOL,
  WIN_RATE_CEILING,
  classLineup,
  lengthStats,
  runBotMatch,
  strategyLineup,
  winRates,
} from '../../harness/soak';
import type { BotMatchResult } from '../../harness/soak';
import { CLASSES } from '../../harness/soak';

/** Seeds per contest; each one plays every rotation, so the strategy contest is
 *  `SEEDS × 3` matches and the class contest `SEEDS × 4`. */
const SEEDS = Number(process.env.A0135_SEEDS ?? 32);

/** `strategy`, `class`, or `both` (default) — the class contest is four matches
 *  a seed and there is no reason to pay for it when tightening the other one. */
const ONLY = process.env.A0135_CONTEST ?? 'both';

/** The behaviour the class contest holds fixed — `HARD_POOL[0]`, exactly as
 *  `readContests` picks it, so the hulls are compared under one Hard tree. */
const CLASS_BEHAVIOUR = HARD_POOL[0]!;

function table(title: string, results: readonly BotMatchResult[], rows: ReturnType<typeof winRates>): void {
  const length = lengthStats(results);
  const timeouts = results.filter((r) => !r.ok).length;
  console.log('');
  console.log(`${title} — ${results.length} matches, ${timeouts} unfinished`);
  console.log(`  match length: mean ${Math.round(length.mean)}s, min ${Math.round(length.min)}s, max ${Math.round(length.max)}s`);
  for (const row of rows) {
    const verdict = row.rate > WIN_RATE_CEILING ? 'OVER' : 'ok';
    console.log(`  ${row.name.padEnd(12)} ${row.wins}/${row.decided}  ${(row.rate * 100).toFixed(1)}%  ${verdict}`);
  }
}

const strategy: BotMatchResult[] = [];
if (ONLY !== 'class') for (let seed = 1; seed <= SEEDS; seed++) {
  for (let rot = 0; rot < HARD_POOL.length; rot++) {
    strategy.push(runBotMatch(seed * 1000 + rot, strategyLineup(HARD_POOL, ShipClass.Vanguard, rot)));
  }
}
if (strategy.length) table(
  'strategy contest (GDD §3.8) — Hard pool, Vanguard, fair share 33.3%',
  strategy,
  winRates(strategy, [...HARD_POOL], (r) => r.winnerPersonality),
);

const klass: BotMatchResult[] = [];
if (ONLY !== 'strategy') for (let seed = 1; seed <= SEEDS; seed++) {
  for (let rot = 0; rot < CLASSES.length; rot++) {
    klass.push(runBotMatch(seed * 1000 + rot, classLineup(CLASS_BEHAVIOUR, rot)));
  }
}
if (klass.length) table(
  `class contest (GDD §2.11) — ${CLASS_BEHAVIOUR}, four hulls, fair share 25%`,
  klass,
  winRates(klass, CLASSES.map((c) => String(c)), (r) => (r.winnerClass === null ? null : String(r.winnerClass))),
);
