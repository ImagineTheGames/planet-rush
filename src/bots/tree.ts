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
import type { AllyResponse } from './ally';
import { newAllyResponse, releaseAllyResponse } from './ally';
import type { Latch } from './commitment';
import { newLatch, release } from './commitment';
import type { CorneredLatch } from './cornered';
import { newCorneredLatch, resetCornered } from './cornered';
import { BotMemory } from './memory';
import type { BotView, SelfView } from './perception';
import type { DifficultyTuning, Personality, PersonalityWeights } from './personalities';
import { tuningFor } from './personalities';
import type { TeamRadio } from './radio';
import type { AimTrack } from './steering';
import { NEUTRAL, newAimTrack } from './steering';

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
  /**
   * The **progress anchor**: the position net movement is measured from, for
   * {@link Brain.stuckFor}. It is *not* last decision's position — it is the last
   * place the bot demonstrably got *away* from. It moves forward only when the
   * ship clears {@link STUCK_PROGRESS} of it (real headway) or stops asking to
   * travel (legitimate station-keeping); a bot that keeps thrusting but only
   * jitters inside that radius leaves the anchor where it is, and `stuckFor`
   * climbs. Measuring net progress rather than per-decision steps is what catches
   * the wedge the field report photographed: a hull grinding against a body slides
   * a few units each decision — enough to look like motion tick-to-tick, never
   * enough to go anywhere.
   */
  lastPos: Vec2 | null;
  /**
   * Consecutive decisions this bot has asked to move and barely moved — the
   * wedged counter. Asteroids and stations are solid, the late waves land in a
   * tight cluster (GDD §2.3: every wave closer to the centre than the last), and
   * two rocks five units apart make a gap no hull fits through. A bot that keeps
   * asking to fly through that gap is not thinking, it is grinding, and
   * `./behaviors` reads this to break the cycle.
   */
  stuckFor: number;
  /**
   * Magnitude of the thrust the last decision actually asked for (0..1), written
   * by `./behaviors`'s `go`. The wedged counter reads it so that *deliberately*
   * holding station — a miner parked at its rock, a bot orbiting its own station
   * with the wheel open — never reads as being stuck.
   */
  lastThrust: number;
  /** Sim time an escape run ends, or -1 when the bot is flying normally. See
   *  `./behaviors`'s `go`. */
  escapeUntil: number;
  /** The committed escape heading while `escapeUntil` is in the future. */
  escapeDir: Vec2;
  /**
   * The reaction-latency state for combat aim: the lead velocity this bot last
   * committed to and when (`./steering` `trackAimVelocity`,
   * `DifficultyTuning.aimLatency`). Carried on the brain so the lag persists
   * across decisions — a target that juked two decisions ago is still being led
   * where it was going. Reset the moment the bot turns to a different target.
   */
  readonly aim: AimTrack;
  /**
   * The flee/fight commitment (`./commitment`, v0.2.2 field report). A wounded
   * bot breaking off latches this *on* and holds it until it has actually
   * escaped or its hull is whole again — so the tree cannot flap between fleeing
   * and re-engaging every time backing off nudges the threat out of range. The
   * bit lives here, on the brain, because a commitment is memory that must
   * persist across decisions; a strictly-higher priority (a core under final
   * assault) {@link release}s it (`./behaviors` `wantsRetreat`).
   */
  readonly fleeing: Latch;
  /**
   * The **cornered** commitment (`./cornered`; developer report p15). A damaged
   * bot whose own station sits behind a ship parked on the line between them is
   * in a trap the flee latch above cannot see: fear pushes it back, home pulls
   * it through, and the two cancel. This latch is what lets the bot notice
   * (after its tier's lag) and then *commit to the fight* for a minimum window
   * during which its fear model gets no vote at all — the ratified
   * "CORNERED = COMMIT TO ATTACK".
   *
   * Beside {@link Brain.fleeing} rather than folded into it because the two are
   * different kinds of memory: the flee latch remembers a *state*, this one
   * remembers a *decision and its deadline*.
   */
  readonly cornered: CorneredLatch;
  /**
   * The asteroid id this bot committed to mining on its last mining decision, or
   * `-1` when it is not mining (`./behaviors`'s `mine`). Two things read it, both
   * from the re-site work (p11 field report — "kept going back and forth" to a
   * contested rock while other fields sat open):
   *
   *  - the **tabu** below, so a retreat that broke off an *approach* knows which
   *    site to cool down (`./behaviors`'s `wantsRetreat`);
   *  - the oscillation soak (`tests/harness/oscillation.test.ts`), so a standing
   *    gate can watch a bot make net progress toward the rock it chose.
   *
   * Written by the tree, never read by a branch to change what it does — the
   * same debug-affordance discipline as {@link Brain.lastBehavior}.
   */
  mineSite: number;
  /**
   * Sim time this bot committed to {@link mineSite} — *when I called it*, and the
   * only thing that settles a dead heat between two teammates who chose the same
   * rock (`./targeting` `foldAllyClaims`, Stage 3).
   *
   * A `claim` carries the sender's own commit time as its `seenAt`, so comparing
   * the two answers "who was on this first?" without a negotiation and without a
   * slot-order bias. **Strictly earlier wins**: on an exact tie — two bots
   * deciding on the same tick, which is common — *neither* defers and both keep
   * the rock, which is precisely today's behaviour and therefore never worse. The
   * alternative, both deferring, is the ping-pong where two teammates leave a good
   * rock together and go and contest the next one together.
   *
   * `-1` when the bot is not mining. Written by `./behaviors`'s `mine`.
   */
  mineSiteAt: number;
  /**
   * **Contested-site memory** (p11 field report point 2): asteroid id → the sim
   * time its mining cool-down lifts. A site whose *approach* triggered a retreat
   * is booked here, and `bestRock` excludes it while the cool-down is live
   * (`./targeting`), so the bot commits to the next-best field instead of
   * re-litigating the same rock with the threat still parked on the path. The
   * entry expires on its own — once the threat leaves and the clock passes, the
   * site is a candidate again. Lives on the brain (bot-private, beside the sim)
   * for the same reason every other commitment does: it is memory that must
   * persist across decisions and must never desync a replay (GDD §4.8).
   *
   * It is *not* {@link BotMemory}: that notebook takes only what the view shows
   * (`./memory`), and a tabu is the bot's own decision history, not a perceived
   * fact.
   */
  readonly tabu: Map<number, number>;
  /**
   * Spendable ore that was already aboard when this bot first took the controls
   * — ore it did not earn, and will not spend (`./behaviors`'s `spendAtHome`).
   *
   * A bot seated at the match opening earns its `STARTING_ORE` grant outright,
   * so its endowment is zero and it spends freely. A bot that takes the stick
   * *mid-match* is a stand-in for a pilot who dropped (GDD §4.2), and the cargo
   * and bank it inherits are the pilot's to reclaim, not the stand-in's to burn
   * on turrets — so they are booked here and only ore the stand-in mines itself
   * lifts `spendable` back above the line. `-1` until the first decision sets it.
   */
  endowment: number;
  /**
   * This bot's side of the **team callout channel** (`./radio`), or `null` when
   * it has nobody to talk to — which is every FFA bot, because a team of one has
   * no recipients. That `null` is how every team-aware branch degrades to exactly
   * today's behaviour with no mode flag anywhere in a tree
   * (`docs/team-bots-plan.md` §2.5).
   *
   * Shared with this bot's teammates, and **deliberately not inside `World`**:
   * the determinism replay hashes the world and replays recorded inputs
   * (GDD §4.8), so a channel in there could desync it — and it would be on the
   * wire budget, which is 494 bytes and not ours (plan Trap 5). It lives here for
   * the same reason everything else on this record does.
   *
   * `null` by default: `createBots` (`./harness`) builds one per side and hands
   * it in, so a caller that seats bots one at a time gets a quiet channel rather
   * than a crash.
   */
  radio: TeamRadio | null;
  /**
   * The **ally-response** commitment (`./ally`): who this bot broke off to help,
   * when that alarm was last live, and when it may answer again. The ally alarm
   * flickers on a two-second window, so a raw read of it flaps; this is the
   * memory between the flickers, and the budget that stops one besieged teammate
   * consuming a whole match.
   */
  readonly allyResponse: AllyResponse;
  /**
   * The **join-the-assault** commitment (`./ally`): which enemy home this bot
   * broke off to help hit, when that raid was last heard of, and when it may
   * join another. The offensive twin of {@link allyResponse} — the same latch
   * type folded by the same function, with its own measured durations, because
   * a raid and a rescue end for completely different reasons.
   *
   * Two latches rather than one because a bot can be *between* commitments on one
   * axis while committed on the other, and folding them together would make the
   * cooldown for answering an alarm also the cooldown for joining a push.
   */
  readonly allyAssault: AllyResponse;
  /**
   * Sim time this bot last spoke on the channel — the `callCooldown` clock
   * (`./behaviors` `callOut`). `-1` until it has said anything.
   *
   * Here rather than on the radio because the cooldown is **per speaker**, not
   * per channel: one voice at a time is a property of a bot's mouth, and one
   * chatty teammate must not be able to mute the rest of the side.
   */
  lastCallAt: number;
}

/** Build the mind for a character. */
export function createBrain(personality: Personality, rng: Rng, radio: TeamRadio | null = null): Brain {
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
    aim: newAimTrack(),
    fleeing: newLatch(),
    cornered: newCorneredLatch(),
    mineSite: -1,
    mineSiteAt: -1,
    tabu: new Map(),
    endowment: -1,
    radio,
    allyResponse: newAllyResponse(),
    allyAssault: newAllyResponse(),
    lastCallAt: -1,
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
 * Net distance a bot must put between itself and its {@link Brain.lastPos}
 * anchor to count as having *gone somewhere* — the threshold that re-anchors the
 * wedged counter and resets it to zero.
 *
 * Deliberately **not** a per-decision step: a hull pinned against a body slides a
 * few units each decision as the collision response trades its inward velocity
 * for a little sideways drift, so a per-step check reads that jitter as motion
 * and never fires (it is exactly why the field-report bot sat wedged for two
 * minutes at full throttle). This is measured against a persistent anchor, so a
 * bot only clears it by actually leaving the spot — comfortably above the
 * observed grind-jitter amplitude (~10 u) and far below the hundreds of units a
 * genuinely travelling hull covers across {@link STUCK_DECISIONS} decisions, so
 * neither a wobble nor a slow thread-through trips a false escape. TUNABLE
 */
export const STUCK_PROGRESS = 24;

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
  // A dead ship holds no commitment: it respawns at full hull (GDD §2.7), so its
  // flee latch must not carry the last life's panic into the next one — nor its
  // cornered commitment the last life's blockade, which the respawn just broke.
  if (!view.self.alive) {
    release(brain.fleeing);
    resetCornered(brain.cornered);
    // And it is not still flying to a teammate's rescue: a respawned bot that
    // resumed a run which ended two lives ago would be answering an alarm nobody
    // is ringing (`./ally`, plan Task 2.7's trap). The *cooldown* survives, on
    // purpose — see `releaseAllyResponse`.
    releaseAllyResponse(brain.allyResponse);
    // The same argument, and it bites harder on the offensive latch: a bot that
    // died at an enemy's doorstep is exactly the bot most likely to still be
    // committed to that doorstep, and respawning at the far end of the map with
    // the raid long over is how a "join" becomes a lone suicide run. Cooldown
    // survives here too — dying on a raid does not earn a free second one.
    releaseAllyResponse(brain.allyAssault);
  }
  // Book the endowment once, on the first decision. A bot seated at the opening
  // (`tick 0`) earns its `STARTING_ORE` grant and owes nothing; a bot that takes
  // over after the match has begun inherits a dropped pilot's ore and must leave
  // it for the reclaim (GDD §4.2). See {@link Brain.endowment}.
  if (brain.endowment < 0) brain.endowment = view.tick > 0 ? view.self.spendable : 0;
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

/**
 * Count consecutive decisions the bot asked to travel and made no net headway
 * (see {@link Brain.stuckFor}). Net headway, not per-decision steps: the anchor
 * ({@link Brain.lastPos}) only moves when the ship clears {@link STUCK_PROGRESS}
 * of it, so a hull grinding against a body — which slides a few units each
 * decision but goes nowhere — accrues `stuckFor` instead of resetting it every
 * time the jitter clears an old per-step threshold. That reset-on-jitter is the
 * defect the field report caught (`./behaviors` reads `stuckFor` to escape).
 */
function trackStuck(view: BotView, brain: Brain): void {
  const pos = view.self.pos;
  const anchor = brain.lastPos;
  if (anchor === null) {
    brain.lastPos = { x: pos.x, y: pos.y };
    return;
  }
  // Not asking to travel is station-keeping, not being stuck (a miner parked at
  // its rock, a bot orbiting home with the wheel open): re-anchor here so a later
  // real departure measures from where the bot actually sat.
  if (brain.lastThrust < STUCK_THROTTLE) {
    brain.stuckFor = 0;
    anchor.x = pos.x;
    anchor.y = pos.y;
    return;
  }
  const dx = pos.x - anchor.x;
  const dy = pos.y - anchor.y;
  if (dx * dx + dy * dy >= STUCK_PROGRESS * STUCK_PROGRESS) {
    // Real headway since the anchor: not wedged. Advance the anchor to here and
    // start measuring the next leg from a clean slate.
    brain.stuckFor = 0;
    anchor.x = pos.x;
    anchor.y = pos.y;
    return;
  }
  // Thrusting, but still inside the progress ring: wedged this decision.
  brain.stuckFor += 1;
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
