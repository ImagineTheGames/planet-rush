/**
 * harness/ — the headless QA balance harness. OWNER: QA Agent (GDD §3.8, §4.8).
 *
 * Runs bot-vs-bot matches with an **enforced timeout** (a hung match is a failed
 * test, not a hung harness) and reduces a batch of them to the two numbers the
 * design promises the player: match length lands in 10–15 minutes, and no
 * strategy and no class wins more than 55% of an eight-way field (GDD §1, §2.11,
 * §3.8). Imports `src/sim` and `src/bots` headless — never PixiJS (GDD §4.1).
 *
 * The harness is **bot-agnostic**: it seats whatever `src/bots` produces and
 * measures the result. On the day-2 do-nothing baseline it measures a structural
 * ending; against the day-4 behaviour trees it measures a real match. Nothing
 * here reaches into the world — the only writer is the simulation, so a replay
 * of the same seed is byte-identical (GDD §4.8).
 *
 * `harness/stats.ts` holds the pure aggregation; this file holds the loop.
 */

import type { PlayerId, ShipClass } from '@shared/types';
import {
  DEFAULT_MATCH_TIMEOUT_S,
  MATCH_SLOTS,
  botLobby,
  createBots,
  fillEmptySlots,
  runHeadlessMatch,
} from '../src/bots/harness';
import { createWorld } from '../src/sim';
import type { MatchOutcome } from './stats';
import { summarize } from './stats';

export * from './stats';

/** How to run one balance match. Every field has a deterministic default. */
export interface BalanceMatchOptions {
  /** Slots in the match — eight planets by default (GDD §2.1). */
  readonly slots?: number;
  /** Enforced timeout in sim seconds. Defaults to the harness ceiling
   *  (`DEFAULT_MATCH_TIMEOUT_S`, 20 min) — comfortably past a 10–15 min match,
   *  so a timeout means "this match was never going to end." */
  readonly maxSeconds?: number;
  /** Asteroids per wave, overriding the sim default (`WAVE.asteroidsPerWave`).
   *  The balance batch leaves this unset — it measures the shipped field. */
  readonly asteroidCount?: number;
}

/**
 * Run one full-roster bot match to its ending and reduce it to a
 * {@link MatchOutcome}. The seed drives both the world and the bots, so the same
 * seed always produces the same match (GDD §4.8) — which is what makes a batch a
 * repeatable experiment rather than a sample of noise.
 */
export function runMatch(seed: number, options: BalanceMatchOptions = {}): MatchOutcome {
  const slots = options.slots ?? MATCH_SLOTS;
  const seats = fillEmptySlots([], slots);
  const world = createWorld({
    seed,
    players: botLobby(seats),
    ...(options.asteroidCount != null ? { asteroidCount: options.asteroidCount } : {}),
  });
  const bots = createBots(seats, { seed });
  const result = runHeadlessMatch(world, bots, {
    maxSeconds: options.maxSeconds ?? DEFAULT_MATCH_TIMEOUT_S,
  });

  const winner: PlayerId | null = result.winner;
  const winSeat = winner != null ? seats.find((s) => s.id === winner) : undefined;
  const winShip = winner != null ? world.ships.find((s) => s.id === winner) : undefined;
  const winnerClass: ShipClass | null = winShip ? winShip.shipClass : null;
  const winnerStrategy: string | null = winSeat ? winSeat.personality : null;

  return {
    seed,
    ended: result.ended,
    timedOut: result.timedOut,
    seconds: result.seconds,
    ticks: result.ticks,
    winner,
    winnerClass,
    winnerStrategy,
  };
}

/** A contiguous, deterministic seed range — the default batch input. */
export function seedRange(count: number, base = 1): number[] {
  return Array.from({ length: count }, (_, i) => base + i);
}

/** Run a match per seed and return every outcome, in seed order. */
export function runBatch(
  seeds: readonly number[],
  options: BalanceMatchOptions = {},
): MatchOutcome[] {
  return seeds.map((seed) => runMatch(seed, options));
}

/** What a balance run produced: the raw outcomes and their summary. */
export interface BalanceRun {
  readonly outcomes: readonly MatchOutcome[];
  readonly summary: ReturnType<typeof summarize>;
}

/**
 * The whole loop: run `count` matches over a deterministic seed range and
 * summarize them. `onMatch` is called after each match so a long batch can
 * stream progress to a console without this module importing one.
 */
export function runBalance(
  count: number,
  options: BalanceMatchOptions & { readonly base?: number; readonly onMatch?: (o: MatchOutcome, i: number) => void } = {},
): BalanceRun {
  const { base = 1, onMatch, ...matchOptions } = options;
  const seeds = seedRange(count, base);
  const outcomes: MatchOutcome[] = [];
  for (let i = 0; i < seeds.length; i++) {
    const o = runMatch(seeds[i]!, matchOptions);
    outcomes.push(o);
    onMatch?.(o, i);
  }
  return { outcomes, summary: summarize(outcomes) };
}
