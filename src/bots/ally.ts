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
 * weighted by the nearest teammate not already in the fight — the coverage curve
 * is 900u → 62%, 1000u → 71%, 1200u → 88%, 1500u → 98%, at roughly 7.6 / 8.4 /
 * 10.1 / 12.7 seconds of flight at the cast's measured 119 units/s cruise.
 *
 * **And then the coverage curve lost the argument to the cost curve**, which is
 * the whole reason this constant is not 1200. Coverage is not the objective;
 * {@link ALLY_RESPONSE_RANGE} says it out loud for the defensive case — *"response
 * range is a **cost** as well as a reach"* — and for a raid the payoff on the
 * other side of that cost is lower, because someone else's core is not the win
 * condition and your own side's is. Run end to end over 8 seeds × 3 casts against
 * the same matches with the branch absent, in mined ore per match:
 *
 *   | reach | Sable-led | mixed | Rusty-led | joining |
 *   |-------|-----------|-------|-----------|---------|
 *   | base  |     13.5  | 24.9  |     32.5  |    —    |
 *   | 1200  |  8.9 (66%)|19.6 (79%)|28.5 (88%)| 12–17% |
 *   | 1000  | 11.0 (81%)|21.7 (87%)|29.9 (92%)|  9–11% |
 *   |  800  | 11.9 (88%)|20.1 (81%)|30.1 (93%)|   5–6% |
 *   |  600  | 12.7 (94%)|25.7(103%)|30.3 (93%)|   1–2% |
 *
 * 1200 costs the keenest cast a **third of its economy**, which is the bot that
 * never mines this budget exists to prevent. 600 buys it back by switching the
 * feature off — 1–2% of the match is not a behaviour anyone would see. 1000 is
 * the knee: ~87% of the control's ore on a mixed cast, comparable to the 86% the
 * defensive branch settled for, with the branch genuinely firing.
 *
 * So the offensive reach ends up **strictly tighter than the defensive one**, and
 * that is the design saying the same thing the ladder says one level up: my home
 * outranks yours, and my home outranks your raid. TUNABLE
 */
export const ASSAULT_JOIN_RANGE = 1000;

/**
 * The reach on the shelf: 88% of raid-seconds instead of 71%, at a third of the
 * joiner's economy. Recorded as a named constant so a re-tune is one edit and the
 * A/B has something to point at, exactly like {@link ALLY_RESPONSE_RANGE_WIDE} —
 * and so the number the coverage curve *would* have picked is written down next
 * to the reason it did not win. Unused by shipped behaviour. TUNABLE
 */
export const ASSAULT_JOIN_RANGE_WIDE = 1200;

/**
 * Seconds a raid must read **quiet** before the join ends.
 *
 * **This one is derived from the channel, not from the klaxon**, and that is the
 * second thing that does not transfer. {@link ALLY_RESPONSE_QUIET} only has to
 * clear `Perception.alarmWindow` (2 s) because the ally alarm is a live boolean.
 * A raid has no klaxon at all: the only signal is a `push` call, so "quiet" means
 * *nobody has said anything about it lately* — and how long that lasts during a
 * raid which never stopped is a property of the channel's own dials.
 *
 * A teammate prosecuting a siege re-sends every `DifficultyTuning.callCooldown`,
 * and each call stays readable for `memorySeconds / HEARSAY_STALENESS` seconds
 * (`./radio` `receive`). So the silence inside a *continuous* raid is
 * `callCooldown - readableLife`:
 *
 *   | tier   | callCooldown | readable life | silent for |
 *   |--------|--------------|---------------|------------|
 *   | Easy   |        6 s   |         3 s   |      3 s   |
 *   | Medium |        3 s   |         6 s   |     never  |
 *   | Hard   |      1.5 s   |        10 s   |     never  |
 *
 * **Easy is the only tier that ever goes quiet mid-raid**, and it does so for
 * 3 s. Eight covers that with a wide margin — wide on purpose, because one voice
 * is one channel: a raider that takes a hit spends its next slot on `help`
 * instead of `push` (`Brain.lastCallAt` is shared across kinds), which stretches
 * an Easy gap toward 9 s. Past that the raid has genuinely paused and letting go
 * is the right answer, not a bug. TUNABLE
 */
export const ASSAULT_JOIN_QUIET = 8;

/**
 * Hard ceiling on one join, in seconds — **the number the brief said to measure,
 * and the measurement moved it from 45 to 25.**
 *
 * A join has to buy the trip *and* the fight. The trip is ~8.4 s at the shipped
 * {@link ASSAULT_JOIN_RANGE}, and 12.2 s at the widest character's reach (Sable,
 * 1450). The fight, from the table above, is p50 10.0 s and p75 13.7 s for the
 * raids that actually killed a core — and those are *solo* raids, so a joined one
 * should close faster ("two beats one", GDD §2.6).
 *
 * 25 = the typical trip plus a p75 winning raid (8.4 + 13.7 ≈ 22), and it still
 * covers the widest trip plus a p50 winning raid (12.2 + 10.0 ≈ 22), with margin
 * for a joiner that has to fight its way in. Below that a joiner arrives and is
 * recalled before it can matter; far above it the ceiling stops being reachable
 * at all. TUNABLE
 */
export const ASSAULT_JOIN_MAX = 25;

/**
 * Seconds before a bot will join again, measured from the end of its last join.
 *
 * **The budget question is different here too.** For the defensive latch it is
 * "one besieged ally must not consume a teammate's whole match", against an
 * attacker who never leaves. There is no offensive equivalent: the measurement
 * found no long raids to be consumed by (p90 7.7 s). What needs bounding instead
 * is **ping-pong** — raids are so short and so frequent that a bot could chase a
 * fresh call every few seconds and never mine.
 *
 * **It is the duty-cycle dial, and only that.** A committed join runs to at most
 * {@link ASSAULT_JOIN_MAX}, so under a raid that is *always* being called the
 * share of a match this branch can hold is `MAX / (MAX + COOLDOWN)`. At 45 that
 * is **36%**, against the defensive latch's 60% — deliberately tighter, because
 * your side's core is the win condition and someone else's is not.
 *
 * Swept end to end (8 seeds × 3 casts, against the same matches with the branch
 * absent), 45 is where the two curves stop disagreeing: the realistic cost is
 * flat from 25 to 60 seconds — 87%, 91%, 90% of the control's ore on a mixed cast
 * — while the pathological case, a teammate broadcasting a call every 1.5 s for
 * four unbroken minutes, tightens from 44% of the match spent joining to 38%.
 * Past 45 neither curve moves. So the larger value is close to free on play
 * anyone will see and strictly better on the case the budget exists for.
 *
 * **A caution for whoever re-tunes this.** The cooldown is a *weak* lever on
 * ordinary play, and the trace-replay estimate that suggested it was the whole
 * budget was wrong in a way worth naming. The replay proxied "is there a raid to
 * join" with "is an enemy home taking fire", which flickers on the 2 s alarm
 * window; the real reading is "is a `push` call still readable", which at Hard
 * persists ten seconds past the last word spoken. So the replay predicted ~1% of
 * ticks committed and the shipped branch actually spends 8–11% — it was a
 * **lower** bound, not the upper bound it was labelled.
 * {@link ASSAULT_JOIN_RANGE} is the lever that priced this feature; measure
 * there first. TUNABLE
 */
export const ASSAULT_JOIN_COOLDOWN = 45;

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
