/**
 * src/bots/ally.ts — the memory of having answered an ally's alarm. OWNER: Bot
 * Engineer (GDD §2.9; `docs/team-bots-plan.md` Stage 2, Task 2.7).
 *
 * The developer, 2026-08-07: *"enemies on teams should try to defend their
 * teammates bases when under attack (if they are under threat as well)"* — and,
 * in the next line, *"same thing for bots on your team"*. Every bot plays as a
 * teammate; this is not an enemy-AI feature.
 *
 * This file is the third of the tree's small commitment primitives, beside
 * `./commitment` (the flee/fight latch) and `./cornered` (the blockade latch),
 * and it exists for the same reason both of those do: a behavior tree
 * re-evaluates from scratch every decision, so a raw condition that flickers
 * produces a bot that flaps. The ally alarm flickers *by construction* —
 * `underAttack` is `sinceDamage < alarmWindow` and `alarmWindow` is two seconds
 * (`./perception`), so an attacker who pauses to line up a shot switches the
 * alarm off and back on. A bot reading that raw would turn for its teammate's
 * home, turn back, and turn again, and never arrive anywhere (plan Trap 7).
 *
 * **It is also the budget.** Answering costs the trip plus the fight, and the
 * plan is explicit that without bounds you get a bot that never mines (§4.2).
 * Three bounds live here, and the fourth lives in the tree:
 *
 *  1. *(the tree's)* the branch sits **below** `last-stand`, `cornered-fight`,
 *     `retreat` and the bot's own `defend` — **my home outranks yours**. The
 *     alarm rings for the team; the priority ladder stays selfish-first. That
 *     distinction is the whole design of the stage, and it is the half that keeps
 *     this from becoming a bot that abandons its economy.
 *  2. a **commitment** that holds across the flicker and clears on "the ally home
 *     went quiet for {@link ALLY_RESPONSE_QUIET} seconds" or "I arrived and there
 *     is nothing to fight";
 *  3. a **ceiling** ({@link ALLY_RESPONSE_MAX}) so a siege the bot cannot break
 *     does not become a permanent posting — without it, clause 2 can never fire
 *     against a *sustained* attacker and the cooldown below never engages;
 *  4. a **cooldown** ({@link ALLY_RESPONSE_COOLDOWN}) after a completed response,
 *     so one besieged ally cannot consume a teammate's whole match.
 *
 * Like its two siblings this carries no domain knowledge on purpose — no ranges,
 * no personalities, no view. The caller supplies the readings and the durations;
 * this file supplies the memory of having decided. The state lives on the
 * {@link import('./tree').Brain}, beside the sim rather than inside it, so it can
 * never desync a determinism replay (GDD §4.8).
 *
 * **That domain-freedom is now load-bearing rather than tidy.** b2-03 ships the
 * offensive half of the same developer ask — *"equally should try to attack when
 * team mates go on offensive"* — and it is a **second instance of this latch**
 * with its own four durations (`ASSAULT_JOIN_*` below), not a second mechanism.
 * Two `AllyResponse`s live on the `Brain`, folded by the same `allyResponseCommit`
 * from two different branches. Anything added here must stay true of both, which
 * in practice means: no view, no ranges, and no assumption about what `arrived`
 * means — the two callers pass it very different questions.
 */

import type { PlayerId, Vec2 } from '@shared/types';

/** No slot — "not answering anybody". */
const NOBODY: PlayerId = -1;

// ---------------------------------------------------------------------------
// The durations (TUNABLE — plan §4.2 recommends, QA Task 2.8 falsifies)
// ---------------------------------------------------------------------------

/**
 * How far a bot will break off to answer a teammate's alarm, before the
 * character's `homebody` leans it (`./behaviors` `allyResponseRange`).
 *
 * **From the measured distribution, not from taste.** The spike weighted every
 * ally-siege second by how far the teammate actually was (plan §1.5): 1200 units
 * covers **93%** of 2v2 and **71%** of 4v4 ally-siege seconds, and 1800 covers
 * 99%/99%. Response range is a *cost* as well as a reach — at ~1200 the round
 * trip is already a meaningful slice of a mining errand — so the plan's
 * recommendation is 1200 with **1800 recorded as the second data point for a
 * re-tune**, which is exactly what QA's sweep (Task 2.8) exists to choose
 * between. Do not invent a third number without a measurement behind it. TUNABLE
 */
export const ALLY_RESPONSE_RANGE = 1200;

/**
 * The range the plan keeps on the shelf: 99% of ally-siege seconds at both team
 * sizes, at a proportionally larger economic cost. Recorded as a named constant
 * rather than a sentence in a comment so a re-tune is one edit and the A/B has
 * something to point at. Unused by shipped behaviour. TUNABLE
 */
export const ALLY_RESPONSE_RANGE_WIDE = 1800;

/**
 * Seconds an answered alarm must read **quiet** before the response ends.
 *
 * Strictly longer than `Perception.alarmWindow` (2 s), and that is the whole
 * point: the alarm is a two-second window, so an attacker between bursts blinks
 * it off. A bot that released on the first quiet read would turn around halfway
 * there, every time. TUNABLE
 */
export const ALLY_RESPONSE_QUIET = 3;

/**
 * Hard ceiling on one response, in seconds. A siege the responder cannot break
 * would otherwise hold the commitment open forever — the "permanent posting" the
 * plan names — because the alarm never goes quiet and the bot never runs out of
 * things to fight. TUNABLE
 */
export const ALLY_RESPONSE_MAX = 45;

/**
 * Seconds before a bot will answer again, measured from the end of its last
 * response. The bound that answers *"one besieged ally cannot consume a
 * teammate's whole match"*: at 30 s a bot under a permanent siege next door
 * spends at most ~60% of its time answering it in the worst case, and in practice
 * far less, because most sieges end well inside {@link ALLY_RESPONSE_MAX}.
 * TUNABLE
 */
export const ALLY_RESPONSE_COOLDOWN = 30;

// ---------------------------------------------------------------------------
// Joining an ally's ATTACK (MEASURED — `evidence/b2-03-assault-window.ts`)
// ---------------------------------------------------------------------------
//
// The developer, 2026-08-07: *"…and equally should try to attack when team mates
// go on offensive."* The offensive half of the same ask, and a **second instance
// of the latch above** rather than a second mechanism — which is the whole reason
// this file carries no domain knowledge.
//
// **What does not transfer, and why these are four fresh numbers.** The defensive
// response ends on *"arrived, and there is nothing to fight"*. An assault that
// arrives to plenty to fight has **succeeded**, so that clause is gone: the join
// latch's only completion is *the objective died*, and everything else leans on
// the ceiling and the cooldown. Inheriting 45/30 would be inheriting numbers
// measured against a different question — and the measurement says they are the
// wrong numbers by a wide margin. `evidence/b2-03-assault-window.ts`, 12 seeds ×
// {2v2, 4v4} at the shipped `scarce` abundance on `octagon`, cutting every
// station's own `underAttack` tell into raids:
//
//   | raid                    |  n  | p50  | p75  | p90  | max  |
//   |-------------------------|-----|------|------|------|------|
//   | all                     | 610 | 2.6s | 4.5s | 7.7s |25.8s |
//   | ended in a dead core    |  29 |10.0s |13.7s |19.7s |25.8s |
//   | petered out             | 581 | 2.6s | 4.2s | 6.6s |18.6s |
//
// **A raid is a short event.** 45 seconds is nearly double the longest raid ever
// observed; a ceiling there would never once bind, which makes it not a ceiling.

/**
 * How far a bot will fly to join a teammate's raid, before the character's
 * `opportunism` leans it (`./behaviors` `assaultJoinRange`).
 *
 * **Measured on the raid distribution, not borrowed from the siege one.** Plan
 * §1.5 weighted every *ally-siege* second by how far the teammate was, and 1200
 * fell out of it; that is a different distribution from "how far is the enemy
 * home my teammate is hitting". Re-run against enemy homes — every raid-second
 * weighted by the nearest teammate not already in the fight — 1200 covers **88%**
 * and 1500 covers **98%**, at ~10.1 s and ~12.7 s of flight at the cast's
 * measured 119 units/s cruise.
 *
 * That it lands on the same number as {@link ALLY_RESPONSE_RANGE} is a result,
 * not a reuse: the two were measured separately and agree. TUNABLE
 */
export const ASSAULT_JOIN_RANGE = 1200;

/**
 * The reach on the shelf: 98% of raid-seconds for a ~25% longer trip. Recorded as
 * a named constant so a re-tune is one edit and the A/B has something to point
 * at, exactly like {@link ALLY_RESPONSE_RANGE_WIDE}. Unused by shipped
 * behaviour. TUNABLE
 */
export const ASSAULT_JOIN_RANGE_WIDE = 1500;

/**
 * Seconds a raid must read **quiet** before the join ends.
 *
 * **This one is derived from the channel, not from the klaxon**, and that is the
 * second thing that does not transfer. {@link ALLY_RESPONSE_QUIET} only has to
 * clear `Perception.alarmWindow` (2 s) because the ally alarm is a live boolean.
 * A raid has no klaxon at all: the only signal is a `push` call, so "quiet" means
 * *my teammate has not said anything about it lately*, and the gap between one
 * teammate's calls is `DifficultyTuning.callCooldown` — **6 s at Easy**.
 *
 * Worse, at Easy a call's readable life is `memorySeconds / HEARSAY_STALENESS` =
 * 3 s while the gap between calls is 6 s, so during a perfectly *continuous* Easy
 * raid the channel is silent half the time. A quiet window under 6 s would
 * release the commitment between two calls of an assault that never stopped.
 * Eight clears the widest cooldown with margin and still sits far under the
 * ceiling. TUNABLE
 */
export const ASSAULT_JOIN_QUIET = 8;

/**
 * Hard ceiling on one join, in seconds — **the number the brief said to measure,
 * and the measurement moved it from 45 to 25.**
 *
 * A join has to buy the trip *and* the fight. The trip is ~10.1 s at the p88
 * reach (1245 units at 119 units/s), and 14.6 s at the widest character's
 * (Sable, 1740). The fight, from the table above, is p50 10.0 s and p75 13.7 s
 * for the raids that actually killed a core — and those are *solo* raids, so a
 * joined one should close faster ("two beats one", GDD §2.6).
 *
 * 25 = the typical trip plus a p75 winning raid (10.1 + 13.7 ≈ 24), and it still
 * covers the widest trip plus a p50 winning raid (14.6 + 10.0 ≈ 25). Below that
 * a joiner arrives and is recalled before it can matter; far above it the ceiling
 * stops being reachable at all. TUNABLE
 */
export const ASSAULT_JOIN_MAX = 25;

/**
 * Seconds before a bot will join again, measured from the end of its last join.
 *
 * **The budget question is different here too.** For the defensive latch it is
 * "one besieged ally must not consume a teammate's whole match", against an
 * attacker who never leaves. There is no offensive equivalent — the measurement
 * found no long raids to be consumed by (p90 7.7 s), and a trace replay of the
 * pure latch across a (max × cooldown) grid put the committed share at ~1% of
 * ticks at *every* pair, so the ceiling/cooldown pair is not what bounds the
 * cost. What actually needs bounding is **ping-pong**: raids are so short and so
 * frequent that a bot could chase a fresh call every few seconds and never mine.
 *
 * So the cooldown is sized against the *trip*, not the siege: 25 s is one full
 * round trip at the measured reach (~10 s each way) plus a working margin, so a
 * bot that answered a call gets its own errand back before it can be pulled out
 * again. The analytic worst case, 25/(25+25) = **50%**, is deliberately tighter
 * than the defensive latch's 60%: your side's core is the win condition and
 * someone else's is not. TUNABLE
 */
export const ASSAULT_JOIN_COOLDOWN = 25;

// ---------------------------------------------------------------------------
// The latch
// ---------------------------------------------------------------------------

/**
 * A bot's memory of a rescue in progress: who it is for, when the alarm was last
 * genuinely live, when the run began, and when it may next answer at all.
 *
 * Four numbers rather than a bare {@link import('./commitment').Latch} because
 * this commitment has to answer four different questions, and folding them into
 * one boolean is how a latch quietly becomes unable to release:
 * {@link target} is *who*, {@link lastLive} is the flicker filter,
 * {@link startedAt} is the ceiling, and {@link readyAt} is the budget.
 */
export interface AllyResponse {
  /**
   * **The subject of the commitment**, or `-1` when there is none. Which slot
   * that is depends on the instance, and the two are deliberately different:
   * for the defensive latch it is the *ally being answered*, and for the assault
   * latch it is the *objective* — the enemy whose home the side is going in on,
   * because "that home is gone" is what ends a raid, not "that teammate is fine".
   */
  target: PlayerId;
  /** Sim time the commitment's subject last read live; `-1` when uncommitted. */
  lastLive: number;
  /** Sim time this response began; `-1` when uncommitted. */
  startedAt: number;
  /** Sim time the cooldown lifts. `-1` means "ready now". */
  readyAt: number;
  /**
   * **Where the trouble was last seen** — the destination the response is flying
   * to, written by the caller each time the distress reads live
   * (`./behaviors` `wantsAllyDefence`).
   *
   * It has to be remembered rather than re-derived, and that is not an
   * optimisation: the alarm blinks off between an attacker's bursts, so a
   * responder that re-read its destination every decision would lose it mid-flight
   * and fall through to mining — the flap this whole latch exists to prevent,
   * moved one level down. Mutated in place; a fresh `Vec2` per decision for eight
   * bots is an allocation the frame budget does not owe (GDD §4.3).
   */
  readonly at: Vec2;
}

/** A fresh latch: nobody answered, nothing owed, ready to go. */
export function newAllyResponse(): AllyResponse {
  return { target: NOBODY, lastLive: -1, startedAt: -1, readyAt: -1, at: { x: 0, y: 0 } };
}

/**
 * Drop the commitment **without** clearing the cooldown — what a death does
 * (`./tree` `context`).
 *
 * A respawned bot must not resume a rescue that ended two lives ago (plan Task
 * 2.7's trap), so the target goes. The cooldown deliberately *stays*: it is an
 * economy budget, not a state of mind, and clearing it on death would hand a bot
 * that keeps dying at its teammate's doorstep an unlimited rescue allowance —
 * exactly the bot this budget exists to prevent.
 */
export function releaseAllyResponse(latch: AllyResponse): void {
  latch.target = NOBODY;
  latch.lastLive = -1;
  latch.startedAt = -1;
}

/** Wipe everything, cooldown included. For tests and for a fresh match. */
export function resetAllyResponse(latch: AllyResponse): void {
  releaseAllyResponse(latch);
  latch.readyAt = -1;
}

/** The ally this bot is committed to, without touching the latch — for the
 *  branch body, for tests, and for a debug overlay. */
export function allyResponseTarget(latch: AllyResponse): PlayerId {
  return latch.target;
}

/** Is the cooldown still running at `now`? */
export function allyResponseCoolingDown(latch: AllyResponse, now: number): boolean {
  return latch.readyAt >= 0 && now < latch.readyAt;
}

/** End a response and start the budget clock. */
function complete(latch: AllyResponse, now: number, cooldownSeconds: number): void {
  releaseAllyResponse(latch);
  latch.readyAt = now + cooldownSeconds;
}

/**
 * Fold one decision's readings into the latch and return the ally this bot is
 * now answering (`-1` for none). Called **once per decision**, from the branch's
 * test — the same contract `commit` and `corneredCommit` keep.
 *
 * The three readings are the caller's, because they are all view questions:
 *
 *  - `candidate` — the ally worth *starting* a run for: in distress, in range,
 *    and with every selfish-first gate already passed. `-1` for none.
 *  - `held` — does the ally already committed to *still* read in distress? This
 *    is asked at **any** range, deliberately: a bot most of the way there has
 *    flown out of nothing, and re-testing the range mid-flight would release the
 *    commitment precisely when it is closest to paying off.
 *  - `arrived` — "I am there and there is nothing to fight". The happy ending.
 *
 * Precedence inside a commitment is *arrival, then life, then the clocks* —
 * safety and completion break a commitment rather than renewing it, the same
 * ordering `commit` uses when both its conditions read true at once.
 */
export function allyResponseCommit(
  latch: AllyResponse,
  now: number,
  candidate: PlayerId,
  held: boolean,
  arrived: boolean,
  quietSeconds: number,
  maxSeconds: number,
  cooldownSeconds: number,
): PlayerId {
  if (latch.target >= 0) {
    // Got there, nothing to do: the response succeeded, and the whole point of
    // naming this case is that a bot which "won" must go back to work.
    if (arrived) {
      complete(latch, now, cooldownSeconds);
      return NOBODY;
    }
    // The ceiling. A siege nobody can break is not a reason to stop mining
    // forever, and this is the only clause that can fire while the alarm is
    // still genuinely live — so it is checked before the alarm is.
    if (latch.startedAt >= 0 && now - latch.startedAt >= maxSeconds) {
      complete(latch, now, cooldownSeconds);
      return NOBODY;
    }
    if (held) {
      latch.lastLive = now;
      return latch.target;
    }
    // Quiet — but for how long? Inside the window this is the flicker, and the
    // commitment holds. That hold is the anti-flap property, and it is the only
    // reason a bot ever arrives anywhere.
    if (now - latch.lastLive >= quietSeconds) {
      complete(latch, now, cooldownSeconds);
      return NOBODY;
    }
    return latch.target;
  }
  if (allyResponseCoolingDown(latch, now)) return NOBODY;
  if (candidate < 0) return NOBODY;
  latch.target = candidate;
  latch.lastLive = now;
  latch.startedAt = now;
  return candidate;
}
