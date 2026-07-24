/**
 * src/bots/bot.ts — the bot contract, and the do-nothing baseline. OWNER: Bot
 * Engineer (GDD §2.9, §3.3).
 *
 * A bot is **an action source, not a special player**. It fills a slot, it gets
 * a fog-honest {@link BotView} of the world (`./perception`), and it emits the
 * same `Action[]` a keyboard, a gamepad, or a thumb would produce — the sim
 * cannot tell the difference, and that is the whole design (GDD §2.4: "the
 * simulation never sees a device").
 *
 * Three rules this file exists to hold:
 *
 *  1. **No `World` reaches a tree.** `decide` takes a view. A bot physically
 *     cannot read a hidden core's HP, so fog-honesty is a type, not a promise.
 *  2. **No LLM calls, ever.** Runtime token cost is zero (GDD §3, §2.9). Trees
 *     are hand-written code and nothing else.
 *  3. **No `Math.random`.** A bot's randomness comes from its own seeded
 *     mulberry32 (`@shared/types`), so a match replays identically as long as
 *     the bots are reconstructed with the same seed. Bot state lives *outside*
 *     the world tree on purpose: the determinism replay (GDD §4.8) hashes the
 *     sim, and feeding it recorded inputs must not depend on bot internals.
 *
 * **Day 4 lands the three trees.** `./easy`, `./medium` and `./hard` are the
 * GDD §2.9 paragraph in priority order; this file is only the wiring — seat,
 * character, seeded stream, decision cadence, and the {@link Brain} that carries
 * a bot's expiring memory beside the simulation rather than inside it.
 *
 * {@link doNothing} stays, because it is the baseline the harness and the QA
 * match loop are proven against: a match of eight bots that do nothing still has
 * to spawn eight planets, run five waves, enter collapse, and produce a winner,
 * and that claim is about the simulation rather than about the bots.
 */

import type { Action, PlayerId, Rng } from '@shared/types';
import { mulberry32 } from '@shared/types';
import { easyTree } from './easy';
import { hardTree } from './hard';
import { mediumTree } from './medium';
import type { BotView } from './perception';
import type { Personality, PersonalityId } from './personalities';
import { Difficulty, personality, tuningFor } from './personalities';
import type { Brain, Node } from './tree';
import { context, createBrain, runTree } from './tree';

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

/**
 * A bot's place in the lobby: which slot it occupies and which character it is
 * (GDD §2.1 — humans and bots share one id space, a slot is a slot).
 */
export interface BotSeat {
  readonly id: PlayerId;
  readonly personality: PersonalityId;
}

// ---------------------------------------------------------------------------
// The bot
// ---------------------------------------------------------------------------

/**
 * One bot. The mutable fields are its decision scheduler — the harness owns
 * them (`./harness`), and they are on the bot rather than in a side table so a
 * bot is one object a caller can hold, inspect, and throw away.
 */
export interface Bot {
  readonly seat: BotSeat;
  readonly personality: Personality;
  readonly difficulty: Difficulty;
  /**
   * Seconds between decisions — reaction time modelled as cadence
   * (`DIFFICULTY_TUNING`). Between decisions the bot holds `actions`, exactly
   * like a human whose hands have not moved yet.
   */
  readonly reactionInterval: number;
  /** This bot's private deterministic random source. Never `Math.random`. */
  readonly rng: Rng;
  /**
   * The mind behind the tree (`./tree`): character weights, tier tuning, the
   * seeded stream, and the expiring fog-honest memory (`./memory`). Exposed so a
   * test or a debug overlay can ask *why* a bot did something —
   * `brain.lastBehavior` names the leaf that won the last decision.
   */
  readonly brain: Brain;
  /** Seconds since the last decision. Harness-owned. */
  sinceDecision: number;
  /** The action stream held between decisions. Harness-owned. */
  actions: readonly Action[];
  /**
   * The behavior tree. Pure with respect to the simulation: it sees only the
   * view, and its only output is actions.
   */
  decide(view: BotView): readonly Action[];
}

/**
 * The neutral stream: hands on the stick, nothing pressed. A do-nothing bot
 * emits this rather than an empty array, because emitting *something* is what
 * proves the action channel end-to-end — a bot that sends no actions and a bot
 * whose actions are dropped look identical from the sim's side.
 *
 * Frozen and shared: the same array every tick for every bot, so an idle
 * eight-slot match allocates nothing per frame (GDD §4.3).
 */
const IDLE: Action[] = [
  { type: 'thrust', dir: Object.freeze({ x: 0, y: 0 }) },
  { type: 'fire', active: false, auto: false },
];
export const IDLE_ACTIONS: readonly Action[] = Object.freeze(IDLE.map((a) => Object.freeze(a)));

/** No actions at all — what an eliminated or dead bot sends (GDD §2.7). */
export const NO_ACTIONS: readonly Action[] = Object.freeze([]);

/**
 * The do-nothing tree: hold position, hold fire, forever.
 *
 * The baseline every later tree is measured against, and the fixed point of the
 * QA harness — a match of these must still reach an ending, because the ending
 * is structural (waves, then collapse; GDD §2.3) rather than something the
 * players do to each other.
 */
export function doNothing(): readonly Action[] {
  return IDLE_ACTIONS;
}

/** Options for constructing a bot. */
export interface BotOptions {
  /**
   * Match seed. Each bot derives its own stream from `seed` and its slot, so two
   * bots in one match never share a sequence and the same match replays the same
   * way. Defaults to a fixed constant — deterministic, never `Date.now()`.
   */
  readonly seed?: number;
}

/** Default bot seed. Any constant will do; it must not be time-derived. */
export const DEFAULT_BOT_SEED = 0x50_4c_4e_54; // 'PLNT'

/**
 * Mix a match seed with a slot into a per-bot 32-bit seed. Cheap avalanche
 * (xorshift-multiply), so adjacent slots do not produce adjacent streams.
 */
export function botSeed(seed: number, id: PlayerId): number {
  let h = (seed ^ (id * 0x9e37_79b9)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x21f0_aaad) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * Build the bot for a seat: its character, its tier's tree, its own seeded
 * stream, and the mind that carries memory between decisions.
 *
 * Difficulty is applied *around* the tree as well as inside it — the tier's
 * `reactionInterval` is copied onto the bot here, so a Hard bot re-decides
 * twenty times a second and an Easy bot six, which is reaction time modelled as
 * cadence (GDD §2.9) and costs the tree nothing.
 */
export function createBot(seat: BotSeat, options: BotOptions = {}): Bot {
  const character = personality(seat.personality);
  const tuning = tuningFor(seat.personality);
  const rng = mulberry32(botSeed(options.seed ?? DEFAULT_BOT_SEED, seat.id));
  const brain = createBrain(character, rng);
  const tree = treeFor(character.difficulty);

  return {
    seat,
    personality: character,
    difficulty: character.difficulty,
    reactionInterval: tuning.reactionInterval,
    rng,
    brain,
    // Due immediately: a fresh bot decides on its first tick rather than
    // idling for one reaction interval.
    sinceDecision: tuning.reactionInterval,
    actions: IDLE_ACTIONS,
    decide: (view: BotView) => runTree(tree, context(view, brain)),
  };
}

/**
 * The tree a tier runs (GDD §2.9). An exhaustive switch, so adding a tier is a
 * compile error rather than a silently missing behavior.
 *
 * The trees are module-level constants rather than per-bot constructions: a tree
 * is pure structure — priority order and pure leaves — and everything mutable
 * about a bot lives in its {@link Brain}. Eight bots therefore share three tree
 * objects and allocate nothing per decision beyond the actions they emit
 * (GDD §4.3).
 */
export function treeFor(difficulty: Difficulty): Node {
  switch (difficulty) {
    case Difficulty.Easy:
      return easyTree;
    case Difficulty.Medium:
      return mediumTree;
    case Difficulty.Hard:
      return hardTree;
  }
}

/**
 * A bot that does nothing regardless of its character — the explicit baseline
 * for tests and for the day-2 offline match. Identical to {@link createBot}
 * today; it stays as its own entry point so the QA harness can keep asking for
 * "the do-nothing baseline" after the real trees land.
 */
export function createDoNothingBot(seat: BotSeat, options: BotOptions = {}): Bot {
  const bot = createBot(seat, options);
  return { ...bot, decide: doNothing };
}
