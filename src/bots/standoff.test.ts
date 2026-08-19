/**
 * src/bots/standoff.test.ts — the primitive that makes a retreat end. OWNER:
 * Bot Engineer (a0-105, ratified: *"ship lives are cheap. enemies should not
 * fear death"*).
 *
 * `./standoff.ts` is the third latch in the flee/fight family and, like
 * `./commitment` and `./cornered`, it carries no domain knowledge at all: no
 * hull fractions, no ranges, no personalities. So this file tests it the way
 * those are tested — as arithmetic on a struct, with the behaviour that reads it
 * pinned next door in `./behaviors.test.ts`.
 *
 * The four claims:
 *
 *  1. **it ends.** An unbroken run of reads that fail to open ground commits,
 *     always, at every patience anyone can pass it;
 *  2. **it only ends a retreat that is failing.** A read that beats the anchor
 *     by the margin gives the patience straight back, which is the half that
 *     makes the turn readable from outside as a decision rather than a timer;
 *  3. **the commitment is a window**, and inside it nothing is re-derived;
 *  4. **the turn re-anchors**, so a bot that turned does not inherit the widest
 *     gap of the retreat it abandoned and chase a leaving opponent on it.
 */

import { describe, it, expect } from 'vitest';
import {
  newStandoff,
  resetStandoff,
  standoffCommitted,
  standoffFold,
  type StandoffLatch,
} from './standoff';

/** The margin and the two durations, fixed for the arithmetic below. The real
 *  values live with the behaviour that supplies them (`./behaviors`
 *  `RETREAT_PROGRESS`, `standoffPatience`, `STANDOFF_COMMIT_SECONDS`). */
const PROGRESS = 60;
const PATIENCE = 2;
const WINDOW = 4;

/** Fold one read at `now` with the fixed knobs above. */
const fold = (latch: StandoffLatch, now: number, gap: number): boolean =>
  standoffFold(latch, now, gap, PROGRESS, PATIENCE, WINDOW);

describe('a retreat that opens no ground ends (a0-105)', () => {
  it('commits once the patience has run without a single gaining read', () => {
    const latch = newStandoff();
    // First read banks the anchor: there is nothing to compare against yet, so
    // no retreat is ever condemned on the decision it started.
    expect(fold(latch, 0, 300)).toBe(false);
    expect(latch.since).toBe(-1);
    // Pinned at the same range: the clock starts, and holds until the patience.
    expect(fold(latch, 0.5, 300)).toBe(false);
    expect(latch.since).toBe(0.5);
    expect(fold(latch, 2.0, 298)).toBe(false);
    // 0.5 + PATIENCE: had enough.
    expect(fold(latch, 2.5, 302)).toBe(true);
    expect(standoffCommitted(latch, 2.5)).toBe(true);
  });

  it('ends at every patience a caller can hand it — nobody holds forever', () => {
    // The guarantee the ruling actually asks for. A patience of ten seconds is
    // far outside anything `standoffPatience` can produce (it clamps at five),
    // and it still terminates: there is no value of this argument for which the
    // latch declines to commit.
    for (const patience of [0, 0.5, 1, 2.5, 5, 10]) {
      const latch = newStandoff();
      let committedAt = -1;
      for (let t = 0; t <= 40 && committedAt < 0; t += 0.5) {
        if (standoffFold(latch, t, 300, PROGRESS, patience, WINDOW)) committedAt = t;
      }
      expect(committedAt, `patience ${patience}`).toBeGreaterThanOrEqual(0);
      expect(committedAt, `patience ${patience}`).toBeLessThanOrEqual(patience + 0.5);
    }
  });

  it('gives the patience back the moment the retreat gains ground', () => {
    // The readable half: a player who backs off resets the meter, so the bot
    // they are chasing keeps running rather than turning on a schedule.
    const latch = newStandoff();
    fold(latch, 0, 300);
    fold(latch, 1, 300);
    expect(latch.since).toBe(1);
    // Beating the anchor by the margin re-anchors and stops the clock.
    expect(fold(latch, 1.5, 300 + PROGRESS)).toBe(false);
    expect(latch.since).toBe(-1);
    expect(latch.gap).toBe(360);
    // …and a gain *short* of the margin is jitter, not escape: the clock keeps
    // running from where it was, so a chase that wobbles never buys time.
    expect(fold(latch, 2, 300 + PROGRESS + 10)).toBe(false);
    expect(latch.since).toBe(2);
    expect(fold(latch, 4.1, 305)).toBe(true);
  });

  it('never commits on a retreat that keeps opening ground', () => {
    const latch = newStandoff();
    let gap = 200;
    for (let t = 0; t <= 30; t += 0.5) {
      gap += PROGRESS; // getting away, decision after decision
      expect(standoffFold(latch, t, gap, PROGRESS, PATIENCE, WINDOW), `t=${t}`).toBe(false);
    }
  });

  it('holds the commitment for a window, and re-derives nothing inside it', () => {
    const latch = newStandoff();
    fold(latch, 0, 300);
    fold(latch, 0.5, 300);
    expect(fold(latch, 2.5, 300)).toBe(true);
    // Inside the window the answer cannot change, whatever the geometry does —
    // the same "no fear re-evaluation mid-commitment" rule `./cornered` runs on.
    expect(fold(latch, 3, 5000)).toBe(true);
    expect(fold(latch, 6.4, 5000)).toBe(true);
    expect(standoffCommitted(latch, 6.6)).toBe(false);
  });

  it('re-anchors on the turn, so an opponent who leaves gets the retreat back', () => {
    // Without this a bot that turned would carry the widest gap of the retreat
    // it abandoned — hundreds of units — and no realistic disengagement could
    // ever beat it, so the bot would re-commit forever and chase.
    const latch = newStandoff();
    fold(latch, 0, 700); // the retreat did open real ground before it failed
    fold(latch, 1, 200);
    expect(fold(latch, 3.1, 180)).toBe(true);
    expect(latch.gap, 'the anchor is the range the fight starts at').toBe(180);
    // Window closed, and the opponent has pulled back past the margin: the
    // standoff releases instead of renewing, and the bot re-reads its nerve.
    expect(fold(latch, 7.2, 180 + PROGRESS)).toBe(false);
    expect(latch.since).toBe(-1);
  });

  it('forgets everything on reset', () => {
    const latch = newStandoff();
    fold(latch, 0, 300);
    fold(latch, 1, 300);
    fold(latch, 3.1, 300);
    expect(standoffCommitted(latch, 3.1)).toBe(true);
    resetStandoff(latch);
    expect(latch).toEqual(newStandoff());
    expect(standoffCommitted(latch, 3.1)).toBe(false);
  });
});
