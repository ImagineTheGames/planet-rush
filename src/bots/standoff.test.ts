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
 *
 * And, from a0-107, the second axis — the one that let the caller throw its
 * gates away:
 *
 *  5. **a retreat that is getting home is working too.** Closing on the refuge
 *     gives the patience back exactly as opening ground does, so the branch
 *     never interrupts a wounded bot still flying to its turrets;
 *  6. **and it still ends.** A bot that stops closing — arrived, blocked, or
 *     herded — spends its patience and turns, because the road anchor is
 *     monotone and cannot be un-banked by an opponent who jitters it.
 */

import { describe, it, expect } from 'vitest';
import {
  NO_ROAD,
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

/** Fold one read at `now` with the fixed knobs above. `road` defaults to
 *  {@link NO_ROAD} — a retreat with no refuge, measured on the gap alone, which
 *  is the single-axis case every claim below §2 is about. */
const fold = (latch: StandoffLatch, now: number, gap: number, road: number = NO_ROAD): boolean =>
  standoffFold(latch, now, gap, road, PROGRESS, PATIENCE, WINDOW);

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
        if (standoffFold(latch, t, 300, NO_ROAD, PROGRESS, patience, WINDOW)) committedAt = t;
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
      expect(standoffFold(latch, t, gap, NO_ROAD, PROGRESS, PATIENCE, WINDOW), `t=${t}`).toBe(false);
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

describe('a retreat that is getting home is working too (a0-107)', () => {
  it('gives the patience back for closing on the refuge, with the gap pinned', () => {
    // The case a0-105 protected with a positional gate and an opponent could
    // flap. Here it is a measurement: the chaser matches the bot's speed exactly
    // — the gap never moves — but the bot is eating the road home, so the
    // retreat is working and the clock never starts.
    const latch = newStandoff();
    let road = 4000;
    for (let t = 0; t <= 20; t += 0.5) {
      road -= PROGRESS + 20; // closing on home, decision after decision
      expect(fold(latch, t, 300, road), `t=${t}`).toBe(false);
      expect(latch.since, `t=${t}`).toBe(-1);
    }
  });

  it('starts spending patience the moment the road stops shortening', () => {
    // It ran, it got there, and the thing came with it: no more road, no more
    // gap, so the retreat is over and the bot turns. This is the a0-105
    // photograph, reached without asking anyone whether the bot has "arrived".
    const latch = newStandoff();
    expect(fold(latch, 0, 300, 900)).toBe(false);
    expect(fold(latch, 0.5, 300, 700)).toBe(false); // still closing
    expect(latch.since).toBe(-1);
    expect(fold(latch, 1, 300, 90)).toBe(false); // arrived
    expect(latch.road).toBe(90);
    expect(fold(latch, 1.5, 300, 92)).toBe(false); // nowhere left to go
    expect(latch.since).toBe(1.5);
    expect(fold(latch, 3.6, 300, 88)).toBe(true);
  });

  it('cannot be paid twice for the same road — the anchor only improves', () => {
    // The a0-106 shape, in arithmetic. An opponent who herds the bot back and
    // forth across its own doorstep re-presents road it has already been
    // credited for; a monotone anchor declines to pay again, so the patience
    // clock keeps running through the oscillation and the retreat still ends.
    const latch = newStandoff();
    fold(latch, 0, 300, 400);
    fold(latch, 0.5, 300, 200); // banked: the best road of this retreat
    expect(latch.road).toBe(200);
    let out = false;
    for (let t = 1; t <= 6 && !out; t += 0.5) {
      // pushed out to 400, allowed back to 220, over and over
      out = fold(latch, t, 300, t % 1 === 0 ? 400 : 220);
    }
    expect(out, 'the oscillation bought no patience back').toBe(true);
  });

  it('measures on the gap alone when there is no refuge to run to', () => {
    // Station gone, or the threat sitting on it: `retreat` is travelling nowhere
    // in particular, so there is no second axis and `NO_ROAD` must never read as
    // progress — least of all against itself.
    const latch = newStandoff();
    expect(fold(latch, 0, 300, NO_ROAD)).toBe(false);
    expect(latch.road).toBe(NO_ROAD);
    expect(fold(latch, 0.5, 300, NO_ROAD)).toBe(false);
    expect(latch.since).toBe(0.5);
    expect(fold(latch, 2.6, 300, NO_ROAD)).toBe(true);
  });

  it('an opponent who takes the road away only brings the turn forward', () => {
    // Standing on the bot's own station flips the road to `NO_ROAD` mid-retreat.
    // The banked anchor stays banked, so the loss of the second axis cannot hand
    // the bot a fresh clock — it can only leave it with fewer ways to be working.
    const latch = newStandoff();
    fold(latch, 0, 300, 800);
    fold(latch, 0.5, 300, 600);
    expect(latch.road).toBe(600);
    expect(fold(latch, 1, 300, NO_ROAD)).toBe(false);
    expect(latch.since, 'the clock starts, it does not reset').toBe(1);
    expect(latch.road, 'and the best road of this retreat is still banked').toBe(600);
    expect(fold(latch, 3.1, 300, NO_ROAD)).toBe(true);
  });

  it('re-anchors both axes on the turn', () => {
    const latch = newStandoff();
    fold(latch, 0, 700, 900); // this retreat did open ground and did close road
    fold(latch, 1, 200, 950);
    expect(fold(latch, 3.1, 180, 940)).toBe(true);
    expect(latch.gap, 'the gap anchor is the range the fight starts at').toBe(180);
    expect(latch.road, 'and the road anchor is where the bot is standing').toBe(940);
  });
});
