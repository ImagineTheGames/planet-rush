/**
 * src/bots/tree.ts — the behavior-tree kernel. OWNER: Bot Engineer (GDD §2.9).
 *
 * "Bots are hand-coded behavior trees … no LLM calls at runtime" (GDD §2.9), so
 * this is the whole runtime: a prioritised selector over named leaves. Thirty
 * lines of machinery, because the interesting part of a bot is the *order of its
 * priorities*, and that order should be readable straight down the page of
 * `./easy`, `./medium`, `./hard` rather than buried in a framework.
 *
 * The rules:
 *
 *  - A **leaf** returns an `Action[]` if it wants the tick, or `null` to pass.
 *  - A **selector** runs its children in order and takes the first non-null —
 *    so the top of the list is the highest priority, always.
 *  - The leaf that wins records its own name in {@link Brain.lastBehavior}. That
 *    is a debugging and QA affordance, not state the tree reads: no branch is
 *    allowed to behave differently because of what fired last tick.
 *
 * There is no running state, no ticking node status, no blackboard beyond the
 * fog-honest {@link BotMemory}. A tree is re-evaluated from scratch on every
 * decision, which is what makes a bot's behavior a pure function of what it can
 * see (plus its own seeded RNG) — and therefore testable.
 */

import type { Action, Rng, Vec2 } from '@shared/types';
import { BotMemory } from './memory';
import type { BotView, SelfView } from './perception';
import type { DifficultyTuning, Personality, PersonalityWeights } from './personalities';
import { tuningFor } from './personalities';
import { NEUTRAL } from './steering';

// ---------------------------------------------------------------------------
// The brain: everything about a bot that is not the view
// ---------------------------------------------------------------------------

/**
 * A bot's persistent, private mind. Lives beside the simulation, never inside
 * it: the determinism replay hashes the world (GDD §4.8), and feeding it
 * recorded inputs must not depend on bot internals (`./bot`).
 */
export interface Brain {
  readonly personality: Personality;
  readonly weights: PersonalityWeights;
  readonly tuning: DifficultyTuning;
  /** This bot's own seeded stream. Never `Math.random` (GDD §4.1). */
  readonly rng: Rng;
  readonly memory: BotMemory;
  /** Name of the leaf that won the last decision. Written by the tree, read by
   *  tests, the QA harness, and a future debug overlay — never by a branch. */
  lastBehavior: string;
  /** Where the ship was at the previous decision, for {@link Brain.stuckFor}. */
  lastPos: Vec2 | null;
  /**
   * Consecutive decisions this bot has asked to move and barely moved — the
   * wedged counter. Asteroids and planets are solid, the late waves land in a
   * tight cluster (GDD §2.3: every wave closer to the centre than the last), and
   * two rocks five units apart make a gap no hull fits through. A bot that keeps
   * asking to fly through that gap is not thinking, it is grinding, and
   * `./behaviors` reads this to break the cycle.
   */
  stuckFor: number;
  /**
   * Magnitude of the thrust the last decision actually asked for (0..1), written
   * by `./behaviors`'s `go`. The wedged counter reads it so that *deliberately*
   * holding station — a miner parked at its rock, a bot orbiting its own planet
   * with the wheel open — never reads as being stuck.
   */
  lastThrust: number;
  /** Sim time an escape run ends, or -1 when the bot is flying normally. See
   *  `./behaviors`'s `go`. */
  escapeUntil: number;
  /** The committed escape heading while `escapeUntil` is in the future. */
  escapeDir: Vec2;
}

/** Build the mind for a character. */
export function createBrain(personality: Personality, rng: Rng): Brain {
  return {
    personality,
    weights: personality.weights,
    tuning: tuningFor(personality.id),
    rng,
    memory: new BotMemory(),
    lastBehavior: 'init',
    lastPos: null,
    stuckFor: 0,
    lastThrust: 0,
    escapeUntil: -1,
    escapeDir: { x: 0, y: 0 },
  };
}

// ---------------------------------------------------------------------------
// The per-decision context
// ---------------------------------------------------------------------------

/** Everything a leaf is handed: this tick's view, and the bot's own mind. */
export interface BotCtx {
  readonly view: BotView;
  /** `view.self`, hoisted — every leaf wants it. */
  readonly self: SelfView;
  readonly brain: Brain;
  readonly weights: PersonalityWeights;
  readonly tuning: DifficultyTuning;
  readonly rng: Rng;
  readonly memory: BotMemory;
}

/**
 * Distance a bot must cover between decisions to count as "moving". Well under
 * the ~20 units even a slow hull travels in one Medium reaction interval, so
 * only a ship that is genuinely pinned trips it. TUNABLE
 */
export const STUCK_MOVE = 3;

/** Throttle a decision must have asked for before a stationary result counts as
 *  wedged rather than as station-keeping. TUNABLE */
export const STUCK_THROTTLE = 0.7;

/** Consecutive stationary decisions before a bot treats itself as wedged. About
 *  a second at every tier's cadence. TUNABLE */
export const STUCK_DECISIONS = 12;

/**
 * Open a decision: fold the view into memory (once — every leaf then reads the
 * same picture), update the wedged counter, and hand back the context the tree
 * runs on.
 */
export function context(view: BotView, brain: Brain): BotCtx {
  brain.memory.observe(view);
  trackStuck(view, brain);
  // Cleared here and re-written by `go`: a decision that never asks to travel
  // leaves it at zero, and cannot be mistaken for a bot pinned against a rock.
  brain.lastThrust = 0;
  return {
    view,
    self: view.self,
    brain,
    weights: brain.weights,
    tuning: brain.tuning,
    rng: brain.rng,
    memory: brain.memory,
  };
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/** Count consecutive decisions spent going nowhere (see {@link Brain.stuckFor}). */
function trackStuck(view: BotView, brain: Brain): void {
  const pos = view.self.pos;
  const last = brain.lastPos;
  if (last === null) {
    brain.lastPos = { x: pos.x, y: pos.y };
    return;
  }
  const dx = pos.x - last.x;
  const dy = pos.y - last.y;
  const pinned = brain.lastThrust >= STUCK_THROTTLE && Math.sqrt(dx * dx + dy * dy) < STUCK_MOVE;
  brain.stuckFor = pinned ? brain.stuckFor + 1 : 0;
  last.x = pos.x;
  last.y = pos.y;
}

/** A node returns the tick's actions, or null to let the next sibling try. */
export interface Node {
  readonly name: string;
  run(ctx: BotCtx): readonly Action[] | null;
}

/** A named leaf. Records itself as the winning behavior when it takes a tick. */
export function leaf(name: string, run: (ctx: BotCtx) => readonly Action[] | null): Node {
  return {
    name,
    run(ctx: BotCtx): readonly Action[] | null {
      const actions = run(ctx);
      if (actions !== null) ctx.brain.lastBehavior = name;
      return actions;
    },
  };
}

/**
 * A leaf with a precondition, spelled as two functions so the *when* reads
 * separately from the *what*. Exactly equivalent to an `if` inside a leaf; it
 * exists because a tree of `when(...)` rows is a priority list you can read
 * top-to-bottom without entering any of the bodies.
 */
export function when(
  name: string,
  test: (ctx: BotCtx) => boolean,
  run: (ctx: BotCtx) => readonly Action[] | null,
): Node {
  return leaf(name, (ctx) => (test(ctx) ? run(ctx) : null));
}

/** First child that wants the tick wins. Priority is list order, top first. */
export function selector(name: string, children: readonly Node[]): Node {
  return {
    name,
    run(ctx: BotCtx): readonly Action[] | null {
      for (const child of children) {
        const actions = child.run(ctx);
        if (actions !== null) return actions;
      }
      return null;
    },
  };
}

/**
 * Run a tree for one decision. A tree that wants nothing emits the neutral
 * stream rather than an empty one: emitting *something* is what proves the
 * action channel end-to-end (`./bot`).
 */
export function runTree(root: Node, ctx: BotCtx): readonly Action[] {
  const actions = root.run(ctx);
  if (actions === null) {
    ctx.brain.lastBehavior = 'idle';
    return NEUTRAL;
  }
  return actions;
}
