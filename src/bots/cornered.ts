/**
 * src/bots/cornered.ts — the commitment a cornered bot makes. OWNER: Bot
 * Engineer (GDD §2.9; developer report p15, ratified: "a blockaded bot FIGHTS —
 * no dithering").
 *
 * `./commitment` gave the flee/fight pair *memory* — two thresholds with a latch
 * between them, so a hull fraction hovering on one boundary can no longer toggle
 * the state. That was the right fix for the pathology it was built for, and it
 * bounds how OFTEN a bot flips. It does not touch the one the developer
 * photographed next, because that one is not a threshold problem:
 *
 * > "When I put myself in between their planet and they are damaged, they can't
 * > decide whether to attack or flee. In this case they need to attack and stop
 * > being scared."
 *
 * Fear pushes the ship *away* from the threat; home pulls it *through* the
 * threat. The two pulls are anti-parallel and the ship sits at their crossing —
 * a stable trap, on the line between the bot and its own station, that no amount
 * of memory between two thresholds moves it off. The destination is behind the
 * thing being feared, so "commit to the retreat" and "commit to the approach"
 * are the same twitch.
 *
 * The ratified answer has two halves and they live in two files:
 *
 *  - **the geometry** — is the road home actually shut? — is pure arithmetic
 *    over positions and speeds, and lives in the sim (`@sim/blockade`);
 *  - **the commitment** — how long a bot takes to *notice* the road is shut, and
 *    how long it then fights without asking its fear model again — is behavior,
 *    and lives here.
 *
 * Like `./commitment`, this is one small struct and three pure functions, and it
 * carries no domain knowledge on purpose: no hull fractions, no ranges, no
 * personalities, not even the geometry. The caller supplies the verdict and the
 * two durations; this file supplies the *memory of having decided*. The bit
 * lives on the {@link import('./tree').Brain}, beside the sim rather than inside
 * it, so it can never desync a determinism replay (GDD §4.8).
 */

import type { PlayerId } from '@shared/types';

/** No slot — "not committed to anybody". */
const NOBODY: PlayerId = -1;

/**
 * A bot's memory of being cornered: when it first noticed, how long it has
 * promised to fight, and who it promised to fight.
 *
 * Two clocks, and they do different jobs. {@link since} is the **detection**
 * clock — the sim time the geometry first read shut *continuously* — and it is
 * what makes an Easy bot slower to catch on than a Hard one without giving
 * either of them a different rule. {@link until} is the **commitment** clock:
 * while it is in the future the decision is already made and the fear model does
 * not get another vote.
 */
export interface CorneredLatch {
  /** Sim time the geometry first read shut without a break; `-1` when clear. */
  since: number;
  /** Sim time the minimum commitment window closes; `-1` when uncommitted. */
  until: number;
  /** The blockader committed to; `-1` when none. */
  target: PlayerId;
}

/** A fresh latch: nothing noticed, nothing promised. */
export function newCorneredLatch(): CorneredLatch {
  return { since: -1, until: -1, target: NOBODY };
}

/**
 * Forget everything — the road is open, the blockader is gone, or a
 * strictly-higher priority took the tick (a core under final assault).
 *
 * This clears the *detection* clock as well as the commitment, which is
 * deliberate: a bot whose blockade genuinely lifted should have to earn its next
 * commitment from scratch rather than inherit credit for a trap that no longer
 * exists.
 */
export function resetCornered(latch: CorneredLatch): void {
  latch.since = -1;
  latch.until = -1;
  latch.target = NOBODY;
}

/**
 * The slot this bot has already promised to fight, or `-1` if it has not.
 *
 * A caller reads this *before* re-deriving any geometry: inside the window there
 * is nothing to re-derive, because the answer cannot change. That is the whole
 * of ratified point 2 — "no fear re-evaluation mid-commitment" — and it is one
 * comparison rather than a rule sprinkled through three behavior trees.
 */
export function corneredHeld(latch: CorneredLatch, now: number): PlayerId {
  return latch.until >= 0 && now < latch.until ? latch.target : NOBODY;
}

/**
 * Fold one fresh geometry read into the latch, and return the slot the bot is
 * now committed to fighting (`-1` for none).
 *
 * `shut` is the caller's verdict that the road is closed by `targetId`
 * (`@sim/blockade`'s `corneredReading`). The two durations are the behavior:
 *
 *  - `detectSeconds` — how long the road must read shut *continuously* before
 *    the bot believes it. This is the difficulty texture of ratified point 3:
 *    HARD notices almost at once and commits ruthlessly, EASY takes long enough
 *    that a visible couple of oscillations happen first — acceptable at EASY,
 *    and only at EASY — and then commits like everyone else.
 *  - `commitSeconds` — the minimum window the resulting commitment holds for.
 *
 * A read that comes back open resets the latch: the detection clock only counts
 * an *unbroken* run of shut reads, so a threat drifting in and out of the lane
 * never accumulates its way into a commitment it did not earn.
 */
export function corneredCommit(
  latch: CorneredLatch,
  now: number,
  targetId: PlayerId,
  shut: boolean,
  detectSeconds: number,
  commitSeconds: number,
): PlayerId {
  if (!shut || targetId < 0) {
    resetCornered(latch);
    return NOBODY;
  }
  if (latch.since < 0) latch.since = now;
  // Still catching on. The clock keeps running (this read was shut), but nothing
  // is promised yet — an Easy bot spends this stretch visibly dithering, which
  // is the tier reading the developer ratified.
  if (now - latch.since < detectSeconds) {
    latch.until = -1;
    latch.target = NOBODY;
    return NOBODY;
  }
  // Believed. Promise a window, and name who it is against.
  latch.until = now + commitSeconds;
  latch.target = targetId;
  return targetId;
}

/** Read the committed state without touching it — for the fear gate that must
 *  stand down mid-commitment, for tests, and for a debug overlay. */
export function corneredCommitted(latch: CorneredLatch, now: number): boolean {
  return corneredHeld(latch, now) >= 0;
}
