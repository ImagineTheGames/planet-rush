/**
 * tests/harness/soak.test.ts — the shipped-bot soak instrument's own tests.
 * OWNER: QA Agent.
 *
 * `harness/soak.ts` measures the *shipped* Easy/Medium/Hard trees (as opposed to
 * the QA probes in `harness/strategies.ts`) for the release balance targets. It
 * is a measuring instrument, so it earns the same scrutiny as the probe harness
 * (`match.test.ts`): the loop **stops** under the enforced ceilings, it stops for
 * a **stated reason**, and the statistics it reports are the ones the report
 * quotes. A full eight-slot match costs ~0.05 ms/tick, so a handful stay cheap
 * enough for the unit suite — and an instrument tested only on toy worlds is not
 * tested (GDD §3.8).
 */

import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import { MATCH_SLOTS } from '../../src/bots';
import { WAVE_INTERVAL_S } from '../../src/sim';
import {
  CLASSES,
  HARD_POOL,
  LENGTH_TARGET_MAX_S,
  LENGTH_TARGET_MIN_S,
  WIN_RATE_CEILING,
  classLineup,
  lengthStats,
  rosterCast,
  runBotMatch,
  strategyLineup,
  terminationStats,
  winRates,
} from '../../harness/soak';
import type { BotMatchResult } from '../../harness/soak';

describe('the shipped-bot match loop (GDD §3.8)', () => {
  it('runs a full real-cast match to an ending inside every ceiling', () => {
    const r = runBotMatch(1, rosterCast());
    expect(r.ok).toBe(true);
    expect(r.failure).toBeNull();
    expect(r.winner).not.toBeNull();
    // A real ending, not a ceiling: comfortably under the 20-minute sim ceiling.
    expect(r.seconds).toBeLessThan(20 * 60);
    // The winner is attributed to a real character and the hull it flew.
    expect(r.winnerPersonality).not.toBeNull();
    expect(r.winnerClass).not.toBeNull();
  });

  it('stops a match that will not end, and says why', () => {
    // A 5-second ceiling on a match that takes minutes: the loop must return a
    // stated sim-timeout, never run past the ceiling.
    const r = runBotMatch(1, rosterCast(), { maxSeconds: 5 });
    expect(r.ok).toBe(false);
    expect(r.failure).toBe('sim-timeout');
    expect(r.winner).toBeNull();
    expect(r.seconds).toBeGreaterThanOrEqual(5);
    expect(r.seconds).toBeLessThan(6);
  });

  it('is deterministic: the same seed and lineup replays to the same hash', () => {
    const a = runBotMatch(3, rosterCast());
    const b = runBotMatch(3, rosterCast());
    expect(b.hash).toBe(a.hash);
    expect(b.seconds).toBe(a.seconds);
    expect(b.winner).toBe(a.winner);
  });

  it('seats a full eight-slot match for every lineup', () => {
    expect(rosterCast()).toHaveLength(MATCH_SLOTS);
    expect(classLineup('foreman', 0)).toHaveLength(MATCH_SLOTS);
    expect(strategyLineup(HARD_POOL, ShipClass.Vanguard, 0)).toHaveLength(MATCH_SLOTS);
  });
});

describe('the contest lineups (GDD §2.11, §3.8)', () => {
  it('class contest deals every hull two of the eight seats', () => {
    const counts = new Map<ShipClass, number>();
    for (const slot of classLineup('foreman', 0)) counts.set(slot.shipClass, (counts.get(slot.shipClass) ?? 0) + 1);
    expect(counts.size).toBe(CLASSES.length);
    for (const c of CLASSES) expect(counts.get(c)).toBe(MATCH_SLOTS / CLASSES.length);
  });

  it('class contest holds the behaviour fixed and varies only the hull', () => {
    const lineup = classLineup('foreman', 2);
    expect(new Set(lineup.map((s) => s.personality))).toEqual(new Set(['foreman']));
  });

  it('strategy contest holds the hull fixed and varies only the character', () => {
    const lineup = strategyLineup(HARD_POOL, ShipClass.Vanguard, 1);
    expect(new Set(lineup.map((s) => s.shipClass))).toEqual(new Set([ShipClass.Vanguard]));
    // Every Hard character appears (8 seats over a 3-pool covers all three).
    expect(new Set(lineup.map((s) => s.personality))).toEqual(new Set(HARD_POOL));
  });
});

describe('the statistics the report quotes', () => {
  /** A tiny synthetic result set — the math must not depend on running a match. */
  function fake(over: Partial<BotMatchResult>): BotMatchResult {
    return {
      seed: 0,
      ok: true,
      failure: null,
      seconds: 12 * 60,
      ticks: 0,
      wallClockMs: 1,
      winner: 0,
      winnerPersonality: 'foreman',
      winnerDifficulty: null,
      winnerClass: ShipClass.Vanguard,
      fieldOreLeft: 0,
      hash: '0',
      oreMined: 0,
      collapseTime: -1,
      wavesSpawned: 0,
      waveInterval: WAVE_INTERVAL_S,
      ...over,
    };
  }

  it('terminationStats separates a sim-timeout from a hang', () => {
    const t = terminationStats([
      fake({}),
      fake({ ok: false, failure: 'sim-timeout', winner: null }),
      fake({ ok: false, failure: 'wall-clock', winner: null }),
      fake({ ok: false, failure: 'stalled', winner: null }),
    ]);
    expect(t.ended).toBe(1);
    expect(t.simTimeout).toBe(1);
    expect(t.hangs).toBe(2); // wall-clock + stalled — the harness's own failures
  });

  it('lengthStats reads only decided matches and flags the target band', () => {
    const inside = fake({ seconds: 12 * 60 }); // 12:00 — inside 10–15
    const tooLong = fake({ seconds: 18 * 60 }); // 18:00 — outside
    const timedOut = fake({ ok: false, failure: 'sim-timeout', seconds: 20 * 60, winner: null });
    const s = lengthStats([inside, tooLong, timedOut]);
    expect(s.n).toBe(2); // the timed-out run contributes no length
    expect(s.min).toBe(12 * 60);
    expect(s.max).toBe(18 * 60);
    expect(s.insideFraction).toBeCloseTo(0.5, 9);
    expect(LENGTH_TARGET_MIN_S).toBe(10 * 60);
    expect(LENGTH_TARGET_MAX_S).toBe(15 * 60);
  });

  it('winRates sums to one winner per decided match and sorts highest-first', () => {
    const results = [
      fake({ winnerClass: ShipClass.Vanguard }),
      fake({ winnerClass: ShipClass.Vanguard }),
      fake({ winnerClass: ShipClass.Hauler }),
      fake({ ok: false, failure: 'sim-timeout', winner: null }),
    ];
    const records = winRates(results, CLASSES.map((c) => String(c)), (r) =>
      r.winnerClass !== null ? String(r.winnerClass) : null,
    );
    expect(records[0]!.name).toBe('vanguard');
    expect(records[0]!.wins).toBe(2);
    expect(records[0]!.decided).toBe(3);
    expect(records.reduce((a, r) => a + r.wins, 0)).toBe(3); // one winner per decided match
    // A rate over the ceiling is what the verdict watches.
    expect(records[0]!.rate).toBeGreaterThan(WIN_RATE_CEILING);
  });
});
