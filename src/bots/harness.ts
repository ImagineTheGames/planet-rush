/**
 * src/bots/harness.ts — bots fill the empty slots, and a match runs headless.
 * OWNER: Bot Engineer (GDD §2.9, §4.2, §3.8).
 *
 * Two jobs, one file:
 *
 *  1. **Filling the lobby.** "A solo player offline still gets a full 8-station
 *     match with a memorable cast" (GDD §3.3), and online "bots fill empty slots
 *     server-side, so a 3-human classroom match is still an 8-station war"
 *     (GDD §4.2). {@link fillEmptySlots} is that rule, and it is deterministic:
 *     the same humans always meet the same cast in the same seats.
 *
 *  2. **Running one headless.** {@link runHeadlessMatch} steps the sim with bot
 *     inputs and no renderer, no window, no clock — the seed of the QA harness
 *     (GDD §3.8). It carries an **enforced match timeout**, because "a hung
 *     match is a failed test, not a hung harness": the loop always terminates
 *     and reports *why*.
 *
 * The bots' side of the tick is deliberately thin: perceive (`./perception`),
 * decide (`./bot`), emit `Action[]`. The sim receives the identical `Inputs`
 * shape a network of humans would produce — one code path, no bot branch inside
 * the simulation (GDD §2.4).
 */

import type { Action, PlayerId } from '@shared/types';
import type { Inputs, PlayerInput, PlayerSpec, World } from '../sim';
import { TICK_DT, isOver, step } from '../sim';
import type { Bot, BotOptions, BotSeat } from './bot';
import { NO_ACTIONS, createBot } from './bot';
import type { Perception } from './perception';
import { DEFAULT_PERCEPTION, perceive } from './perception';
import type { PersonalityId } from './personalities';
import { PERSONALITIES, ROSTER } from './personalities';

/** Slots in a match — eight stations, always (GDD §2.1). */
export const MATCH_SLOTS = 8;

// ---------------------------------------------------------------------------
// Filling the lobby
// ---------------------------------------------------------------------------

/**
 * Seat a bot in every slot below `slots` that no human holds, in roster order
 * (GDD §2.9). Deterministic and side-effect free: same humans in, same cast out,
 * on the client and on the server.
 *
 * The roster has seven characters and a match has at most seven empty slots, so
 * the cycle below never actually repeats a name in a real lobby — it exists so
 * that a widened `slots` (a QA harness running sixteen) degrades to a repeated
 * character rather than an undefined one.
 *
 * **Teams are a table indexed by slot, and FFA supplies none.** `teams[id]` is
 * the side slot `id` fights for — the same shape `sim/match-config.ts` resolves
 * a lobby into, and the same shape the offline boot stamps onto its roster. An
 * absent entry (or an absent table, which is every FFA lobby) leaves the seat
 * with **no `team` key at all**, so `createWorld` applies its teams-of-one
 * default and an FFA match is byte-identical to the one this function built
 * before teams existed. That absence is load-bearing: assigning `team:
 * undefined` would not compile under `exactOptionalPropertyTypes`, and if it did
 * it would still be the wrong thing to ship (`docs/team-bots-plan.md`, Trap 10).
 *
 * @param humans slots already taken by people.
 * @param slots  total slots in the match.
 * @param roster the cast to draw from, in order.
 * @param teams  per-slot side table, indexed by slot id. Omit for FFA.
 */
export function fillEmptySlots(
  humans: readonly PlayerId[] = [],
  slots: number = MATCH_SLOTS,
  roster: readonly PersonalityId[] = ROSTER,
  teams?: readonly number[],
): BotSeat[] {
  const taken = new Set(humans);
  const seats: BotSeat[] = [];
  for (let id = 0; id < slots; id++) {
    if (taken.has(id)) continue;
    const character = roster[seats.length % roster.length];
    if (character === undefined) break; // empty roster: no bots, not a crash
    const team = teams?.[id];
    seats.push(team === undefined ? { id, personality: character } : { id, personality: character, team });
  }
  return seats;
}

/**
 * The lobby rows a seated cast contributes to `createWorld` — each bot brings
 * its character's hull (style-guide §4: the livery is a palette swap over one of
 * the four silhouettes). Humans' rows are the caller's to add; concatenate and
 * sort by id if the world config wants them in slot order.
 *
 * **A seat's side travels with it** (`BotSeat.team`). This line used to drop
 * everything but the id and the hull, which meant a caller could seat a team
 * lineup and get an FFA world — bots on "teams" that the simulation had never
 * heard of, which is the worst of both and reads as a bot bug for a day
 * (`docs/team-bots-plan.md`, Trap 1). The spread is conditional so an FFA seat
 * produces a spec with **no `team` key**, not a `team: undefined`: `createWorld`
 * distinguishes the two, and only the first is teams-of-one (Trap 10).
 */
export function botLobby(seats: readonly BotSeat[]): PlayerSpec[] {
  return seats.map((seat) => {
    const spec: PlayerSpec = { id: seat.id, shipClass: PERSONALITIES[seat.personality].shipClass };
    return seat.team === undefined ? spec : { ...spec, team: seat.team };
  });
}

/** Construct the bots for a seated cast (`./bot`). */
export function createBots(seats: readonly BotSeat[], options: BotOptions = {}): Bot[] {
  return seats.map((seat) => createBot(seat, options));
}

// ---------------------------------------------------------------------------
// The per-tick input stream
// ---------------------------------------------------------------------------

/** How the harness feeds bots. */
export interface BotTickOptions {
  /** Perception envelope handed to every bot. Defaults to the fog-honest
   *  baseline; narrowing it narrows behavior, and it cannot be widened past
   *  `HUMAN_VISUAL_RANGE`. */
  readonly perception?: Perception;
}

/**
 * One tick of bot thinking, as `Inputs` the sim can consume directly.
 *
 * Each bot's reaction cadence is applied here rather than inside the tree: a bot
 * whose interval has not elapsed re-emits the stream it decided last time,
 * exactly like a human whose hands have not moved. That is a competence knob
 * (GDD §2.9) and, not incidentally, keeps an eight-bot match from re-perceiving
 * the world sixty times a second per slot.
 *
 * Dead-but-respawning bots keep thinking (a human stares at the respawn clock
 * and plans); **eliminated** bots emit nothing at all — their match is over
 * (GDD §2.7).
 *
 * Returns only the bots' rows. Human inputs are the caller's to merge, which is
 * what makes a mixed 3-human/5-bot match one code path.
 */
export function botInputs(
  world: World,
  bots: readonly Bot[],
  dt: number = TICK_DT,
  options: BotTickOptions = {},
): Inputs {
  const env = options.perception ?? DEFAULT_PERCEPTION;
  const inputs: PlayerInput[] = [];
  for (const bot of bots) {
    inputs.push({ id: bot.seat.id, actions: thinkOnce(world, bot, dt, env) });
  }
  return inputs;
}

/**
 * Advance one bot's decision scheduler and return the stream it is holding.
 * Exported because the match server drives bots the same way the offline loop
 * does, one bot at a time.
 */
export function thinkOnce(
  world: World,
  bot: Bot,
  dt: number,
  env: Perception = DEFAULT_PERCEPTION,
): readonly Action[] {
  bot.sinceDecision += dt;
  if (bot.sinceDecision < bot.reactionInterval) return bot.actions;
  bot.sinceDecision = 0;

  const view = perceive(world, bot.seat.id, env);
  const decided = view.self.eliminated ? NO_ACTIONS : bot.decide(view);
  // Emit the decision once; hold only what a human would still be holding.
  bot.actions = holdable(decided);
  return decided;
}

/**
 * The part of a decision a bot may keep pressing between decisions.
 *
 * Held verbs — thrust, aim, fire — are exactly that: a stick position and
 * a trigger a human's hands are still on, and re-sending them every tick is the
 * point of the reaction cadence. **Wheel and upgrade-panel presses are not.**
 * They are one-shot by contract (`@shared/types`: "acted on for the tick it
 * appears in and never held, so a … press can never double-charge by being
 * latched") — and a bot that latched one would re-order a turret on every tick
 * of its reaction interval, buying ten of them in a sixth of a second and
 * emptying its bank into the build queue.
 *
 * That bug is invisible in the action *type* and fatal in the action *stream*,
 * so it is fixed here, in the one place that re-emits a stream, rather than
 * asked of every tree.
 *
 * Returns the same array when there is nothing to strip, which is almost every
 * decision — no allocation on the common path (GDD §4.3).
 */
export function holdable(actions: readonly Action[]): readonly Action[] {
  for (const action of actions) {
    if (action.type === 'buildOrder' || action.type === 'upgradeOrder') {
      return actions.filter((a) => a.type !== 'buildOrder' && a.type !== 'upgradeOrder');
    }
  }
  return actions;
}

// ---------------------------------------------------------------------------
// The headless match loop (the seed of the QA harness — GDD §3.8)
// ---------------------------------------------------------------------------

/**
 * Hard ceiling on a headless match, seconds of **sim time**. The design target
 * is a 10–15 minute match (GDD §1) and collapse is guaranteed by ~12.5 minutes
 * at baseline constants; twenty minutes is therefore comfortably "this match is
 * not going to end". TUNABLE.
 */
export const DEFAULT_MATCH_TIMEOUT_S = 20 * 60;

/** Options for {@link runHeadlessMatch}. */
export interface MatchRunOptions {
  /** Fixed timestep. Defaults to the sim's `TICK_DT` (60 Hz). */
  readonly dt?: number;
  /** Enforced timeout in sim seconds — the loop stops even if nobody won. */
  readonly maxSeconds?: number;
  readonly perception?: Perception;
  /** Extra inputs to merge each tick — human players, or a scripted probe. */
  readonly extraInputs?: (world: World, dt: number) => Inputs;
  /** Called after every step; the QA harness hangs its sampling off this. */
  readonly onTick?: (world: World, tick: number) => void;
}

/** What a headless match produced. */
export interface MatchRunResult {
  readonly world: World;
  /** Ticks stepped by this call. */
  readonly ticks: number;
  /** Sim seconds elapsed at the end of the run. */
  readonly seconds: number;
  /** True when the match reached a result (GDD §1). */
  readonly ended: boolean;
  /** The winning slot, or null if the run stopped before a result. */
  readonly winner: PlayerId | null;
  /** True when the timeout stopped the loop — **a failed match, not a passed
   *  one** (GDD §3.8). */
  readonly timedOut: boolean;
}

/**
 * Run a match to its ending with no renderer and no wall clock (GDD §4.1: the
 * sim runs headless; §3.8: the QA harness runs bot-vs-bot matches with an
 * enforced timeout).
 *
 * The loop is exactly: gather bot actions → `step` → check the ending. Nothing
 * here reaches into the world; the only writer is the simulation.
 */
export function runHeadlessMatch(
  world: World,
  bots: readonly Bot[],
  options: MatchRunOptions = {},
): MatchRunResult {
  const dt = options.dt ?? TICK_DT;
  const maxSeconds = options.maxSeconds ?? DEFAULT_MATCH_TIMEOUT_S;
  const tickOptions: BotTickOptions = options.perception ? { perception: options.perception } : {};

  let ticks = 0;
  while (!isOver(world) && world.time < maxSeconds) {
    const inputs = botInputs(world, bots, dt, tickOptions);
    const extra = options.extraInputs?.(world, dt);
    step(world, extra && extra.length > 0 ? [...inputs, ...extra] : inputs, dt);
    ticks++;
    options.onTick?.(world, ticks);
  }

  const ended = isOver(world);
  return {
    world,
    ticks,
    seconds: world.time,
    ended,
    winner: ended ? world.match.winner : null,
    timedOut: !ended,
  };
}
