/**
 * tests/harness/stats.test.ts — the balance arithmetic, proven without running a
 * match. OWNER: QA Agent.
 *
 * `harness/stats.ts` is the one place a match length or a win share becomes a
 * pass/fail against the two targets (GDD §1, §2.11, §3.8), so it is tested on
 * hand-built outcomes where the right answer is obvious. If this drifts, every
 * balance report drifts with it.
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import {
  TARGET_MIN_S,
  TARGET_MAX_S,
  WIN_RATE_CEILING,
  percentile,
  lengthStats,
  summarize,
  fmtDuration,
  type MatchOutcome,
} from '../../harness/stats';

/** A finished match won by `strategy`/`cls` at `seconds`. */
function win(seed: number, seconds: number, cls: ShipClass, strategy: string): MatchOutcome {
  return {
    seed,
    ended: true,
    timedOut: false,
    seconds,
    ticks: Math.round(seconds * 60),
    winner: 0,
    winnerClass: cls,
    winnerStrategy: strategy,
  };
}

/** A match that hit the enforced timeout — a failed match, no winner. */
function timeout(seed: number, seconds: number): MatchOutcome {
  return {
    seed,
    ended: false,
    timedOut: true,
    seconds,
    ticks: Math.round(seconds * 60),
    winner: null,
    winnerClass: null,
    winnerStrategy: null,
  };
}

describe('percentile', () => {
  it('returns the bounds and the middle of a simple sample', () => {
    const xs = [10, 20, 30, 40, 50];
    expect(percentile(xs, 0)).toBe(10);
    expect(percentile(xs, 1)).toBe(50);
    expect(percentile(xs, 0.5)).toBe(30);
  });

  it('interpolates between neighbours and is order-independent', () => {
    expect(percentile([0, 100], 0.5)).toBe(50);
    expect(percentile([100, 0], 0.5)).toBe(50); // sorts a copy
  });

  it('is safe on empty and singleton samples', () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([42], 0.9)).toBe(42);
  });
});

describe('lengthStats', () => {
  it('counts the fraction inside the 10–15 min band', () => {
    // three in-band (12/13/14 min), one short (9), one long (16)
    const secs = [12 * 60, 13 * 60, 14 * 60, 9 * 60, 16 * 60];
    const s = lengthStats(secs);
    expect(s.count).toBe(5);
    expect(s.min).toBe(9 * 60);
    expect(s.max).toBe(16 * 60);
    expect(s.median).toBe(13 * 60);
    expect(s.fractionInTarget).toBeCloseTo(3 / 5, 9);
  });

  it('treats the band as inclusive of both ends', () => {
    const s = lengthStats([TARGET_MIN_S, TARGET_MAX_S]);
    expect(s.fractionInTarget).toBe(1);
  });
});

describe('summarize', () => {
  it('reports both targets met when the field is balanced and prompt', () => {
    // Four winners, four classes, all matches 12–13 min: nothing over 55%.
    const outcomes = [
      win(1, 12 * 60, ShipClass.Interceptor, 'sable'),
      win(2, 12.5 * 60, ShipClass.Vanguard, 'warden'),
      win(3, 13 * 60, ShipClass.Excavator, 'foreman'),
      win(4, 12.2 * 60, ShipClass.Hauler, 'rusty'),
    ];
    const s = summarize(outcomes);
    expect(s.matches).toBe(4);
    expect(s.ended).toBe(4);
    expect(s.timedOut).toBe(0);
    expect(s.lengthTargetMet).toBe(true);
    expect(s.medianInTarget).toBe(true);
    expect(s.winRateTargetMet).toBe(true);
    expect(s.topShare?.share).toBeCloseTo(0.25, 9);
  });

  it('fails the win-rate target when one class exceeds the ceiling', () => {
    const outcomes = [
      win(1, 13 * 60, ShipClass.Excavator, 'warden'),
      win(2, 13 * 60, ShipClass.Excavator, 'warden'),
      win(3, 13 * 60, ShipClass.Excavator, 'foreman'),
      win(4, 13 * 60, ShipClass.Interceptor, 'sable'),
    ];
    const s = summarize(outcomes);
    expect(s.winRateTargetMet).toBe(false);
    const excavator = s.byClass.find((w) => w.key === ShipClass.Excavator);
    expect(excavator?.wins).toBe(3);
    expect(excavator?.share).toBeCloseTo(0.75, 9);
    // warden (2/4 = 50%) is under the ceiling; excavator (3/4 = 75%) is not.
    expect(s.topShare?.key).toBe(ShipClass.Excavator);
    expect(s.topShare!.share).toBeGreaterThan(WIN_RATE_CEILING);
  });

  it('fails the length target on any timeout, and never counts it as a win', () => {
    const outcomes = [
      win(1, 13 * 60, ShipClass.Vanguard, 'warden'),
      timeout(2, 20 * 60),
    ];
    const s = summarize(outcomes);
    expect(s.timedOut).toBe(1);
    expect(s.lengthTargetMet).toBe(false);
    // The timed-out match contributes no winner to either tally.
    expect(s.byClass.reduce((n, w) => n + w.wins, 0)).toBe(1);
    expect(s.length.count).toBe(1); // only the ended match has a length
  });

  it('fails the length target when an ended match lands outside the band', () => {
    const s = summarize([win(1, 16 * 60, ShipClass.Vanguard, 'warden')]);
    expect(s.lengthTargetMet).toBe(false);
    expect(s.medianInTarget).toBe(false);
  });
});

describe('fmtDuration', () => {
  it('renders m:ss with a zero-padded seconds field', () => {
    expect(fmtDuration(0)).toBe('0:00');
    expect(fmtDuration(65)).toBe('1:05');
    expect(fmtDuration(12 * 60 + 55)).toBe('12:55');
  });
});
