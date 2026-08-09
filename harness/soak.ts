/**
 * harness/soak.ts — the release soak and the **shipped-bot** balance instrument.
 * OWNER: QA Agent (GDD §3.8, §2.11).
 *
 * The rest of the harness measures the QA *probes* (`./strategies`) — the fixed
 * reference corners of the triangle, kept because "every difficulty tier on
 * `main` still runs the do-nothing baseline" was true when they were written.
 * That is no longer true: the Easy/Medium/Hard trees are merged, and the
 * classroom plays *them*. This file measures the shipped product.
 *
 * It answers three of QA's four measurable targets against the real bots, and it
 * carries the same enforced ceilings the probe harness does (`./match`) — a hung
 * match is a failed test, never a hung harness (GDD §3.8):
 *
 *  1. **Soak / termination** — N eight-slot matches of the real offline cast
 *     (`fillEmptySlots`, GDD §2.9). Zero hangs is the pass; the match-length
 *     distribution (GDD §1: 10–15 min) is read off the same runs.
 *  2. **Ship class ≤ 55%** (GDD §2.11) — one behaviour, four hulls rotated
 *     across the seats, so a win is attributable to the hull and nothing else.
 *  3. **Strategy ≤ 55%** (GDD §3.8) — one hull, the three *equally-skilled*
 *     Hard characters rotated across the seats, so a win is attributable to the
 *     triangle strategy the character leans on, not to a difficulty gap (of
 *     course Hard beats Easy — that is what difficulty is *for*, and it is not
 *     what this target measures).
 *
 * Nothing here reads a clock, an env var, or a random source to decide *what* to
 * run: the run is its arguments, and the ceilings live outside `step` so they can
 * never influence the world.
 */

import type { PlayerId } from '@shared/types';
import { ShipClass } from '@shared/types';
import type { PlayerSpec, World } from '../src/sim';
import type { Abundance } from '../src/sim';
import { TICK_DT, createWorld, fieldOre, isOver, resolveEconomy, step, waveIntervalOf } from '../src/sim';
import type { Bot, PersonalityId } from '../src/bots';
import {
  Difficulty,
  MATCH_SLOTS,
  PERSONALITIES,
  botInputs,
  createBot,
  fillEmptySlots,
  rosterAt,
} from '../src/bots';
import { hashState } from './hash';
import { MATCH_TIMEOUT_S, MATCH_WALL_CLOCK_MS } from './match';

// ---------------------------------------------------------------------------
// One seat, and one match
// ---------------------------------------------------------------------------

/** One seat: which character flies it, in which hull. Character drives the tree
 *  and the competence tier; hull is the lobby choice, set independently on the
 *  world (GDD §2.11) — which is exactly what lets a class contest hold the
 *  behaviour fixed and vary only the shape. */
export interface BotSlot {
  readonly id: PlayerId;
  readonly personality: PersonalityId;
  readonly shipClass: ShipClass;
}

/** Why a run stopped short of a result. `null` means it ended properly. A
 *  `sim-timeout` is a *match* that would not end (a target-1 failure); the other
 *  two are the *harness* refusing to hang, and they are the soak's real gate. */
export type SoakFailure = 'sim-timeout' | 'wall-clock' | 'stalled';

/** Everything one shipped-bot match produced. */
export interface BotMatchResult {
  readonly seed: number;
  /** Reached a real ending inside every ceiling. */
  readonly ok: boolean;
  readonly failure: SoakFailure | null;
  /** Sim seconds elapsed — the match-length target is measured on this (GDD §1). */
  readonly seconds: number;
  readonly ticks: number;
  readonly wallClockMs: number;
  readonly winner: PlayerId | null;
  readonly winnerPersonality: PersonalityId | null;
  readonly winnerDifficulty: Difficulty | null;
  readonly winnerClass: ShipClass | null;
  readonly fieldOreLeft: number;
  readonly hash: string;
  /** Ore chipped out of rock over the whole match (`world.ledger.mined`) — the
   *  numerator of the ore-per-minute the scarcity reports are measured on (p11,
   *  a0-17). `0` on a world built without a ledger. */
  readonly oreMined: number;
  /** Sim time collapse opened, or `-1` if it never did (GDD §2.3). */
  readonly collapseTime: number;
  /** Waves actually delivered. Below `WAVE_COUNT` means the schedule outran the
   *  match — the "the last wave never mattered" check (a0-17). */
  readonly wavesSpawned: number;
  /** The wave interval this match actually ran on (`world.economy.waveInterval`). */
  readonly waveInterval: number;
}

/** How a soak match is run. Defaults are the probe harness's ceilings, so the
 *  two instruments diagnose a hang identically. */
export interface SoakRunOptions {
  readonly dt?: number;
  readonly maxSeconds?: number;
  readonly maxWallClockMs?: number;
  /** Ore scarcity this match runs at (p11). Omitted keeps `createWorld`'s
   *  legacy-safe `standard` baseline, so every pre-a0-17 soak is unchanged. */
  readonly abundance?: Abundance;
  /** Candidate wave interval (seconds) forced onto the resolved economy right
   *  after construction — the a0-17 measuring instrument, so a candidate
   *  `respawnInterval` can be priced without editing the constants table between
   *  runs. See `./match` `MatchSetup.waveIntervalOverride` for why this is exact:
   *  `world.economy.waveInterval` is the one number every consumer reads
   *  (`waveIntervalOf`, a0-16) and wave 1 lands at t=0 regardless. */
  readonly waveIntervalOverride?: number;
}

/** Wall-clock guard cadence — mirrors `./match`. */
const WALL_CLOCK_CHECK_TICKS = 256;

/**
 * Run one eight-slot match of the *real* trees to its ending — or to whichever
 * ceiling it hits first. The loop is exactly: think → `step` → check the ending
 * → check the ceilings, and it always returns (GDD §3.8).
 */
export function runBotMatch(
  seed: number,
  slots: readonly BotSlot[],
  options: SoakRunOptions = {},
): BotMatchResult {
  const dt = options.dt ?? TICK_DT;
  if (!(dt > 0)) throw new Error(`runBotMatch: dt must be positive, got ${dt}`);
  const maxSeconds = options.maxSeconds ?? MATCH_TIMEOUT_S;
  const maxWallClockMs = options.maxWallClockMs ?? MATCH_WALL_CLOCK_MS;
  const maxTicks = Math.ceil((maxSeconds / dt) * 1.5) + 1;

  const players: PlayerSpec[] = slots.map((s) => ({ id: s.id, shipClass: s.shipClass }));
  const world: World = createWorld({
    seed,
    players,
    ...(options.abundance !== undefined ? { abundance: options.abundance } : {}),
  });
  if (options.waveIntervalOverride !== undefined) {
    const iv = options.waveIntervalOverride;
    if (!(iv > 0)) throw new Error(`runBotMatch: waveIntervalOverride must be positive, got ${iv}`);
    world.economy = { ...(world.economy ?? resolveEconomy()), waveInterval: iv };
  }
  const bots: Bot[] = slots.map((s) => createBot({ id: s.id, personality: s.personality }, { seed }));

  const startedAt = performance.now();
  let failure: SoakFailure | null = null;
  let ticks = 0;

  while (!isOver(world)) {
    if (world.time >= maxSeconds) {
      failure = 'sim-timeout';
      break;
    }
    if (ticks >= maxTicks) {
      failure = 'stalled';
      break;
    }
    if (ticks % WALL_CLOCK_CHECK_TICKS === 0 && performance.now() - startedAt > maxWallClockMs) {
      failure = 'wall-clock';
      break;
    }
    step(world, botInputs(world, bots, dt), dt);
    ticks++;
  }

  const wallClockMs = performance.now() - startedAt;
  const ended = isOver(world);
  const winner = ended ? world.match.winner : null;
  const bySlot = new Map<PlayerId, BotSlot>(slots.map((s) => [s.id, s]));
  const wSlot = winner === null ? undefined : bySlot.get(winner);
  const wp = wSlot ? PERSONALITIES[wSlot.personality] : undefined;

  return {
    seed,
    ok: ended && failure === null,
    failure,
    seconds: world.time,
    ticks,
    wallClockMs,
    winner,
    winnerPersonality: wSlot?.personality ?? null,
    winnerDifficulty: wp?.difficulty ?? null,
    winnerClass: wSlot?.shipClass ?? null,
    fieldOreLeft: fieldOre(world),
    hash: hashState(world),
    oreMined: world.ledger?.mined ?? 0,
    collapseTime: world.match.collapseTime,
    wavesSpawned: world.match.wavesSpawned,
    waveInterval: waveIntervalOf(world),
  };
}

// ---------------------------------------------------------------------------
// Lineups
// ---------------------------------------------------------------------------

/** The four hulls in report order (GDD §2.11). */
export const CLASSES: readonly ShipClass[] = [
  ShipClass.Interceptor,
  ShipClass.Vanguard,
  ShipClass.Excavator,
  ShipClass.Hauler,
];

/**
 * The real offline cast: `fillEmptySlots` seats the roster in slot order, and
 * each seat flies its character's assigned hull (GDD §2.9, §2.11 — "a silhouette
 * on the minimap is information"). This is the exact match a solo player gets,
 * so it is the honest thing to soak for hangs and to time.
 */
export function rosterCast(): BotSlot[] {
  return fillEmptySlots([], MATCH_SLOTS).map((s) => ({
    id: s.id,
    personality: s.personality,
    shipClass: PERSONALITIES[s.personality].shipClass,
  }));
}

/**
 * One behaviour, four hulls dealt round-robin across the eight seats and rotated
 * by `rotation` — the class contest (GDD §2.11). Every hull holds two of the
 * eight seats, so fair share is 25% and a win is attributable to the shape.
 */
export function classLineup(behaviour: PersonalityId, rotation = 0): BotSlot[] {
  return Array.from({ length: MATCH_SLOTS }, (_, id) => ({
    id,
    personality: behaviour,
    shipClass: CLASSES[(id + rotation) % CLASSES.length]!,
  }));
}

/**
 * One hull, a pool of equally-skilled characters dealt round-robin across the
 * seats and rotated — the strategy contest (GDD §3.8). Holding skill and shape
 * fixed makes a win attributable to the triangle strategy a character leans on.
 */
export function strategyLineup(
  pool: readonly PersonalityId[],
  hull: ShipClass,
  rotation = 0,
): BotSlot[] {
  if (pool.length === 0) throw new Error('strategyLineup: empty pool');
  return Array.from({ length: MATCH_SLOTS }, (_, id) => ({
    id,
    personality: pool[(id + rotation) % pool.length]!,
    shipClass: hull,
  }));
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/** The win-rate ceiling every contestant must sit under (GDD §2.11, §3.8). */
export const WIN_RATE_CEILING = 0.55;

/** Match-length target, in sim seconds (GDD §1: 10–15 minutes). */
export const LENGTH_TARGET_MIN_S = 10 * 60;
export const LENGTH_TARGET_MAX_S = 15 * 60;

/** Termination breakdown of a batch of runs. `hangs` is the soak's gate: a
 *  wall-clock or stalled run is the harness failing to terminate (GDD §3.8), as
 *  opposed to a `simTimeout`, which is a match that would not end. */
export interface TerminationStats {
  readonly matches: number;
  readonly ended: number;
  readonly simTimeout: number;
  readonly hangs: number;
  readonly maxWallClockMs: number;
}

export function terminationStats(results: readonly BotMatchResult[]): TerminationStats {
  let ended = 0;
  let simTimeout = 0;
  let hangs = 0;
  let maxWallClockMs = 0;
  for (const r of results) {
    if (r.ok) ended++;
    else if (r.failure === 'sim-timeout') simTimeout++;
    else hangs++;
    if (r.wallClockMs > maxWallClockMs) maxWallClockMs = r.wallClockMs;
  }
  return { matches: results.length, ended, simTimeout, hangs, maxWallClockMs };
}

/** Distribution of match length over the runs that produced a result. */
export interface LengthStats {
  readonly n: number;
  readonly min: number;
  readonly p10: number;
  readonly median: number;
  readonly mean: number;
  readonly p90: number;
  readonly max: number;
  /** Fraction of decided matches inside the 10–15 min target (GDD §1). */
  readonly insideFraction: number;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i]!;
}

/** Length stats over the *decided* matches only — a timed-out match has no
 *  length to speak of, and folding the ceiling into the median would launder a
 *  termination failure into a length number. */
export function lengthStats(results: readonly BotMatchResult[]): LengthStats {
  const decided = results.filter((r) => r.ok).map((r) => r.seconds);
  const sorted = [...decided].sort((a, b) => a - b);
  const n = sorted.length;
  const inside = decided.filter((s) => s >= LENGTH_TARGET_MIN_S && s <= LENGTH_TARGET_MAX_S).length;
  return {
    n,
    min: n ? sorted[0]! : 0,
    p10: quantile(sorted, 0.1),
    median: quantile(sorted, 0.5),
    mean: n ? decided.reduce((a, b) => a + b, 0) / n : 0,
    p90: quantile(sorted, 0.9),
    max: n ? sorted[n - 1]! : 0,
    insideFraction: n ? inside / n : 0,
  };
}

/** One contestant's record in a contest. */
export interface WinRecord {
  readonly name: string;
  readonly entered: number;
  readonly decided: number;
  readonly wins: number;
  /** Wins as a fraction of decided matches — the number the 55% ceiling caps. */
  readonly rate: number;
}

/**
 * Win rate by contestant, over the *decided* matches. Every contestant is
 * present in every match of a rotated contest, so `decided` is shared and the
 * rates sum to 100% — one winner per match. Sorted highest-first, because the
 * verdict is about the *top* of the list.
 */
export function winRates(
  results: readonly BotMatchResult[],
  contestants: readonly string[],
  keyOf: (r: BotMatchResult) => string | null,
): WinRecord[] {
  const decided = results.filter((r) => r.ok && r.winner !== null).length;
  const wins = new Map<string, number>(contestants.map((c) => [c, 0]));
  for (const r of results) {
    if (!(r.ok && r.winner !== null)) continue;
    const k = keyOf(r);
    if (k !== null && wins.has(k)) wins.set(k, wins.get(k)! + 1);
  }
  return contestants
    .map((c) => ({ name: c, entered: results.length, decided, wins: wins.get(c)!, rate: decided ? wins.get(c)! / decided : 0 }))
    .sort((a, b) => b.rate - a.rate);
}

/** The three Hard characters — the equally-skilled strategy pool (GDD §2.9). */
export const HARD_POOL: readonly PersonalityId[] = rosterAt(Difficulty.Hard);
