/**
 * Asteroid-wave clock tests (GDD §2.2, §2.3). The clock names the wave, counts
 * down to the next, and shows match time — derived purely from time + the
 * ratified wave constants, so it can never drift from the sim's metronome.
 */
import { describe, it, expect } from 'vitest';
import { ShipClass } from '@shared/types';
import { computeWaveClock, formatClock, WAVE_NAMES } from './wave-clock';
import { WAVE_COUNT, WAVE_INTERVAL_S, waveTime } from '../sim/constants';
import { createWorld, step, waveIntervalOf, type Abundance, type World } from '../sim';

describe('computeWaveClock (GDD §2.3)', () => {
  it('is wave 1, named, at match start', () => {
    const c = computeWaveClock(0);
    expect(c.wave).toBe(1);
    expect(c.waveCount).toBe(WAVE_COUNT);
    expect(c.name).toBe(WAVE_NAMES[0]);
    expect(c.isFinalWave).toBe(false);
  });

  it('counts down to the next wave within the first interval', () => {
    const c = computeWaveClock(10);
    expect(c.wave).toBe(1);
    expect(c.countdownToNext).toBeCloseTo(WAVE_INTERVAL_S - 10, 6);
    expect(c.matchTime).toBe(10);
  });

  it('advances to wave 2 exactly at the first interval boundary', () => {
    const c = computeWaveClock(WAVE_INTERVAL_S);
    expect(c.wave).toBe(2);
    expect(c.countdownToNext).toBeCloseTo(WAVE_INTERVAL_S, 6);
  });

  it('reaches the final wave and reports no next wave (GDD §2.3 collapse-bound)', () => {
    const c = computeWaveClock(WAVE_INTERVAL_S * (WAVE_COUNT - 1));
    expect(c.wave).toBe(WAVE_COUNT);
    expect(c.isFinalWave).toBe(true);
    expect(c.countdownToNext).toBeNull();
  });

  it('caps the wave number at WAVE_COUNT even long after the last wave', () => {
    const c = computeWaveClock(WAVE_INTERVAL_S * (WAVE_COUNT + 3));
    expect(c.wave).toBe(WAVE_COUNT);
    expect(c.isFinalWave).toBe(true);
  });

  it('clamps negative time to match start (defensive)', () => {
    const c = computeWaveClock(-5);
    expect(c.wave).toBe(1);
    expect(c.matchTime).toBe(0);
  });

  it('counts down to the sim\'s own arrival times, not a second copy of them', () => {
    // src/sim/waves.ts spawns wave n at waveTime(n) and says so in its header:
    // "the same function the HUD's wave clock counts down to." Calling it is
    // what makes the clock unable to promise a wave the sim will not deliver.
    for (let n = 1; n <= WAVE_COUNT; n++) {
      const atArrival = computeWaveClock(waveTime(n));
      expect(atArrival.wave).toBe(n);
      // A hair before the arrival, it is still the previous wave, counting down
      // to zero — the boundary lands exactly where the spawner puts it.
      if (n > 1) {
        const justBefore = computeWaveClock(waveTime(n) - 0.001);
        expect(justBefore.wave).toBe(n - 1);
        expect(justBefore.countdownToNext).toBeCloseTo(0.001, 6);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The clock and the spawner, tied together (a0-16)
// ---------------------------------------------------------------------------
//
// The bug this replaced: `waveTime`'s `interval` argument defaults to the
// baseline `WAVE_INTERVAL_S`, the spawner passed the match's own
// `world.economy.waveInterval`, and this clock took the default. SCARCE is the
// DEFAULT abundance, so in a default match the countdown reached zero fifteen
// seconds before the rocks arrived — every game, for the whole match.
//
// These do not assert a literal 165 s. They assert the clock's countdown target
// IS the tick the spawner spawns on, whatever the abundance table says — so
// a0-17 can widen the SCARCE↔RICH spread as far as it likes and this still holds.

/** A world at one abundance level, big and quiet: the wave schedule is all we
 *  are measuring, so the rocks are only there to be counted as arrivals. */
function matchAt(abundance: Abundance): World {
  return createWorld({
    seed: 11,
    players: [
      { id: 0, shipClass: ShipClass.Vanguard },
      { id: 1, shipClass: ShipClass.Vanguard },
    ],
    abundance,
  });
}

/**
 * Run the world forward in `SPAWN_DT` steps until wave `n` has been delivered,
 * and return the tick it landed on together with the one before it — the bracket
 * the wave's true arrival time falls inside. Comparing against the bracket rather
 * than the landing tick alone is what lets this assert agreement *exactly*
 * without needing the interval to be a whole number of ticks (RICH's is not).
 */
const SPAWN_DT = 1;
function waveLandingBracket(world: World, n: number): { landed: number; before: number } {
  let guard = 0;
  let before = world.time;
  while (world.match.wavesSpawned < n && guard < 10_000) {
    before = world.time;
    step(world, [], SPAWN_DT);
    guard++;
  }
  expect(world.match.wavesSpawned, `wave ${n} was delivered`).toBeGreaterThanOrEqual(n);
  return { landed: world.time, before };
}

describe('the clock counts down to the wave the spawner actually spawns (a0-16)', () => {
  for (const abundance of ['scarce', 'standard', 'rich'] as const) {
    it(`agrees with the spawner at ${abundance.toUpperCase()}`, () => {
      const world = matchAt(abundance);
      const interval = waveIntervalOf(world);

      for (let n = 2; n <= WAVE_COUNT; n++) {
        // Where the clock says wave n arrives: the countdown, read one tick
        // before the wave lands, plus the time it was read at.
        const early = computeWaveClock(waveTime(n, interval) - 1, false, interval);
        expect(early.wave, `${abundance}: still wave ${n - 1} a tick early`).toBe(n - 1);
        const clockTarget = early.matchTime + (early.countdownToNext ?? NaN);

        // Where the spawner actually puts it: the wave lands on the first tick
        // at or after the clock's target, and not one tick sooner. That is the
        // agreement — exact, and true whatever a0-17 sets the multipliers to.
        const { landed, before } = waveLandingBracket(world, n);
        expect(landed, `${abundance}: wave ${n} not spawned before the countdown ends`)
          .toBeGreaterThanOrEqual(clockTarget - 1e-9);
        expect(before, `${abundance}: wave ${n} not spawned a tick late`)
          .toBeLessThan(clockTarget + 1e-9);
      }
    });
  }

  it('the countdown reaches zero on the frame the rocks land — the SCARCE case', () => {
    // The player-facing shape of the bug, in the default abundance. Step the
    // real sim and read the clock on the same frame: the countdown must be
    // spent exactly when `wavesSpawned` ticks up, not fifteen seconds after.
    const world = matchAt('scarce');
    const interval = waveIntervalOf(world);
    let sawWave2 = false;

    while (world.match.wavesSpawned < 2) {
      const before = world.match.wavesSpawned;
      const clock = computeWaveClock(world.time, false, interval);
      step(world, [], 1);
      if (world.match.wavesSpawned > before) {
        // The frame the wave landed on: the clock, read at its start, had at
        // most that one step of countdown left.
        expect(clock.countdownToNext).toBeLessThanOrEqual(1 + 1e-9);
        expect(clock.countdownToNext).toBeGreaterThanOrEqual(0);
        sawWave2 = true;
      } else {
        // Any earlier frame: the countdown is still running, and the clock has
        // not promised a wave the sim is not about to deliver.
        expect(clock.countdownToNext).toBeGreaterThan(0);
      }
    }
    expect(sawWave2).toBe(true);
  });

  it('a SCARCE clock is genuinely slower than the baseline it used to read', () => {
    // Not a literal: only that reading the per-world interval CHANGED the answer,
    // which is the whole claim of the fix. (If a0-17 ever set SCARCE's multiplier
    // to 1 this would fail loudly rather than quietly re-hiding the bug.)
    const scarce = waveIntervalOf(matchAt('scarce'));
    expect(scarce).toBeGreaterThan(WAVE_INTERVAL_S);
    const atZero = computeWaveClock(0, false, scarce);
    const baselineAtZero = computeWaveClock(0, false, WAVE_INTERVAL_S);
    expect(atZero.countdownToNext).toBeGreaterThan(baselineAtZero.countdownToNext!);
  });

  it('a world with no resolved economy reads the baseline and does not throw', () => {
    // Net snapshots, bot fixtures and @platform/freeze hand-build worlds with no
    // `economy`, exactly as they do with no `ledger`. The clock must show them
    // the pre-abundance cadence rather than crash on a missing field.
    const foreign = { time: 0 } as unknown as World;
    expect(() => waveIntervalOf(foreign)).not.toThrow();
    expect(waveIntervalOf(foreign)).toBe(WAVE_INTERVAL_S);
    expect(waveIntervalOf(undefined)).toBe(WAVE_INTERVAL_S);

    // …and the clock built on it matches the no-argument form exactly.
    const fallback = computeWaveClock(10, false, waveIntervalOf(foreign));
    expect(fallback).toEqual(computeWaveClock(10));
    expect(fallback.countdownToNext).toBeCloseTo(WAVE_INTERVAL_S - 10, 6);
  });
});

describe('the collapse phase (GDD §2.3)', () => {
  it('is not collapsed by default — a caller that predates the endgame is safe', () => {
    expect(computeWaveClock(0).isCollapsed).toBe(false);
    expect(computeWaveClock(WAVE_INTERVAL_S * 99).isCollapsed).toBe(false);
  });

  it('reports collapse when the sim says so, independently of the wave number', () => {
    // Collapse begins the instant the field runs dry, which can happen during
    // the final wave — so it is not "final wave, later", and the clock takes
    // the sim's verdict rather than inferring one from the time.
    const early = computeWaveClock(WAVE_INTERVAL_S * (WAVE_COUNT - 1) + 1, true);
    expect(early.isCollapsed).toBe(true);
    expect(early.isFinalWave).toBe(true);
  });
});

describe('formatClock', () => {
  it('formats seconds as m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(9)).toBe('0:09');
    expect(formatClock(75)).toBe('1:15');
    expect(formatClock(150)).toBe('2:30');
  });

  it('rounds up so a pending countdown never reads 0:00 early', () => {
    expect(formatClock(0.1)).toBe('0:01');
    expect(formatClock(59.4)).toBe('1:00');
  });

  it('clamps negatives to 0:00', () => {
    expect(formatClock(-3)).toBe('0:00');
  });
});
