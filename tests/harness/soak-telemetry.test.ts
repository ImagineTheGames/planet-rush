/**
 * tests/harness/soak-telemetry.test.ts — the a0-112 telemetry, on trial.
 * OWNER: QA Agent.
 *
 * `SoakRunOptions.telemetry` is how a0-112 answers the two questions nobody had
 * numbers for — the share of a match spent in `turn-and-fight`, and deaths per
 * match. Both are read off a running match, which makes them worth exactly as
 * much as the claim that reading them changes nothing.
 *
 * So the load-bearing test here is the boring one: **a measured match and an
 * unmeasured match are the same match**, down to the final state hash (GDD §4.8).
 * An instrument that perturbs what it measures would have made the whole report
 * unfalsifiable, and it would have done it silently.
 *
 * The rest is the arithmetic the report's denominators rest on: decisions are
 * ticks × seats, the census sums to the decisions, and a death is a transition
 * rather than a level.
 */

import { describe, it, expect } from 'vitest';
import { MATCH_SLOTS, PERSONALITIES } from '../../src/bots';
import { TICK_DT } from '../../src/sim';
import { rosterCast, runBotMatch } from '../../harness/soak';

/** A minute of sim is thousands of decisions and dozens of deaths — plenty to
 *  check the arithmetic on, and fast enough for the unit suite. */
const SECONDS = 60;

describe('telemetry is inert (GDD §4.8)', () => {
  it('a measured match and an unmeasured match are the same match', () => {
    const cast = rosterCast();
    const plain = runBotMatch(7, cast, { maxSeconds: SECONDS });
    const measured = runBotMatch(7, cast, { maxSeconds: SECONDS, telemetry: true });

    expect(measured.hash).toBe(plain.hash);
    expect(measured.ticks).toBe(plain.ticks);
    expect(measured.seconds).toBe(plain.seconds);
    expect(measured.winner).toBe(plain.winner);
    expect(measured.oreMined).toBe(plain.oreMined);
    expect(measured.fieldOreLeft).toBe(plain.fieldOreLeft);
  });

  it('costs nothing when it is not asked for', () => {
    expect(runBotMatch(7, rosterCast(), { maxSeconds: 5 }).telemetry).toBeNull();
  });
});

describe('what the telemetry counts', () => {
  const cast = rosterCast();
  const run = runBotMatch(7, cast, { maxSeconds: SECONDS, telemetry: true });
  const tel = run.telemetry!;

  it('records one seat per slot, in lineup order', () => {
    expect(tel.seats).toHaveLength(MATCH_SLOTS);
    expect(tel.seats.map((s) => s.id)).toEqual(cast.map((s) => s.id));
    expect(tel.seats.map((s) => s.personality)).toEqual(cast.map((s) => s.personality));
  });

  it('observes every seat on every taken tick — decisions are ticks × seats', () => {
    expect(tel.decisions).toBe(run.ticks * MATCH_SLOTS);
    for (const seat of tel.seats) expect(seat.decisions).toBe(run.ticks);
  });

  it('the leaf census sums to the decisions it is a census of', () => {
    const sum = (census: Record<string, number>): number =>
      Object.values(census).reduce((a, b) => a + b, 0);
    expect(sum(tel.leafTicks)).toBe(tel.decisions);
    for (const seat of tel.seats) expect(sum(seat.leafTicks)).toBe(seat.decisions);
    // And the pooled census is the seats', not a second, independent count.
    const pooled: Record<string, number> = {};
    for (const seat of tel.seats)
      for (const [leaf, n] of Object.entries(seat.leafTicks)) pooled[leaf] = (pooled[leaf] ?? 0) + n;
    expect(pooled).toEqual(tel.leafTicks);
  });

  it('names leaves the trees actually run', () => {
    // Not an exhaustive list on purpose — the report never hard-codes one either.
    // A minute of eight shipped bots always contains at least mining and dying.
    const leaves = Object.keys(tel.leafTicks);
    expect(leaves).toContain('mine');
    expect(leaves).toContain('dead');
  });

  it('counts a death as a transition, not as a level', () => {
    for (const seat of tel.seats) {
      expect(seat.deaths).toBeGreaterThanOrEqual(0);
      // A ship is dead for `RESPAWN_S` after each death, so counting the *state*
      // instead of the *edge* would inflate this by two orders of magnitude —
      // the ticks spent dead are a hundred times the deaths that caused them.
      const deadTicks = seat.leafTicks['dead'] ?? 0;
      if (deadTicks > 0) expect(seat.deaths).toBeLessThan(deadTicks);
    }
    const deaths = tel.seats.reduce((a, s) => a + s.deaths, 0);
    expect(deaths).toBeGreaterThan(0);
    // Nobody can die more often than the respawn timer allows in a minute.
    expect(deaths).toBeLessThanOrEqual((MATCH_SLOTS * SECONDS) / 5);
  });

  it('attributes a seat to the character flying it, so a tier can be folded up', () => {
    for (const seat of tel.seats) {
      expect(PERSONALITIES[seat.personality].difficulty).toBeTruthy();
      expect(seat.shipClass).toBe(PERSONALITIES[seat.personality].shipClass);
    }
  });

  it('stops where the ceiling says, and the census stops with it', () => {
    // The ceiling is checked before a tick is taken, and `world.time` is a sum
    // of float `dt`s, so the last tick may straddle it — one tick of slack, not
    // an open-ended one.
    expect(run.seconds).toBeLessThanOrEqual(SECONDS + TICK_DT);
    expect(tel.decisions).toBeLessThanOrEqual((Math.ceil(SECONDS / TICK_DT) + 1) * MATCH_SLOTS);
  });
});
