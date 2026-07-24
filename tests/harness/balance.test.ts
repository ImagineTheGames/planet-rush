/**
 * tests/harness/balance.test.ts — the balance harness against the real sim.
 * OWNER: QA Agent (GDD §3.8).
 *
 * This runs the shipped simulation and the bots on this branch (today the
 * do-nothing baseline, `src/bots`) to prove the harness itself: it steps a real
 * match, it enforces its timeout, and it replays identically (GDD §4.8). The
 * win-rate and match-length *targets* are measured against the behaviour trees
 * and reported in `tests/reports/balance-day6.md`; what is pinned here is the
 * machinery those measurements ride on.
 *
 * It also pins a live finding. At the **shipped** constants (`COLLAPSE_CORE_DECAY`
 * = 0) the collapse phase removes no core HP, so a match of idle bots never
 * reaches a winner — collapse opens and then nothing finishes it (GDD §2.3 /
 * docs/bot-balance-day4.md Finding 2). The harness is what makes that safe: a
 * match that will not end is a *failed* match, caught by the enforced timeout,
 * never a hung harness (GDD §3.8). The day-6 report proposes raising the decay
 * to 3 to make the ending structural; until that lands, this test documents the
 * gap by asserting the timeout fires.
 */

import { describe, it, expect } from 'vitest';
import { runMatch, runBalance, seedRange, summarize } from '../../harness';

/** Past the collapse deadline (waveTime(5) + grace = 750 s) but a fraction of
 *  the 20-minute ceiling, so an idle baseline match has entered collapse and
 *  still not ended when the cap stops it — cheaply. */
const PAST_COLLAPSE_S = 820;

describe('the balance harness steps a real match and enforces its timeout', () => {
  it('at the shipped baseline an idle match never ends — the timeout catches it', () => {
    // COLLAPSE_CORE_DECAY is 0, so collapse opens (~12.5 min) but removes no core
    // HP; eight idle bots do nothing to each other, so no core ever reaches zero.
    const o = runMatch(1, { maxSeconds: PAST_COLLAPSE_S });
    expect(o.timedOut).toBe(true);
    expect(o.ended).toBe(false);
    expect(o.winner).toBeNull();
    expect(o.winnerClass).toBeNull();
    expect(o.seconds).toBeLessThanOrEqual(PAST_COLLAPSE_S + 1);
  }, 30_000);

  it('replays byte-for-byte on the same seed (GDD §4.8)', () => {
    const a = runMatch(7, { maxSeconds: 300 });
    const b = runMatch(7, { maxSeconds: 300 });
    expect(a).toEqual(b);
    expect(a.ticks).toBe(b.ticks);
  }, 30_000);

  it('enforces a short timeout exactly — a hung match is a failed test, not a hung harness', () => {
    const o = runMatch(1, { maxSeconds: 60 });
    expect(o.timedOut).toBe(true);
    expect(o.ended).toBe(false);
    expect(o.seconds).toBeLessThanOrEqual(60 + 1);
  }, 30_000);
});

describe('the harness aggregates a batch', () => {
  it('summarizes a seed range into a well-formed report', () => {
    const seeds = seedRange(3);
    const { outcomes, summary } = runBalance(3, { maxSeconds: 300 });
    expect(outcomes.map((o) => o.seed)).toEqual(seeds);
    expect(summary.matches).toBe(3);
    // At the shipped baseline every idle match times out — which the summary
    // reports as a length-target failure, never as a silent pass.
    expect(summary.timedOut).toBe(3);
    expect(summary.ended).toBe(0);
    expect(summary.lengthTargetMet).toBe(false);
    // The summary equals summarize() of the same outcomes — one arithmetic.
    expect(summary).toEqual(summarize(outcomes));
  }, 60_000);
});
